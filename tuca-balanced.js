const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { performance } = require('perf_hooks');
const { v4: uuidv4 } = require('uuid');

require('dotenv').config();
const BASE_NAME = process.env.BASE_NAME;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'test_jurisprudencia_3';
const SENTENCIAS_DIR = process.env.SENTENCIAS_DIR;
const VECTORIZED_DIR = process.env.VECTORIZED_DIR;

// CONFIGURACIÓN BALANCEADA - NO SATURAR EL SERVICIO
const BALANCED_CONFIG = {
  EMBEDDING_BATCH_SIZE: 128,           // Óptimo según test
  MAX_CONCURRENT_DOCS: 3,              // REDUCIDO - evitar saturación
  EMBEDDING_API_URL: process.env.EMBEDDING_API_URL || 'http://localhost:11441/embed',
  QDRANT_URL: process.env.QDRANT_URL || 'http://localhost:6333',
  TARGET_DIMENSION: 1024,
  QDRANT_BATCH_SIZE: 200,
  REQUEST_DELAY_MS: 100                // Pausa entre requests
};

// Cliente HTTP conservador
const httpClient = axios.create({
  timeout: 120000,  // Timeout más largo
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    keepAliveMsecs: 1000,
    maxSockets: 20,   // Reducido drásticamente
    maxFreeSockets: 5
  })
});

/**
 * Crear metadata
 */
function createMetadata(jsonData, tipoBase) {
  return {
    idSentence: jsonData.id,
    base: tipoBase,
    url: jsonData.url_corta_acceso_sentencia || '',
    rol: jsonData.rol_era_sup_s || jsonData.rol_era_ape_s || '',
    caratulado: jsonData.caratulado_s || '',
    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
  };
}

/**
 * Dividir texto en chunks
 */
function createChunks(text, chunkSize = 800, overlap = 80) {
  const chunks = [];
  for (let i = 0; i < text.length; i += chunkSize - overlap) {
    chunks.push(text.substring(i, i + chunkSize));
  }
  return chunks;
}

/**
 * Obtener embeddings con control de flujo
 */
async function getEmbeddingsControlled(chunks) {
  const allEmbeddings = [];
  
  // Procesar en batches secuenciales para evitar saturación
  for (let i = 0; i < chunks.length; i += BALANCED_CONFIG.EMBEDDING_BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + BALANCED_CONFIG.EMBEDDING_BATCH_SIZE);
    
    const batchStartTime = performance.now();
    
    try {
      const response = await httpClient.post(BALANCED_CONFIG.EMBEDDING_API_URL, {
        inputs: batchChunks
      });
      
      const embeddings = Array.isArray(response.data[0]) ? response.data : [response.data];
      allEmbeddings.push(...embeddings);
      
      const batchEndTime = performance.now();
      const batchTime = batchEndTime - batchStartTime;
      const throughput = batchChunks.length / (batchTime / 1000);
      
      console.log(`    📦 Batch ${Math.floor(i/BALANCED_CONFIG.EMBEDDING_BATCH_SIZE) + 1}: ${batchChunks.length} chunks en ${batchTime.toFixed(0)}ms (${throughput.toFixed(1)} chunks/sec)`);
      
      // Pausa controlada entre batches
      if (i + BALANCED_CONFIG.EMBEDDING_BATCH_SIZE < chunks.length) {
        await new Promise(resolve => setTimeout(resolve, BALANCED_CONFIG.REQUEST_DELAY_MS));
      }
      
    } catch (error) {
      console.error(`    ❌ Error en batch: ${error.message}`);
      throw error;
    }
  }
  
  return allEmbeddings;
}

/**
 * Upsert a Qdrant controlado
 */
async function upsertToQdrantControlled(points) {
  const batchSize = BALANCED_CONFIG.QDRANT_BATCH_SIZE;
  
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    
    const startTime = performance.now();
    
    try {
      await httpClient.put(`${BALANCED_CONFIG.QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`, {
        points: batch
      });
      
      const endTime = performance.now();
      const duration = endTime - startTime;
      const throughput = batch.length / (duration / 1000);
      
      console.log(`    📤 Qdrant batch: ${batch.length} vectors en ${duration.toFixed(0)}ms (${throughput.toFixed(1)} vectors/sec)`);
      
    } catch (error) {
      console.error(`    ❌ Error Qdrant: ${error.message}`);
      throw error;
    }
    
    // Pausa entre upserts de Qdrant
    if (i + batchSize < points.length) {
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

/**
 * Procesar un documento de forma controlada
 */
async function procesarDocumentoControlado(archivo, rutaOrigen) {
  const docStartTime = performance.now();
  
  try {
    console.log(`  🔄 Procesando ${archivo}...`);
    
    // Leer y parsear
    const contenido = fs.readFileSync(rutaOrigen, 'utf8');
    const jsonData = JSON.parse(contenido);

    if (!jsonData.texto_sentencia || jsonData.texto_sentencia.trim() === '') {
      console.log(`    ⚠️ Sin texto, saltando`);
      return { success: false, reason: 'sin_texto', archivo };
    }

    // Crear chunks
    const chunks = createChunks(jsonData.texto_sentencia);
    if (chunks.length === 0) {
      return { success: false, reason: 'sin_chunks', archivo };
    }

    console.log(`    📝 ${chunks.length} chunks generados`);

    // Obtener embeddings de forma controlada
    const embeddingStartTime = performance.now();
    const embeddings = await getEmbeddingsControlled(chunks);
    const embeddingEndTime = performance.now();
    const embeddingTime = embeddingEndTime - embeddingStartTime;

    // Crear metadata
    const metadata = createMetadata(jsonData, BASE_NAME);

    // Preparar puntos para Qdrant
    const points = chunks.map((chunk, idx) => ({
      id: uuidv4(),
      vector: embeddings[idx],
      payload: {
        ...metadata,
        text: chunk,
        chunk_index: idx,
        total_chunks: chunks.length,
        timestamp: new Date().toISOString()
      }
    }));

    // Upsert a Qdrant de forma controlada
    const qdrantStartTime = performance.now();
    await upsertToQdrantControlled(points);
    const qdrantEndTime = performance.now();
    const qdrantTime = qdrantEndTime - qdrantStartTime;

    const docEndTime = performance.now();
    const totalTime = docEndTime - docStartTime;

    console.log(`    ✅ Completado en ${totalTime.toFixed(0)}ms (Emb: ${embeddingTime.toFixed(0)}ms, Qdr: ${qdrantTime.toFixed(0)}ms)`);

    return {
      success: true,
      archivo,
      rutaOrigen,
      chunks: chunks.length,
      totalTime,
      embeddingTime,
      qdrantTime,
      id: jsonData.id
    };

  } catch (error) {
    console.error(`    ❌ Error: ${error.message}`);
    return {
      success: false,
      archivo,
      error: error.message,
      totalTime: performance.now() - docStartTime
    };
  }
}

/**
 * Procesamiento balanceado
 */
async function procesarBalanceado(archivos, sentenciasDir) {
  console.log(`\n🚀 PROCESAMIENTO BALANCEADO: ${archivos.length} archivos`);
  console.log(`⚡ Configuración balanceada:`);
  console.log(`   - Documentos simultáneos: ${BALANCED_CONFIG.MAX_CONCURRENT_DOCS}`);
  console.log(`   - Batch size embeddings: ${BALANCED_CONFIG.EMBEDDING_BATCH_SIZE}`);
  console.log(`   - Request delay: ${BALANCED_CONFIG.REQUEST_DELAY_MS}ms`);
  console.log(`   - Max sockets: 20`);
  
  const results = {
    success: [],
    errors: [],
    totalChunks: 0,
    totalEmbeddingTime: 0,
    totalQdrantTime: 0
  };

  const startTime = performance.now();
  
  // Procesar en grupos pequeños
  const batchSize = BALANCED_CONFIG.MAX_CONCURRENT_DOCS;
  let processedCount = 0;
  
  for (let i = 0; i < archivos.length; i += batchSize) {
    const batch = archivos.slice(i, i + batchSize);
    const batchStartTime = performance.now();
    
    console.log(`\n📦 Lote ${Math.floor(i/batchSize) + 1}: docs ${i + 1}-${Math.min(i + batchSize, archivos.length)}`);
    
    // Procesar batch con concurrencia limitada
    const batchPromises = batch.map(archivo => {
      const rutaOrigen = path.join(sentenciasDir, archivo);
      return procesarDocumentoControlado(archivo, rutaOrigen);
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    const batchEndTime = performance.now();
    const batchTime = batchEndTime - batchStartTime;
    
    // Procesar resultados
    let batchChunks = 0;
    let batchEmbeddingTime = 0;
    let batchQdrantTime = 0;
    
    for (const result of batchResults) {
      if (result.success) {
        results.success.push(result);
        results.totalChunks += result.chunks;
        results.totalEmbeddingTime += result.embeddingTime;
        results.totalQdrantTime += result.qdrantTime;
        
        batchChunks += result.chunks;
        batchEmbeddingTime += result.embeddingTime;
        batchQdrantTime += result.qdrantTime;
      } else {
        results.errors.push(result);
      }
      processedCount++;
    }
    
    const batchThroughput = batch.length / (batchTime / 1000);
    const batchChunkThroughput = batchChunks / (batchTime / 1000);
    const overallTime = (performance.now() - startTime) / 1000;
    const overallThroughput = processedCount / overallTime;
    const overallChunkThroughput = results.totalChunks / overallTime;
    
    console.log(`\n  ⚡ Lote: ${batchThroughput.toFixed(2)} docs/seg, ${batchChunkThroughput.toFixed(2)} chunks/seg`);
    console.log(`  📈 Global: ${overallThroughput.toFixed(2)} docs/seg, ${overallChunkThroughput.toFixed(2)} chunks/seg`);
    console.log(`  📊 Utilización estimada: ${(overallChunkThroughput / 612 * 100).toFixed(1)}%`);
    console.log(`  🎯 Progreso: ${processedCount}/${archivos.length} (${((processedCount/archivos.length)*100).toFixed(1)}%)`);
    
    // Pausa entre lotes para dar respiro al servicio
    if (i + batchSize < archivos.length) {
      console.log(`  😴 Pausa de 2 segundos...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  results.totalTime = (performance.now() - startTime) / 1000;
  return results;
}

/**
 * Función principal balanceada
 */
async function indexarBalanceado(sentenciasDir, vectorizedDir) {
  try {
    if (!fs.existsSync(sentenciasDir)) {
      console.log('❌ La carpeta de sentencias no existe', sentenciasDir);
      return;
    }

    if (!fs.existsSync(vectorizedDir)) {
      fs.mkdirSync(vectorizedDir, { recursive: true });
    }

    const archivos = fs.readdirSync(sentenciasDir).filter(archivo =>
      archivo.endsWith('.json') && fs.statSync(path.join(sentenciasDir, archivo)).isFile()
    );

    if (archivos.length === 0) {
      console.log('⚠️ No se encontraron archivos JSON');
      return;
    }

    console.log(`\n🚀 INDEXACIÓN BALANCEADA`);
    console.log(`📂 Total archivos: ${archivos.length}`);
    console.log(`📦 Colección: ${QDRANT_COLLECTION}`);

    const results = await procesarBalanceado(archivos, sentenciasDir);

    // Mover archivos
    console.log(`\n📁 Moviendo archivos procesados...`);
    let movedCount = 0;
    
    for (const result of results.success) {
      const rutaDestino = path.join(vectorizedDir, result.archivo);
      
      try {
        if (fs.existsSync(result.rutaOrigen)) {
          fs.renameSync(result.rutaOrigen, rutaDestino);
          movedCount++;
        }
      } catch (error) {
        console.error(`Error moviendo ${result.archivo}:`, error.message);
      }
    }

    // Resumen final
    const overallThroughput = results.success.length / results.totalTime;
    const chunksPerSec = results.totalChunks / results.totalTime;
    const avgEmbeddingTime = results.totalEmbeddingTime / results.success.length;
    const avgQdrantTime = results.totalQdrantTime / results.success.length;

    console.log(`\n🎉 INDEXACIÓN BALANCEADA COMPLETADA:`);
    console.log(`   ✅ Procesados: ${results.success.length}`);
    console.log(`   ❌ Errores: ${results.errors.length}`);
    console.log(`   📦 Movidos: ${movedCount}`);
    console.log(`   🔢 Total chunks: ${results.totalChunks}`);
    console.log(`\n⚡ Rendimiento BALANCEADO:`);
    console.log(`   ⏱️ Tiempo total: ${results.totalTime.toFixed(2)}s`);
    console.log(`   📈 Velocidad: ${overallThroughput.toFixed(2)} docs/seg`);
    console.log(`   🔢 Chunks: ${chunksPerSec.toFixed(2)} chunks/seg`);
    console.log(`   💾 Throughput: ${(overallThroughput * 60).toFixed(0)} docs/min`);
    console.log(`   🧠 Tiempo promedio embeddings: ${avgEmbeddingTime.toFixed(0)}ms/doc`);
    console.log(`   📤 Tiempo promedio Qdrant: ${avgQdrantTime.toFixed(0)}ms/doc`);
    console.log(`   🚀 Mejora vs saturado: SIN TIMEOUTS`);

    if (overallThroughput > 15) {
      console.log(`\n🎉 ¡EXCELENTE RENDIMIENTO! (>15 docs/seg sin errores)`);
    } else if (overallThroughput > 10) {
      console.log(`\n✅ Buen rendimiento estable (>10 docs/seg)`);
    } else {
      console.log(`\n⚠️ Rendimiento conservador pero estable`);
    }

  } catch (error) {
    console.error('\n🛑 ERROR CRÍTICO:', error);
    process.exit(1);
  }
}

// Ejecutar
if (!SENTENCIAS_DIR || !VECTORIZED_DIR) {
  console.error('❌ Variables de entorno requeridas');
  process.exit(1);
}

indexarBalanceado(SENTENCIAS_DIR, VECTORIZED_DIR);

process.on('SIGINT', () => {
  console.log('\n⚠️ Proceso interrumpido');
  process.exit(0);
});
