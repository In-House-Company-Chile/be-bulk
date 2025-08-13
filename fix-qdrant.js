const axios = require('axios');

const QDRANT_URL = 'http://localhost:6333';
const COLLECTION_NAME = 'jurisprudencia';

async function fixQdrant() {
  console.log('🔧 === DIAGNÓSTICO Y REPARACIÓN DE QDRANT ===\n');
  
  const http = axios.create({ timeout: 10000 });
  
  try {
    // 1. Verificar conectividad
    console.log('📡 1. Verificando conectividad...');
    const healthResponse = await http.get(`${QDRANT_URL}/collections`);
    console.log(`   ✅ Qdrant responde: ${healthResponse.status}`);
    console.log(`   📊 Colecciones existentes: ${healthResponse.data.result.collections.length}`);
    
    // Listar colecciones
    healthResponse.data.result.collections.forEach(col => {
      console.log(`     - ${col.name}`);
    });
    
    // 2. Verificar si existe la colección jurisprudencia
    console.log('\n🔍 2. Verificando colección jurisprudencia...');
    try {
      const collectionResponse = await http.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
      console.log(`   ✅ Colección '${COLLECTION_NAME}' existe`);
      
      const info = collectionResponse.data.result;
      console.log(`   📊 Vectores: ${info.vectors_count || 0}`);
      console.log(`   📏 Dimensiones: ${info.config?.params?.vectors?.size || 'N/A'}`);
      console.log(`   📐 Distancia: ${info.config?.params?.vectors?.distance || 'N/A'}`);
      
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`   ⚠️ Colección '${COLLECTION_NAME}' no existe`);
        console.log('   🔧 Creando colección...');
        
        await http.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
          vectors: {
            size: 1024,
            distance: "Cosine"
          },
          optimizers_config: {
            default_segment_number: 4,
            indexing_threshold: 20000
          }
        });
        
        console.log(`   ✅ Colección '${COLLECTION_NAME}' creada exitosamente`);
      } else {
        throw error;
      }
    }
    
    // 3. Test de upsert simple
    console.log('\n📤 3. Test de upsert simple...');
    const testPoints = [
      {
        id: `test_${Date.now()}`,
        vector: Array(1024).fill(0.1),
        payload: {
          text: "Test document",
          timestamp: new Date().toISOString()
        }
      }
    ];
    
    try {
      const upsertResponse = await http.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
        points: testPoints
      });
      
      if (upsertResponse.data.status === 'ok') {
        console.log('   ✅ Upsert simple exitoso');
      } else {
        console.log('   ❌ Upsert falló:', upsertResponse.data);
      }
    } catch (error) {
      console.log('   ❌ Error en upsert:', error.response?.data || error.message);
      
      // Diagnóstico adicional
      if (error.response?.status === 400) {
        console.log('\n🔍 Diagnóstico Error 400:');
        console.log('   • Verificando formato de vector...');
        
        // Verificar longitud del vector
        if (testPoints[0].vector.length !== 1024) {
          console.log(`   ❌ Vector incorrecto: ${testPoints[0].vector.length} dimensiones (esperadas: 1024)`);
        } else {
          console.log('   ✅ Vector tiene 1024 dimensiones');
        }
        
        // Verificar formato de payload
        console.log('   • Formato de payload:', JSON.stringify(testPoints[0].payload, null, 2));
      }
    }
    
    // 4. Test de upsert batch
    console.log('\n📦 4. Test de upsert batch (10 vectores)...');
    const batchPoints = Array(10).fill().map((_, i) => ({
      id: `batch_test_${Date.now()}_${i}`,
      vector: Array(1024).fill().map(() => Math.random() - 0.5),
      payload: {
        text: `Batch test document ${i}`,
        batch_index: i,
        timestamp: new Date().toISOString()
      }
    }));
    
    try {
      const batchResponse = await http.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
        points: batchPoints
      });
      
      if (batchResponse.data.status === 'ok') {
        console.log('   ✅ Upsert batch exitoso');
      } else {
        console.log('   ❌ Upsert batch falló:', batchResponse.data);
      }
    } catch (error) {
      console.log('   ❌ Error en batch upsert:', error.response?.data || error.message);
    }
    
    // 5. Verificar estado final
    console.log('\n📊 5. Estado final de la colección...');
    const finalState = await http.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
    const finalInfo = finalState.data.result;
    
    console.log(`   📊 Vectores totales: ${finalInfo.vectors_count || 0}`);
    console.log(`   💾 Tamaño en disco: ${finalInfo.disk_data_size || 'N/A'}`);
    console.log(`   🔍 Estado: ${finalInfo.status}`);
    
    console.log('\n✅ Diagnóstico completado - Qdrant debería funcionar ahora');
    
  } catch (error) {
    console.error('\n❌ Error en diagnóstico:', error.message);
    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
    }
  }
}

// Función para limpiar tests
async function cleanupTests() {
  console.log('\n🧹 Limpiando datos de test...');
  
  const http = axios.create({ timeout: 10000 });
  
  try {
    // Eliminar puntos de test
    const deleteResponse = await http.post(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
      filter: {
        must: [
          {
            key: "text",
            match: {
              text: "test"
            }
          }
        ]
      }
    });
    
    console.log('✅ Datos de test eliminados');
  } catch (error) {
    console.log('⚠️ No se pudieron eliminar todos los datos de test');
  }
}

// Ejecutar
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--clean')) {
    cleanupTests();
  } else {
    fixQdrant();
  }
}

module.exports = { fixQdrant, cleanupTests };
