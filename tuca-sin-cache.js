const fs = require('fs');
const path = require('path');
const IndexarQdrant = require('./functions/IndexarQdrant');
const axios = require('axios');
const http = require('http');
const https = require('https');

require('dotenv').config();
const BASE_NAME = process.env.BASE_NAME;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'test_jurisprudencia_3';
const SENTENCIAS_DIR = process.env.SENTENCIAS_DIR;
const VECTORIZED_DIR = process.env.VECTORIZED_DIR;

// Configuración optimizada basada en tests
const PARALLELIZATION_CONFIG = {
  MAX_CONCURRENT_DOCS: 40,
  MAX_CONCURRENT_EMBEDDINGS: 25,
  EMBEDDING_BATCH_SIZE: 128,
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

// Agentes HTTP optimizados
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 500,
  maxSockets: 500,
  maxFreeSockets: 100,
  timeout: 120000,
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 500,
  maxSockets: 500,
  maxFreeSockets: 100,
  timeout: 120000,
});

axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 30000;

/**
 * Crear metadata según el tipo de base
 */
function createMetadataByType(jsonData, tipoBase) {
  const baseMetadata = {
    idSentence: jsonData.id,
    base: tipoBase,
    url: jsonData.url_corta_acceso_sentencia || '',
  };

  switch (tipoBase.toLowerCase()) {
    case 'civil':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
        materia: jsonData.gls_materia_s || '',
      };

    case 'penal':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        materia: jsonData.gls_materia_ss || [],
        juez: jsonData.gls_juez_ss || [],
        resultado: jsonData.sent__GLS_DECISION_s || '',
      };

    case 'familia':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        materia: jsonData.cod_materia_s || [],
        juez: jsonData.gls_juez_ss || [],
      };

    case 'corte_de_apelaciones':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_ape_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.gls_materia_s || '',
        sala: jsonData.gls_sala_sup_s || '',
        corte: jsonData.gls_corte_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        tipoRecurso: jsonData.tip_recurso_s || '',
        juzgado: jsonData.gls_juz_s || '',
      };

    default:
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
      };
  }
}

/**
 * Monitor de rendimiento
 */
function createPerformanceMonitor() {
  const startTime = Date.now();
  let lastBatchTime = startTime;
  let totalProcessed = 0;
  let totalChunks = 0;
  let totalEmbeddingTime = 0;

  return {
    logBatchPerformance: (batchSize, batchNumber, totalBatches, extraMetrics = {}) => {
      const now = Date.now();
      const batchTime = now - lastBatchTime;
      const totalTime = now - startTime;

      totalProcessed += batchSize;
      if (extraMetrics.chunks) totalChunks += extraMetrics.chunks;
      if (extraMetrics.embeddingTime) totalEmbeddingTime += extraMetrics.embeddingTime;

      const batchRate = batchSize / (batchTime / 1000);
      const overallRate = totalProcessed / (totalTime / 1000);
      const estimatedTimeRemaining = ((totalBatches - batchNumber) * (totalTime / batchNumber)) / 1000;
      const avgChunksPerDoc = totalChunks / totalProcessed;

      console.log(`\n⚡ Rendimiento del lote ${batchNumber}/${totalBatches}:`);
      console.log(`   📊 Velocidad del lote: ${batchRate.toFixed(2)} docs/seg`);
      console.log(`   📈 Velocidad promedio: ${overallRate.toFixed(2)} docs/seg`);
      console.log(`   🔢 Chunks promedio por doc: ${avgChunksPerDoc.toFixed(1)}`);
      console.log(`   ⏱️ Tiempo estimado restante: ${Math.round(estimatedTimeRemaining)}s`);
      console.log(`   💾 Total procesado: ${totalProcessed} documentos (${totalChunks} chunks)`);
      
      if (totalEmbeddingTime > 0) {
        const avgEmbeddingTime = totalEmbeddingTime / totalProcessed;
        console.log(`   🧠 Tiempo promedio embeddings: ${avgEmbeddingTime.toFixed(0)}ms/doc`);
      }

      lastBatchTime = now;
    },

    getFinalStats: (totalProcessed, totalErrors, totalDuplicates) => {
      const totalTime = Date.now() - startTime;
      const overallRate = totalProcessed / (totalTime / 1000);
      const chunksRate = totalChunks / (totalTime / 1000);

      return {
        totalTime: Math.round(totalTime / 1000),
        overallRate: overallRate.toFixed(2),
        chunksRate: chunksRate.toFixed(2),
        totalProcessed,
        totalChunks,
        totalErrors,
        totalDuplicates,
        avgEmbeddingTime: totalProcessed > 0 ? (totalEmbeddingTime / totalProcessed).toFixed(0) : 0
      };
    }
  };
}

/**
 * Procesar documentos SIN CACHE
 */
async function processDocuments(archivos, sentenciasDir, performanceMonitor) {
  const results = {
    success: [],
    errors: [],
    totalChunks: 0,
    totalEmbeddingTime: 0
  };

  console.log(`\n🚀 Procesando ${archivos.length} archivos SIN CACHÉ...`);

  // Procesar en paralelo limitado
  const maxConcurrent = Math.min(PARALLELIZATION_CONFIG.MAX_CONCURRENT_DOCS, archivos.length);
  const workers = [];
  
  for (let i = 0; i < maxConcurrent; i++) {
    workers.push(processWorker(archivos, sentenciasDir, results, i));
  }

  await Promise.all(workers);
  
  return results;
}

/**
 * Worker para procesar documentos
 */
async function processWorker(archivos, sentenciasDir, results, workerId) {
  while (archivos.length > 0) {
    const archivo = archivos.shift();
    if (!archivo) break;

    const rutaOrigen = path.join(sentenciasDir, archivo);
    const docStartTime = Date.now();

    try {
      const contenido = fs.readFileSync(rutaOrigen, 'utf8');
      const jsonData = JSON.parse(contenido);

      // Verificar texto
      if (!jsonData.texto_sentencia || jsonData.texto_sentencia.trim() === '') {
        console.log(`⚠️ ${archivo}: Sin texto, saltando`);
        continue;
      }

      console.log(`🔄 Worker ${workerId}: Procesando ${archivo} (ID: ${jsonData.id})`);

      // Crear metadata
      const metadata = createMetadataByType(jsonData, BASE_NAME);

      // Vectorizar
      const embeddingStartTime = Date.now();
      
      const indexResult = await IndexarQdrant.create(
        jsonData.texto_sentencia, 
        QDRANT_COLLECTION, 
        metadata,
        {
          embeddingBatchSize: PARALLELIZATION_CONFIG.EMBEDDING_BATCH_SIZE,
          embeddingUrl: PARALLELIZATION_CONFIG.EMBEDDING_API_URL,
          qdrantUrl: config.QDRANT.URL,
          vectorDimension: PARALLELIZATION_CONFIG.TARGET_DIMENSION,
          upsertBatchSize: PARALLELIZATION_CONFIG.QDRANT_BATCH_SIZE,
          maxConcurrentUpserts: PARALLELIZATION_CONFIG.MAX_CONCURRENT_QDRANT_UPSERTS
        }
      );

      const docEndTime = Date.now();
      const embeddingTime = docEndTime - embeddingStartTime;

      results.success.push({ archivo, rutaOrigen });
      results.totalChunks += (indexResult?.chunksProcessed || 0);
      results.totalEmbeddingTime += embeddingTime;

      console.log(`✅ ${archivo}: ${indexResult?.chunksProcessed || 0} chunks en ${embeddingTime}ms`);

    } catch (error) {
      console.error(`❌ Error procesando ${archivo}:`, error.message);
      results.errors.push({ archivo, error: error.message });
    }
  }
}

/**
 * Función principal SIN CACHE
 */
async function indexarQdrantSinCache(sentenciasDir, vectorizedDir) {
  try {
    // Verificar carpeta
    if (!fs.existsSync(sentenciasDir)) {
      console.log('❌ La carpeta de sentencias no existe', sentenciasDir);
      return;
    }

    // Crear carpeta vectorized
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

    console.log(`\n🚀 INICIANDO INDEXACIÓN QDRANT SIN CACHÉ`);
    console.log(`📂 Total archivos: ${archivos.length}`);
    console.log(`📦 Colección: ${QDRANT_COLLECTION}`);
    console.log(`\n⚡ Configuración de paralelización:`);
    console.log(`   - Documentos concurrentes: ${PARALLELIZATION_CONFIG.MAX_CONCURRENT_DOCS}`);
    console.log(`   - Embeddings paralelos: ${PARALLELIZATION_CONFIG.MAX_CONCURRENT_EMBEDDINGS}`);
    console.log(`   - Batch size: ${PARALLELIZATION_CONFIG.EMBEDDING_BATCH_SIZE}`);

    // Configurar Qdrant
    console.log('\n🔍 Configurando Qdrant...');
    const qdrantUrl = config.QDRANT.URL;
    console.log(`📍 URL Qdrant: ${qdrantUrl}`);

    // Monitor de rendimiento
    const performanceMonitor = createPerformanceMonitor();

    // Procesar documentos
    const results = await processDocuments([...archivos], sentenciasDir, performanceMonitor);

    // Mover archivos procesados
    console.log(`\n📁 Moviendo archivos procesados...`);
    let movedCount = 0;
    
    for (const { archivo } of results.success) {
      const rutaOrigen = path.join(sentenciasDir, archivo);
      const rutaDestino = path.join(vectorizedDir, archivo);
      
      try {
        if (fs.existsSync(rutaOrigen)) {
          fs.renameSync(rutaOrigen, rutaDestino);
          movedCount++;
        }
      } catch (error) {
        console.error(`Error moviendo ${archivo}:`, error.message);
      }
    }

    // Resumen final
    const finalStats = performanceMonitor.getFinalStats(results.success.length, results.errors.length, 0);

    console.log(`\n🎉 INDEXACIÓN QDRANT SIN CACHÉ COMPLETADA:`);
    console.log(`   ✅ Procesados: ${results.success.length}`);
    console.log(`   ❌ Errores: ${results.errors.length}`);
    console.log(`   📦 Movidos: ${movedCount}`);
    console.log(`\n⚡ Rendimiento:`);
    console.log(`   ⏱️ Tiempo total: ${finalStats.totalTime}s`);
    console.log(`   📈 Velocidad: ${finalStats.overallRate} docs/seg`);
    console.log(`   🔢 Chunks: ${finalStats.chunksRate} chunks/seg`);
    console.log(`   💾 Throughput: ${(results.success.length / finalStats.totalTime * 60).toFixed(0)} docs/min`);

  } catch (error) {
    console.error('\n🛑 ERROR CRÍTICO EN QDRANT:', error);
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

indexarQdrantSinCache(SENTENCIAS_DIR, VECTORIZED_DIR);

// Handlers
process.on('SIGINT', () => {
  console.log('\n⚠️ Proceso interrumpido');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('\n🛑 ERROR NO CAPTURADO:', error);
  process.exit(1);
});
