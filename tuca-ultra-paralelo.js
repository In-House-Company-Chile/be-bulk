const fs = require('fs');
const path = require('path');
const IndexarQdrant = require('./functions/IndexarQdrant');
const axios = require('axios');
const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');

require('dotenv').config();
const BASE_NAME = process.env.BASE_NAME;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'test_jurisprudencia_3';
const SENTENCIAS_DIR = process.env.SENTENCIAS_DIR;
const VECTORIZED_DIR = process.env.VECTORIZED_DIR;

// CONFIGURACIÓN ULTRA PARALELA
const ULTRA_CONFIG = {
  MAX_CONCURRENT_DOCS: 20,        // Procesamos 20 docs simultáneamente
  EMBEDDING_BATCH_SIZE: 64,       // Batch grande para GPU
  EMBEDDING_API_URL: process.env.EMBEDDING_API_URL || 'http://localhost:11441/embed',
  TARGET_DIMENSION: 1024,
  QDRANT_BATCH_SIZE: 200,
  MAX_CONCURRENT_QDRANT_UPSERTS: 10
};

const config = {
  QDRANT: {
    URL: process.env.QDRANT_URL || 'http://localhost:6333'
  }
};

// Agentes HTTP ultra optimizados
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 100,
  maxSockets: 200,
  maxFreeSockets: 50,
  timeout: 60000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 100,
  maxSockets: 200,
  maxFreeSockets: 50,
  timeout: 60000,
});

axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 30000;

/**
 * Crear metadata optimizada
 */
function createMetadataByType(jsonData, tipoBase) {
  return {
    idSentence: jsonData.id,
    base: tipoBase,
    url: jsonData.url_corta_acceso_sentencia || '',
    rol: jsonData.rol_era_sup_s || jsonData.rol_era_ape_s || '',
    caratulado: jsonData.caratulado_s || '',
    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
    tribunal: jsonData.gls_juz_s || '',
    juez: Array.isArray(jsonData.gls_juez_ss) ? jsonData.gls_juez_ss[0] : jsonData.gls_juez_ss || '',
  };
}

/**
 * Procesar un documento individual
 */
async function procesarDocumento(archivo, rutaOrigen) {
  const docStartTime = performance.now();
  
  try {
    // Leer y parsear
    const contenido = fs.readFileSync(rutaOrigen, 'utf8');
    const jsonData = JSON.parse(contenido);

    // Verificar texto
    if (!jsonData.texto_sentencia || jsonData.texto_sentencia.trim() === '') {
      return { success: false, reason: 'sin_texto', archivo };
    }

    // Crear metadata
    const metadata = createMetadataByType(jsonData, BASE_NAME);

    // Vectorizar (aquí está la magia de la paralelización)
    const indexResult = await IndexarQdrant.create(
      jsonData.texto_sentencia, 
      QDRANT_COLLECTION, 
      metadata,
      {
        embeddingBatchSize: ULTRA_CONFIG.EMBEDDING_BATCH_SIZE,
        embeddingUrl: ULTRA_CONFIG.EMBEDDING_API_URL,
        qdrantUrl: config.QDRANT.URL,
        vectorDimension: ULTRA_CONFIG.TARGET_DIMENSION,
        upsertBatchSize: ULTRA_CONFIG.QDRANT_BATCH_SIZE,
        maxConcurrentUpserts: ULTRA_CONFIG.MAX_CONCURRENT_QDRANT_UPSERTS
      }
    );

    const docEndTime = performance.now();
    const totalTime = docEndTime - docStartTime;

    return {
      success: true,
      archivo,
      rutaOrigen,
      chunks: indexResult?.chunksProcessed || 0,
      totalTime,
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
 * Procesamiento ultra paralelo
 */
async function procesarEnParalelo(archivos, sentenciasDir) {
  console.log(`\n🚀 PROCESAMIENTO ULTRA PARALELO: ${archivos.length} archivos`);
  console.log(`⚡ Concurrencia: ${ULTRA_CONFIG.MAX_CONCURRENT_DOCS} documentos simultáneos`);
  
  const results = {
    success: [],
    errors: [],
    totalChunks: 0,
    totalTime: 0
  };

  const startTime = performance.now();
  
  // Crear promesas para todos los documentos
  const documentPromises = archivos.map(archivo => {
    const rutaOrigen = path.join(sentenciasDir, archivo);
    return procesarDocumento(archivo, rutaOrigen);
  });

  // Procesar con límite de concurrencia
  const batchSize = ULTRA_CONFIG.MAX_CONCURRENT_DOCS;
  let processedCount = 0;
  
  for (let i = 0; i < documentPromises.length; i += batchSize) {
    const batch = documentPromises.slice(i, i + batchSize);
    const batchStartTime = performance.now();
    
    console.log(`\n📦 Procesando lote ${Math.floor(i/batchSize) + 1}: documentos ${i + 1}-${Math.min(i + batchSize, documentPromises.length)}`);
    
    // Ejecutar batch en paralelo
    const batchResults = await Promise.all(batch);
    
    const batchEndTime = performance.now();
    const batchTime = batchEndTime - batchStartTime;
    
    // Procesar resultados del batch
    for (const result of batchResults) {
      if (result.success) {
        results.success.push(result);
        results.totalChunks += result.chunks;
        console.log(`  ✅ ${result.archivo}: ${result.chunks} chunks en ${result.totalTime.toFixed(0)}ms (ID: ${result.id})`);
      } else {
        results.errors.push(result);
        if (result.reason !== 'sin_texto') {
          console.log(`  ❌ ${result.archivo}: ${result.error}`);
        }
      }
      processedCount++;
    }
    
    const batchThroughput = batch.length / (batchTime / 1000);
    const overallTime = (performance.now() - startTime) / 1000;
    const overallThroughput = processedCount / overallTime;
    
    console.log(`\n  ⚡ Lote: ${batchThroughput.toFixed(2)} docs/seg`);
    console.log(`  📈 Promedio: ${overallThroughput.toFixed(2)} docs/seg`);
    console.log(`  📊 Progreso: ${processedCount}/${archivos.length} (${((processedCount/archivos.length)*100).toFixed(1)}%)`);
  }

  results.totalTime = (performance.now() - startTime) / 1000;
  return results;
}

/**
 * Función principal ultra paralela
 */
async function indexarQdrantUltraParalelo(sentenciasDir, vectorizedDir) {
  try {
    // Verificaciones iniciales
    if (!fs.existsSync(sentenciasDir)) {
      console.log('❌ La carpeta de sentencias no existe', sentenciasDir);
      return;
    }

    if (!fs.existsSync(vectorizedDir)) {
      fs.mkdirSync(vectorizedDir, { recursive: true });
    }

    // Leer archivos
    const archivos = fs.readdirSync(sentenciasDir).filter(archivo =>
      archivo.endsWith('.json') && fs.statSync(path.join(sentenciasDir, archivo)).isFile()
    );

    if (archivos.length === 0) {
      console.log('⚠️ No se encontraron archivos JSON');
      return;
    }

    console.log(`\n🚀 INDEXACIÓN QDRANT ULTRA PARALELA`);
    console.log(`📂 Total archivos: ${archivos.length}`);
    console.log(`📦 Colección: ${QDRANT_COLLECTION}`);
    console.log(`\n⚡ Configuración ultra paralela:`);
    console.log(`   - Documentos simultáneos: ${ULTRA_CONFIG.MAX_CONCURRENT_DOCS}`);
    console.log(`   - Batch size embeddings: ${ULTRA_CONFIG.EMBEDDING_BATCH_SIZE}`);
    console.log(`   - Batch size Qdrant: ${ULTRA_CONFIG.QDRANT_BATCH_SIZE}`);

    // Configurar Qdrant
    console.log('\n🔍 Configurando Qdrant...');
    console.log(`📍 URL Qdrant: ${config.QDRANT.URL}`);

    // Procesamiento ultra paralelo
    const results = await procesarEnParalelo(archivos, sentenciasDir);

    // Mover archivos procesados exitosamente
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

    console.log(`\n🎉 INDEXACIÓN ULTRA PARALELA COMPLETADA:`);
    console.log(`   ✅ Procesados: ${results.success.length}`);
    console.log(`   ❌ Errores: ${results.errors.length}`);
    console.log(`   📦 Movidos: ${movedCount}`);
    console.log(`   🔢 Total chunks: ${results.totalChunks}`);
    console.log(`\n⚡ Rendimiento ULTRA:`);
    console.log(`   ⏱️ Tiempo total: ${results.totalTime.toFixed(2)}s`);
    console.log(`   📈 Velocidad: ${overallThroughput.toFixed(2)} docs/seg`);
    console.log(`   🔢 Chunks: ${chunksPerSec.toFixed(2)} chunks/seg`);
    console.log(`   💾 Throughput: ${(overallThroughput * 60).toFixed(0)} docs/min`);
    console.log(`   🎯 Mejora vs secuencial: ${(overallThroughput / 6.54).toFixed(1)}x más rápido`);

    // Proyección
    if (overallThroughput > 30) {
      console.log(`\n🎉 ¡OBJETIVO SUPERADO! (>30 docs/seg)`);
    } else if (overallThroughput > 15) {
      console.log(`\n✅ Buen rendimiento (>15 docs/seg)`);
    } else {
      console.log(`\n⚠️ Rendimiento mejorable (<15 docs/seg)`);
    }

  } catch (error) {
    console.error('\n🛑 ERROR CRÍTICO:', error);
    process.exit(1);
  }
}

// Ejecutar
if (!SENTENCIAS_DIR || !VECTORIZED_DIR) {
  console.error('❌ Variables de entorno requeridas:');
  console.error('   SENTENCIAS_DIR - Directorio de archivos JSON');
  console.error('   VECTORIZED_DIR - Directorio de archivos procesados');
  process.exit(1);
}

indexarQdrantUltraParalelo(SENTENCIAS_DIR, VECTORIZED_DIR);

// Handlers
process.on('SIGINT', () => {
  console.log('\n⚠️ Proceso interrumpido');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('\n🛑 ERROR NO CAPTURADO:', error);
  process.exit(1);
});
