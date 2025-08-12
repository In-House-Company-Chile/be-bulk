const fs = require('fs');
const path = require('path');

/**
 * Clase para cargar documentos desde una carpeta externa
 * Soporta archivos JSON, TXT, y otros formatos de texto
 */
class LoadDocumentsFromDir {
  constructor(dirPath, options = {}) {
    this.dirPath = dirPath;
    this.options = {
      extensions: options.extensions || ['.json', '.txt', '.md'],
      recursive: options.recursive || false,
      encoding: options.encoding || 'utf8',
      processedDir: options.processedDir || null, // Carpeta donde mover archivos procesados
      ...options
    };
  }

  /**
   * Método estático para crear y extraer documentos
   * @param {string} dirPath - Ruta de la carpeta
   * @param {Object} options - Opciones de configuración
   */
  static async create(dirPath, options = {}) {
    const loader = new LoadDocumentsFromDir(dirPath, options);
    return await loader.extract();
  }

  /**
   * Verifica si un archivo tiene una extensión válida
   * @param {string} filename - Nombre del archivo
   */
  isValidFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return this.options.extensions.includes(ext);
  }

  /**
   * Lee y procesa un archivo JSON
   * @param {string} filePath - Ruta del archivo
   */
  processJsonFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, this.options.encoding);
      const jsonData = JSON.parse(content);
      
      return {
        type: 'json',
        filename: path.basename(filePath),
        filePath: filePath,
        data: jsonData,
        // Intentar extraer campos comunes
        id: jsonData.id || jsonData.idSentence || jsonData.idNorm || path.basename(filePath, '.json'),
        text: jsonData.texto_sentencia || jsonData.planeText || jsonData.content || JSON.stringify(jsonData),
        metadata: this.extractMetadataFromJson(jsonData)
      };
    } catch (error) {
      console.error(`❌ Error procesando archivo JSON ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Lee y procesa un archivo de texto
   * @param {string} filePath - Ruta del archivo
   */
  processTextFile(filePath) {
    try {
      const content = fs.readFileSync(filePath, this.options.encoding);
      
      if (!content || content.trim().length === 0) {
        console.warn(`⚠️ Archivo vacío: ${filePath}`);
        return null;
      }

      return {
        type: 'text',
        filename: path.basename(filePath),
        filePath: filePath,
        data: content,
        id: path.basename(filePath, path.extname(filePath)),
        text: content,
        metadata: {
          filename: path.basename(filePath),
          extension: path.extname(filePath),
          size: content.length,
          created: fs.statSync(filePath).birthtime,
          modified: fs.statSync(filePath).mtime
        }
      };
    } catch (error) {
      console.error(`❌ Error procesando archivo de texto ${filePath}:`, error.message);
      return null;
    }
  }

  /**
   * Extrae metadatos de un objeto JSON según diferentes estructuras
   * @param {Object} jsonData - Datos JSON del archivo
   */
  extractMetadataFromJson(jsonData) {
    const metadata = {};

    // Metadatos comunes para sentencias judiciales
    if (jsonData.rol_era_sup_s) metadata.rol = jsonData.rol_era_sup_s;
    if (jsonData.caratulado_s) metadata.caratulado = jsonData.caratulado_s;
    if (jsonData.fec_sentencia_sup_dt) metadata.fechaSentencia = jsonData.fec_sentencia_sup_dt;
    if (jsonData.gls_juz_s) metadata.tribunal = jsonData.gls_juz_s;
    if (jsonData.gls_juez_ss) metadata.juez = jsonData.gls_juez_ss;
    if (jsonData.gls_materia_s) metadata.materia = jsonData.gls_materia_s;
    if (jsonData.url_corta_acceso_sentencia) metadata.url = jsonData.url_corta_acceso_sentencia;

    // Metadatos para normas
    if (jsonData.data && jsonData.data.metadatos) {
      const meta = jsonData.data.metadatos;
      if (meta.titulo_norma) metadata.titulo_norma = meta.titulo_norma;
      if (meta.fecha_publicacion) metadata.fecha_publicacion = meta.fecha_publicacion;
      if (meta.fecha_promulgacion) metadata.fecha_promulgacion = meta.fecha_promulgacion;
      if (meta.organismos) metadata.organismos = meta.organismos;
      if (meta.tipos_numeros) metadata.tipos_numeros = meta.tipos_numeros;
    }

    // ID del documento
    metadata.idSentence = jsonData.id || jsonData.idSentence || jsonData.idNorm;

    return metadata;
  }

  /**
   * Obtiene todos los archivos de la carpeta (con opción recursiva)
   * @param {string} dirPath - Ruta de la carpeta
   */
  getAllFiles(dirPath) {
    let files = [];
    
    try {
      const items = fs.readdirSync(dirPath);
      
      for (const item of items) {
        const fullPath = path.join(dirPath, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && this.options.recursive) {
          files = files.concat(this.getAllFiles(fullPath));
        } else if (stat.isFile() && this.isValidFile(item)) {
          files.push(fullPath);
        }
      }
    } catch (error) {
      console.error(`❌ Error leyendo carpeta ${dirPath}:`, error.message);
    }
    
    return files;
  }

  /**
   * Mueve un archivo a la carpeta de procesados
   * @param {string} filePath - Ruta del archivo original
   */
  moveToProcessed(filePath) {
    if (!this.options.processedDir) return;

    try {
      // Crear carpeta de procesados si no existe
      if (!fs.existsSync(this.options.processedDir)) {
        fs.mkdirSync(this.options.processedDir, { recursive: true });
      }

      const filename = path.basename(filePath);
      const processedPath = path.join(this.options.processedDir, filename);
      
      // Si ya existe, agregar timestamp
      let finalPath = processedPath;
      if (fs.existsSync(processedPath)) {
        const ext = path.extname(filename);
        const name = path.basename(filename, ext);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        finalPath = path.join(this.options.processedDir, `${name}_${timestamp}${ext}`);
      }

      fs.renameSync(filePath, finalPath);
      console.log(`📁 Archivo movido a procesados: ${finalPath}`);
    } catch (error) {
      console.error(`❌ Error moviendo archivo ${filePath}:`, error.message);
    }
  }

  /**
   * Extrae y procesa todos los documentos de la carpeta
   */
  async extract() {
    try {
      console.log(`📂 Cargando documentos desde: ${this.dirPath}`);
      
      // Verificar que la carpeta existe
      if (!fs.existsSync(this.dirPath)) {
        throw new Error(`La carpeta no existe: ${this.dirPath}`);
      }

      const stat = fs.statSync(this.dirPath);
      if (!stat.isDirectory()) {
        throw new Error(`La ruta no es una carpeta: ${this.dirPath}`);
      }

      // Obtener todos los archivos
      const files = this.getAllFiles(this.dirPath);
      
      if (files.length === 0) {
        console.log(`⚠️ No se encontraron archivos válidos en: ${this.dirPath}`);
        console.log(`   Extensiones buscadas: ${this.options.extensions.join(', ')}`);
        return [];
      }

      console.log(`📄 Encontrados ${files.length} archivos para procesar`);

      const documents = [];
      let processedCount = 0;
      let errorCount = 0;

      // Procesar cada archivo
      for (const filePath of files) {
        try {
          console.log(`🔄 Procesando: ${path.basename(filePath)}`);
          
          const ext = path.extname(filePath).toLowerCase();
          let document = null;

          if (ext === '.json') {
            document = this.processJsonFile(filePath);
          } else {
            document = this.processTextFile(filePath);
          }

          if (document) {
            documents.push(document);
            processedCount++;
            
            // Mover a carpeta de procesados si está configurado
            this.moveToProcessed(filePath);
          } else {
            errorCount++;
          }

        } catch (error) {
          console.error(`❌ Error procesando ${filePath}:`, error.message);
          errorCount++;
        }
      }

      // Resumen
      console.log(`\n📊 Resumen de carga:`);
      console.log(`   ✅ Procesados exitosamente: ${processedCount}`);
      console.log(`   ❌ Errores: ${errorCount}`);
      console.log(`   📁 Total archivos: ${files.length}`);

      return documents;

    } catch (error) {
      console.error('❌ Error general cargando documentos:', error.message);
      throw error;
    }
  }
}

module.exports = LoadDocumentsFromDir;