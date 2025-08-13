const axios = require('axios');
const { performance } = require('perf_hooks');

const EMBEDDING_URL = 'http://localhost:11441/embed';

// Cliente HTTP optimizado
const httpClient = axios.create({
  timeout: 60000,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    maxSockets: 100,
    keepAliveMsecs: 500
  })
});

/**
 * Test de saturación del servicio de embeddings
 */
async function testSaturation() {
  console.log('🔍 === TEST DE SATURACIÓN DEL SERVICIO DE EMBEDDINGS ===\n');

  const testText = 'Esta es una sentencia de prueba para medir la saturación del servicio de embeddings.';
  
  // Test 1: Requests secuenciales
  console.log('📊 Test 1: 10 requests SECUENCIALES');
  const sequentialStart = performance.now();
  
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    await httpClient.post(EMBEDDING_URL, { inputs: testText });
    const end = performance.now();
    console.log(`   Request ${i + 1}: ${(end - start).toFixed(2)}ms`);
  }
  
  const sequentialEnd = performance.now();
  const sequentialTime = sequentialEnd - sequentialStart;
  const sequentialThroughput = 10 / (sequentialTime / 1000);
  
  console.log(`   ⏱️ Total secuencial: ${sequentialTime.toFixed(2)}ms`);
  console.log(`   📈 Throughput: ${sequentialThroughput.toFixed(2)} req/sec\n`);

  // Test 2: Requests paralelos
  console.log('🚀 Test 2: 10 requests PARALELOS');
  const parallelStart = performance.now();
  
  const promises = Array(10).fill().map((_, i) =>
    httpClient.post(EMBEDDING_URL, { inputs: testText })
      .then(() => {
        const now = performance.now();
        console.log(`   Request ${i + 1} completado: ${(now - parallelStart).toFixed(2)}ms desde inicio`);
      })
      .catch(error => {
        console.log(`   ❌ Request ${i + 1} falló: ${error.message}`);
      })
  );
  
  await Promise.all(promises);
  
  const parallelEnd = performance.now();
  const parallelTime = parallelEnd - parallelStart;
  const parallelThroughput = 10 / (parallelTime / 1000);
  
  console.log(`   ⏱️ Total paralelo: ${parallelTime.toFixed(2)}ms`);
  console.log(`   📈 Throughput: ${parallelThroughput.toFixed(2)} req/sec\n`);

  // Test 3: Saturación progresiva
  console.log('🔥 Test 3: SATURACIÓN PROGRESIVA');
  
  const concurrencyLevels = [1, 2, 5, 10, 20, 30, 40, 50];
  const results = [];
  
  for (const concurrency of concurrencyLevels) {
    console.log(`\n   🧪 Probando ${concurrency} requests concurrentes...`);
    
    const start = performance.now();
    const promises = Array(concurrency).fill().map(() =>
      httpClient.post(EMBEDDING_URL, { inputs: testText })
        .catch(error => ({ error: error.message }))
    );
    
    const responses = await Promise.all(promises);
    const end = performance.now();
    
    const duration = end - start;
    const successful = responses.filter(r => !r.error).length;
    const failed = responses.length - successful;
    const throughput = successful / (duration / 1000);
    
    results.push({
      concurrency,
      duration,
      successful,
      failed,
      throughput
    });
    
    console.log(`     ✅ Exitosos: ${successful}/${concurrency}`);
    if (failed > 0) {
      console.log(`     ❌ Fallidos: ${failed}`);
    }
    console.log(`     ⏱️ Tiempo: ${duration.toFixed(2)}ms`);
    console.log(`     📈 Throughput: ${throughput.toFixed(2)} req/sec`);
    
    // Pausa entre tests
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  // Análisis de resultados
  console.log('\n📊 === ANÁLISIS DE SATURACIÓN ===');
  
  const bestResult = results.reduce((best, current) => 
    current.throughput > best.throughput ? current : best
  );
  
  console.log(`\n🏆 MEJOR RENDIMIENTO:`);
  console.log(`   🎯 Concurrencia óptima: ${bestResult.concurrency}`);
  console.log(`   📈 Throughput máximo: ${bestResult.throughput.toFixed(2)} req/sec`);
  console.log(`   ⏱️ Tiempo: ${bestResult.duration.toFixed(2)}ms`);
  
  // Detectar saturación
  const saturationPoint = results.find((result, index) => {
    if (index === 0) return false;
    const prevResult = results[index - 1];
    return result.throughput < prevResult.throughput * 0.9; // 10% de degradación
  });
  
  if (saturationPoint) {
    console.log(`\n⚠️ PUNTO DE SATURACIÓN DETECTADO:`);
    console.log(`   🔴 Saturación en: ${saturationPoint.concurrency} requests concurrentes`);
    console.log(`   📉 Throughput degradado: ${saturationPoint.throughput.toFixed(2)} req/sec`);
  } else {
    console.log(`\n✅ No se detectó saturación hasta ${concurrencyLevels[concurrencyLevels.length - 1]} requests`);
  }
  
  // Comparación con rendimiento teórico
  console.log(`\n🎯 === COMPARACIÓN CON RENDIMIENTO ACTUAL ===`);
  console.log(`   📊 Throughput máximo del servicio: ${bestResult.throughput.toFixed(2)} req/sec`);
  console.log(`   📈 Throughput actual del pipeline: ~6.33 docs/sec`);
  console.log(`   🔢 Chunks por documento: ~17.7`);
  console.log(`   🧮 Requests necesarios por doc: ~17.7 / batch_size`);
  
  const batchSize = 64; // Batch size actual
  const requestsPerDoc = 17.7 / batchSize;
  const theoreticalDocsPerSec = bestResult.throughput / requestsPerDoc;
  
  console.log(`   🎯 Throughput teórico con batch ${batchSize}: ${theoreticalDocsPerSec.toFixed(2)} docs/sec`);
  
  if (theoreticalDocsPerSec > 20) {
    console.log(`   🤔 El servicio PUEDE dar más rendimiento. Problema en el código.`);
  } else {
    console.log(`   ⚠️ El servicio está LIMITANDO el rendimiento.`);
  }
}

// Test específico de batch sizes
async function testBatchSizes() {
  console.log('\n🔬 === TEST DE BATCH SIZES ===\n');
  
  const testTexts = Array(128).fill().map((_, i) => 
    `Texto de prueba número ${i} para medir el rendimiento del batch processing en diferentes tamaños.`
  );
  
  const batchSizes = [1, 4, 8, 16, 32, 64, 128];
  
  for (const batchSize of batchSizes) {
    const texts = testTexts.slice(0, batchSize);
    
    try {
      const start = performance.now();
      const response = await httpClient.post(EMBEDDING_URL, { inputs: texts });
      const end = performance.now();
      
      const duration = end - start;
      const throughput = batchSize / (duration / 1000);
      
      console.log(`📦 Batch ${batchSize.toString().padStart(3)}: ${duration.toFixed(2).padStart(7)}ms → ${throughput.toFixed(1).padStart(6)} texts/sec`);
      
    } catch (error) {
      console.log(`❌ Batch ${batchSize}: ${error.message}`);
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
  }
}

// Ejecutar
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--batch')) {
    testBatchSizes();
  } else {
    testSaturation().then(() => {
      if (args.includes('--full')) {
        return testBatchSizes();
      }
    });
  }
}

module.exports = { testSaturation, testBatchSizes };
