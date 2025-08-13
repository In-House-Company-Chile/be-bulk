require('dotenv').config();
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { Pinecone } = require('@pinecone-database/pinecone');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const apiKeyPinecone = process.env.PINECONE_API_KEY;

class IndexarPinecone {
  constructor(doc, indexName, namespace, metadata, options = {}) {
    this.doc = doc;
    this.indexName = indexName;
    this.namespace = namespace;
    this.metadata = metadata;
    this.apiUrl = options.apiUrl || 'http://localhost:11440/embed';
    this.targetDimension = options.targetDimension || 1024; // Por defecto 1024 para tu caso
  }

  static create(doc, indexName, namespace, metadata, options) {
    return new IndexarPinecone(doc, indexName, namespace, metadata, options).indexar();
  }

  // Método para obtener embeddings del servicio
  async getEmbedding(text) {
    try {
      const response = await axios.post(
        this.apiUrl,
        { inputs: text },
        {
          headers: {
            'Content-Type': 'application/json'
          }
        }
      );

      // El servicio devuelve [[vector]], tomamos el primer elemento
      if (response.data && Array.isArray(response.data) && response.data[0]) {
        const embedding = [response.data[0]];
        
        // Verificar dimensión del embedding
        console.log(`  📏 Dimensión del embedding recibido: ${embedding.length}`);
        
        // SIEMPRE aplicar padding si el embedding es menor que targetDimension
        if (embedding.length < this.targetDimension) {
          console.log(`  🔧 Aplicando padding de ${embedding.length} a ${this.targetDimension} dimensiones`);
          
          // Padding con ceros
          const paddedEmbedding = [...embedding];
          const zerosNeeded = this.targetDimension - embedding.length;
          paddedEmbedding.push(...new Array(zerosNeeded).fill(0));
          
          console.log(`  ✅ Padding aplicado: vector ahora tiene ${paddedEmbedding.length} dimensiones`);
          return paddedEmbedding;
        }
        
        return embedding;
      } else {
        throw new Error('Formato de respuesta inesperado del servicio de embeddings');
      }
    } catch (error) {
      console.error('Error al obtener embedding:', error.message);
      throw error;
    }
  }

  async indexar() {
    try {
      // Inicializar Pinecone
      const pc = new Pinecone({ apiKey: apiKeyPinecone });
      const index = pc.Index(this.indexName);

      // Dividir el texto en chunks
      const text_splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 80,
        lengthFunction: (text) => text.length
      });

      const chunks = await text_splitter.splitText(this.doc);
      
      console.log(`📄 Procesando ${chunks.length} chunks para indexar...`);

      // Preparar los vectores para Pinecone
      const vectors = [];
      
      // Procesar chunks en lotes para evitar sobrecarga
      const batchSize = 5;
      for (let i = 0; i < chunks.length; i += batchSize) {
        const batch = chunks.slice(i, i + batchSize);
        
        // Obtener embeddings para el lote actual
        const embeddingPromises = batch.map((chunk, idx) => 
          this.getEmbedding(chunk).then(embedding => {
            console.log(`    📊 Vector ${i + idx}: ${embedding.length} dimensiones`);
            return {
              id: `${this.metadata.idNorm || 'doc'}_chunk_${i + idx}_${uuidv4()}`,
              values: embedding,
              metadata: {
                ...this.metadata,
                text: chunk,
                chunk_index: i + idx,
                total_chunks: chunks.length
              }
            };
          })
        );

        const batchVectors = await Promise.all(embeddingPromises);
        vectors.push(...batchVectors);
        
        console.log(`  ✓ Procesados chunks ${i + 1} a ${Math.min(i + batchSize, chunks.length)} de ${chunks.length}`);
      }

      // Insertar en Pinecone
      if (vectors.length > 0) {
        // Pinecone tiene un límite de 100 vectores por upsert
        const upsertBatchSize = 100;
        
        for (let i = 0; i < vectors.length; i += upsertBatchSize) {
          const batch = vectors.slice(i, i + upsertBatchSize);
          
          await index.namespace(this.namespace).upsert(batch);
          
          console.log(`  ✓ Insertados vectores ${i + 1} a ${Math.min(i + upsertBatchSize, vectors.length)} de ${vectors.length}`);
        }

        console.log(`✅ Indexado exitosamente en Pinecone: ${this.metadata.idNorm || 'documento'} (${vectors.length} chunks)`);
      } else {
        console.warn(`⚠️ No se generaron vectores para indexar`);
      }

    } catch (error) {
      console.error(`❌ Error al indexar en Pinecone:`, error);
      throw error;
    }
  }
}

module.exports = IndexarPinecone;