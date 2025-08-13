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

// OPTIMIZACIÓN ULTRA AGRESIVA: Agentes HTTP para RTX 3060
const httpAgent = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 500,  // Reducido para más velocidad
  maxSockets: 500,      // Aumentado agresivamente
  maxFreeSockets: 100,  // Más sockets libres
  timeout: 120000,      // Timeout más largo para batches grandes
});

const httpsAgent = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 500,
  maxSockets: 500,
  maxFreeSockets: 100,
  timeout: 120000,
});

// Configurar axios globalmente
axios.defaults.httpAgent = httpAgent;
axios.defaults.httpsAgent = httpsAgent;
axios.defaults.timeout = 30000;

const config = {
  QDRANT: {
    URL: process.env.QDRANT_URL || 'http://localhost:6333'
  }
};

// OPTIMIZACIÓN ULTRA AGRESIVA PARA RTX 3060 12GB VRAM + 32GB RAM
const PARALLELIZATION_CONFIG = {
  MAX_CONCURRENT_DOCS: 50,        // Aumentado agresivamente para 32GB RAM
  MAX_CONCURRENT_EMBEDDINGS: 100, // Aumentado para aprovechar 12GB VRAM
  EMBEDDING_BATCH_SIZE: 128,      // Batch mucho más grande para GPU
  EMBEDDING_API_URL: process.env.EMBEDDING_API_URL || 'http://localhost:11441/embed',
  TARGET_DIMENSION: 1024,
  QDRANT_BATCH_SIZE: 500,         // Batches más grandes para Qdrant
  MAX_CONCURRENT_QDRANT_UPSERTS: 20 // Más upserts paralelos
};

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

    case 'salud_corte_de_apelaciones':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_ape_s || '',
        caratulado: jsonData.caratulado_s || '',
        corte: jsonData.gls_corte_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        sala: jsonData.gls_sala_sup_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        tematicaDeSalud: jsonData.tematica_ss || [],
        era: jsonData.era_sup_i || 0,
        isapre: jsonData.isapre_ss || [],
      };

    case 'salud_corte_suprema':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        institucionesRecurridas: jsonData.organismo_ss || [],
        tematicaDeSalud: jsonData.tematica_ss || [],
        medicamento: jsonData.medicamento_ss || [],
        enfermedad: jsonData.enfermedad_ss || [],
        corte: jsonData.gls_corte_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        sala: jsonData.gls_sala_sup_s || '',
        era: jsonData.era_sup_i || 0,
        tipoRecurso: jsonData.gls_tip_recurso_sup_s || ''
      };

    case 'cobranza':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
      };

    case 'corte_suprema':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        sala: jsonData.gls_sala_sup_s || '',
        corte: jsonData.gls_corte_s || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.sent__categorizacion_s || '',
        resultado: jsonData.resultado_recurso_sup_s || '',
        redactor: jsonData.gls_relator_s || '',
        ministro: jsonData.gls_ministro_ss || [],
        tipoRecurso: jsonData.gls_tip_recurso_sup_s || '',
        descriptores: jsonData.gls_descriptor_ss || [],
        idNorm: jsonData.id_norma_ss || [],
        articulo: jsonData.norma_articulo_ss || [],
      };

    case 'laboral':
      return {
        ...baseMetadata,
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
        era: jsonData.era_sup_i || 0,
        categorizacion: jsonData.gls_materia_s || [],
        tribunal: jsonData.gls_juz_s || '',
        juez: jsonData.gls_juez_ss || '',
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

// OPTIMIZACIÓN ULTRA AGRESIVA PARA HARDWARE POTENTE
const OPTIMIZATION_CONFIGS = {
  HEAVY_LOAD: {
    BATCH_SIZE: 500,  // Aumentado agresivamente para 32GB RAM
    BATCH_PAUSE_MS: 10,     // Pausa mínima
    SOCKET_TIMEOUT: 120000, // Timeout más largo para batches grandes
    MAX_RETRIES: 3
  },
  MEDIUM_LOAD: {
    BATCH_SIZE: 300,
    BATCH_PAUSE_MS: 25,
    SOCKET_TIMEOUT: 90000,
    MAX_RETRIES: 3
  },
  LIGHT_LOAD: {
    BATCH_SIZE: 200,
    BATCH_PAUSE_MS: 50,
    SOCKET_TIMEOUT: 60000,
    MAX_RETRIES: 2
  }
};

function getOptimalConfig(totalFiles) {
  if (totalFiles > 10000) {
    console.log('🔥 Configuración HEAVY_LOAD detectada (>10k archivos) - RTX 3060 Mode');
    return OPTIMIZATION_CONFIGS.HEAVY_LOAD;
  } else if (totalFiles > 1000) {
    console.log('⚡ Configuración MEDIUM_LOAD detectada (1k-10k archivos) - RTX 3060 Mode');
    return OPTIMIZATION_CONFIGS.MEDIUM_LOAD;
  } else {
    console.log('💡 Configuración LIGHT_LOAD detectada (<1k archivos) - RTX 3060 Mode');
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
 * NUEVO: Pre-calentar el servicio de embeddings
 */
async function warmupEmbeddingService() {
  console.log('🔥 Calentando servicio de embeddings...');
  try {
    const testTexts = [
      'Este es un texto de prueba para calentar el servicio',
      'Segundo texto de prueba para verificar batch processing'
    ];
    
    const response = await axios.post(
      PARALLELIZATION_CONFIG.EMBEDDING_API_URL,
      { inputs: testTexts },
      { timeout: 30000 }
    );
    
    console.log('✅ Servicio de embeddings listo');
    return true;
  } catch (error) {
    console.error('❌ Error al calentar servicio:', error.message);
    return false;
  }
}

/**
 * OPTIMIZADO: Procesamiento de documentos con cola de trabajo
 */
async function processDocumentQueue(queue, cacheManager, vectorizedDir, BASE_NAME, performanceMonitor) {
  const results = {
    success: [],
    duplicates: [],
    errors: [],
    totalChunks: 0,
    totalEmbeddingTime: 0
  };

  // Procesar en paralelo máximo
  const workers = [];
  const maxWorkers = PARALLELIZATION_CONFIG.MAX_CONCURRENT_DOCS;
  
  for (let i = 0; i < maxWorkers; i++) {
    workers.push(processWorker(queue, cacheManager, results, BASE_NAME));
  }

  await Promise.all(workers);
  
  return results;
}

/**
 * Worker para procesar documentos de la cola
 */
async function processWorker(queue, cacheManager, results, BASE_NAME) {
  while (queue.length > 0) {
    const { archivo, rutaOrigen } = queue.shift();
    if (!archivo) continue;

    const docStartTime = Date.now();

    try {
      const contenido = fs.readFileSync(rutaOrigen, 'utf8');
      const jsonData = JSON.parse(contenido);

      // Verificar texto
      if (!jsonData.texto_sentencia || jsonData.texto_sentencia.trim() === '') {
        continue;
      }

      // Verificar duplicados usando caché
      const isDuplicate = await cacheManager.exists(jsonData.id);
      if (isDuplicate) {
        results.duplicates.push({ archivo, rutaOrigen });
        continue;
      }

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

      // Agregar ID al caché
      await cacheManager.add(jsonData.id);

      results.success.push({ archivo, rutaOrigen });
      results.totalChunks += (indexResult?.chunks || 0);
      results.totalEmbeddingTime += embeddingTime;

    } catch (error) {
      console.error(`❌ Error procesando ${archivo}:`, error.message);
      results.errors.push({ archivo, error: error.message });
    }
  }
}

/**
 * Función principal optimizada
 */
async function indexarQdrant(sentenciasDir, vectorizedDir) {
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

    console.log(`\n🚀 INICIANDO INDEXACIÓN QDRANT ULTRA OPTIMIZADA`);
    console.log(`📂 Total archivos: ${archivos.length}`);
    console.log(`\n⚡ Configuración de paralelización:`);
    console.log(`   - Documentos concurrentes: ${PARALLELIZATION_CONFIG.MAX_CONCURRENT_DOCS}`);
    console.log(`   - Embeddings paralelos: ${PARALLELIZATION_CONFIG.MAX_CONCURRENT_EMBEDDINGS}`);
    console.log(`   - Batch size: ${PARALLELIZATION_CONFIG.EMBEDDING_BATCH_SIZE}`);

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

    // Inicializar sistema de caché
    const cacheManager = new CacheManager({
      useRedis: true, // Cambiar a false para usar solo archivo
      redisHost: 'localhost',
      redisPort: 6379,
      // redisPassword: 'tu_password_si_tienes', // Opcional
      cacheFile: 'cache/existing_ids.json.gz',
    });

    // Sincronizar caché con Qdrant
    await cacheManager.syncWithQdrant(qdrantUrl, QDRANT_COLLECTION);
    
    const totalCachedIds = await cacheManager.size();
    console.log(`✅ ${totalCachedIds} IDs disponibles en caché`);









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

      // Pausa mínima entre lotes
      if (loteIndex < archivosEnLotes.length - 1) {
        await new Promise(resolve => setTimeout(resolve, optimalConfig.BATCH_PAUSE_MS));
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
    await cacheManager.close();

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