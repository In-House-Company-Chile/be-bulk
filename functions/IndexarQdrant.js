require('dotenv').config();
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

class IndexarQdrant {
  constructor(doc, collectionName, metadata, options = {}) {
    this.doc = doc;
    this.collectionName = collectionName;
    this.metadata = metadata;
    
    // URLs de servicios
    this.embeddingUrl = options.embeddingUrl || 'https://ms-vector.sandbox.governare.ai/embed';
    this.qdrantUrl = options.qdrantUrl || 'http://localhost:6333';
    
    // Configuración
    this.vectorDimension = options.vectorDimension || 1024;
    this.chunkSize = options.chunkSize || 800;
    this.chunkOverlap = options.chunkOverlap || 80;
    this.embeddingBatchSize = options.embeddingBatchSize || 32;
    this.upsertBatchSize = options.upsertBatchSize || 100;
  }

  static create(doc, collectionName, metadata, options) {
    return new IndexarQdrant(doc, collectionName, metadata, options).indexar();
  }

  // Verificar/crear colección en Qdrant
  async ensureCollection() {
    try {
      // Verificar si la colección existe
      const response = await axios.get(`${this.qdrantUrl}/collections/${this.collectionName}`);
      
      if (response.data.status === 'ok') {
        console.log(`✅ Colección '${this.collectionName}' ya existe`);
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

        await axios.put(
          `${this.qdrantUrl}/collections/${this.collectionName}`,
          collectionConfig,
          { headers: { 'Content-Type': 'application/json' } }
        );

        console.log(`✅ Colección '${this.collectionName}' creada exitosamente`);
        return true;
      }
      
      throw error;
    }
  }

  // Obtener embeddings del servicio
  async getEmbedding(text) {
    try {
      const response = await axios.post(
        this.embeddingUrl,
        { inputs: text },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
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

  // Obtener embeddings en lote
  async getEmbeddingsBatch(texts) {
    try {
      const response = await axios.post(
        this.embeddingUrl,
        { inputs: texts }, // Array de textos
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 60000
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
      console.log('⚠️  Procesamiento en lote falló, procesando individualmente...');
      const embeddings = [];
      for (const text of texts) {
        const embedding = await this.getEmbedding(text);
        embeddings.push(embedding);
      }
      return embeddings;
    }
  }

  // Insertar puntos en Qdrant
  async upsertToQdrant(points) {
    try {
      const response = await axios.put(
        `${this.qdrantUrl}/collections/${this.collectionName}/points`,
        { points },
        {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000
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
      console.log('🚀 Iniciando indexación en Qdrant...');
      
      // Asegurar que la colección existe
      await this.ensureCollection();

      // Dividir el texto en chunks
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap,
        lengthFunction: (text) => text.length
      });

      const chunks = await textSplitter.splitText(this.doc);
      console.log(`📄 Procesando ${chunks.length} chunks para indexar...`);

      // Generar ID único para el documento
      const docId = this.metadata.idNorm || `doc_${uuidv4()}`;
      
      // Procesar chunks en lotes
      let totalProcessed = 0;
      
      for (let i = 0; i < chunks.length; i += this.embeddingBatchSize) {
        const batchChunks = chunks.slice(i, i + this.embeddingBatchSize);
        
        console.log(`\n🔄 Procesando lote ${Math.floor(i / this.embeddingBatchSize) + 1}...`);
        
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
            chunk_index: i + idx,
            total_chunks: chunks.length,
            timestamp: new Date().toISOString()
          }
        }));

        // Insertar en Qdrant
        await this.upsertToQdrant(points);
        
        totalProcessed += points.length;
        
        // Progreso
        const progress = Math.round((totalProcessed / chunks.length) * 100);
        console.log(`  ✓ Procesados ${totalProcessed}/${chunks.length} chunks (${progress}%)`);
        
        // Pequeña pausa para no sobrecargar los servicios
        if (i + this.embeddingBatchSize < chunks.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      // Verificar el conteo final
      const collectionInfo = await axios.get(
        `${this.qdrantUrl}/collections/${this.collectionName}`
      );
      
      const vectorCount = collectionInfo.data.result.vectors_count;
      
      console.log(`\n✅ Indexación completada exitosamente:`);
      console.log(`   📊 Documento: ${docId}`);
      console.log(`   📝 Chunks procesados: ${chunks.length}`);
      console.log(`   🗄️  Total vectores en colección: ${vectorCount}`);
      
      return {
        success: true,
        docId,
        chunksProcessed: chunks.length,
        totalVectors: vectorCount
      };

    } catch (error) {
      console.error('❌ Error durante la indexación:', error);
      throw error;
    }
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
      // Obtener embedding de la consulta
      const response = await axios.post(
        embeddingUrl,
        { inputs: queryText },
        { headers: { 'Content-Type': 'application/json' } }
      );

      const queryVector = response.data[0];

      // Buscar en Qdrant
      const searchResponse = await axios.post(
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