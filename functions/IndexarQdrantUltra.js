const axios = require('axios');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Generador de IDs únicos para Qdrant (enteros)
class IdGenerator {
  static counter = 0;
  
  static generateId() {
    // Usar timestamp + contador para garantizar unicidad
    const timestamp = Date.now();
    this.counter = (this.counter + 1) % 1000; // Reset cada 1000
    return parseInt(`${timestamp}${this.counter.toString().padStart(3, '0')}`);
  }
}

/**
 * Clase ULTRA-OPTIMIZADA para indexar documentos en Qdrant
 * Configurada para 30+ docs/seg en RTX 3060 con 12GB VRAM
 */
class IndexarQdrantUltra {
  constructor(doc, collectionName, metadata = {}) {
    this.doc = doc;
    this.collectionName = collectionName;
    this.metadata = metadata;
    this.qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    this.embeddingUrl = process.env.EMBEDDING_URL || 'http://localhost:11441/embed';
    
    // CONFIGURACIÓN ULTRA - Para RTX 3060 12GB + 30GB RAM
    this.embeddingConcurrency = 64; // Máximo paralelismo (8x más)
    this.batchSize = 150; // Lotes masivos (10x más)
    this.batchDelay = 0; // SIN pausas
    this.requestTimeout = 45000; // Timeout más largo para lotes grandes
    
    // Pool de conexiones para embeddings (reutilizar conexiones)
    this.axiosInstance = axios.create({
      timeout: this.requestTimeout,
      maxRedirects: 0,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      }
    });
  }

  /**
   * Método estático para crear y ejecutar la indexación ULTRA
   */
  static async create(doc, collectionName, metadata = {}, sourceFilePath = null) {
    const indexer = new IndexarQdrantUltra(doc, collectionName, metadata);
    return await indexer.indexar(sourceFilePath);
  }

  /**
   * Genera embeddings con paralelismo MASIVO (64 simultáneos)
   * Optimizado para RTX 3060 12GB
   */
  async generateEmbeddingsUltraParallel(texts) {
    const embeddings = [];
    const errors = [];
    
    console.log(`⚡ Generando ${texts.length} embeddings - MODO ULTRA (concurrencia: ${this.embeddingConcurrency})`);
    
    // Dividir en súper-lotes para evitar saturar completamente
    const superBatchSize = Math.min(this.embeddingConcurrency * 4, 256); // Máximo 256 por súper-lote
    
    for (let i = 0; i < texts.length; i += superBatchSize) {
      const superBatch = texts.slice(i, i + superBatchSize);
      const superBatchNum = Math.floor(i / superBatchSize) + 1;
      const totalSuperBatches = Math.ceil(texts.length / superBatchSize);
      
      console.log(`🔥 Súper-lote ${superBatchNum}/${totalSuperBatches} (${superBatch.length} embeddings)...`);
      
      // Procesar súper-lote en paralelo extremo
      const batchPromises = [];
      
      for (let j = 0; j < superBatch.length; j += this.embeddingConcurrency) {
        const batch = superBatch.slice(j, j + this.embeddingConcurrency);
        
        const batchPromise = Promise.all(
          batch.map(async (text, batchIndex) => {
            const globalIndex = i + j + batchIndex;
            try {
              const response = await this.axiosInstance.post(this.embeddingUrl, {
                inputs: text
              });

              if (Array.isArray(response.data) && response.data.length === 1 && Array.isArray(response.data[0])) {
                const embedding = response.data[0];
                if (embedding.length === 1024) {
                  return { index: globalIndex, embedding, success: true };
                } else {
                  throw new Error(`Embedding dimensión incorrecta: ${embedding.length}`);
                }
              } else {
                throw new Error('Formato de respuesta inesperado');
              }
            } catch (error) {
              return { index: globalIndex, error: error.message, success: false };
            }
          })
        );
        
        batchPromises.push(batchPromise);
      }
      
      // Esperar todos los lotes del súper-lote
      const superBatchResults = await Promise.all(batchPromises);
      
      // Procesar resultados
      let superBatchSuccesses = 0;
      let superBatchErrors = 0;
      
      superBatchResults.flat().forEach(result => {
        if (result.success) {
          embeddings[result.index] = result.embedding;
          superBatchSuccesses++;
        } else {
          errors.push({ index: result.index, error: result.error });
          superBatchErrors++;
        }
      });
      
      console.log(`✅ Súper-lote ${superBatchNum}: ${superBatchSuccesses} éxitos, ${superBatchErrors} errores`);
    }
    
    const successCount = embeddings.filter(e => e).length;
    console.log(`⚡ ULTRA completado: ${successCount}/${texts.length} embeddings (${((successCount/texts.length)*100).toFixed(1)}% éxito)`);
    
    return { embeddings, errors };
  }

  /**
   * Verifica si la colección existe en Qdrant, si no la crea
   */
  async ensureCollection() {
    try {
      const checkResponse = await axios.get(`${this.qdrantUrl}/collections/${this.collectionName}`);
      console.log(`✅ Colección '${this.collectionName}' existente`);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`📝 Creando colección '${this.collectionName}'...`);
        await axios.put(`${this.qdrantUrl}/collections/${this.collectionName}`, {
          vectors: {
            size: 1024,
            distance: "Cosine"
          }
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        console.log(`✅ Colección '${this.collectionName}' creada`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Inserta chunks en MEGA-LOTES (150+ chunks por lote)
   */
  async insertPointsUltraBatches(points) {
    if (points.length === 0) {
      throw new Error('No hay puntos para insertar');
    }

    const totalBatches = Math.ceil(points.length / this.batchSize);
    let insertedCount = 0;
    let failedCount = 0;

    console.log(`📤 Inserción ULTRA: ${points.length} puntos en ${totalBatches} mega-lotes de ${this.batchSize}`);

    // Procesar todos los lotes EN PARALELO (sin pausas)
    const batchPromises = [];
    
    for (let i = 0; i < points.length; i += this.batchSize) {
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      const batch = points.slice(i, i + this.batchSize);
      
      const batchPromise = this.insertSingleBatch(batch, batchNumber, totalBatches);
      batchPromises.push(batchPromise);
    }
    
    console.log(`🚀 Ejecutando ${totalBatches} lotes EN PARALELO...`);
    const batchResults = await Promise.allSettled(batchPromises);
    
    // Procesar resultados
    batchResults.forEach((result, index) => {
      if (result.status === 'fulfilled' && result.value.success) {
        insertedCount += result.value.inserted;
      } else {
        const batchSize = Math.min(this.batchSize, points.length - (index * this.batchSize));
        failedCount += batchSize;
        console.error(`❌ Lote ${index + 1} falló:`, result.reason?.message || 'Unknown error');
      }
    });

    console.log(`📤 Inserción ULTRA completada: ${insertedCount}/${points.length} insertados`);

    return {
      success: insertedCount > 0,
      inserted: insertedCount,
      failed: failedCount,
      total: points.length
    };
  }

  /**
   * Inserta un lote individual
   */
  async insertSingleBatch(batch, batchNumber, totalBatches) {
    try {
      console.log(`🔄 Lote ${batchNumber}/${totalBatches} (${batch.length} chunks) - PARALELO`);
      
      const insertResponse = await axios.put(
        `${this.qdrantUrl}/collections/${this.collectionName}/points`, 
        { points: batch }, 
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: this.requestTimeout
        }
      );

      if (insertResponse.data && insertResponse.data.status === 'ok') {
        console.log(`✅ Lote ${batchNumber}/${totalBatches} - OK`);
        return { success: true, inserted: batch.length };
      } else {
        throw new Error('Respuesta inesperada de Qdrant');
      }

    } catch (insertError) {
      console.error(`❌ Lote ${batchNumber}/${totalBatches} falló:`, insertError.message);
      return { success: false, inserted: 0 };
    }
  }

  /**
   * Configuración dinámica ULTRA basada en tamaño del documento
   */
  getUltraBatchingConfig(docText) {
    const docLength = docText.length;
    
    if (docLength > 500000) {
      // Documentos masivos (>500K chars) - lotes medianos pero más chunks
      return { batchSize: 80 };
    } else if (docLength > 200000) {
      // Documentos largos (200K-500K chars) - lotes grandes
      return { batchSize: 120 };
    } else if (docLength > 100000) {
      // Documentos medianos (100K-200K chars) - lotes muy grandes
      return { batchSize: 150 };
    } else {
      // Documentos pequeños (<100K chars) - lotes masivos
      return { batchSize: 200 };
    }
  }

  /**
   * Indexa el documento con configuración ULTRA
   */
  async indexar(sourceFilePath = null) {
    try {
      console.log(`🚀 INDEXACIÓN ULTRA iniciada: ${this.metadata.idSentence || 'ID desconocido'}`);

      // Asegurar que la colección existe
      await this.ensureCollection();

      // Configuración ULTRA dinámica
      const config = this.getUltraBatchingConfig(this.doc);
      this.batchSize = config.batchSize;
      
      console.log(`📄 Documento: ${this.doc.length} chars`);
      console.log(`⚙️ Config ULTRA: chunks=800, overlap=80, lotes=${this.batchSize}, concurrencia=${this.embeddingConcurrency}`);

      // Dividir texto en chunks (mantenemos 800 chars - está optimizado)
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 80,
        lengthFunction: (text) => text.length,
        separators: ['\n\n', '\n', '. ', ', ', ' ', ''],
      });

      const chunks = await textSplitter.createDocuments([this.doc]);
      const documents = await textSplitter.splitDocuments(chunks);

      console.log(`📄 ${documents.length} chunks creados`);

      // Extraer textos válidos
      const chunkTexts = documents
        .map(doc => doc.pageContent)
        .filter(text => text && text.trim().length > 0);

      if (chunkTexts.length === 0) {
        throw new Error('No se encontraron chunks válidos');
      }

      // EMBEDDINGS ULTRA-PARALELOS
      console.log(`⚡ Generando embeddings ULTRA para ${chunkTexts.length} chunks...`);
      const startEmbedTime = Date.now();
      const { embeddings, errors } = await this.generateEmbeddingsUltraParallel(chunkTexts);
      const embedTime = Date.now() - startEmbedTime;
      
      console.log(`⚡ Embeddings ULTRA: ${(embedTime/1000).toFixed(2)}s (${(chunkTexts.length/(embedTime/1000)).toFixed(1)} chunks/seg)`);

      // Crear puntos para Qdrant
      const points = [];
      let validChunkIndex = 0;
      
      for (let i = 0; i < documents.length; i++) {
        const chunk = documents[i];
        const chunkText = chunk.pageContent;

        if (!chunkText || chunkText.trim().length === 0) continue;

        const embedding = embeddings[validChunkIndex];
        validChunkIndex++;

        if (!embedding || !Array.isArray(embedding) || embedding.length !== 1024) {
          console.error(`❌ Embedding inválido chunk ${i + 1}`);
          continue;
        }

        const uniqueId = IdGenerator.generateId();
        const point = {
          id: uniqueId,
          vector: embedding,
          payload: {
            ...this.metadata,
            chunk_index: i,
            chunk_text: chunkText,
            total_chunks: documents.length,
            timestamp: new Date().toISOString(),
            original_id: this.metadata.idSentence || 'unknown'
          }
        };

        points.push(point);
      }

      if (points.length === 0) {
        throw new Error('No se pudieron generar embeddings válidos');
      }

      // INSERCIÓN ULTRA-PARALELA
      console.log(`📤 Inserción ULTRA de ${points.length} puntos...`);
      const startInsertTime = Date.now();
      const insertResult = await this.insertPointsUltraBatches(points);
      const insertTime = Date.now() - startInsertTime;

      console.log(`📤 Inserción ULTRA: ${(insertTime/1000).toFixed(2)}s`);

      if (insertResult.success) {
        const totalTime = (embedTime + insertTime) / 1000;
        console.log(`✅ ULTRA indexación exitosa: ${this.metadata.idSentence || 'ID desconocido'}`);
        console.log(`📊 Stats ULTRA:`);
        console.log(`   💾 Chunks: ${insertResult.inserted}/${insertResult.total}`);
        console.log(`   ⚡ Embed: ${(embedTime/1000).toFixed(2)}s (${(chunkTexts.length/(embedTime/1000)).toFixed(1)} chunks/seg)`);
        console.log(`   💾 Insert: ${(insertTime/1000).toFixed(2)}s`);
        console.log(`   🚀 Total: ${totalTime.toFixed(2)}s`);
        
        return {
          success: true,
          chunks_processed: insertResult.inserted,
          chunks_failed: insertResult.failed,
          total_chunks: insertResult.total,
          embed_time_ms: embedTime,
          insert_time_ms: insertTime,
          total_time_ms: embedTime + insertTime,
          chunks_per_second: Math.round(chunkTexts.length / (embedTime/1000))
        };
      } else {
        throw new Error(`Inserción ULTRA falló: ${insertResult.failed}/${insertResult.total}`);
      }

    } catch (error) {
      console.error(`❌ Error ULTRA indexando (${this.metadata.idSentence}):`, error.message);
      
      // Mover a carpeta de errores si es necesario
      if (error.response && error.response.status === 413 && sourceFilePath) {
        await this.moveToErrorFolder(sourceFilePath);
      }
      
      throw error;
    }
  }

  /**
   * Mueve archivo a carpeta de errores
   */
  async moveToErrorFolder(sourceFilePath) {
    try {
      const errorDir = process.env.FOLDER_ERROR;
      if (!fs.existsSync(errorDir)) {
        fs.mkdirSync(errorDir, { recursive: true });
      }
      
      const fileName = path.basename(sourceFilePath);
      const destPath = path.join(errorDir, fileName);
      
      fs.renameSync(sourceFilePath, destPath);
      console.log(`📦 Archivo movido a errores: ${fileName}`);
      
    } catch (moveError) {
      console.error(`❌ Error moviendo archivo:`, moveError.message);
    }
  }

  /**
   * Búsqueda ULTRA en Qdrant
   */
  async search(queryText, limit = 10, threshold = 0.7) {
    try {
      // Generar embedding para consulta
      const response = await this.axiosInstance.post(this.embeddingUrl, {
        inputs: queryText
      });

      let queryEmbedding;
      if (Array.isArray(response.data) && response.data.length === 1 && Array.isArray(response.data[0])) {
        queryEmbedding = response.data[0];
      } else {
        throw new Error('Formato de respuesta inesperado en búsqueda');
      }

      // Buscar en Qdrant
      const searchResponse = await axios.post(`${this.qdrantUrl}/collections/${this.collectionName}/points/search`, {
        vector: queryEmbedding,
        limit: limit,
        score_threshold: threshold,
        with_payload: true,
        with_vector: false
      }, {
        headers: { 'Content-Type': 'application/json' }
      });

      if (searchResponse.data && searchResponse.data.result) {
        return {
          success: true,
          results: searchResponse.data.result
        };
      } else {
        throw new Error('Respuesta inesperada de Qdrant en búsqueda');
      }

    } catch (error) {
      console.error('❌ Error buscando en Qdrant:', error.message);
      throw error;
    }
  }
}

module.exports = IndexarQdrantUltra;