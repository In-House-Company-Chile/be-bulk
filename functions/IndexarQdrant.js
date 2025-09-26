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
    this.embeddingBatchSize = options.embeddingBatchSize || 20;  // Reducido para estabilidad
    this.upsertBatchSize = options.upsertBatchSize || 50;        // Batches pequeños
    this.maxConcurrentUpserts = options.maxConcurrentUpserts || 2; // Muy poca concurrencia
    
    // Cliente HTTP optimizado para estabilidad
    this.httpClient = require('axios').create({
      timeout: 300000, // 5 minutos de timeout
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      httpAgent: new (require('http').Agent)({
        keepAlive: true,
        keepAliveMsecs: 3000,
        maxSockets: 20,   // Reducido para estabilidad
        maxFreeSockets: 5
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

  // Función auxiliar para delays
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Función de reintento con backoff exponencial
  async retryWithBackoff(fn, maxRetries = 3, baseDelay = 2000) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        if (attempt === maxRetries) {
          throw error;
        }
        
        const delay = baseDelay * Math.pow(2, attempt - 1);
        console.log(`⚠️ Intento ${attempt} falló, reintentando en ${delay}ms...`);
        await this.sleep(delay);
      }
    }
  }

  // Verificar/crear colección en Qdrant con reintentos
  async ensureCollection() {
    return await this.retryWithBackoff(async () => {
      try {
        // Verificar si la colección existe
        const response = await this.httpClient.get(`${this.qdrantUrl}/collections/${this.collectionName}`);
        
        if (response.data.status === 'ok') {
          return true;
        }
      } catch (error) {
        if (error.response && error.response.status === 404) {
          // La colección no existe, crearla
          console.log(`📦 Creando colección '${this.collectionName}'...`);
          
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

          await this.httpClient.put(
            `${this.qdrantUrl}/collections/${this.collectionName}`,
            collectionConfig,
            { headers: { 'Content-Type': 'application/json' } }
          );

          console.log(`✅ Colección '${this.collectionName}' creada exitosamente`);
          await this.sleep(1000); // Pausa después de crear colección
          return true;
        }
        
        throw error;
      }
    }, 5, 3000); // 5 reintentos con delay base de 3 segundos
  }

  // Obtener embeddings del servicio con reintentos
  async getEmbedding(text) {
    return await this.retryWithBackoff(async () => {
      const response = await this.httpClient.post(
        this.embeddingUrl,
        { inputs: text },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
  
      // Si response.data es directamente el array de números
      if (Array.isArray(response.data) && typeof response.data[0] === 'number') {
        const embedding = response.data;
        
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
    }, 3, 2000);
  }

  // Obtener embeddings en lote con reintentos y delays
  async getEmbeddingsBatch(texts) {
    return await this.retryWithBackoff(async () => {
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
    }, 3, 2000).catch(async (error) => {
      // Fallback: procesar uno por uno con delays
      console.log('⚠️  Procesamiento en lote falló, procesando individualmente...');
      const embeddings = [];
      for (let i = 0; i < texts.length; i++) {
        const text = texts[i];
        const embedding = await this.getEmbedding(text);
        embeddings.push(embedding);
        
        // Pausa entre embeddings individuales
        if (i < texts.length - 1) {
          await this.sleep(100);
        }
      }
      return embeddings;
    });
  }

  // Insertar puntos en Qdrant con reintentos
  async upsertToQdrant(points) {
    return await this.retryWithBackoff(async () => {
      const response = await this.httpClient.put(
        `${this.qdrantUrl}/collections/${this.collectionName}/points`,
        { points },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (response.data.status === 'ok') {
        // Pausa pequeña después de cada upsert exitoso
        await this.sleep(50);
        return true;
      } else {
        throw new Error(`Error en upsert: ${JSON.stringify(response.data)}`);
      }
    }, 3, 3000); // 3 reintentos con delay base de 3 segundos
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
      
      // PROCESAMIENTO SECUENCIAL ESTABLE
      console.log(`🐢 Procesamiento secuencial estable: ${this.embeddingBatchSize} chunks por batch`);
      
      let totalProcessed = 0;
      
      // Procesar batches secuencialmente para máxima estabilidad
      for (let i = 0; i < chunks.length; i += this.embeddingBatchSize) {
        const batchChunks = chunks.slice(i, i + this.embeddingBatchSize);
        const batchIndex = Math.floor(i / this.embeddingBatchSize);
        const totalBatches = Math.ceil(chunks.length / this.embeddingBatchSize);
        
        console.log(`🔄 Procesando batch ${batchIndex + 1}/${totalBatches} (${batchChunks.length} chunks)`);
        
        try {
          const processedCount = await this.processBatchOptimized(batchChunks, docId, i, chunks.length, batchIndex);
          totalProcessed += processedCount;
          
          // Pausa entre batches para dar respiro
          if (i + this.embeddingBatchSize < chunks.length) {
            await this.sleep(1000); // 1 segundo entre batches
          }
        } catch (error) {
          console.error(`❌ Error en batch ${batchIndex + 1}:`, error.message);
          // Continuar con el siguiente batch
        }
      }
      
      // console.log(`✅ Total chunks procesados: ${totalProcessed}/${chunks.length}`);

      // Verificar el conteo final
      const collectionInfo = await this.httpClient.get(
        `${this.qdrantUrl}/collections/${this.collectionName}`
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
  
  // Método para upsert secuencial con delays
  async upsertBatchParallel(points) {
    // Procesar secuencialmente para máxima estabilidad
    for (let i = 0; i < points.length; i += this.upsertBatchSize) {
      const batch = points.slice(i, i + this.upsertBatchSize);
      const batchNumber = Math.floor(i / this.upsertBatchSize) + 1;
      const totalBatches = Math.ceil(points.length / this.upsertBatchSize);
      
      console.log(`📤 Subiendo batch ${batchNumber}/${totalBatches} a Qdrant (${batch.length} puntos)`);
      
      try {
        await this.upsertToQdrant(batch);
        console.log(`✅ Batch ${batchNumber} subido exitosamente`);
        
        // Pausa entre upserts para no saturar Qdrant
        if (i + this.upsertBatchSize < points.length) {
          await this.sleep(500); // 500ms entre batches de upsert
        }
      } catch (error) {
        console.error(`❌ Error en upsert batch ${batchNumber}:`, error.message);
        throw error; // Re-lanzar el error para que sea manejado por el retry
      }
    }
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
        { headers: { 'Content-Type': 'application/json' } }
      );

      return searchResponse.data.result;
    } catch (error) {
      console.error('❌ Error en búsqueda:', error);
      throw error;
    }
  }
}

module.exports = IndexarQdrant;