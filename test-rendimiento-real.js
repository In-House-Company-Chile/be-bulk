require('dotenv').config();
const axios = require('axios');
const { performance } = require('perf_hooks');

// Configuración confirmada que funciona
const EMBEDDING_URL = 'http://localhost:11441/embed';
const QDRANT_URL = 'http://localhost:6333';
const INFO_URL = 'http://localhost:11441/info';

// Cliente HTTP optimizado
const httpClient = axios.create({
  timeout: 30000,
  maxContentLength: Infinity,
  maxBodyLength: Infinity,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    keepAliveMsecs: 500,
    maxSockets: 100,
    maxFreeSockets: 20
  })
});

/**
 * Test de rendimiento real con tu configuración
 */
async function testRendimientoReal() {
  console.log('🚀 === TEST DE RENDIMIENTO REAL RTX 3060 ===\n');

  // 1. Verificar info del servicio
  console.log('📊 1. INFORMACIÓN DEL SERVICIO:');
  try {
    const info = await httpClient.get(INFO_URL);
    const data = info.data;
    console.log(`   🤖 Modelo: ${data.model_name}`);
    console.log(`   🎯 Dimensiones: ${data.embedding_dimension}`);
    console.log(`   🔥 GPU: ${data.gpu_name}`);
    console.log(`   💾 VRAM Usada: ${data.gpu_memory_allocated}`);
    console.log(`   📦 Batch Size Máximo: ${data.batch_size}`);
    console.log(`   ⚡ Precisión: ${data.precision}`);
  } catch (error) {
    console.log(`   ❌ Error obteniendo info: ${error.message}`);
  }

  // 2. Test de embedding individual
  console.log('\n🧠 2. TEST EMBEDDING INDIVIDUAL:');
  const testText = 'Esta es una sentencia judicial de prueba para medir el rendimiento del sistema de embeddings en la RTX 3060.';
  
  try {
    const start = performance.now();
    const response = await httpClient.post(EMBEDDING_URL, { inputs: testText });
    const end = performance.now();
    const duration = end - start;
    
    const embedding = response.data;
    console.log(`   ✅ Tiempo: ${duration.toFixed(2)}ms`);
    console.log(`   📊 Dimensiones: ${embedding.length}`);
    console.log(`   ⚡ Throughput: ${(1000/duration).toFixed(2)} req/sec`);
    
    if (duration < 50) {
      console.log('   🔥 EXCELENTE: <50ms es óptimo');
    } else if (duration < 100) {
      console.log('   ✅ BUENO: <100ms es aceptable');
    } else {
      console.log('   ⚠️ MEJORABLE: Debería ser <100ms');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 3. Test de batches progresivos
  console.log('\n📦 3. TEST DE BATCHES PROGRESIVOS:');
  const batchSizes = [2, 4, 8, 16, 32, 64, 128];
  let bestBatchSize = 0;
  let bestThroughput = 0;
  
  for (const batchSize of batchSizes) {
    try {
      const texts = Array(batchSize).fill(testText);
      
      const start = performance.now();
      const response = await httpClient.post(EMBEDDING_URL, { inputs: texts });
      const end = performance.now();
      const duration = end - start;
      const throughput = batchSize / (duration / 1000);
      
      console.log(`   📦 Batch ${batchSize.toString().padStart(3)}: ${duration.toFixed(2).padStart(7)}ms → ${throughput.toFixed(1).padStart(6)} texts/sec`);
      
      if (throughput > bestThroughput) {
        bestThroughput = throughput;
        bestBatchSize = batchSize;
      }
      
      // Pausa pequeña para no saturar
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.log(`   ❌ Batch ${batchSize}: ${error.message}`);
    }
  }
  
  console.log(`\n   🏆 MEJOR CONFIGURACIÓN: Batch ${bestBatchSize} → ${bestThroughput.toFixed(1)} texts/sec`);

  // 4. Test de concurrencia
  console.log('\n🔥 4. TEST DE CONCURRENCIA:');
  const concurrencyLevels = [2, 5, 10, 20, 30];
  
  for (const concurrency of concurrencyLevels) {
    try {
      console.log(`\n   🚀 Probando ${concurrency} requests concurrentes...`);
      
      const start = performance.now();
      const promises = Array(concurrency).fill().map((_, i) =>
        httpClient.post(EMBEDDING_URL, { 
          inputs: `${testText} - Request ${i}` 
        }).catch(error => ({ error: error.message }))
      );
      
      const responses = await Promise.all(promises);
      const end = performance.now();
      const duration = end - start;
      const successful = responses.filter(r => !r.error).length;
      const failed = responses.length - successful;
      const throughput = successful / (duration / 1000);
      
      console.log(`     ✅ Exitosos: ${successful}/${concurrency}`);
      if (failed > 0) {
        console.log(`     ❌ Fallidos: ${failed}`);
      }
      console.log(`     ⏱️ Tiempo: ${duration.toFixed(2)}ms`);
      console.log(`     ⚡ Throughput: ${throughput.toFixed(2)} req/sec`);
      
      if (throughput > 50) {
        console.log(`     🔥 EXCELENTE concurrencia`);
      } else if (throughput > 20) {
        console.log(`     ✅ BUENA concurrencia`);
      } else {
        console.log(`     ⚠️ BAJA concurrencia - posible cuello de botella`);
      }
      
    } catch (error) {
      console.log(`     ❌ Error en concurrencia ${concurrency}: ${error.message}`);
    }
  }

  // 5. Test de Qdrant
  console.log('\n📤 5. TEST DE QDRANT:');
  
  try {
    // Test de upsert
    const vectors = Array(100).fill().map((_, i) => ({
      id: `perf_test_${Date.now()}_${i}`,
      vector: Array(1024).fill().map(() => Math.random() - 0.5),
      payload: { 
        text: `Test document ${i}`,
        timestamp: Date.now()
      }
    }));

    const start = performance.now();
    await httpClient.put(`${QDRANT_URL}/collections/jurisprudencia/points`, { points: vectors });
    const end = performance.now();
    const duration = end - start;
    const throughput = vectors.length / (duration / 1000);
    
    console.log(`   ✅ Upsert 100 vectores: ${duration.toFixed(2)}ms`);
    console.log(`   ⚡ Throughput: ${throughput.toFixed(2)} vectors/sec`);
    
    if (throughput > 1000) {
      console.log(`   🔥 EXCELENTE velocidad Qdrant`);
    } else if (throughput > 500) {
      console.log(`   ✅ BUENA velocidad Qdrant`);
    } else {
      console.log(`   ⚠️ Qdrant podría ser más rápido`);
    }
    
  } catch (error) {
    console.log(`   ❌ Error Qdrant: ${error.message}`);
  }

  // 6. Proyecciones de rendimiento
  console.log('\n🎯 6. PROYECCIONES DE RENDIMIENTO:');
  
  if (bestThroughput > 0) {
    const docsPerSec = bestThroughput / 10; // Asumiendo ~10 chunks por documento
    const docsPerMin = docsPerSec * 60;
    const docsPerHour = docsPerMin * 60;
    
    console.log(`   📈 Con batch size ${bestBatchSize}:`);
    console.log(`     • ${docsPerSec.toFixed(1)} documentos/segundo`);
    console.log(`     • ${docsPerMin.toFixed(0)} documentos/minuto`);
    console.log(`     • ${docsPerHour.toFixed(0)} documentos/hora`);
    
    if (docsPerSec > 50) {
      console.log(`     🎉 ¡EXCELENTE! Supera objetivo de 50 docs/sec`);
    } else if (docsPerSec > 25) {
      console.log(`     ✅ BUENO - Cerca del objetivo`);
    } else {
      console.log(`     ⚠️ BAJO - Necesita optimización`);
    }
  }

  // 7. Recomendaciones específicas
  console.log('\n💡 7. RECOMENDACIONES PARA TU CÓDIGO:');
  console.log(`   🔧 Usar EMBEDDING_BATCH_SIZE: ${bestBatchSize}`);
  console.log(`   🔧 Usar MAX_CONCURRENT_EMBEDDINGS: 20-30`);
  console.log(`   🔧 Usar MAX_CONCURRENT_DOCS: 30-50`);
  console.log(`   🔧 Usar QDRANT_BATCH_SIZE: 200-500`);
  console.log(`   🔧 Timeouts HTTP: 30000ms mínimo`);
  
  console.log('\n🚀 PRÓXIMO PASO: Actualizar tu configuración con estos valores');
}

// Ejecutar
if (require.main === module) {
  testRendimientoReal().catch(console.error);
}

module.exports = { testRendimientoReal };
