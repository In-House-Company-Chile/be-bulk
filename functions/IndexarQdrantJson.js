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
class IndexarQdrantJSON {
  constructor(doc, collectionName, metadata = {}) {
    this.doc = doc;
    this.collectionName = collectionName;
    this.metadata = metadata;
    this.qdrantUrl = process.env.QDRANT_URL || 'http://ms-qdrant-8f82e7cd-8cc2.governare.ai';
    this.embeddingUrl = process.env.EMBEDDING_URL || 'http://ms-vector.governare.ai/embed';
  }

  /**
   * Método estático para crear y ejecutar la indexación
   * @param {string} doc - Texto del documento a indexar
   * @param {string} collectionName - Nombre de la colección en Qdrant
   * @param {Object} metadata - Metadatos del documento
   */
  static async create(doc, collectionName, metadata = {}, sourceFilePath = null) {
    const indexer = new IndexarQdrantJSON(doc, collectionName, metadata);
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
          console.log(`✅ Embedding generado correctamente: ${embedding.length} dimensiones`);
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
   * Indexa el documento en Qdrant
   * @param {string} sourceFilePath - Ruta del archivo original (opcional, para mover en caso de error)
   */
  async indexar(sourceFilePath = null) {
    try {
      console.log(`🔄 Iniciando indexación en Qdrant para documento: ${this.metadata.idSentence || 'ID desconocido'}`);

      // Asegurar que la colección existe
      await this.ensureCollection();

      // Dividir el texto en chunks optimizados para documentos jurídicos
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,           // Aumentado para capturar más contexto jurídico
        chunkOverlap: 100,         // 10% de overlap para mantener continuidad
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
          console.log(`🔄 Generando embedding para chunk ${i + 1}/${documents.length}...`);
          const embedding = await this.generateEmbedding(chunkText);
          
          // Debug: verificar embedding
          if (!Array.isArray(embedding) || embedding.length !== 1024) {
            console.error(`❌ Embedding inválido:`, {
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

      // Insertar puntos en Qdrant
      console.log(`📤 Insertando ${points.length} puntos en Qdrant...`);
      
      // Debug: verificar estructura del primer punto
      if (points.length > 0) {
        const firstPoint = points[0];
        console.log(`🔍 DEBUG - Estructura del primer punto:`, {
          id: firstPoint.id,
          idType: typeof firstPoint.id,
          vectorLength: Array.isArray(firstPoint.vector) ? firstPoint.vector.length : 'No es array',
          vectorType: typeof firstPoint.vector,
          payloadKeys: Object.keys(firstPoint.payload || {}),
          originalId: firstPoint.payload.original_id,
          firstVectorValues: Array.isArray(firstPoint.vector) ? firstPoint.vector.slice(0, 3) : 'N/A'
        });
      }
      
      const requestData = { points: points };
      
      let insertResponse;
      try {
        insertResponse = await axios.put(`${this.qdrantUrl}/collections/${this.collectionName}/points`, requestData, {
          headers: {
            'Content-Type': 'application/json'
          },
          timeout: 60000
        });
      } catch (insertError) {
        console.error('❌ Error insertando en Qdrant:', insertError.message);
        if (insertError.response) {
          console.error('📋 Status:', insertError.response.status);
          console.error('📋 Response data:', JSON.stringify(insertError.response.data, null, 2));
          console.error('📋 Request data sample:', JSON.stringify({
            points: points.slice(0, 1) // Solo mostrar el primer punto para debug
          }, null, 2));
          
          // Si es error 413 y tenemos la ruta del archivo, moverlo a carpeta de errores
          if (insertError.response.status === 413 && sourceFilePath) {
            await this.moveToErrorFolder(sourceFilePath);
          }
        }
        throw insertError;
      }

      if (insertResponse.data && insertResponse.data.status === 'ok') {
        console.log(`✅ Documento indexado exitosamente en Qdrant: ${this.metadata.idSentence || 'ID desconocido'}`);
        return {
          success: true,
          chunks_processed: points.length,
          total_chunks: documents.length
        };
      } else {
        throw new Error('Respuesta inesperada de Qdrant al insertar puntos');
      }

    } catch (error) {
      console.error(`❌ Error indexando en Qdrant (${this.metadata.idSentence || 'ID desconocido'}):`, error.message);
      throw error;
    }
  }

  /**
   * Mueve un archivo a la carpeta de errores cuando hay error 413
   * @param {string} sourceFilePath - Ruta del archivo original
   */
  async moveToErrorFolder(sourceFilePath) {
    try {
      const errorDir = process.env.FOLDER + '/error';
      
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

module.exports = IndexarQdrantJSON;