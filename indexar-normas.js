const fs = require('fs');
const path = require('path');
const IndexarQdrant = require('./functions/IndexarQdrant');
const CacheManager = require('./functions/CacheManager');

const axios = require('axios');
const http = require('http');
const https = require('https');

require('dotenv').config();
const BASE_NAME = process.env.BASE_NAME;
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'jurisprudencia';
const SENTENCIAS_DIR = process.env.SENTENCIAS_DIR;
const VECTORIZED_DIR = process.env.VECTORIZED_DIR;

// CONFIGURACIÓN CONSERVADORA: Agentes HTTP optimizados para estabilidad
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 2000,  // Más tiempo para mantener conexiones
  maxSockets: 50,        // Reducido para evitar saturación
  maxFreeSockets: 10,    // Menos sockets libres
  timeout: 300000,       // 5 minutos de timeout
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 2000,
  maxSockets: 50,
  maxFreeSockets: 10,
  timeout: 300000,
});

// Configurar axios globalmente con timeouts largos
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 120000; // 2 minutos

const config = {
  QDRANT: {
    URL: process.env.QDRANT_URL || 'http://localhost:6333'
  }
};

// CONFIGURACIÓN CONSERVADORA PARA ESTABILIDAD
const PARALLELIZATION_CONFIG = {
  MAX_CONCURRENT_DOCS: 5,         // Muy reducido para estabilidad
  MAX_CONCURRENT_EMBEDDINGS: 3,   // Pocas operaciones paralelas
  EMBEDDING_BATCH_SIZE: 20,       // Batches pequeños para evitar timeouts
  EMBEDDING_API_URL: process.env.EMBEDDING_API_URL || 'http://localhost:11441/embed',
  TARGET_DIMENSION: 1024,
  QDRANT_BATCH_SIZE: 50,          // Batches pequeños para Qdrant
  MAX_CONCURRENT_QDRANT_UPSERTS: 2 // Muy pocas operaciones concurrentes
};

/**
 * Crear metadata según el tipo de base
 */
function createMetadataByType(jsonData, tipoBase) {

  const {vigencias, eventos_pendientes, vinculaciones, ingresado_por, fecha_ingreso, fecha_version, tipo_tratado, ...resto} = jsonData.data.metadatos;

  switch (tipoBase.toLowerCase()) {

    case 'normas':
      return {
        idNorm: jsonData.idNorm,
        base: 'normas',
        ...resto
      };

    default:
      return {};
  }
}

// CONFIGURACIÓN CONSERVADORA PARA EVITAR TIMEOUTS
const OPTIMIZATION_CONFIGS = {
  HEAVY_LOAD: {
    BATCH_SIZE: 10,         // Muy pequeño para evitar saturación
    BATCH_PAUSE_MS: 2000,   // Pausa larga para dar respiro
    SOCKET_TIMEOUT: 300000, // 5 minutos de timeout
    MAX_RETRIES: 5
  },
  MEDIUM_LOAD: {
    BATCH_SIZE: 15,
    BATCH_PAUSE_MS: 1500,
    SOCKET_TIMEOUT: 240000, // 4 minutos
    MAX_RETRIES: 4
  },
  LIGHT_LOAD: {
    BATCH_SIZE: 20,
    BATCH_PAUSE_MS: 1000,
    SOCKET_TIMEOUT: 180000, // 3 minutos
    MAX_RETRIES: 3
  }
};

function getOptimalConfig(totalFiles) {
  if (totalFiles > 5000) {
    console.log('🐢 Configuración HEAVY_LOAD detectada (>5k archivos) - Modo Estable');
    return OPTIMIZATION_CONFIGS.HEAVY_LOAD;
  } else if (totalFiles > 500) {
    console.log('🐢 Configuración MEDIUM_LOAD detectada (500-5k archivos) - Modo Estable');
    return OPTIMIZATION_CONFIGS.MEDIUM_LOAD;
  } else {
    console.log('🐢 Configuración LIGHT_LOAD detectada (<500 archivos) - Modo Estable');
    return OPTIMIZATION_CONFIGS.LIGHT_LOAD;
  }
}

/**
 * Monitor de rendimiento mejorado
 */
function createPerformanceMonitor() {
  const startTime = Date.now();
  let lastBatchTime = startTime;
  let totalProcessed = 0;
  let totalChunks = 0;
  let totalEmbeddingTime = 0;
  let totalPineconeTime = 0;

  return {
    logBatchPerformance: (batchSize, batchNumber, totalBatches, extraMetrics = {}) => {
      const now = Date.now();
      const batchTime = now - lastBatchTime;
      const totalTime = now - startTime;

      totalProcessed += batchSize;
      if (extraMetrics.chunks) totalChunks += extraMetrics.chunks;
      if (extraMetrics.embeddingTime) totalEmbeddingTime += extraMetrics.embeddingTime;
      if (extraMetrics.pineconeTime) totalPineconeTime += extraMetrics.pineconeTime;

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
      
      if (totalPineconeTime > 0) {
        const avgPineconeTime = totalPineconeTime / totalProcessed;
        console.log(`   📦 Tiempo promedio Pinecone: ${avgPineconeTime.toFixed(0)}ms/doc`);
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
        avgEmbeddingTime: totalProcessed > 0 ? (totalEmbeddingTime / totalProcessed).toFixed(0) : 0,
        avgPineconeTime: totalProcessed > 0 ? (totalPineconeTime / totalProcessed).toFixed(0) : 0
      };
    }
  };
}

/**
 * Función para agregar delays entre operaciones
 */
async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Función de reintento con backoff exponencial
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 1000) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`⚠️ Intento ${attempt} falló, reintentando en ${delay}ms...`);
      await sleep(delay);
    }
  }
}

/**
 * Pre-calentar el servicio de embeddings con reintentos
 */
async function warmupEmbeddingService() {
  console.log('🔥 Calentando servicio de embeddings...');
  try {
    const testTexts = [
      'Este es un texto de prueba para calentar el servicio',
      'Segundo texto de prueba para verificar batch processing'
    ];
    
    const response = await retryWithBackoff(async () => {
      return await axios.post(
        PARALLELIZATION_CONFIG.EMBEDDING_API_URL,
        { inputs: testTexts },
        { timeout: 60000 } // Timeout más largo
      );
    }, 3, 2000);
    
    console.log('✅ Servicio de embeddings listo');
    await sleep(1000); // Pausa después del warmup
    return true;
  } catch (error) {
    console.error('❌ Error al calentar servicio:', error.message);
    return false;
  }
}

/**
 * PROCESAMIENTO ESTABLE: Documentos uno por uno con delays
 */
async function processDocumentQueue(queue, cacheManager, vectorizedDir, BASE_NAME, performanceMonitor) {
  const results = {
    success: [],
    duplicates: [],
    errors: [],
    totalChunks: 0,
    totalEmbeddingTime: 0
  };

  // Procesar documentos secuencialmente para evitar saturación
  for (let i = 0; i < queue.length; i++) {
    const { archivo, rutaOrigen } = queue[i];
    if (!archivo) continue;

    console.log(`📄 Procesando documento ${i + 1}/${queue.length}: ${archivo}`);

    try {
      await processDocumentWithRetry(archivo, rutaOrigen, results, BASE_NAME, cacheManager);
      
      // Pausa entre documentos para dar respiro al sistema
      if (i < queue.length - 1) {
        await sleep(500); // 500ms entre documentos
      }
    } catch (error) {
      console.error(`❌ Error procesando ${archivo}:`, error.message);
      results.errors.push({ archivo, error: error.message });
    }
  }
  
  return results;
}

/**
 * Procesar un documento individual con reintentos
 */
async function processDocumentWithRetry(archivo, rutaOrigen, results, BASE_NAME, cacheManager) {
  const docStartTime = Date.now();

  return await retryWithBackoff(async () => {
    const contenido = fs.readFileSync(rutaOrigen, 'utf8');
    const jsonData = JSON.parse(contenido);

    // Verificar texto
    if (!jsonData.planeText || jsonData.planeText.trim() === '') {
      console.log(`⚠️ Documento ${archivo} sin texto, saltando...`);
      return;
    }

    // Crear metadata
    const metadata = createMetadataByType(jsonData, BASE_NAME);

    // Vectorizar con configuración conservadora
    const embeddingStartTime = Date.now();
    
    console.log(`🔄 Indexando documento: ${archivo}`);
    
    const indexResult = await IndexarQdrant.create(
      jsonData.planeText, 
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
    results.totalChunks += (indexResult?.chunks || indexResult?.chunksProcessed || 0);
    results.totalEmbeddingTime += embeddingTime;

    console.log(`✅ Documento ${archivo} procesado exitosamente en ${embeddingTime}ms`);
    
    // Pausa pequeña después de procesar cada documento
    await sleep(200);
    
  }, 3, 2000); // 3 reintentos con backoff exponencial
}

/**
 * Función principal optimizada
 */
async function indexarQdrant(sentenciasDir, vectorizedDir) {
  try {
    // Verificar carpeta
    if (!fs.existsSync(sentenciasDir)) {
      console.log('❌ La carpeta de normas no existe', sentenciasDir);
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

    console.log(`\n🐢 INICIANDO INDEXACIÓN QDRANT MODO ESTABLE`);
    console.log(`📂 Total archivos: ${archivos.length}`);
    console.log(`\n🔧 Configuración conservadora:`);
    console.log(`   - Documentos concurrentes: ${PARALLELIZATION_CONFIG.MAX_CONCURRENT_DOCS}`);
    console.log(`   - Embeddings paralelos: ${PARALLELIZATION_CONFIG.MAX_CONCURRENT_EMBEDDINGS}`);
    console.log(`   - Batch size: ${PARALLELIZATION_CONFIG.EMBEDDING_BATCH_SIZE}`);
    console.log(`   - Modo: SECUENCIAL con delays y reintentos`);

    // Calentar servicio
    await warmupEmbeddingService();

    // Configurar lotes
    const optimalConfig = getOptimalConfig(archivos.length);
    const BATCH_SIZE = optimalConfig.BATCH_SIZE;
    
    // Configurar Qdrant
    console.log('🔍 Configurando Qdrant...');
    const qdrantUrl = config.QDRANT.URL;
    console.log(`📍 URL Qdrant: ${qdrantUrl}`);
    console.log(`📦 Colección: ${QDRANT_COLLECTION}`);

    // Inicializar sistema de caché (sin Redis)
/*     const cacheManager = new CacheManager({
      useRedis: false, // Usar solo archivo, sin verificación de Redis
      cacheFile: 'cache/existing_ids.json.gz',
    }); */
        // Inicializar sistema de caché
    const cacheManager = new CacheManager({
      useRedis: false, // Cambiar a false para usar solo archivo
      redisHost: 'localhost',
      redisPort: 6379,
      // redisPassword: 'tu_password_si_tienes', // Opcional
      // cacheFile: 'cache/existing_ids.json.gz',
    });

    // Sincronizar caché con Qdrant
    // await cacheManager.syncWithQdrant(qdrantUrl, QDRANT_COLLECTION);
    
    // const totalCachedIds = await cacheManager.size();
    // console.log(`✅ ${totalCachedIds} IDs disponibles en caché`);









    // Monitor de rendimiento
    const performanceMonitor = createPerformanceMonitor();

    let processedCount = 0;
    let errorCount = 0;
    let duplicateCount = 0;

    // Procesar en lotes
    const archivosEnLotes = [];
    for (let i = 0; i < archivos.length; i += BATCH_SIZE) {
      archivosEnLotes.push(archivos.slice(i, i + BATCH_SIZE));
    }

    console.log(`\n🔄 Procesando en ${archivosEnLotes.length} lotes de ${BATCH_SIZE} archivos`);

    // Procesar lotes
    for (let loteIndex = 0; loteIndex < archivosEnLotes.length; loteIndex++) {
      const loteArchivos = archivosEnLotes[loteIndex];
      console.log(`\n📦 Lote ${loteIndex + 1}/${archivosEnLotes.length}`);

      // Crear cola de trabajo
      const queue = loteArchivos.map(archivo => ({
        archivo,
        rutaOrigen: path.join(sentenciasDir, archivo)
      }));

      // Procesar cola
      const results = await processDocumentQueue(
        queue, 
        cacheManager, 
        vectorizedDir, 
        BASE_NAME,
        performanceMonitor
      );

      processedCount += results.success.length;
      duplicateCount += results.duplicates.length;
      errorCount += results.errors.length;

      // Métricas
      performanceMonitor.logBatchPerformance(
        results.success.length,
        loteIndex + 1,
        archivosEnLotes.length,
        {
          chunks: results.totalChunks,
          embeddingTime: results.totalEmbeddingTime
        }
      );

      // Pausa entre lotes para dar respiro al sistema
      if (loteIndex < archivosEnLotes.length - 1) {
        console.log(`⏸️ Pausa de ${optimalConfig.BATCH_PAUSE_MS}ms entre lotes...`);
        await sleep(optimalConfig.BATCH_PAUSE_MS);
      }
    }

    // Mover archivos procesados
    console.log(`\n📁 Moviendo archivos procesados...`);
    let movedCount = 0;
    
    for (const archivo of archivos) {
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
    const finalStats = performanceMonitor.getFinalStats(processedCount, errorCount, duplicateCount);

    console.log(`\n🎉 INDEXACIÓN EN QDRANT COMPLETADA:`);
    console.log(`   ✅ Procesados: ${processedCount}`);
    console.log(`   ⚠️ Duplicados: ${duplicateCount}`);
    console.log(`   ❌ Errores: ${errorCount}`);
    console.log(`   📦 Movidos: ${movedCount}`);
    console.log(`\n⚡ Rendimiento:`);
    console.log(`   ⏱️ Tiempo total: ${finalStats.totalTime}s`);
    console.log(`   📈 Velocidad: ${finalStats.overallRate} docs/seg`);
    console.log(`   🔢 Chunks: ${finalStats.chunksRate} chunks/seg`);
    console.log(`   💾 Throughput: ${(processedCount / finalStats.totalTime * 60).toFixed(0)} docs/min`);

    // Cerrar caché
    // await cacheManager.close();

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

indexarQdrant(SENTENCIAS_DIR, VECTORIZED_DIR);

// Handlers
process.on('SIGINT', () => {
  console.log('\n⚠️ Proceso interrumpido');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  console.error('\n🛑 ERROR NO CAPTURADO:', error);
  process.exit(1);
});