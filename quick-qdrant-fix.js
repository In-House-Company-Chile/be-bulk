const axios = require('axios');
const { v4: uuidv4 } = require('uuid');

const QDRANT_URL = 'http://localhost:6333';
const COLLECTION_NAME = 'test_jurisprudencia_3';

async function quickFix() {
  console.log('🔧 === ARREGLO RÁPIDO DE QDRANT ===\n');
  
  try {
    // 1. Verificar si la colección existe
    console.log('🔍 Verificando colección...');
    try {
      const response = await axios.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
      console.log('✅ Colección existe');
      console.log(`📊 Vectores: ${response.data.result.vectors_count}`);
      console.log(`📏 Config:`, JSON.stringify(response.data.result.config.params.vectors, null, 2));
    } catch (error) {
      if (error.response?.status === 404) {
        console.log('❌ Colección no existe, creando...');
        
        await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
          vectors: {
            size: 1024,
            distance: "Cosine"
          }
        });
        
        console.log('✅ Colección creada');
      } else {
        throw error;
      }
    }
    
    // 2. Test simple de upsert
    console.log('\n🧪 Test de upsert simple...');
    const testPoint = {
      id: uuidv4(),
      vector: Array(1024).fill(0.1),
      payload: {
        text: "Test",
        timestamp: new Date().toISOString()
      }
    };
    
    try {
      await axios.put(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points`, {
        points: [testPoint]
      });
      console.log('✅ Upsert simple exitoso');
    } catch (error) {
      console.log('❌ Error en upsert:', error.response?.data || error.message);
      
      // Mostrar detalles del error
      if (error.response?.data) {
        console.log('📋 Detalles del error:');
        console.log(JSON.stringify(error.response.data, null, 2));
      }
    }
    
    // 3. Verificar estado final
    const finalCheck = await axios.get(`${QDRANT_URL}/collections/${COLLECTION_NAME}`);
    console.log(`\n📊 Estado final: ${finalCheck.data.result.vectors_count} vectores`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.response?.data) {
      console.error('📋 Detalles:', JSON.stringify(error.response.data, null, 2));
    }
  }
}

quickFix();
