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

// CONFIGURACIÓN ÓPTIMA - PUNTO DULCE
const OPTIMAL_CONFIG = {
  EMBEDDING_BATCH_SIZE: 128,           // Óptimo confirmado
  MAX_CONCURRENT_DOCS: 8,              // Punto dulce - no satura pero es rápido
  MAX_CONCURRENT_EMBEDDING_BATCHES: 3, // Múltiples batches por documento
  EMBEDDING_API_URL: process.env.EMBEDDING_API_URL || 'http://localhost:11441/embed',
  QDRANT_URL: process.env.QDRANT_URL || 'http://localhost:6333',
  TARGET_DIMENSION: 1024,
  QDRANT_BATCH_SIZE: 300,
  REQUEST_DELAY_MS: 10                 // Pausa mínima
};

// Cliente HTTP optimizado pero no agresivo
const httpClient = axios.create({
  timeout: 90000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    keepAliveMsecs: 500,
    maxSockets: 50,   // Punto medio
    maxFreeSockets: 15
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
 * Obtener embeddings con concurrencia controlada
 */
async function getEmbeddingsOptimal(chunks) {
  const allEmbeddings = [];
  const batchPromises = [];
  
  // Dividir en batches de 128
  for (let i = 0; i < chunks.length; i += OPTIMAL_CONFIG.EMBEDDING_BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + OPTIMAL_CONFIG.EMBEDDING_BATCH_SIZE);
    
    // Crear promesa para este batch
    const batchPromise = httpClient.post(OPTIMAL_CONFIG.EMBEDDING_API_URL, {
      inputs: batchChunks
    }).then(response => {
      const embeddings = Array.isArray(response.data[0]) ? response.data : [response.data];
      return { startIndex: i, embeddings, chunkCount: batchChunks.length };
    });
    
    batchPromises.push(batchPromise);
    
    // Limitar concurrencia de batches de embeddings
    if (batchPromises.length >= OPTIMAL_CONFIG.MAX_CONCURRENT_EMBEDDING_BATCHES) {
      const results = await Promise.all(batchPromises);
      
      // Ordenar y agregar embeddings
      results.sort((a, b) => a.startIndex - b.startIndex);
      results.forEach(result => {
        allEmbeddings.push(...result.embeddings);
      });
      
      batchPromises.length = 0;
      
      // Pausa mínima para no saturar
      await new Promise(resolve => setTimeout(resolve, OPTIMAL_CONFIG.REQUEST_DELAY_MS));
    }
  }
  
  // Procesar batches restantes
  if (batchPromises.length > 0) {
    const results = await Promise.all(batchPromises);
    results.sort((a, b) => a.startIndex - b.startIndex);
    results.forEach(result => {
      allEmbeddings.push(...result.embeddings);
    });
  }
  
  return allEmbeddings;
}

/**
 * Upsert a Qdrant optimizado
 */
async function upsertToQdrantOptimal(points) {
  const batchSize = OPTIMAL_CONFIG.QDRANT_BATCH_SIZE;
  const upsertPromises = [];
  
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    
    const promise = httpClient.put(`${OPTIMAL_CONFIG.QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`, {
      points: batch
    });
    
    upsertPromises.push(promise);
    
    // Limitar upserts concurrentes
    if (upsertPromises.length >= 3) {
      await Promise.race(upsertPromises.map((p, idx) => 
        p.then(() => upsertPromises.splice(idx, 1))
      ));
    }
  }
  
  await Promise.all(upsertPromises);
}

/**
 * Procesar un documento optimizado
 */
async function procesarDocumentoOptimal(archivo, rutaOrigen) {
  const docStartTime = performance.now();
  
  try {
    // Leer y parsear
    const contenido = fs.readFileSync(rutaOrigen, 'utf8');
    const jsonData = JSON.parse(contenido);

    if (!jsonData.texto_sentencia || jsonData.texto_sentencia.trim() === '') {
      return { success: false, reason: 'sin_texto', archivo };
    }

    // Crear chunks
    const chunks = createChunks(jsonData.texto_sentencia);
    if (chunks.length === 0) {
      return { success: false, reason: 'sin_chunks', archivo };
    }

    // Obtener embeddings optimizado
    const embeddingStartTime = performance.now();
    const embeddings = await getEmbeddingsOptimal(chunks);
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

    // Upsert a Qdrant optimizado
    const qdrantStartTime = performance.now();
    await upsertToQdrantOptimal(points);
    const qdrantEndTime = performance.now();
    const qdrantTime = qdrantEndTime - qdrantStartTime;

    const docEndTime = performance.now();
    const totalTime = docEndTime - docStartTime;

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
    return {
      success: false,
      archivo,
      error: error.message,
      totalTime: performance.now() - docStartTime
    };
  }
}

/**
 * Procesamiento óptimo
 */
async function procesarOptimo(archivos, sentenciasDir) {
  console.log(`\n🚀 PROCESAMIENTO ÓPTIMO: ${archivos.length} archivos`);
  console.log(`⚡ Configuración óptima:`);
  console.log(`   - Documentos simultáneos: ${OPTIMAL_CONFIG.MAX_CONCURRENT_DOCS}`);
  console.log(`   - Batches embeddings paralelos: ${OPTIMAL_CONFIG.MAX_CONCURRENT_EMBEDDING_BATCHES}`);
  console.log(`   - Batch size embeddings: ${OPTIMAL_CONFIG.EMBEDDING_BATCH_SIZE}`);
  console.log(`   - Batch size Qdrant: ${OPTIMAL_CONFIG.QDRANT_BATCH_SIZE}`);
  console.log(`   - Max sockets: 50`);
  
  const results = {
    success: [],
    errors: [],
    totalChunks: 0,
    totalEmbeddingTime: 0,
    totalQdrantTime: 0
  };

  const startTime = performance.now();
  
  // Procesar en grupos óptimos
  const batchSize = OPTIMAL_CONFIG.MAX_CONCURRENT_DOCS;
  let processedCount = 0;
  
  for (let i = 0; i < archivos.length; i += batchSize) {
    const batch = archivos.slice(i, i + batchSize);
    const batchStartTime = performance.now();
    
    console.log(`\n📦 Lote ${Math.floor(i/batchSize) + 1}: docs ${i + 1}-${Math.min(i + batchSize, archivos.length)}`);
    
    // Procesar batch con concurrencia óptima
    const batchPromises = batch.map(archivo => {
      const rutaOrigen = path.join(sentenciasDir, archivo);
      return procesarDocumentoOptimal(archivo, rutaOrigen);
    });
    
    const batchResults = await Promise.all(batchPromises);
    
    const batchEndTime = performance.now();
    const batchTime = batchEndTime - batchStartTime;
    
    // Procesar resultados
    let batchChunks = 0;
    let batchEmbeddingTime = 0;
    let batchQdrantTime = 0;
    let batchSuccessful = 0;
    
    for (const result of batchResults) {
      if (result.success) {
        results.success.push(result);
        results.totalChunks += result.chunks;
        results.totalEmbeddingTime += result.embeddingTime;
        results.totalQdrantTime += result.qdrantTime;
        
        batchChunks += result.chunks;
        batchEmbeddingTime += result.embeddingTime;
        batchQdrantTime += result.qdrantTime;
        batchSuccessful++;
        
        console.log(`  ✅ ${result.archivo}: ${result.chunks} chunks en ${result.totalTime.toFixed(0)}ms (ID: ${result.id})`);
      } else {
        results.errors.push(result);
        if (result.reason !== 'sin_texto') {
          console.log(`  ❌ ${result.archivo}: ${result.error}`);
        } else {
          console.log(`  ⚠️ ${result.archivo}: sin texto`);
        }
      }
      processedCount++;
    }
    
    const batchThroughput = batchSuccessful / (batchTime / 1000);
    const batchChunkThroughput = batchChunks / (batchTime / 1000);
    const overallTime = (performance.now() - startTime) / 1000;
    const overallThroughput = results.success.length / overallTime;
    const overallChunkThroughput = results.totalChunks / overallTime;
    
    console.log(`\n  ⚡ Lote: ${batchThroughput.toFixed(2)} docs/seg, ${batchChunkThroughput.toFixed(2)} chunks/seg`);
    console.log(`  📈 Global: ${overallThroughput.toFixed(2)} docs/seg, ${overallChunkThroughput.toFixed(2)} chunks/seg`);
    console.log(`  📊 Utilización GPU: ${(overallChunkThroughput / 612 * 100).toFixed(1)}%`);
    console.log(`  🎯 Progreso: ${processedCount}/${archivos.length} (${((processedCount/archivos.length)*100).toFixed(1)}%)`);
    console.log(`  ⏱️ Tiempo promedio/doc: ${(batchTime / batchSuccessful).toFixed(0)}ms`);
    
    // Pausa mínima entre lotes
    if (i + batchSize < archivos.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  results.totalTime = (performance.now() - startTime) / 1000;
  return results;
}

/**
 * Función principal óptima
 */
async function indexarOptimo(sentenciasDir, vectorizedDir) {
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

    console.log(`\n🚀 INDEXACIÓN ÓPTIMA`);
    console.log(`📂 Total archivos: ${archivos.length}`);
    console.log(`📦 Colección: ${QDRANT_COLLECTION}`);

    const results = await procesarOptimo(archivos, sentenciasDir);

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
    const avgTotalTime = (results.totalEmbeddingTime + results.totalQdrantTime) / results.success.length;
    const gpuUtilization = (chunksPerSec / 612 * 100);

    console.log(`\n🎉 INDEXACIÓN ÓPTIMA COMPLETADA:`);
    console.log(`   ✅ Procesados: ${results.success.length}`);
    console.log(`   ❌ Errores: ${results.errors.length}`);
    console.log(`   📦 Movidos: ${movedCount}`);
    console.log(`   🔢 Total chunks: ${results.totalChunks}`);
    console.log(`\n⚡ Rendimiento ÓPTIMO:`);
    console.log(`   ⏱️ Tiempo total: ${results.totalTime.toFixed(2)}s`);
    console.log(`   📈 Velocidad: ${overallThroughput.toFixed(2)} docs/seg`);
    console.log(`   🔢 Chunks: ${chunksPerSec.toFixed(2)} chunks/seg`);
    console.log(`   💾 Throughput: ${(overallThroughput * 60).toFixed(0)} docs/min`);
    console.log(`   🎯 Utilización GPU: ${gpuUtilization.toFixed(1)}%`);
    console.log(`   🧠 Tiempo promedio embeddings: ${avgEmbeddingTime.toFixed(0)}ms/doc`);
    console.log(`   📤 Tiempo promedio Qdrant: ${avgQdrantTime.toFixed(0)}ms/doc`);
    console.log(`   ⚡ Tiempo promedio total: ${avgTotalTime.toFixed(0)}ms/doc`);
    console.log(`   🚀 Mejora vs conservador: ${(overallThroughput / 1.22).toFixed(1)}x más rápido`);

    if (overallThroughput > 20) {
      console.log(`\n🎉 ¡RENDIMIENTO EXCELENTE! (>20 docs/seg)`);
    } else if (overallThroughput > 15) {
      console.log(`\n✅ RENDIMIENTO MUY BUENO (>15 docs/seg)`);
    } else if (overallThroughput > 10) {
      console.log(`\n✅ Buen rendimiento (>10 docs/seg)`);
    } else {
      console.log(`\n⚠️ Rendimiento mejorable`);
    }

    // Proyección para dataset completo
    if (results.success.length > 0) {
      const timeFor6000 = (6000 / overallThroughput) / 60; // minutos
      console.log(`\n🎯 Proyección para 6000 documentos: ${timeFor6000.toFixed(1)} minutos`);
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

indexarOptimo(SENTENCIAS_DIR, VECTORIZED_DIR);

process.on('SIGINT', () => {
  console.log('\n⚠️ Proceso interrumpido');
  process.exit(0);
});
