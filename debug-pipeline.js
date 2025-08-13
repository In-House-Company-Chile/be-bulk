require('dotenv').config();
const fs = require('fs');
const path = require('path');
const IndexarQdrant = require('./functions/IndexarQdrant');
const axios = require('axios');
const { performance } = require('perf_hooks');

// Configuración
const EMBEDDING_URL = 'http://localhost:11441/embed';
const QDRANT_URL = 'http://localhost:6333';
const QDRANT_COLLECTION = 'test_jurisprudencia_3';
const SENTENCIAS_DIR = process.env.SENTENCIAS_DIR;

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
 * Debug detallado del pipeline
 */
async function debugPipeline() {
  console.log('🔍 === DEBUG DETALLADO DEL PIPELINE ===\n');

  // Leer un archivo de muestra
  const archivos = fs.readdirSync(SENTENCIAS_DIR).filter(archivo =>
    archivo.endsWith('.json')
  ).slice(0, 5); // Solo 5 archivos para debug

  console.log(`📂 Analizando ${archivos.length} archivos de muestra...\n`);

  for (let i = 0; i < archivos.length; i++) {
    const archivo = archivos[i];
    const rutaArchivo = path.join(SENTENCIAS_DIR, archivo);
    
    console.log(`\n📄 === ARCHIVO ${i + 1}: ${archivo} ===`);
    
    const docStartTime = performance.now();
    
    try {
      // Paso 1: Leer archivo
      const readStart = performance.now();
      const contenido = fs.readFileSync(rutaArchivo, 'utf8');
      const jsonData = JSON.parse(contenido);
      const readEnd = performance.now();
      
      console.log(`   📖 Lectura: ${(readEnd - readStart).toFixed(2)}ms`);
      console.log(`   🆔 ID: ${jsonData.id}`);
      console.log(`   📝 Texto: ${jsonData.texto_sentencia?.length || 0} caracteres`);
      
      if (!jsonData.texto_sentencia || jsonData.texto_sentencia.trim() === '') {
        console.log('   ⚠️ Sin texto, saltando...');
        continue;
      }

      // Paso 2: Crear metadata
      const metaStart = performance.now();
      const metadata = {
        idSentence: jsonData.id,
        base: 'test',
        url: jsonData.url_corta_acceso_sentencia || '',
        rol: jsonData.rol_era_sup_s || '',
        caratulado: jsonData.caratulado_s || '',
        fechaSentencia: jsonData.fec_sentencia_sup_dt || ''
      };
      const metaEnd = performance.now();
      
      console.log(`   🏷️ Metadata: ${(metaEnd - metaStart).toFixed(2)}ms`);

      // Paso 3: Dividir en chunks (simulando lo que hace IndexarQdrant)
      const chunkStart = performance.now();
      const chunkSize = 800;
      const chunks = [];
      const texto = jsonData.texto_sentencia;
      
      for (let j = 0; j < texto.length; j += chunkSize) {
        chunks.push(texto.substring(j, j + chunkSize));
      }
      const chunkEnd = performance.now();
      
      console.log(`   ✂️ Chunking: ${(chunkEnd - chunkStart).toFixed(2)}ms (${chunks.length} chunks)`);

      // Paso 4: Test de embeddings por lotes
      console.log(`   🧠 Probando embeddings...`);
      
      // Test individual
      const singleStart = performance.now();
      const singleResponse = await httpClient.post(EMBEDDING_URL, {
        inputs: chunks[0]
      });
      const singleEnd = performance.now();
      console.log(`     📊 Individual: ${(singleEnd - singleStart).toFixed(2)}ms`);
      
      // Test batch pequeño (4 chunks)
      if (chunks.length >= 4) {
        const batchStart = performance.now();
        const batchResponse = await httpClient.post(EMBEDDING_URL, {
          inputs: chunks.slice(0, 4)
        });
        const batchEnd = performance.now();
        const batchTime = batchEnd - batchStart;
        const throughput = 4 / (batchTime / 1000);
        console.log(`     📦 Batch 4: ${batchTime.toFixed(2)}ms (${throughput.toFixed(1)} chunks/sec)`);
      }
      
      // Test batch grande (todos los chunks)
      const allStart = performance.now();
      const allResponse = await httpClient.post(EMBEDDING_URL, {
        inputs: chunks
      });
      const allEnd = performance.now();
      const allTime = allEnd - allStart;
      const allThroughput = chunks.length / (allTime / 1000);
      console.log(`     🚀 Batch ${chunks.length}: ${allTime.toFixed(2)}ms (${allThroughput.toFixed(1)} chunks/sec)`);

      // Paso 5: Test de Qdrant upsert
      console.log(`   📤 Probando Qdrant upsert...`);
      
      const embeddings = Array.isArray(allResponse.data[0]) ? allResponse.data : [allResponse.data];
      const points = chunks.map((chunk, idx) => ({
        id: require('uuid').v4(), // UUID válido
        vector: embeddings[idx] || embeddings[0],
        payload: {
          ...metadata,
          text: chunk,
          chunk_index: idx
        }
      }));
      
      const qdrantStart = performance.now();
      await httpClient.put(`${QDRANT_URL}/collections/${QDRANT_COLLECTION}/points`, {
        points
      });
      const qdrantEnd = performance.now();
      const qdrantTime = qdrantEnd - qdrantStart;
      const qdrantThroughput = points.length / (qdrantTime / 1000);
      
      console.log(`     📦 Qdrant: ${qdrantTime.toFixed(2)}ms (${qdrantThroughput.toFixed(1)} vectors/sec)`);

      // Tiempo total del documento
      const docEnd = performance.now();
      const totalTime = docEnd - docStartTime;
      const docThroughput = 1 / (totalTime / 1000);
      
      console.log(`\n   ⏱️ TOTAL DOCUMENTO: ${totalTime.toFixed(2)}ms (${docThroughput.toFixed(2)} docs/sec)`);
      
      // Desglose de tiempos
      const embeddingPercent = ((allTime / totalTime) * 100);
      const qdrantPercent = ((qdrantTime / totalTime) * 100);
      
      console.log(`   📊 Desglose:`);
      console.log(`     🧠 Embeddings: ${embeddingPercent.toFixed(1)}% del tiempo`);
      console.log(`     📤 Qdrant: ${qdrantPercent.toFixed(1)}% del tiempo`);
      console.log(`     🔧 Overhead: ${(100 - embeddingPercent - qdrantPercent).toFixed(1)}% del tiempo`);
      
      // Pausa entre documentos
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error(`   ❌ Error: ${error.message}`);
    }
  }

  console.log('\n💡 === ANÁLISIS Y RECOMENDACIONES ===');
  console.log('\n🔍 BUSCA ESTOS PATRONES:');
  console.log('   • Si embeddings >80% del tiempo: GPU subutilizada o batch size subóptimo');
  console.log('   • Si Qdrant >30% del tiempo: problema de red o configuración Qdrant');
  console.log('   • Si overhead >20%: problema en el código de procesamiento');
  console.log('   • Si chunks/sec <200: batch size muy pequeño');
  console.log('   • Si docs/sec <10 por documento: problema serio en pipeline');
}

// Función para probar diferentes configuraciones
async function testDifferentConfigs() {
  console.log('\n🧪 === TEST DE DIFERENTES CONFIGURACIONES ===\n');
  
  // Leer un archivo de prueba
  const archivos = fs.readdirSync(SENTENCIAS_DIR).filter(archivo =>
    archivo.endsWith('.json')
  );
  
  if (archivos.length === 0) {
    console.log('❌ No hay archivos para probar');
    return;
  }
  
  const archivo = archivos[0];
  const rutaArchivo = path.join(SENTENCIAS_DIR, archivo);
  const contenido = fs.readFileSync(rutaArchivo, 'utf8');
  const jsonData = JSON.parse(contenido);
  
  const texto = jsonData.texto_sentencia;
  if (!texto) {
    console.log('❌ Archivo sin texto');
    return;
  }
  
  // Crear chunks
  const chunkSize = 800;
  const chunks = [];
  for (let i = 0; i < texto.length; i += chunkSize) {
    chunks.push(texto.substring(i, i + chunkSize));
  }
  
  console.log(`📊 Archivo: ${archivo} (${chunks.length} chunks)\n`);
  
  // Probar diferentes batch sizes
  const batchSizes = [1, 4, 8, 16, 32, 64, Math.min(128, chunks.length)];
  
  for (const batchSize of batchSizes) {
    if (batchSize > chunks.length) continue;
    
    try {
      const testChunks = chunks.slice(0, batchSize);
      
      const start = performance.now();
      const response = await httpClient.post(EMBEDDING_URL, {
        inputs: testChunks
      });
      const end = performance.now();
      
      const duration = end - start;
      const throughput = batchSize / (duration / 1000);
      
      console.log(`📦 Batch ${batchSize.toString().padStart(3)}: ${duration.toFixed(2).padStart(7)}ms → ${throughput.toFixed(1).padStart(6)} chunks/sec`);
      
    } catch (error) {
      console.log(`❌ Batch ${batchSize}: ${error.message}`);
    }
    
    // Pausa pequeña
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

// Ejecutar
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--config')) {
    testDifferentConfigs();
  } else {
    debugPipeline();
  }
}

module.exports = { debugPipeline, testDifferentConfigs };
