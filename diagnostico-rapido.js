require('dotenv').config();
const axios = require('axios');
const { performance } = require('perf_hooks');

// Configuración
const EMBEDDING_URL = process.env.EMBEDDING_API_URL || 'http://localhost:11441/embed';
const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';

// Cliente HTTP simple
const http = axios.create({ timeout: 10000 });

/**
 * Diagnóstico rápido de servicios
 */
async function diagnosticoRapido() {
  console.log('🔍 === DIAGNÓSTICO RÁPIDO DE RENDIMIENTO ===\n');

  // 1. Test de conectividad
  console.log('📡 1. TEST DE CONECTIVIDAD:');
  
  try {
    const start1 = performance.now();
    const response1 = await http.get(EMBEDDING_URL.replace('/embed', '/'));
    const end1 = performance.now();
    console.log(`   ✅ Embeddings: ${(end1 - start1).toFixed(2)}ms - ${response1.data.status || 'OK'}`);
    
    if (response1.data.model_loaded === false) {
      console.log('   ⚠️  PROBLEMA: Modelo no cargado en GPU!');
    }
    if (response1.data.device !== 'cuda') {
      console.log('   ⚠️  PROBLEMA: No está usando CUDA!');
    }
  } catch (error) {
    console.log(`   ❌ Embeddings: ${error.message}`);
    return;
  }

  try {
    const start2 = performance.now();
    const response2 = await http.get(`${QDRANT_URL}/collections`);
    const end2 = performance.now();
    console.log(`   ✅ Qdrant: ${(end2 - start2).toFixed(2)}ms - ${response2.data.result.collections.length} colecciones`);
  } catch (error) {
    console.log(`   ❌ Qdrant: ${error.message}`);
    return;
  }

  // 2. Test de embedding individual
  console.log('\n🧠 2. TEST DE EMBEDDING INDIVIDUAL:');
  const testText = 'Esta es una prueba de rendimiento del sistema de embeddings para medir la latencia.';
  
  try {
    const start = performance.now();
    const response = await http.post(EMBEDDING_URL, { inputs: testText });
    const end = performance.now();
    const duration = end - start;
    
    const embedding = response.data;
    const dimensions = Array.isArray(embedding) ? embedding.length : 'unknown';
    console.log(`   ✅ Tiempo: ${duration.toFixed(2)}ms`);
    console.log(`   📊 Dimensiones: ${dimensions}`);
    console.log(`   ⚡ Throughput: ${(1000/duration).toFixed(2)} req/sec`);
    
    if (duration > 500) {
      console.log('   ⚠️  LENTO: Debería ser <100ms para texto corto');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 3. Test de batch pequeño
  console.log('\n📦 3. TEST DE BATCH PEQUEÑO (8 textos):');
  const batchTexts = Array(8).fill(testText);
  
  try {
    const start = performance.now();
    const response = await http.post(EMBEDDING_URL, { inputs: batchTexts });
    const end = performance.now();
    const duration = end - start;
    const throughput = batchTexts.length / (duration / 1000);
    
    console.log(`   ✅ Tiempo: ${duration.toFixed(2)}ms`);
    console.log(`   ⚡ Throughput: ${throughput.toFixed(2)} texts/sec`);
    console.log(`   📈 Mejora vs individual: ${(throughput / (1000/500)).toFixed(1)}x`);
    
    if (throughput < 50) {
      console.log('   ⚠️  LENTO: Debería ser >100 texts/sec en batch');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 4. Test de batch grande
  console.log('\n🚀 4. TEST DE BATCH GRANDE (64 textos):');
  const largeBatch = Array(64).fill(testText);
  
  try {
    const start = performance.now();
    const response = await http.post(EMBEDDING_URL, { inputs: largeBatch });
    const end = performance.now();
    const duration = end - start;
    const throughput = largeBatch.length / (duration / 1000);
    
    console.log(`   ✅ Tiempo: ${duration.toFixed(2)}ms`);
    console.log(`   ⚡ Throughput: ${throughput.toFixed(2)} texts/sec`);
    console.log(`   🎯 Proyección: ${(throughput * 60).toFixed(0)} texts/min`);
    
    if (throughput < 200) {
      console.log('   ⚠️  SUBÓPTIMO: Con RTX 3060 debería ser >500 texts/sec');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 5. Test de Qdrant upsert
  console.log('\n📤 5. TEST DE QDRANT UPSERT (100 vectores):');
  
  // Generar vectores falsos
  const vectors = Array(100).fill().map((_, i) => ({
    id: `diag_${Date.now()}_${i}`,
    vector: Array(1024).fill().map(() => Math.random() - 0.5),
    payload: { text: `Test ${i}`, timestamp: Date.now() }
  }));

  try {
    const start = performance.now();
    await http.put(`${QDRANT_URL}/collections/jurisprudencia/points`, { points: vectors });
    const end = performance.now();
    const duration = end - start;
    const throughput = vectors.length / (duration / 1000);
    
    console.log(`   ✅ Tiempo: ${duration.toFixed(2)}ms`);
    console.log(`   ⚡ Throughput: ${throughput.toFixed(2)} vectors/sec`);
    console.log(`   🎯 Proyección: ${(throughput * 60).toFixed(0)} vectors/min`);
    
    if (throughput < 500) {
      console.log('   ⚠️  LENTO: Qdrant local debería ser >1000 vectors/sec');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 6. Test de requests concurrentes
  console.log('\n🔥 6. TEST DE CONCURRENCIA (10 requests paralelos):');
  
  try {
    const start = performance.now();
    const promises = Array(10).fill().map(() => 
      http.post(EMBEDDING_URL, { inputs: testText })
    );
    const responses = await Promise.all(promises);
    const end = performance.now();
    const duration = end - start;
    const throughput = promises.length / (duration / 1000);
    
    console.log(`   ✅ Tiempo: ${duration.toFixed(2)}ms`);
    console.log(`   ⚡ Throughput: ${throughput.toFixed(2)} req/sec`);
    console.log(`   📊 Exitosos: ${responses.length}/10`);
    
    if (throughput < 20) {
      console.log('   ⚠️  PROBLEMA: Concurrencia muy baja, posible cuello de botella');
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error.message}`);
  }

  // 7. Análisis y recomendaciones
  console.log('\n💡 === ANÁLISIS Y RECOMENDACIONES ===');
  console.log('\n🎯 OBJETIVOS PARA TU HARDWARE:');
  console.log('   • RTX 3060 12GB: >500 embeddings/sec en batch');
  console.log('   • Ryzen 5 7600X: >50 requests concurrentes');
  console.log('   • 30GB RAM: >100 documentos paralelos');
  console.log('   • SSD: >1000 Qdrant upserts/sec');
  
  console.log('\n🔍 SI VES PROBLEMAS:');
  console.log('   • <100ms embedding individual: ✅ Óptimo');
  console.log('   • 100-500ms: ⚠️  Revisar GPU utilization');
  console.log('   • >500ms: ❌ Problema serio - modelo no en GPU');
  console.log('   • <200 batch throughput: ❌ GPU subutilizada');
  console.log('   • <500 Qdrant upserts/sec: ❌ Problema I/O o red');
  console.log('   • Errores concurrencia: ❌ Límites de conexión');

  console.log('\n🚀 PRÓXIMOS PASOS:');
  console.log('   1. Ejecuta: nvidia-smi -l 1 (monitorear GPU)');
  console.log('   2. Si GPU <90%: aumentar batch size');
  console.log('   3. Si RAM <20GB: aumentar concurrencia');
  console.log('   4. Si todo bien: problema en tu código principal');
}

// Ejecutar
if (require.main === module) {
  diagnosticoRapido().catch(console.error);
}

module.exports = { diagnosticoRapido };
