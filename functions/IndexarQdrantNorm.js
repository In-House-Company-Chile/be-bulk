const axios = require('axios');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
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

class IndexarQdrantNorm {
  constructor(doc, indexName) {
    this.doc = doc;
    this.indexName = indexName;
    this.qdrantUrl = process.env.QDRANT_URL || 'http://ms-qdrant-8f82e7cd-8cc2.governare.ai';
    this.embeddingUrl = process.env.EMBEDDING_URL || 'http://ms-vector.governare.ai/embed';
    
    // Configuración optimizada para normas
    this.embeddingConcurrency = 32; // Concurrencia moderada para normas
    this.batchSize = 100; // Lotes medianos
    this.requestTimeout = 30000; // Timeout de 30 segundos
    
    // Pool de conexiones para embeddings
    this.axiosInstance = axios.create({
      timeout: this.requestTimeout,
      maxRedirects: 0,
      headers: {
        'Content-Type': 'application/json',
        'Connection': 'keep-alive'
      }
    });
  }

  static create(doc, indexName) {
    return new IndexarQdrantNorm(doc, indexName).indexar();
  }

  /**
   * Genera embedding único usando el servidor local
   */
  async generateEmbedding(text) {
    try {
      const response = await this.axiosInstance.post(this.embeddingUrl, {
        inputs: text
      });

      if (Array.isArray(response.data) && response.data.length === 1 && Array.isArray(response.data[0])) {
        const embedding = response.data[0];
        if (embedding.length === 1024) {
          return embedding;
        } else {
          throw new Error(`Embedding dimensión incorrecta: ${embedding.length}`);
        }
      } else {
        throw new Error('Formato de respuesta inesperado');
      }
    } catch (error) {
      console.error('Error generando embedding:', error.message);
      throw error;
    }
  }

  /**
   * Genera múltiples embeddings en paralelo
   */
  async generateEmbeddingsParallel(texts) {
    const embeddings = [];
    const errors = [];
    
    console.log(`⚡ Generando ${texts.length} embeddings para norma (concurrencia: ${this.embeddingConcurrency})`);
    
    // Procesar en lotes con concurrencia controlada
    for (let i = 0; i < texts.length; i += this.embeddingConcurrency) {
      const batch = texts.slice(i, i + this.embeddingConcurrency);
      const batchNum = Math.floor(i / this.embeddingConcurrency) + 1;
      const totalBatches = Math.ceil(texts.length / this.embeddingConcurrency);
      
      console.log(`🔄 Lote embeddings ${batchNum}/${totalBatches} (${batch.length} textos)...`);
      
      const batchPromises = batch.map(async (text, batchIndex) => {
        const globalIndex = i + batchIndex;
        try {
          const embedding = await this.generateEmbedding(text);
          return { index: globalIndex, embedding, success: true };
        } catch (error) {
          return { index: globalIndex, error: error.message, success: false };
        }
      });
      
      const batchResults = await Promise.all(batchPromises);
      
      // Procesar resultados del lote
      let batchSuccesses = 0;
      let batchErrors = 0;
      
      batchResults.forEach(result => {
        if (result.success) {
          embeddings[result.index] = result.embedding;
          batchSuccesses++;
        } else {
          errors.push({ index: result.index, error: result.error });
          batchErrors++;
        }
      });
      
      console.log(`✅ Lote ${batchNum}: ${batchSuccesses} éxitos, ${batchErrors} errores`);
    }
    
    const successCount = embeddings.filter(e => e).length;
    console.log(`⚡ Embeddings completados: ${successCount}/${texts.length} (${((successCount/texts.length)*100).toFixed(1)}% éxito)`);
    
    return { embeddings, errors };
  }

  /**
   * Verifica si la colección existe en Qdrant, si no la crea
   */
  async ensureCollection() {
    try {
      const checkResponse = await axios.get(`${this.qdrantUrl}/collections/${this.indexName}`);
      console.log(`✅ Colección '${this.indexName}' existente`);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`📝 Creando colección '${this.indexName}'...`);
        await axios.put(`${this.qdrantUrl}/collections/${this.indexName}`, {
          vectors: {
            size: 1024,
            distance: "Cosine"
          }
        }, {
          headers: { 'Content-Type': 'application/json' }
        });
        console.log(`✅ Colección '${this.indexName}' creada`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Inserta chunks en lotes optimizados
   */
  async insertPointsBatches(points) {
    if (points.length === 0) {
      throw new Error('No hay puntos para insertar');
    }

    const totalBatches = Math.ceil(points.length / this.batchSize);
    let insertedCount = 0;
    let failedCount = 0;

    console.log(`📤 Inserción de norma: ${points.length} puntos en ${totalBatches} lotes de ${this.batchSize}`);

    for (let i = 0; i < points.length; i += this.batchSize) {
      const batchNumber = Math.floor(i / this.batchSize) + 1;
      const batch = points.slice(i, i + this.batchSize);
      
      try {
        console.log(`🔄 Lote ${batchNumber}/${totalBatches} (${batch.length} chunks)...`);
        
        const insertResponse = await axios.put(
          `${this.qdrantUrl}/collections/${this.indexName}/points`, 
          { points: batch }, 
          {
            headers: { 'Content-Type': 'application/json' },
            timeout: this.requestTimeout
          }
        );

        if (insertResponse.data && insertResponse.data.status === 'ok') {
          insertedCount += batch.length;
          console.log(`✅ Lote ${batchNumber}/${totalBatches} - OK`);
        } else {
          failedCount += batch.length;
          console.error(`❌ Lote ${batchNumber}/${totalBatches} - Respuesta inesperada`);
        }

      } catch (insertError) {
        failedCount += batch.length;
        console.error(`❌ Lote ${batchNumber}/${totalBatches} falló:`, insertError.message);
      }
    }

    console.log(`📤 Inserción completada: ${insertedCount}/${points.length} insertados`);

    return {
      success: insertedCount > 0,
      inserted: insertedCount,
      failed: failedCount,
      total: points.length
    };
  }

  async indexar() {
    const meta = this.doc.data?.metadatos || {};
    const tiposNumeros = meta.tipos_numeros?.[0] || {};

    try {
      console.log(`🚀 Indexación de norma iniciada: ${this.doc.idNorm}`);

      // Asegurar que la colección existe
      await this.ensureCollection();

      console.log(`📄 Norma: ${this.doc.planeText.length} chars`);
      console.log(`⚙️ Config: chunks=800, overlap=80, lotes=${this.batchSize}, concurrencia=${this.embeddingConcurrency}`);

      // Dividir texto en chunks
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 80,
        lengthFunction: (text) => text.length,
        separators: ['\n\n', '\n', '. ', ', ', ' ', ''],
      });

      const chunks = await textSplitter.createDocuments([this.doc.planeText]);
      const documents = await textSplitter.splitDocuments(chunks);

      console.log(`📄 ${documents.length} chunks creados`);

      // Extraer textos válidos
      const chunkTexts = documents
        .map(doc => doc.pageContent)
        .filter(text => text && text.trim().length > 0);

      if (chunkTexts.length === 0) {
        throw new Error('No se encontraron chunks válidos');
      }

      // Generar embeddings en paralelo
      console.log(`⚡ Generando embeddings para ${chunkTexts.length} chunks...`);
      const startEmbedTime = Date.now();
      const { embeddings, errors } = await this.generateEmbeddingsParallel(chunkTexts);
      const embedTime = Date.now() - startEmbedTime;
      
      console.log(`⚡ Embeddings: ${(embedTime/1000).toFixed(2)}s (${(chunkTexts.length/(embedTime/1000)).toFixed(1)} chunks/seg)`);

      // Preparar metadata base para todos los chunks
      const baseMetadata = {
        idNorm: this.doc.idNorm,
        compuesto: tiposNumeros.compuesto || '',
        titulo_norma: meta.titulo_norma || '',
        organismos: meta.organismos || [],
        fecha_publicacion: meta.fecha_publicacion || '',
        fecha_promulgacion: meta.fecha_promulgacion || '',
        tipo_version_s: meta.tipo_version_s || '',
        inicio_vigencia: meta.vigencia?.inicio_vigencia || '',
        fin_vigencia: meta.vigencia?.fin_vigencia || '',
        tag: 'norma',
      };

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
            ...baseMetadata,
            chunk_index: i,
            chunk_text: chunkText,
            total_chunks: documents.length,
            timestamp: new Date().toISOString()
          }
        };

        points.push(point);
      }

      if (points.length === 0) {
        throw new Error('No se pudieron generar embeddings válidos');
      }

      // Insertar puntos en lotes
      console.log(`📤 Insertando ${points.length} puntos...`);
      const startInsertTime = Date.now();
      const insertResult = await this.insertPointsBatches(points);
      const insertTime = Date.now() - startInsertTime;

      console.log(`📤 Inserción: ${(insertTime/1000).toFixed(2)}s`);

      if (insertResult.success) {
        const totalTime = (embedTime + insertTime) / 1000;
        console.log(`✅ Indexación exitosa: ${this.doc.idNorm}`);
        console.log(`📊 Stats:`);
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
        throw new Error(`Inserción falló: ${insertResult.failed}/${insertResult.total}`);
      }

    } catch (error) {
      console.error(`❌ Error indexando norma (${this.doc.idNorm}):`, error.message);
      throw error;
    }
  }
}

module.exports = IndexarQdrantNorm;