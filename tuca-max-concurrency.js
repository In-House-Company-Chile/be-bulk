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

// CONFIGURACIÓN PARA EXPLOTAR 612 texts/sec
const MAX_CONFIG = {
  EMBEDDING_BATCH_SIZE: 128,           // Óptimo según test
  MAX_CONCURRENT_EMBEDDING_REQUESTS: 10, // Múltiples requests paralelos
  MAX_CONCURRENT_DOCS: 50,             // Más documentos simultáneos
  EMBEDDING_API_URL: process.env.EMBEDDING_API_URL || 'http://localhost:11441/embed',
  QDRANT_URL: process.env.QDRANT_URL || 'http://localhost:6333',
  TARGET_DIMENSION: 1024,
  QDRANT_BATCH_SIZE: 200
};

// Cliente HTTP ultra agresivo
const httpClient = axios.create({
  timeout: 60000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    keepAliveMsecs: 100,
    maxSockets: 200,
    maxFreeSockets: 50
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
 * Obtener embeddings con máxima concurrencia
 */
async function getEmbeddingsMaxConcurrency(chunks) {
  const allEmbeddings = [];
  const batchPromises = [];
  
  // Dividir chunks en batches de 128
  for (let i = 0; i < chunks.length; i += MAX_CONFIG.EMBEDDING_BATCH_SIZE) {
    const batchChunks = chunks.slice(i, i + MAX_CONFIG.EMBEDDING_BATCH_SIZE);
    
    // Crear promesa para este batch
    const batchPromise = httpClient.post(MAX_CONFIG.EMBEDDING_API_URL, {
      inputs: batchChunks
    }).then(response => {
      const embeddings = Array.isArray(response.data[0]) ? response.data : [response.data];
      return { startIndex: i, embeddings };
    });
    
    batchPromises.push(batchPromise);
    
    // Limitar concurrencia de requests de embeddings
    if (batchPromises.length >= MAX_CONFIG.MAX_CONCURRENT_EMBEDDING_REQUESTS) {
      const results = await Promise.all(batchPromises);
      
      // Ordenar y agregar embeddings
      results.sort((a, b) => a.startIndex - b.startIndex);
      results.forEach(result => {
        allEmbeddings.push(...result.embeddings);
      });
      
      batchPromises.length = 0;
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
 * Upsert a Qdrant con batches grandes
 */
async function upsertToQdrant(points) {
  const batchSize = MAX_CONFIG.QDRANT_BATCH_SIZE;
  const upsertPromises = [];
  
  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    
    const promise = httpClient.put(`${MAX_CONFIG.QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`, {
      points: batch
    });
    
    upsertPromises.push(promise);
    
    // Limitar upserts concurrentes
    if (upsertPromises.length >= 5) {
      await Promise.race(upsertPromises.map((p, idx) => 
        p.then(() => upsertPromises.splice(idx, 1))
      ));
    }
  }
  
  await Promise.all(upsertPromises);
}

/**
 * Procesar un documento con máxima eficiencia
 */
async function procesarDocumentoMax(archivo, rutaOrigen) {
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

    // Obtener embeddings con máxima concurrencia
    const embeddingStartTime = performance.now();
    const embeddings = await getEmbeddingsMaxConcurrency(chunks);
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

    // Upsert a Qdrant
    const qdrantStartTime = performance.now();
    await upsertToQdrant(points);
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
 * Procesamiento con máxima concurrencia
 */
async function procesarMaxConcurrency(archivos, sentenciasDir) {
  console.log(`\n🚀 PROCESAMIENTO MÁXIMA CONCURRENCIA: ${archivos.length} archivos`);
  console.log(`⚡ Configuración extrema:`);
  console.log(`   - Documentos simultáneos: ${MAX_CONFIG.MAX_CONCURRENT_DOCS}`);
  console.log(`   - Requests embeddings paralelos: ${MAX_CONFIG.MAX_CONCURRENT_EMBEDDING_REQUESTS}`);
  console.log(`   - Batch size embeddings: ${MAX_CONFIG.EMBEDDING_BATCH_SIZE}`);
  console.log(`   - Capacidad teórica: 612 texts/sec`);
  
  const results = {
    success: [],
    errors: [],
    totalChunks: 0,
    totalEmbeddingTime: 0,
    totalQdrantTime: 0
  };

  const startTime = performance.now();
  
  // Crear todas las promesas
  const documentPromises = archivos.map(archivo => {
    const rutaOrigen = path.join(sentenciasDir, archivo);
    return procesarDocumentoMax(archivo, rutaOrigen);
  });

  // Procesar con límite de concurrencia extremo
  const batchSize = MAX_CONFIG.MAX_CONCURRENT_DOCS;
  let processedCount = 0;
  
  for (let i = 0; i < documentPromises.length; i += batchSize) {
    const batch = documentPromises.slice(i, i + batchSize);
    const batchStartTime = performance.now();
    
    console.log(`\n📦 Lote extremo ${Math.floor(i/batchSize) + 1}: docs ${i + 1}-${Math.min(i + batchSize, documentPromises.length)}`);
    
    const batchResults = await Promise.all(batch);
    
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
        
        console.log(`  ✅ ${result.archivo}: ${result.chunks} chunks en ${result.totalTime.toFixed(0)}ms`);
      } else {
        results.errors.push(result);
        if (result.reason !== 'sin_texto') {
          console.log(`  ❌ ${result.archivo}: ${result.error}`);
        }
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
    console.log(`  📊 Utilización GPU estimada: ${(overallChunkThroughput / 612 * 100).toFixed(1)}%`);
    console.log(`  🎯 Progreso: ${processedCount}/${archivos.length} (${((processedCount/archivos.length)*100).toFixed(1)}%)`);
  }

  results.totalTime = (performance.now() - startTime) / 1000;
  return results;
}

/**
 * Función principal máxima concurrencia
 */
async function indexarMaxConcurrency(sentenciasDir, vectorizedDir) {
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

    console.log(`\n🚀 INDEXACIÓN MÁXIMA CONCURRENCIA`);
    console.log(`📂 Total archivos: ${archivos.length}`);
    console.log(`📦 Colección: ${QDRANT_COLLECTION}`);

    const results = await procesarMaxConcurrency(archivos, sentenciasDir);

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
    const gpuUtilization = (chunksPerSec / 612 * 100);

    console.log(`\n🎉 INDEXACIÓN MÁXIMA CONCURRENCIA COMPLETADA:`);
    console.log(`   ✅ Procesados: ${results.success.length}`);
    console.log(`   ❌ Errores: ${results.errors.length}`);
    console.log(`   📦 Movidos: ${movedCount}`);
    console.log(`   🔢 Total chunks: ${results.totalChunks}`);
    console.log(`\n⚡ Rendimiento EXTREMO:`);
    console.log(`   ⏱️ Tiempo total: ${results.totalTime.toFixed(2)}s`);
    console.log(`   📈 Velocidad: ${overallThroughput.toFixed(2)} docs/seg`);
    console.log(`   🔢 Chunks: ${chunksPerSec.toFixed(2)} chunks/seg`);
    console.log(`   💾 Throughput: ${(overallThroughput * 60).toFixed(0)} docs/min`);
    console.log(`   🎯 Utilización GPU: ${gpuUtilization.toFixed(1)}%`);
    console.log(`   🚀 Mejora vs anterior: ${(overallThroughput / 6.33).toFixed(1)}x más rápido`);

    if (overallThroughput > 30) {
      console.log(`\n🎉 ¡OBJETIVO SUPERADO! (>30 docs/seg)`);
    } else if (overallThroughput > 15) {
      console.log(`\n✅ Buen rendimiento (>15 docs/seg)`);
    } else {
      console.log(`\n⚠️ Aún hay margen de mejora`);
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

indexarMaxConcurrency(SENTENCIAS_DIR, VECTORIZED_DIR);

process.on('SIGINT', () => {
  console.log('\n⚠️ Proceso interrumpido');
  process.exit(0);
});
