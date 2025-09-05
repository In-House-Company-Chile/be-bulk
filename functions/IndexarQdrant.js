require('dotenv').config();
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs').promises;
const path = require('path');

class IndexarQdrant {
  constructor(doc, collectionName, metadata, options = {}) {
    this.doc = doc;
    this.collectionName = collectionName;
    this.metadata = metadata;
    this.filePath = options.filePath || null; // Ruta del archivo original
    
    // URLs de servicios
    this.embeddingUrl = options.embeddingUrl || 'https://ms-vector.sandbox.governare.ai/embed';
    this.qdrantUrl = options.qdrantUrl || 'http://localhost:6333';
    
    // Carpeta para archivos con errores
    this.errorFolder = process.env.ERROR_FOLDER || './error_files';
    
    // Configuración OPTIMIZADA PARA RTX 3060
    this.vectorDimension = options.vectorDimension || 1024;
    this.chunkSize = options.chunkSize || 800;
    this.chunkOverlap = options.chunkOverlap || 80;
    this.embeddingBatchSize = options.embeddingBatchSize || 128; // Aumentado para GPU
    this.upsertBatchSize = options.upsertBatchSize || 500;       // Batches más grandes
    this.maxConcurrentUpserts = options.maxConcurrentUpserts || 20; // Más concurrencia
    
    // Cliente HTTP optimizado para alta concurrencia
    this.httpClient = require('axios').create({
      timeout: 120000, // Timeout más largo
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      httpAgent: new (require('http').Agent)({
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 200,  // Más sockets
        maxFreeSockets: 50
      })
    });
  }

  static create(doc, collectionName, metadata, options) {
    return new IndexarQdrant(doc, collectionName, metadata, options).indexar();
  }

  // Función para mover archivos con errores a carpeta específica
  async moveFileToErrorFolder(error) {
    if (!this.filePath) {
      console.warn('⚠️  No se especificó filePath, no se puede mover el archivo con error');
      return false;
    }

    try {
      // Asegurar que la carpeta de errores existe
      await fs.mkdir(this.errorFolder, { recursive: true });
      
      // Obtener el nombre del archivo original
      const fileName = path.basename(this.filePath);
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const errorFileName = `${timestamp}_${fileName}`;
      const errorFilePath = path.join(this.errorFolder, errorFileName);
      
      // Verificar si el archivo original existe
      try {
        await fs.access(this.filePath);
      } catch (accessError) {
        console.warn(`⚠️  Archivo original no encontrado: ${this.filePath}`);
        return false;
      }
      
      // Mover el archivo a la carpeta de errores
      await fs.rename(this.filePath, errorFilePath);
      
      // Crear un archivo de log con el error
      const errorLogPath = path.join(this.errorFolder, `${timestamp}_${path.parse(fileName).name}_error.log`);
      const errorInfo = {
        originalFile: this.filePath,
        movedTo: errorFilePath,
        timestamp: new Date().toISOString(),
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name
        },
        metadata: this.metadata,
        collectionName: this.collectionName
      };
      
      await fs.writeFile(errorLogPath, JSON.stringify(errorInfo, null, 2));
      
      console.log(`📁 Archivo movido a carpeta de errores: ${errorFilePath}`);
      console.log(`📋 Log de error creado: ${errorLogPath}`);
      
      return true;
    } catch (moveError) {
      console.error('❌ Error al mover archivo a carpeta de errores:', moveError.message);
      return false;
    }
  }

  // Verificar/crear colección en Qdrant
  async ensureCollection() {
    try {
      // Verificar si la colección existe
      const response = await axios.get(`${this.qdrantUrl}/collections/${this.collectionName}`);
      
      if (response.data.status === 'ok') {
        // console.log(`✅ Colección '${this.collectionName}' ya existe`);
        return true;
      }
    } catch (error) {
      if (error.response && error.response.status === 404) {
        // La colección no existe, crearla
        // console.log(`📦 Creando colección '${this.collectionName}'...`);
        
        const collectionConfig = {
          vectors: {
            size: this.vectorDimension,
            distance: "Cosine"
          },
          optimizers_config: {
            default_segment_number: 4,
            indexing_threshold: 20000,
            memmap_threshold: 50000
          },
          quantization_config: {
            scalar: {
              type: "int8",
              quantile: 0.99,
              always_ram: true
            }
          }
        };

        await axios.put(
          `${this.qdrantUrl}/collections/${this.collectionName}`,
          collectionConfig,
          { headers: { 'Content-Type': 'application/json' } }
        );

        // console.log(`✅ Colección '${this.collectionName}' creada exitosamente`);
        return true;
      }
      
      throw error;
    }
  }

  // Obtener embeddings del servicio
  async getEmbedding(text) {
    try {
      const response = await this.httpClient.post(
        this.embeddingUrl,
        { inputs: text },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
  
      // CAMBIAR ESTA PARTE
      // Si response.data es directamente el array de números
      if (Array.isArray(response.data) && typeof response.data[0] === 'number') {
        const embedding = response.data;  // <-- Usar directamente response.data
        
        // Verificar dimensión
        if (embedding.length !== this.vectorDimension) {
          console.warn(`⚠️  Dimensión inesperada: ${embedding.length} vs ${this.vectorDimension} esperado`);
        }
        
        return embedding;
      } 
      // Si es un array de arrays (para compatibilidad con batch)
      else if (Array.isArray(response.data) && Array.isArray(response.data[0])) {
        return response.data[0];
      } 
      else {
        console.error('Formato inesperado:', response.data);
        throw new Error('Formato de respuesta inesperado del servicio de embeddings');
      }
    } catch (error) {
      console.error('❌ Error al obtener embedding:', error.message);
      throw error;
    }
  }

  // Obtener embeddings en lote OPTIMIZADO
  async getEmbeddingsBatch(texts) {
    try {
      const response = await this.httpClient.post(
        this.embeddingUrl,
        { inputs: texts }, // Array de textos
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
  
      // Si el servicio devuelve un array de arrays (batch)
      if (Array.isArray(response.data)) {
        // Verificar si es un batch (array de arrays) o un solo vector
        if (texts.length === 1 && typeof response.data[0] === 'number') {
          // Es un solo vector, envolverlo en array
          return [response.data];
        } else if (Array.isArray(response.data[0])) {
          // Es un array de arrays (batch correcto)
          return response.data;
        } else {
          // Formato inesperado
          throw new Error('Formato de batch inesperado');
        }
      } else {
        throw new Error('Respuesta no es un array');
      }
    } catch (error) {
      // Fallback: procesar uno por uno
      // console.log('⚠️  Procesamiento en lote falló, procesando individualmente...');
      const embeddings = [];
      for (const text of texts) {
        const embedding = await this.getEmbedding(text);
        embeddings.push(embedding);
      }
      return embeddings;
    }
  }

  // Insertar puntos en Qdrant OPTIMIZADO
  async upsertToQdrant(points) {
    try {
      const response = await this.httpClient.put(
        `${this.qdrantUrl}/collections/${this.collectionName}/points`,
        { points },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000 // Timeout más largo
        }
      );

      if (response.data.status === 'ok') {
        return true;
      } else {
        throw new Error(`Error en upsert: ${JSON.stringify(response.data)}`);
      }
    } catch (error) {
      console.error('❌ Error al insertar en Qdrant:', error.message);
      throw error;
    }
  }

  async indexar() {
    try {
      // console.log('🚀 Iniciando indexación en Qdrant...');
      
      // Asegurar que la colección existe
      await this.ensureCollection();

      // Dividir el texto en chunks
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap,
        lengthFunction: (text) => text.length
      });

      const chunks = await textSplitter.splitText(this.doc);
      // console.log(`📄 Procesando ${chunks.length} chunks para indexar...`);

      // Generar ID único para el documento
      const docId = this.metadata.idNorm || `doc_${uuidv4()}`;
      
      // PROCESAMIENTO ULTRA PARALELO CON RTX 3060
      // console.log(`🚀 Procesamiento ultra paralelo: ${this.embeddingBatchSize} chunks por batch`);
      
      const allPromises = [];
      const batchPromises = [];
      let totalProcessed = 0;
      
      // Crear todos los batches de embeddings en paralelo
      for (let i = 0; i < chunks.length; i += this.embeddingBatchSize) {
        const batchChunks = chunks.slice(i, i + this.embeddingBatchSize);
        const batchIndex = Math.floor(i / this.embeddingBatchSize);
        
        const batchPromise = this.processBatchOptimized(batchChunks, docId, i, chunks.length, batchIndex);
        batchPromises.push(batchPromise);
        
        // Limitar concurrencia para no saturar la GPU
        if (batchPromises.length >= 10) { // Máximo 10 batches paralelos
          const results = await Promise.allSettled(batchPromises);
          totalProcessed += this.processBatchResults(results);
          batchPromises.length = 0; // Limpiar array
        }
      }
      
      // Procesar batches restantes
      if (batchPromises.length > 0) {
        const results = await Promise.allSettled(batchPromises);
        totalProcessed += this.processBatchResults(results);
      }
      
      // console.log(`✅ Total chunks procesados: ${totalProcessed}/${chunks.length}`);

      // Verificar el conteo final
      const collectionInfo = await this.httpClient.get(
        `${this.qdrantUrl}/collections/${this.collectionName}`, { timeout: 30000 }
      );
      
      const vectorCount = collectionInfo.data.result.vectors_count;
      
      // console.log(`\n✅ Indexación completada exitosamente:`);
      // console.log(`   📊 Documento: ${docId}`);
      // console.log(`   📝 Chunks procesados: ${chunks.length}`);
      // console.log(`   🗄️  Total vectores en colección: ${vectorCount}`);
      
      return {
        success: true,
        docId,
        chunksProcessed: chunks.length,
        totalVectors: vectorCount
      };

    } catch (error) {
      console.error('❌ Error durante la indexación:', error);
      
      // Mover archivo a carpeta de errores si está especificado
      if (this.filePath) {
        // console.log('🔄 Moviendo archivo con error a carpeta específica...');
        const moved = await this.moveFileToErrorFolder(error);
        if (moved) {
          console.log('✅ Archivo movido exitosamente a carpeta de errores');
        } else {
          console.log('⚠️  No se pudo mover el archivo a la carpeta de errores');
        }
      }
      
      throw error;
    }
  }
  
  // Método optimizado para procesar un batch
  async processBatchOptimized(batchChunks, docId, startIndex, totalChunks, batchIndex) {
    try {
      // console.log(`🔄 Batch ${batchIndex + 1}: ${batchChunks.length} chunks`);
      
      // Obtener embeddings para el lote
      const embeddings = await this.getEmbeddingsBatch(batchChunks);
      
      // Preparar puntos para Qdrant
      const points = batchChunks.map((chunk, idx) => ({
        id: uuidv4(),
        vector: embeddings[idx],
        payload: {
          ...this.metadata,
          doc_id: docId,
          text: chunk,
          chunk_index: startIndex + idx,
          total_chunks: totalChunks,
          timestamp: new Date().toISOString()
        }
      }));

      // Insertar en Qdrant con batches más grandes
      await this.upsertBatchParallel(points);
      
      return points.length;
    } catch (error) {
      console.error(`❌ Error en batch ${batchIndex}:`, error.message);
      
      // Si es un error crítico y tenemos filePath, logearlo para posible movimiento
      if (this.filePath && error.message.includes('ECONNREFUSED') || error.message.includes('timeout')) {
        console.warn(`⚠️  Error crítico en batch ${batchIndex} para archivo: ${this.filePath}`);
      }
      
      return 0;
    }
  }
  
  // Método para upsert paralelo en batches grandes
  async upsertBatchParallel(points) {
    const upsertPromises = [];
    
    for (let i = 0; i < points.length; i += this.upsertBatchSize) {
      const batch = points.slice(i, i + this.upsertBatchSize);
      
      // Limitar upserts concurrentes
      if (upsertPromises.length >= this.maxConcurrentUpserts) {
        await Promise.race(upsertPromises.map((p, idx) => 
          p.then(() => upsertPromises.splice(idx, 1))
        ));
      }
      
      const promise = this.upsertToQdrant(batch)
        .catch(error => {
          console.error(`❌ Error en upsert batch:`, error.message);
          // Reintentar una vez
          return this.upsertToQdrant(batch);
        });
      
      upsertPromises.push(promise);
    }
    
    // Esperar a que terminen todos los upserts
    await Promise.all(upsertPromises);
  }
  
  // Procesar resultados de batches
  processBatchResults(results) {
    let processed = 0;
    results.forEach((result, idx) => {
      if (result.status === 'fulfilled') {
        processed += result.value;
      } else {
        console.error(`❌ Batch ${idx} falló:`, result.reason?.message);
      }
    });
    return processed;
  }

  // Método auxiliar para búsqueda (útil para testing)
  static async search(collectionName, queryText, options = {}) {
    const {
      embeddingUrl = 'http://localhost:11440/embed',
      qdrantUrl = 'http://localhost:6333',
      limit = 5,
      scoreThreshold = 0.7
    } = options;

    try {
      // Cliente HTTP optimizado para búsqueda
      const httpClient = require('axios').create({
        timeout: 30000,
        httpAgent: new (require('http').Agent)({
          keepAlive: true,
          maxSockets: 50
        })
      });
      
      // Obtener embedding de la consulta
      const response = await httpClient.post(
        embeddingUrl,
        { inputs: queryText },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const queryVector = Array.isArray(response.data) && typeof response.data[0] === 'number' 
        ? response.data 
        : response.data[0];

      // Buscar en Qdrant
      const searchResponse = await httpClient.post(
        `${qdrantUrl}/collections/${collectionName}/points/search`,
        {
          vector: queryVector,
          limit,
          score_threshold: scoreThreshold,
          with_payload: true,
          with_vector: false
        },
        { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
      );

      return searchResponse.data.result;
    } catch (error) {
      console.error('❌ Error en búsqueda:', error);
      throw error;
    }
  }
}

module.exports = IndexarQdrant;