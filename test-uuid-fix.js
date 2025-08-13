const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const QDRANT_URL = 'http://localhost:6333';
const COLLECTION_NAME = 'test_jurisprudencia_3';

async function testUuidFix() {
  console.log('🧪 === TEST DE UUID FIX ===\n');
  
  try {
    // Test 1: UUID válido
    console.log('🔍 Test 1: UUID válido');
    const validUuid = uuidv4();
    console.log(`   🆔 UUID generado: ${validUuid}`);
    
    const testPoint1 = {
      id: validUuid, // UUID válido
      vector: Array(1024).fill(0.1),
      payload: {
        text: "Test con UUID válido",
        timestamp: new Date().toISOString()
      }
    };
    
    const response1 = await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
      points: [testPoint1]
    });
    
    console.log(`   ✅ Upsert con UUID exitoso: ${response1.data.status}`);
    
    // Test 2: Integer válido
    console.log('\n🔍 Test 2: Integer válido');
    const validInteger = Math.floor(Math.random() * 1000000);
    console.log(`   🔢 Integer generado: ${validInteger}`);
    
    const testPoint2 = {
      id: validInteger, // Integer válido
      vector: Array(1024).fill(0.2),
      payload: {
        text: "Test con Integer válido",
        timestamp: new Date().toISOString()
      }
    };
    
    const response2 = await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
      points: [testPoint2]
    });
    
    console.log(`   ✅ Upsert con Integer exitoso: ${response2.data.status}`);
    
    // Test 3: Batch con UUIDs
    console.log('\n🔍 Test 3: Batch con múltiples UUIDs');
    const batchPoints = Array(5).fill().map((_, i) => ({
      id: uuidv4(),
      vector: Array(1024).fill(0.3 + i * 0.1),
      payload: {
        text: `Test batch ${i}`,
        batch_index: i,
        timestamp: new Date().toISOString()
      }
    }));
    
    console.log('   🆔 UUIDs del batch:');
    batchPoints.forEach((point, i) => {
      console.log(`     ${i + 1}: ${point.id}`);
    });
    
    const response3 = await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
      points: batchPoints
    });
    
    console.log(`   ✅ Batch upsert exitoso: ${response3.data.status}`);
    
    // Verificar estado final
    console.log('\n📊 Estado final de la colección:');
    const finalState = await axios.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
    console.log(`   📈 Total vectores: ${finalState.data.result.vectors_count}`);
    
    console.log('\n🎉 ¡Todos los tests exitosos! El problema de IDs está resuelto.');
    
  } catch (error) {
    console.error('❌ Error en test:', error.message);
    if (error.response?.data) {
      console.error('📋 Detalles:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Test específico del IndexarQdrant
async function testIndexarQdrant() {
  console.log('\n🔧 === TEST DEL IndexarQdrant REAL ===\n');
  
  const IndexarQdrant = require('./functions/IndexarQdrant');
  
  try {
    const testText = 'Esta es una sentencia de prueba para verificar que el IndexarQdrant funciona correctamente con los UUIDs arreglados. Debe generar múltiples chunks y procesarlos sin errores.';
    
    const metadata = {
      idSentence: '12345',
      base: 'test',
      rol: 'TEST-2024',
      caratulado: 'Test vs Test'
    };
    
    console.log('🚀 Ejecutando IndexarQdrant.create...');
    const result = await IndexarQdrant.create(testText, COLLECTION_NAME, metadata, {
      embeddingUrl: 'http://localhost:11441/embed',
      qdrantUrl: QDRANT_URL,
      vectorDimension: 1024,
      embeddingBatchSize: 32,
      upsertBatchSize: 100
    });
    
    console.log('✅ IndexarQdrant exitoso:');
    console.log(`   📊 Chunks procesados: ${result.chunksProcessed}`);
    console.log(`   📈 Total vectores: ${result.totalVectors}`);
    
    // Verificar en Qdrant
    const finalCheck = await axios.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
    console.log(`   🔍 Vectores en Qdrant: ${finalCheck.data.result.vectors_count}`);
    
  } catch (error) {
    console.error('❌ Error en IndexarQdrant:', error.message);
    if (error.response?.data) {
      console.error('📋 Detalles:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

// Ejecutar
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--indexar')) {
    testIndexarQdrant();
  } else {
    testUuidFix().then(() => {
      if (process.argv.includes('--full')) {
        return testIndexarQdrant();
      }
    });
  }
}

module.exports = { testUuidFix, testIndexarQdrant };
