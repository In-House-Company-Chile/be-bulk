require('dotenv').config();
const axios = require('axios');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

// Configuración del test
const TEST_CONFIG = {
  EMBEDDING_URL: process.env.EMBEDDING_API_URL || 'http://localhost:11441/embed',
  QDRANT_URL: process.env.QDRANT_URL || 'http://localhost:6333',
  COLLECTION_NAME: 'performance_test',
  TEST_TEXTS: [
    'Esta es una sentencia judicial de prueba para medir el rendimiento del sistema de embeddings.',
    'El tribunal ha decidido que la demanda presentada por el actor debe ser acogida en todas sus partes.',
    'La defensa alega que no se han cumplido los requisitos procesales necesarios para la admisibilidad.',
    'En consecuencia, se condena al demandado al pago de la suma de dinero solicitada más intereses.',
    'El recurso de apelación interpuesto debe ser rechazado por improcedente según la jurisprudencia.',
    'La prueba testimonial rendida en el proceso no logra desvirtuar la presunción legal establecida.',
    'Se declara que la excepción de prescripción opuesta por la parte demandada carece de fundamento.',
    'El contrato celebrado entre las partes debe ser declarado nulo por vicio del consentimiento.'
  ]
};

// Cliente HTTP optimizado
const httpClient = axios.create({
  timeout: 120000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    keepAliveMsecs: 500,
    maxSockets: 500,
    maxFreeSockets: 100
  })
});

/**
 * Test de rendimiento del servicio de embeddings
 */
async function testEmbeddingService() {
  console.log('\n🧠 === TEST DE RENDIMIENTO: SERVICIO DE EMBEDDINGS ===');
  
  const results = {
    singleRequests: [],
    batchRequests: [],
    concurrentRequests: []
  };

  // Test 1: Requests individuales
  console.log('\n📊 Test 1: Requests individuales...');
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    try {
      const response = await httpClient.post(TEST_CONFIG.EMBEDDING_URL, {
        inputs: TEST_CONFIG.TEST_TEXTS[i % TEST_CONFIG.TEST_TEXTS.length]
      });
      const end = performance.now();
      const duration = end - start;
      results.singleRequests.push(duration);
      
      const dimensions = Array.isArray(response.data) ? response.data.length : 'unknown';
      console.log(`  ✅ Request ${i + 1}: ${duration.toFixed(2)}ms (${dimensions} dims)`);
    } catch (error) {
      console.error(`  ❌ Request ${i + 1}: ${error.message}`);
    }
  }

  // Test 2: Batch requests
  console.log('\n📦 Test 2: Batch requests...');
  const batchSizes = [2, 4, 8, 16, 32, 64, 128];
  
  for (const batchSize of batchSizes) {
    const texts = Array(batchSize).fill().map((_, i) => 
      TEST_CONFIG.TEST_TEXTS[i % TEST_CONFIG.TEST_TEXTS.length]
    );
    
    const start = performance.now();
    try {
      const response = await httpClient.post(TEST_CONFIG.EMBEDDING_URL, {
        inputs: texts
      });
      const end = performance.now();
      const duration = end - start;
      const throughput = batchSize / (duration / 1000);
      
      results.batchRequests.push({ batchSize, duration, throughput });
      console.log(`  ✅ Batch ${batchSize}: ${duration.toFixed(2)}ms (${throughput.toFixed(2)} texts/sec)`);
    } catch (error) {
      console.error(`  ❌ Batch ${batchSize}: ${error.message}`);
    }
  }

  // Test 3: Requests concurrentes
  console.log('\n🚀 Test 3: Requests concurrentes...');
  const concurrencyLevels = [5, 10, 20, 50, 100];
  
  for (const concurrency of concurrencyLevels) {
    console.log(`\n  📡 Probando ${concurrency} requests concurrentes...`);
    const start = performance.now();
    
    const promises = Array(concurrency).fill().map((_, i) =>
      httpClient.post(TEST_CONFIG.EMBEDDING_URL, {
        inputs: TEST_CONFIG.TEST_TEXTS[i % TEST_CONFIG.TEST_TEXTS.length]
      }).catch(error => ({ error: error.message }))
    );
    
    const responses = await Promise.all(promises);
    const end = performance.now();
    const duration = end - start;
    const successful = responses.filter(r => !r.error).length;
    const throughput = successful / (duration / 1000);
    
    results.concurrentRequests.push({ concurrency, duration, successful, throughput });
    console.log(`    ✅ ${successful}/${concurrency} exitosos en ${duration.toFixed(2)}ms (${throughput.toFixed(2)} req/sec)`);
  }

  return results;
}

/**
 * Test de rendimiento de Qdrant
 */
async function testQdrantService() {
  console.log('\n📦 === TEST DE RENDIMIENTO: QDRANT ===');
  
  const results = {
    collectionOps: [],
    upsertOps: [],
    searchOps: []
  };

  // Crear colección de test
  console.log('\n🔧 Preparando colección de test...');
  try {
    await httpClient.delete(`${TEST_CONFIG.QDRANT_URL}/collections/${TEST_CONFIG.COLLECTION_NAME}`);
  } catch (error) {
    // Colección no existe, está bien
  }

  const start = performance.now();
  await httpClient.put(`${TEST_CONFIG.QDRANT_URL}/collections/${TEST_CONFIG.COLLECTION_NAME}`, {
    vectors: {
      size: 1024,
      distance: "Cosine"
    }
  });
  const end = performance.now();
  console.log(`  ✅ Colección creada en ${(end - start).toFixed(2)}ms`);

  // Test 1: Upsert performance
  console.log('\n📤 Test 1: Rendimiento de Upsert...');
  const batchSizes = [10, 50, 100, 200, 500];
  
  for (const batchSize of batchSizes) {
    // Generar vectores falsos para el test
    const points = Array(batchSize).fill().map((_, i) => ({
      id: `test_${Date.now()}_${i}`,
      vector: Array(1024).fill().map(() => Math.random() - 0.5),
      payload: {
        text: `Test document ${i}`,
        batch_size: batchSize,
        timestamp: new Date().toISOString()
      }
    }));

    const start = performance.now();
    try {
      await httpClient.put(`${TEST_CONFIG.QDRANT_URL}/collections/${TEST_CONFIG.COLLECTION_NAME}/points`, {
        points
      });
      const end = performance.now();
      const duration = end - start;
      const throughput = batchSize / (duration / 1000);
      
      results.upsertOps.push({ batchSize, duration, throughput });
      console.log(`  ✅ Upsert ${batchSize}: ${duration.toFixed(2)}ms (${throughput.toFixed(2)} vectors/sec)`);
    } catch (error) {
      console.error(`  ❌ Upsert ${batchSize}: ${error.message}`);
    }
  }

  // Test 2: Search performance
  console.log('\n🔍 Test 2: Rendimiento de Búsqueda...');
  const queryVector = Array(1024).fill().map(() => Math.random() - 0.5);
  
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    try {
      const response = await httpClient.post(`${TEST_CONFIG.QDRANT_URL}/collections/${TEST_CONFIG.COLLECTION_NAME}/points/search`, {
        vector: queryVector,
        limit: 10,
        with_payload: true
      });
      const end = performance.now();
      const duration = end - start;
      const resultsCount = response.data.result.length;
      
      results.searchOps.push({ duration, resultsCount });
      console.log(`  ✅ Search ${i + 1}: ${duration.toFixed(2)}ms (${resultsCount} resultados)`);
    } catch (error) {
      console.error(`  ❌ Search ${i + 1}: ${error.message}`);
    }
  }

  return results;
}

/**
 * Test del pipeline completo (embeddings + qdrant)
 */
async function testCompletePipeline() {
  console.log('\n🔄 === TEST DE PIPELINE COMPLETO ===');
  
  const results = [];
  const testDocuments = [
    'Esta es una sentencia completa de prueba número 1 que contiene suficiente texto para ser dividida en chunks y procesada completamente por el sistema de vectorización.',
    'Segunda sentencia judicial de prueba que incluye consideraciones legales, hechos probados y fundamentos de derecho que permiten evaluar el rendimiento del sistema.',
    'Tercera sentencia que aborda temas de responsabilidad civil, daños y perjuicios, con análisis jurisprudencial y doctrinario extenso para testing.',
    'Cuarta resolución judicial que trata aspectos procesales, admisibilidad de recursos y competencia territorial en materia civil y comercial.',
    'Quinta sentencia con análisis de prueba, valoración testimonial y documental, aplicación de presunciones legales y carga de la prueba.'
  ];

  console.log(`\n🚀 Procesando ${testDocuments.length} documentos de prueba...`);
  
  for (let i = 0; i < testDocuments.length; i++) {
    const doc = testDocuments[i];
    const docStart = performance.now();
    
    try {
      // Paso 1: Generar chunks (simulado)
      const chunkSize = 200;
      const chunks = [];
      for (let j = 0; j < doc.length; j += chunkSize) {
        chunks.push(doc.substring(j, j + chunkSize));
      }
      
      console.log(`  📄 Doc ${i + 1}: ${chunks.length} chunks generados`);
      
      // Paso 2: Obtener embeddings
      const embStart = performance.now();
      const embResponse = await httpClient.post(TEST_CONFIG.EMBEDDING_URL, {
        inputs: chunks
      });
      const embEnd = performance.now();
      const embeddingTime = embEnd - embStart;
      
      const embeddings = Array.isArray(embResponse.data[0]) ? embResponse.data : [embResponse.data];
      console.log(`    🧠 Embeddings: ${embeddingTime.toFixed(2)}ms (${embeddings.length} vectores)`);
      
      // Paso 3: Preparar puntos para Qdrant
      const points = chunks.map((chunk, idx) => ({
        id: `pipeline_test_${Date.now()}_${i}_${idx}`,
        vector: embeddings[idx] || embeddings[0],
        payload: {
          doc_id: `test_doc_${i}`,
          text: chunk,
          chunk_index: idx,
          total_chunks: chunks.length
        }
      }));
      
      // Paso 4: Upsert a Qdrant
      const qdrantStart = performance.now();
      await httpClient.put(`${TEST_CONFIG.QDRANT_URL}/collections/${TEST_CONFIG.COLLECTION_NAME}/points`, {
        points
      });
      const qdrantEnd = performance.now();
      const qdrantTime = qdrantEnd - qdrantStart;
      
      const docEnd = performance.now();
      const totalTime = docEnd - docStart;
      
      const result = {
        docIndex: i + 1,
        chunks: chunks.length,
        embeddingTime,
        qdrantTime,
        totalTime,
        throughput: chunks.length / (totalTime / 1000)
      };
      
      results.push(result);
      console.log(`    📤 Qdrant: ${qdrantTime.toFixed(2)}ms`);
      console.log(`    ✅ Total: ${totalTime.toFixed(2)}ms (${result.throughput.toFixed(2)} chunks/sec)`);
      
    } catch (error) {
      console.error(`    ❌ Doc ${i + 1} falló: ${error.message}`);
    }
  }

  return results;
}

/**
 * Generar reporte de rendimiento
 */
function generateReport(embeddingResults, qdrantResults, pipelineResults) {
  console.log('\n📊 === REPORTE DE RENDIMIENTO ===');
  
  // Embeddings
  if (embeddingResults.singleRequests.length > 0) {
    const avgSingle = embeddingResults.singleRequests.reduce((a, b) => a + b, 0) / embeddingResults.singleRequests.length;
    console.log(`\n🧠 Embeddings Individuales:`);
    console.log(`   Promedio: ${avgSingle.toFixed(2)}ms`);
    console.log(`   Throughput: ${(1000 / avgSingle).toFixed(2)} req/sec`);
  }
  
  if (embeddingResults.batchRequests.length > 0) {
    const bestBatch = embeddingResults.batchRequests.reduce((best, current) => 
      current.throughput > best.throughput ? current : best
    );
    console.log(`\n📦 Embeddings Batch (Mejor):`);
    console.log(`   Tamaño: ${bestBatch.batchSize} textos`);
    console.log(`   Tiempo: ${bestBatch.duration.toFixed(2)}ms`);
    console.log(`   Throughput: ${bestBatch.throughput.toFixed(2)} texts/sec`);
  }
  
  if (embeddingResults.concurrentRequests.length > 0) {
    const bestConcurrent = embeddingResults.concurrentRequests.reduce((best, current) => 
      current.throughput > best.throughput ? current : best
    );
    console.log(`\n🚀 Embeddings Concurrentes (Mejor):`);
    console.log(`   Concurrencia: ${bestConcurrent.concurrency}`);
    console.log(`   Exitosos: ${bestConcurrent.successful}/${bestConcurrent.concurrency}`);
    console.log(`   Throughput: ${bestConcurrent.throughput.toFixed(2)} req/sec`);
  }

  // Qdrant
  if (qdrantResults.upsertOps.length > 0) {
    const bestUpsert = qdrantResults.upsertOps.reduce((best, current) => 
      current.throughput > best.throughput ? current : best
    );
    console.log(`\n📤 Qdrant Upsert (Mejor):`);
    console.log(`   Batch size: ${bestUpsert.batchSize} vectores`);
    console.log(`   Tiempo: ${bestUpsert.duration.toFixed(2)}ms`);
    console.log(`   Throughput: ${bestUpsert.throughput.toFixed(2)} vectors/sec`);
  }
  
  if (qdrantResults.searchOps.length > 0) {
    const avgSearch = qdrantResults.searchOps.reduce((a, b) => a + b.duration, 0) / qdrantResults.searchOps.length;
    console.log(`\n🔍 Qdrant Search:`);
    console.log(`   Promedio: ${avgSearch.toFixed(2)}ms`);
    console.log(`   Throughput: ${(1000 / avgSearch).toFixed(2)} searches/sec`);
  }

  // Pipeline completo
  if (pipelineResults.length > 0) {
    const avgPipeline = pipelineResults.reduce((a, b) => a + b.totalTime, 0) / pipelineResults.length;
    const avgThroughput = pipelineResults.reduce((a, b) => a + b.throughput, 0) / pipelineResults.length;
    const totalChunks = pipelineResults.reduce((a, b) => a + b.chunks, 0);
    
    console.log(`\n🔄 Pipeline Completo:`);
    console.log(`   Documentos: ${pipelineResults.length}`);
    console.log(`   Total chunks: ${totalChunks}`);
    console.log(`   Tiempo promedio/doc: ${avgPipeline.toFixed(2)}ms`);
    console.log(`   Throughput promedio: ${avgThroughput.toFixed(2)} chunks/sec`);
    console.log(`   Proyección: ${(avgThroughput * 60).toFixed(0)} chunks/min`);
  }

  // Recomendaciones
  console.log(`\n💡 === RECOMENDACIONES ===`);
  
  if (embeddingResults.batchRequests.length > 0) {
    const bestBatch = embeddingResults.batchRequests.reduce((best, current) => 
      current.throughput > best.throughput ? current : best
    );
    console.log(`✅ Usar batch size de ${bestBatch.batchSize} para embeddings`);
  }
  
  if (qdrantResults.upsertOps.length > 0) {
    const bestUpsert = qdrantResults.upsertOps.reduce((best, current) => 
      current.throughput > best.throughput ? current : best
    );
    console.log(`✅ Usar batch size de ${bestUpsert.batchSize} para Qdrant upserts`);
  }
  
  if (embeddingResults.concurrentRequests.length > 0) {
    const bestConcurrent = embeddingResults.concurrentRequests.reduce((best, current) => 
      current.throughput > best.throughput ? current : best
    );
    console.log(`✅ Usar concurrencia de ${bestConcurrent.concurrency} para máximo throughput`);
  }
}

/**
 * Función principal
 */
async function runPerformanceTest() {
  console.log('🚀 === INICIANDO TEST DE RENDIMIENTO ===');
  console.log(`📡 Embedding URL: ${TEST_CONFIG.EMBEDDING_URL}`);
  console.log(`📦 Qdrant URL: ${TEST_CONFIG.QDRANT_URL}`);
  
  try {
    // Test de embeddings
    const embeddingResults = await testEmbeddingService();
    
    // Test de Qdrant
    const qdrantResults = await testQdrantService();
    
    // Test de pipeline completo
    const pipelineResults = await testCompletePipeline();
    
    // Generar reporte
    generateReport(embeddingResults, qdrantResults, pipelineResults);
    
    // Limpiar colección de test
    try {
      await httpClient.delete(`${TEST_CONFIG.QDRANT_URL}/collections/${TEST_CONFIG.COLLECTION_NAME}`);
      console.log('\n🧹 Colección de test eliminada');
    } catch (error) {
      console.log('⚠️ No se pudo eliminar la colección de test');
    }
    
  } catch (error) {
    console.error('\n❌ Error en test de rendimiento:', error);
  }
}

// Ejecutar si es llamado directamente
if (require.main === module) {
  runPerformanceTest();
}

module.exports = {
  runPerformanceTest,
  testEmbeddingService,
  testQdrantService,
  testCompletePipeline
};
