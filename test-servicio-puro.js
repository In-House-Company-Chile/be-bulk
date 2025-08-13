const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { performance } = require('perf_hooks');

require('dotenv').config();
const EMBEDDING_URL = 'http://localhost:11441/embed';
const SENTENCIAS_DIR = process.env.SENTENCIAS_DIR;

// Cliente HTTP simple
const httpClient = axios.create({
  timeout: 60000,
  httpAgent: new (require('http').Agent)({
    keepAlive: true,
    maxSockets: 10
  })
});

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
 * Test puro del servicio de embeddings
 */
async function testServicioPuro() {
  console.log('🧪 === TEST PURO DEL SERVICIO DE EMBEDDINGS ===\n');

  // Leer 20 archivos reales
  const archivos = fs.readdirSync(SENTENCIAS_DIR)
    .filter(archivo => archivo.endsWith('.json'))
    .slice(0, 20);

  if (archivos.length === 0) {
    console.log('❌ No hay archivos para probar');
    return;
  }

  console.log(`📂 Probando ${archivos.length} archivos reales...`);
  console.log(`🎯 SOLO EMBEDDINGS - Sin Qdrant, sin complejidad\n`);

  const results = [];
  const startTime = performance.now();
  let totalChunks = 0;

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    const rutaArchivo = path.join(SENTENCIAS_DIR, archivo);
    
    try {
      console.log(`📄 ${i + 1}/${archivos.length}: ${archivo}`);
      
      // Leer archivo
      const contenido = fs.readFileSync(rutaArchivo, 'utf8');
      const jsonData = JSON.parse(contenido);

      if (!jsonData.texto_sentencia || jsonData.texto_sentencia.trim() === '') {
        console.log('   ⚠️ Sin texto, saltando...');
        continue;
      }

      // Crear chunks
      const chunks = createChunks(jsonData.texto_sentencia);
      console.log(`   📝 ${chunks.length} chunks`);

      // SOLO EMBEDDINGS - NADA MÁS
      const embeddingStartTime = performance.now();
      
      // Procesar en batches de 128
      const batchSize = 128;
      let embeddingCount = 0;
      
      for (let j = 0; j < chunks.length; j += batchSize) {
        const batchChunks = chunks.slice(j, j + batchSize);
        
        const batchStart = performance.now();
        await httpClient.post(EMBEDDING_URL, { inputs: batchChunks });
        const batchEnd = performance.now();
        
        embeddingCount += batchChunks.length;
        const batchTime = batchEnd - batchStart;
        const batchThroughput = batchChunks.length / (batchTime / 1000);
        
        console.log(`     📦 Batch ${Math.floor(j/batchSize) + 1}: ${batchChunks.length} chunks en ${batchTime.toFixed(0)}ms (${batchThroughput.toFixed(1)} chunks/sec)`);
      }
      
      const embeddingEndTime = performance.now();
      const embeddingTime = embeddingEndTime - embeddingStartTime;
      const embeddingThroughput = chunks.length / (embeddingTime / 1000);
      
      console.log(`   ✅ Total embeddings: ${embeddingTime.toFixed(0)}ms (${embeddingThroughput.toFixed(1)} chunks/sec)`);
      
      totalChunks += chunks.length;
      
      results.push({
        archivo,
        chunks: chunks.length,
        embeddingTime,
        embeddingThroughput
      });
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }

  const endTime = performance.now();
  const totalTime = endTime - startTime;
  const docsProcessed = results.length;
  const docThroughput = docsProcessed / (totalTime / 1000);
  const chunkThroughput = totalChunks / (totalTime / 1000);

  console.log(`\n🎯 === RESULTADOS DEL TEST PURO ===`);
  console.log(`   📊 Documentos procesados: ${docsProcessed}`);
  console.log(`   🔢 Total chunks: ${totalChunks}`);
  console.log(`   ⏱️ Tiempo total: ${(totalTime / 1000).toFixed(2)}s`);
  console.log(`   📈 Velocidad documentos: ${docThroughput.toFixed(2)} docs/sec`);
  console.log(`   🔢 Velocidad chunks: ${chunkThroughput.toFixed(2)} chunks/sec`);
  console.log(`   📊 Chunks promedio/doc: ${(totalChunks / docsProcessed).toFixed(1)}`);

  // Análisis crítico
  console.log(`\n🔍 === ANÁLISIS CRÍTICO ===`);
  
  if (docThroughput > 20) {
    console.log(`   🎉 SERVICIO EXCELENTE: >20 docs/sec`);
    console.log(`   🤔 El problema está en Qdrant o en el código de integración`);
  } else if (docThroughput > 10) {
    console.log(`   ✅ SERVICIO BUENO: >10 docs/sec`);
    console.log(`   🤔 Hay margen de mejora pero es aceptable`);
  } else if (docThroughput > 5) {
    console.log(`   ⚠️ SERVICIO LIMITADO: ~${docThroughput.toFixed(1)} docs/sec`);
    console.log(`   🎯 Esta es probablemente la velocidad máxima real del servicio`);
  } else {
    console.log(`   ❌ SERVICIO LENTO: <5 docs/sec`);
    console.log(`   🔧 El servicio necesita optimización`);
  }

  // Comparación con capacidad teórica
  console.log(`\n📊 === COMPARACIÓN CON TESTS ANTERIORES ===`);
  console.log(`   🧪 Test de batch puro: 612 texts/sec`);
  console.log(`   📄 Test con documentos reales: ${chunkThroughput.toFixed(2)} chunks/sec`);
  console.log(`   📉 Diferencia: ${((612 - chunkThroughput) / 612 * 100).toFixed(1)}% más lento con docs reales`);

  if (chunkThroughput < 300) {
    console.log(`   🤔 POSIBLE CAUSA: El servicio se comporta diferente con textos largos reales vs textos de prueba`);
  }

  // Proyección final
  const timeFor6000 = (6000 / docThroughput) / 60;
  console.log(`\n⏰ Tiempo estimado para 6000 documentos: ${timeFor6000.toFixed(1)} minutos`);
  
  if (timeFor6000 > 60) {
    console.log(`   ⚠️ MÁS DE 1 HORA - Necesitamos optimizar el servicio`);
  } else if (timeFor6000 > 30) {
    console.log(`   ⚠️ ~30-60 MINUTOS - Aceptable pero mejorable`);
  } else {
    console.log(`   ✅ MENOS DE 30 MINUTOS - Rendimiento excelente`);
  }
}

// Test adicional: Saturación progresiva con docs reales
async function testSaturacionReal() {
  console.log('\n🔥 === TEST DE SATURACIÓN CON DOCUMENTOS REALES ===\n');

  // Leer 5 archivos
  const archivos = fs.readdirSync(SENTENCIAS_DIR)
    .filter(archivo => archivo.endsWith('.json'))
    .slice(0, 5);

  const documentos = [];
  
  // Preparar documentos
  for (const archivo of archivos) {
    const rutaArchivo = path.join(SENTENCIAS_DIR, archivo);
    const contenido = fs.readFileSync(rutaArchivo, 'utf8');
    const jsonData = JSON.parse(contenido);
    
    if (jsonData.texto_sentencia && jsonData.texto_sentencia.trim()) {
      const chunks = createChunks(jsonData.texto_sentencia);
      documentos.push({ archivo, chunks });
    }
  }

  console.log(`📂 Preparados ${documentos.length} documentos reales`);

  // Test de concurrencia progresiva
  const concurrencyLevels = [1, 2, 3, 5, 8, 10];
  
  for (const concurrency of concurrencyLevels) {
    console.log(`\n🧪 Probando ${concurrency} documentos simultáneos...`);
    
    const docsToProcess = documentos.slice(0, Math.min(concurrency, documentos.length));
    const startTime = performance.now();
    
    const promises = docsToProcess.map(async (doc, idx) => {
      const docStart = performance.now();
      let totalChunks = 0;
      
      // Procesar chunks del documento
      for (let i = 0; i < doc.chunks.length; i += 128) {
        const batchChunks = doc.chunks.slice(i, i + 128);
        await httpClient.post(EMBEDDING_URL, { inputs: batchChunks });
        totalChunks += batchChunks.length;
      }
      
      const docEnd = performance.now();
      return {
        archivo: doc.archivo,
        chunks: totalChunks,
        time: docEnd - docStart
      };
    });
    
    const results = await Promise.all(promises);
    const endTime = performance.now();
    
    const totalTime = endTime - startTime;
    const totalChunks = results.reduce((sum, r) => sum + r.chunks, 0);
    const docThroughput = docsToProcess.length / (totalTime / 1000);
    const chunkThroughput = totalChunks / (totalTime / 1000);
    
    console.log(`   ⏱️ Tiempo total: ${totalTime.toFixed(0)}ms`);
    console.log(`   📈 Throughput: ${docThroughput.toFixed(2)} docs/sec, ${chunkThroughput.toFixed(2)} chunks/sec`);
    
    results.forEach((result, idx) => {
      console.log(`     ${idx + 1}. ${result.archivo}: ${result.chunks} chunks en ${result.time.toFixed(0)}ms`);
    });
    
    // Pausa entre tests
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
}

// Ejecutar
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--saturacion')) {
    testSaturacionReal();
  } else {
    testServicioPuro().then(() => {
      if (args.includes('--full')) {
        return testSaturacionReal();
      }
    });
  }
}

module.exports = { testServicioPuro, testSaturacionReal };
