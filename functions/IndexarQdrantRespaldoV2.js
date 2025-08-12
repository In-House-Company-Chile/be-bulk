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
 * Clase para indexar documentos en Qdrant usando un servicio de embeddings externo
 */
class IndexarQdrant {
  constructor(doc, collectionName, metadata = {}) {
    this.doc = doc;
    this.collectionName = collectionName;
    this.metadata = metadata;
    this.qdrantUrl = process.env.QDRANT_URL || 'http://ms-qdrant-8f82e7cd-8cc2.governare.ai';
    this.embeddingUrl = process.env.EMBEDDING_URL || 'http://ms-vector.governare.ai/embed';
    
    // Configuración de lotes - solo el tamaño de lote cambia
    this.batchSize = 15; // Chunks por lote - ajustable dinámicamente según tamaño del documento
    this.batchDelay = 500; // Pausa entre lotes en ms
  }

  /**
   * Método estático para crear y ejecutar la indexación
   * @param {string} doc - Texto del documento a indexar
   * @param {string} collectionName - Nombre de la colección en Qdrant
   * @param {Object} metadata - Metadatos del documento
   */
  static async create(doc, collectionName, metadata = {}, sourceFilePath = null) {
    const indexer = new IndexarQdrant(doc, collectionName, metadata);
    return await indexer.indexar(sourceFilePath);
  }

  /**
   * Genera embeddings usando el servicio externo
   * @param {string} text - Texto para generar embedding
   * @returns {Array} Vector embedding
   */
  async generateEmbedding(text) {
    try {
      const response = await axios.post(this.embeddingUrl, {
        inputs: [text]
      }, {
        headers: {
          'Content-Type': 'application/json'
        },
        timeout: 30000
      });

      // El servicio devuelve formato: [[embedding_vector_1024_dims]]
      // Extraer el vector real del formato anidado
      if (Array.isArray(response.data) && response.data.length === 1 && Array.isArray(response.data[0])) {
        const embedding = response.data[0];
        if (embedding.length === 1024) {
          return embedding;
        } else {
          throw new Error(`Embedding tiene dimensión incorrecta: ${embedding.length}, se esperaba 1024`);
        }
      } else {
        throw new Error('Formato de respuesta inesperado del servicio de embeddings');
      }

    } catch (error) {
      console.error('❌ Error generando embedding:', error.message);
      throw error;
    }
  }

  /**
   * Verifica si la colección existe en Qdrant, si no la crea
   */
  async ensureCollection() {
    try {
      // Verificar si la colección existe
      const checkResponse = await axios.get(`${this.qdrantUrl}/collections/${this.collectionName}`);
      console.log(`✅ Colección '${this.collectionName}' ya existe`);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        // La colección no existe, crearla
        console.log(`📝 Creando colección '${this.collectionName}'...`);
        try {
          await axios.put(`${this.qdrantUrl}/collections/${this.collectionName}`, {
            vectors: {
              size: 1024,
              distance: "Cosine"
            }
          }, {
            headers: {
              'Content-Type': 'application/json'
            }
          });
          console.log(`✅ Colección '${this.collectionName}' creada exitosamente`);
        } catch (createError) {
          console.error('❌ Error creando colección:', createError.message);
          throw createError;
        }
      } else {
        console.error('❌ Error verificando colección:', error.message);
        throw error;
      }
    }
  }

  /**
   * Inserta chunks en lotes para evitar errores 413
   * @param {Array} points - Array de puntos para insertar
   * @returns {Object} Resultado de la inserción
   */
  async insertPointsInBatches(points) {
    if (points.length === 0) {
      throw new Error('No hay puntos para insertar');
    }

    const totalBatches = Math.ceil(points.length / this.batchSize);
    let insertedCount = 0;
    let failedCount = 0;

    console.log(`📤 Insertando ${points.length} puntos en ${totalBatches} lotes de ${this.batchSize}...`);

    for (let i = 0; i < points.length; i += this.batchSize) {
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      const batch = points.slice(i, i + this.batchSize);
      
      try {
        console.log(`🔄 Procesando lote ${batchNumber}/${totalBatches} (${batch.length} chunks)...`);
        
        const insertResponse = await axios.put(
          `${this.qdrantUrl}/collections/${this.collectionName}/points`, 
          { points: batch }, 
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 60000
          }
        );

        if (insertResponse.data && insertResponse.data.status === 'ok') {
          insertedCount += batch.length;
          console.log(`✅ Lote ${batchNumber}/${totalBatches} insertado exitosamente`);
        } else {
          console.error(`❌ Lote ${batchNumber}/${totalBatches} falló: respuesta inesperada`);
          failedCount += batch.length;
        }

        // Pausa entre lotes para no saturar el servidor
        if (i + this.batchSize < points.length) {
          await new Promise(resolve => setTimeout(resolve, this.batchDelay));
        }

      } catch (insertError) {
        console.error(`❌ Error insertando lote ${batchNumber}/${totalBatches}:`, insertError.message);
        failedCount += batch.length;
        
        // Si es error 413, intentar con lotes más pequeños
        if (insertError.response && insertError.response.status === 413) {
          console.log(`⚠️ Error 413 detectado, intentando con lotes más pequeños...`);
          const smallerBatchSize = Math.floor(this.batchSize / 2);
          if (smallerBatchSize > 0) {
            await this.insertSmallerBatches(batch, smallerBatchSize, batchNumber);
          }
        }
        
        // Continuar con el siguiente lote en lugar de fallar completamente
        continue;
      }
    }

    return {
      success: insertedCount > 0,
      inserted: insertedCount,
      failed: failedCount,
      total: points.length
    };
  }

  /**
   * Maneja lotes más pequeños cuando hay error 413
   * @param {Array} failedBatch - Lote que falló
   * @param {number} smallerSize - Tamaño de lote más pequeño
   * @param {number} originalBatchNumber - Número del lote original
   */
  async insertSmallerBatches(failedBatch, smallerSize, originalBatchNumber) {
    console.log(`🔄 Reintentando lote ${originalBatchNumber} en sub-lotes de ${smallerSize}...`);
    
    for (let i = 0; i < failedBatch.length; i += smallerSize) {
      const subBatch = failedBatch.slice(i, i + smallerSize);
      const subBatchNumber = Math.floor(i / smallerSize) + 1;
      const totalSubBatches = Math.ceil(failedBatch.length / smallerSize);
      
      try {
        console.log(`   🔄 Sub-lote ${subBatchNumber}/${totalSubBatches}...`);
        
        await axios.put(
          `${this.qdrantUrl}/collections/${this.collectionName}/points`, 
          { points: subBatch }, 
          {
            headers: {
              'Content-Type': 'application/json'
            },
            timeout: 60000
          }
        );
        
        console.log(`   ✅ Sub-lote ${subBatchNumber}/${totalSubBatches} insertado`);
        
        // Pausa más corta entre sub-lotes
        if (i + smallerSize < failedBatch.length) {
          await new Promise(resolve => setTimeout(resolve, 300));
        }
        
      } catch (subError) {
        console.error(`   ❌ Sub-lote ${subBatchNumber}/${totalSubBatches} falló:`, subError.message);
      }
    }
  }

  /**
   * Determina configuración de lotes según el tamaño del documento
   * Los chunks se mantienen consistentes en 1000 caracteres
   * @param {string} docText - Texto del documento
   * @returns {Object} Configuración de lotes
   */
  getBatchingConfig(docText) {
    const docLength = docText.length;
    
    if (docLength > 200000) {
      // Documentos muy largos (>200K chars) - lotes muy pequeños
      return {
        batchSize: 5
      };
    } else if (docLength > 100000) {
      // Documentos largos (100K-200K chars) - lotes pequeños
      return {
        batchSize: 8
      };
    } else if (docLength > 50000) {
      // Documentos medianos (50K-100K chars) - lotes medianos
      return {
        batchSize: 12
      };
    } else {
      // Documentos pequeños (<50K chars) - lotes grandes
      return {
        batchSize: 20
      };
    }
  }

  /**
   * Indexa el documento en Qdrant
   * @param {string} sourceFilePath - Ruta del archivo original (opcional, para mover en caso de error)
   */
  async indexar(sourceFilePath = null) {
    try {
      console.log(`🔄 Iniciando indexación en Qdrant para documento: ${this.metadata.idSentence || 'ID desconocido'}`);

      // Asegurar que la colección existe
      await this.ensureCollection();

      // Configuración dinámica de lotes según tamaño del documento
      // Los chunks se mantienen consistentes en 1000 caracteres
      const config = this.getBatchingConfig(this.doc);
      this.batchSize = config.batchSize;
      
      console.log(`📄 Documento: ${this.doc.length} caracteres`);
      console.log(`⚙️ Configuración: chunks=1000, overlap=80, lotes=${config.batchSize}`);

      // Dividir el texto en chunks consistentes de 1000 caracteres
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,           // Tamaño fijo
        chunkOverlap: 80,         // 10% de overlap
        lengthFunction: (text) => text.length,
        separators: ['\n\n', '\n', '. ', ', ', ' ', ''], // Separadores jerárquicos
      });

      const chunks = await textSplitter.createDocuments([this.doc]);
      const documents = await textSplitter.splitDocuments(chunks);

      console.log(`📄 Documento dividido en ${documents.length} chunks`);

      // Procesar cada chunk
      const points = [];
      for (let i = 0; i < documents.length; i++) {
        const chunk = documents[i];
        const chunkText = chunk.pageContent;

        if (!chunkText || chunkText.trim().length === 0) {
          console.log(`⚠️ Chunk ${i + 1} está vacío, saltando...`);
          continue;
        }

        try {
          // Generar embedding para este chunk
          const embedding = await this.generateEmbedding(chunkText);
          
          // Debug: verificar embedding
          if (!Array.isArray(embedding) || embedding.length !== 1024) {
            console.error(`❌ Embedding inválido para chunk ${i + 1}:`, {
              isArray: Array.isArray(embedding),
              length: embedding ? embedding.length : 'undefined',
              type: typeof embedding
            });
            continue;
          }

          // Crear punto para Qdrant con ID único (entero)
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
              original_id: this.metadata.idSentence || 'unknown' // ID original para referencia
            }
          };

          points.push(point);

          // Mostrar progreso cada 10 chunks
          if ((i + 1) % 10 === 0 || i === documents.length - 1) {
            console.log(`🔄 Procesados ${i + 1}/${documents.length} chunks...`);
          }

          // Pausa pequeña entre embeddings para no saturar el servicio
          if (i < documents.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 200));
          }

        } catch (embeddingError) {
          console.error(`❌ Error generando embedding para chunk ${i + 1}:`, embeddingError.message);
          continue;
        }
      }

      if (points.length === 0) {
        throw new Error('No se pudieron generar embeddings para ningún chunk');
      }

      // Insertar puntos en lotes
      console.log(`📤 Iniciando inserción en lotes de ${points.length} puntos...`);
      const insertResult = await this.insertPointsInBatches(points);

      if (insertResult.success) {
        console.log(`✅ Documento indexado exitosamente en Qdrant: ${this.metadata.idSentence || 'ID desconocido'}`);
        console.log(`📊 Estadísticas: ${insertResult.inserted}/${insertResult.total} chunks insertados, ${insertResult.failed} fallos`);
        
        return {
          success: true,
          chunks_processed: insertResult.inserted,
          chunks_failed: insertResult.failed,
          total_chunks: insertResult.total
        };
      } else {
        throw new Error(`Falló la inserción: ${insertResult.failed}/${insertResult.total} chunks fallaron`);
      }

    } catch (error) {
      console.error(`❌ Error indexando en Qdrant (${this.metadata.idSentence || 'ID desconocido'}):`, error.message);
      
      // Si es error 413 y tenemos la ruta del archivo, moverlo a carpeta de errores
      if (error.response && error.response.status === 413 && sourceFilePath) {
        await this.moveToErrorFolder(sourceFilePath);
      }
      
      throw error;
    }
  }

  /**
   * Mueve un archivo a la carpeta de errores cuando hay error 413
   * @param {string} sourceFilePath - Ruta del archivo original
   */
  async moveToErrorFolder(sourceFilePath) {
    try {
      const errorDir = 'C:\\Users\\kathe\\Desktop\\Leo\\sentencias\\error';
      
      // Crear la carpeta de errores si no existe
      if (!fs.existsSync(errorDir)) {
        fs.mkdirSync(errorDir, { recursive: true });
        console.log(`📁 Carpeta de errores creada: ${errorDir}`);
      }
      
      const fileName = path.basename(sourceFilePath);
      const destPath = path.join(errorDir, fileName);
      
      // Mover el archivo
      fs.renameSync(sourceFilePath, destPath);
      console.log(`📦 Archivo movido a carpeta de errores: ${fileName}`);
      console.log(`   📍 Origen: ${sourceFilePath}`);
      console.log(`   📍 Destino: ${destPath}`);
      
    } catch (moveError) {
      console.error(`❌ Error moviendo archivo a carpeta de errores:`, moveError.message);
      console.error(`   📄 Archivo: ${sourceFilePath}`);
    }
  }

  /**
   * Busca documentos similares en Qdrant
   * @param {string} queryText - Texto de consulta
   * @param {number} limit - Número máximo de resultados
   * @param {number} threshold - Umbral de similitud mínima
   */
  async search(queryText, limit = 10, threshold = 0.7) {
    try {
      // Generar embedding para la consulta
      const queryEmbedding = await this.generateEmbedding(queryText);

      // Buscar en Qdrant
      const searchResponse = await axios.post(`${this.qdrantUrl}/collections/${this.collectionName}/points/search`, {
        vector: queryEmbedding,
        limit: limit,
        score_threshold: threshold,
        with_payload: true,
        with_vector: false
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (searchResponse.data && searchResponse.data.result) {
        return {
          success: true,
          results: searchResponse.data.result
        };
      } else {
        throw new Error('Respuesta inesperada de Qdrant en la búsqueda');
      }

    } catch (error) {
      console.error('❌ Error buscando en Qdrant:', error.message);
      throw error;
    }
  }
}

module.exports = IndexarQdrant;