/**
 * Script de prueba para verificar la conexión a Qdrant y el servicio de embeddings
 */

require('dotenv').config();
const axios = require('axios');

const QDRANT_URL = process.env.QDRANT_URL || 'http://ms-qdrant-8f82e7cd-8cc2.governare.ai';
const EMBEDDING_URL = process.env.EMBEDDING_URL || 'http://ms-vector.governare.ai/embed';
const COLLECTION_NAME = 'test_jurisprudencia';

async function testQdrantConnection() {
  console.log('🔧 Probando conexión a Qdrant...');
  
  try {
    // Probar conexión básica
    const response = await axios.get(`${QDRANT_URL}/collections`);
    console.log('✅ Conexión a Qdrant exitosa');
    console.log(`📊 Colecciones existentes: ${response.data.result.collections.length}`);
    
    // Verificar si la colección test_jurisprudencia existe
    try {
      const collectionResponse = await axios.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
      console.log(`✅ Colección '${COLLECTION_NAME}' existe`);
      console.log(`📈 Configuración: ${JSON.stringify(collectionResponse.data.result.config, null, 2)}`);
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`⚠️ Colección '${COLLECTION_NAME}' no existe - se creará automáticamente`);
      } else {
        throw error;
      }
    }
    
  } catch (error) {
    console.error('❌ Error conectando a Qdrant:', error.message);
    return false;
  }
  
  return true;
}

async function testEmbeddingService() {
  console.log('\n🧠 Probando servicio de embeddings...');
  
  try {
    const testText = "Esta es una prueba del servicio de embeddings";
    const response = await axios.post(EMBEDDING_URL, {
      inputs: testText
    }, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout: 10000
    });
    
    if (response.data && Array.isArray(response.data)) {
      console.log('✅ Servicio de embeddings funcionando');
      
      if (response.data.length === 1024) {
        console.log('✅ Dimensiones correctas (1024)');
      } else if (response.data.length === 1 && Array.isArray(response.data[0])) {
        console.log(`✅ Formato anidado detectado - Dimensiones internas: ${response.data[0].length}`);
        if (response.data[0].length === 1024) {
          console.log('✅ Dimensiones correctas (1024) en array anidado');
        } else {
          console.log(`⚠️ Dimensiones inesperadas en array anidado: ${response.data[0].length}, se esperaba 1024`);
        }
      } else {
        console.log(`⚠️ Dimensiones inesperadas: ${response.data.length}, se esperaba 1024 o formato anidado`);
      }
    } else {
      console.log('⚠️ Formato de respuesta inesperado');
      console.log('Respuesta:', JSON.stringify(response.data).substring(0, 200) + '...');
    }
    
  } catch (error) {
    console.error('❌ Error con el servicio de embeddings:', error.message);
    return false;
  }
  
  return true;
}

async function testIndexing() {
  console.log('\n🔍 Probando indexación básica...');
  
  try {
    const IndexarQdrant = require('./functions/IndexarQdrant');
    
    const testMetadata = {
      idSentence: 'TEST_001',
      base: 'test',
      rol: 'TEST-123-2024',
      caratulado: 'Prueba de indexación',
      tribunal: 'Tribunal de Prueba'
    };
    
    const testText = `
      Esta es una sentencia de prueba para verificar que el sistema de indexación funciona correctamente.
      
      CONSIDERANDO:
      1. Que se ha implementado un sistema de indexación en Qdrant
      2. Que el servicio de embeddings genera vectores de 1024 dimensiones
      3. Que los metadatos se extraen usando la función createMetadataByType
      
      SE RESUELVE:
      Aprobar la implementación del sistema de indexación en Qdrant.
    `;
    
    const result = await IndexarQdrant.create(testText, COLLECTION_NAME, testMetadata);
    
    if (result.success) {
      console.log('✅ Indexación de prueba exitosa');
      console.log(`📊 Chunks procesados: ${result.chunks_processed}/${result.total_chunks}`);
    } else {
      console.log('❌ Error en la indexación de prueba');
    }
    
  } catch (error) {
    console.error('❌ Error probando indexación:', error.message);
    return false;
  }
  
  return true;
}

async function main() {
  console.log('🚀 Iniciando pruebas del sistema Qdrant\n');
  console.log(`🔧 Configuración:`);
  console.log(`   🎯 Qdrant URL: ${QDRANT_URL}`);
  console.log(`   🧠 Embedding URL: ${EMBEDDING_URL}`);
  console.log(`   📦 Colección: ${COLLECTION_NAME}\n`);
  
  const qdrantOk = await testQdrantConnection();
  const embeddingOk = await testEmbeddingService();
  
  if (qdrantOk && embeddingOk) {
    await testIndexing();
  }
  
  console.log('\n📋 Resumen de pruebas:');
  console.log(`   🎯 Qdrant: ${qdrantOk ? '✅' : '❌'}`);
  console.log(`   🧠 Embeddings: ${embeddingOk ? '✅' : '❌'}`);
  
  if (qdrantOk && embeddingOk) {
    console.log('\n🎉 ¡Sistema listo para indexar documentos!');
    console.log('💡 Ejecuta: node indexar-qdrant-ejemplo.js');
  } else {
    console.log('\n⚠️ Hay problemas de conexión que deben resolverse antes de indexar');
  }
}

if (require.main === module) {
  main().catch(console.error);
}