require('dotenv').config();
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { Pinecone } = require('@pinecone-database/pinecone');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const apiKeyPinecone = process.env.PINECONE_API_KEY;

class IndexarPinecone4Optimized {
  constructor(doc, indexName, namespace, metadata, options = {}) {
    this.doc = doc;
    this.indexName = indexName;
    this.namespace = namespace;
    this.metadata = metadata;
    this.apiUrl = options.apiUrl || 'http://localhost:11440/embed';
    this.targetDimension = options.targetDimension || 1024;
    
    // OPTIMIZACIÓN AGRESIVA: Aumentar significativamente la concurrencia
    this.maxConcurrentEmbeddings = options.maxConcurrentEmbeddings || 50; // Aumentado de 10 a 50
    this.embeddingBatchSize = options.embeddingBatchSize || 32; // Aumentado a 32 (batch size del servidor)
    
    // Reutilizar cliente axios con configuración optimizada
    this.axiosClient = axios.create({
      baseURL: this.apiUrl,
      timeout: 60000,
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
      // Mantener conexiones vivas
      httpAgent: new (require('http').Agent)({ 
        keepAlive: true,
        keepAliveMsecs: 1000,
        maxSockets: 100,
        maxFreeSockets: 10
      })
    });
  }

  static create(doc, indexName, namespace, metadata, options) {
    return new IndexarPinecone4Optimized(doc, indexName, namespace, metadata, options).indexar();
  }

  // OPTIMIZADO: Obtener embeddings en batch real
  async getEmbeddingsBatch(texts) {
    try {
      const response = await this.axiosClient.post('', {
        inputs: texts
      }, {
        headers: {
          'Content-Type': 'application/json'
        }
      });

      if (response.data && Array.isArray(response.data)) {
        return response.data.map(embedding => {
          // Verificar si necesita padding
          if (Array.isArray(embedding) && embedding.length === this.targetDimension) {
            return embedding;
          }
          // Si es un solo embedding para un solo texto
          if (!Array.isArray(embedding) && texts.length === 1) {
            return response.data;
          }
          // Aplicar padding si es necesario
          if (embedding.length < this.targetDimension) {
            const paddedEmbedding = [...embedding];
            const zerosNeeded = this.targetDimension - embedding.length;
            paddedEmbedding.push(...new Array(zerosNeeded).fill(0));
            return paddedEmbedding;
          }
          return embedding;
        });
      } else {
        throw new Error('Formato de respuesta inesperado del servicio de embeddings');
      }
    } catch (error) {
      console.error('Error al obtener embeddings batch:', error.message);
      throw error;
    }
  }

  // NUEVO: Procesamiento ultra optimizado con batching real
  async processChunksInParallel(chunks) {
    const vectors = [];
    const startTime = Date.now();
    
    console.log(`  🚀 Procesando ${chunks.length} chunks con batching optimizado...`);
    
    // Procesar todos los chunks en batches grandes
    const allTexts = chunks.map(chunk => chunk.text);
    const batchPromises = [];
    
    // Dividir en batches del tamaño óptimo para la GPU
    for (let i = 0; i < allTexts.length; i += this.embeddingBatchSize) {
      const batchTexts = allTexts.slice(i, i + this.embeddingBatchSize);
      const batchStartIdx = i;
      
      // Crear promesa para este batch
      const batchPromise = this.getEmbeddingsBatch(batchTexts)
        .then(embeddings => {
          // Mapear embeddings a vectores con metadata
          return embeddings.map((embedding, idx) => ({
            id: `${this.metadata.idSentence || 'doc'}_chunk_${batchStartIdx + idx}_${uuidv4()}`,
            values: embedding,
            metadata: {
              ...this.metadata,
              text: chunks[batchStartIdx + idx].text,
              chunk_index: batchStartIdx + idx,
              total_chunks: chunks.length
            }
          }));
        })
        .catch(error => {
          console.error(`  ❌ Error en batch ${i}-${i + batchTexts.length}:`, error.message);
          return [];
        });
      
      batchPromises.push(batchPromise);
    }
    
    // Procesar todos los batches en paralelo
    const results = await Promise.all(batchPromises);
    
    // Combinar todos los resultados
    for (const batchVectors of results) {
      vectors.push(...batchVectors);
    }
    
    const elapsed = (Date.now() - startTime) / 1000;
    const rate = chunks.length / elapsed;
    console.log(`  ✅ ${vectors.length}/${chunks.length} embeddings completados en ${elapsed.toFixed(2)}s (${rate.toFixed(2)} chunks/seg)`);
    
    return vectors;
  }

  async indexar() {
    try {
      const indexStartTime = Date.now();
      
      // Inicializar Pinecone con configuración optimizada
      const pc = new Pinecone({ 
        apiKey: apiKeyPinecone,
        // Configuración para mejor rendimiento
        maxRetries: 3,
        // @ts-ignore
        // pool: {
        //   maxSockets: 100
        // }
      });
      const index = pc.Index(this.indexName);

      // Dividir el texto en chunks
      const text_splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 80,
        lengthFunction: (text) => text.length
      });

      const chunksText = await text_splitter.splitText(this.doc);
      const chunks = chunksText.map((text, idx) => ({ text, index: idx }));
      
      if (chunks.length === 0) {
        console.warn(`  ⚠️ No se generaron chunks para el documento`);
        return { chunks: 0 };
      }

      // Procesar chunks
      const vectors = await this.processChunksInParallel(chunks);

      // OPTIMIZADO: Insertar en Pinecone con paralelización
      if (vectors.length > 0) {
        console.log(`  📤 Insertando ${vectors.length} vectores en Pinecone...`);
        
        const upsertBatchSize = 100;
        const upsertPromises = [];
        const maxConcurrentUpserts = 10; // Más upserts paralelos
        
        for (let i = 0; i < vectors.length; i += upsertBatchSize) {
          const batch = vectors.slice(i, i + upsertBatchSize);
          
          // Limitar upserts concurrentes
          if (upsertPromises.length >= maxConcurrentUpserts) {
            await Promise.race(upsertPromises.map((p, idx) => 
              p.then(() => upsertPromises.splice(idx, 1))
            ));
          }
          
          const promise = index.namespace(this.namespace).upsert(batch)
            .catch(error => {
              console.error(`  ❌ Error en upsert:`, error.message);
              // Reintentar una vez
              return index.namespace(this.namespace).upsert(batch);
            });
          
          upsertPromises.push(promise);
        }
        
        // Esperar a que terminen todos los upserts
        await Promise.all(upsertPromises);
        
        const totalTime = (Date.now() - indexStartTime) / 1000;
        console.log(`  ✅ Documento indexado en ${totalTime.toFixed(2)}s`);
        
        return { 
          chunks: chunks.length,
          vectors: vectors.length,
          time: totalTime
        };
      }

      return { chunks: 0 };

    } catch (error) {
      console.error(`❌ Error al indexar en Pinecone:`, error);
      throw error;
    }
  }
}

module.exports = IndexarPinecone4Optimized;