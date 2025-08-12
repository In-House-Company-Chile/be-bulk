/**
 * Test simple del servicio de embeddings
 */

const axios = require('axios');

async function testSimple() {
  try {
    console.log('🧪 Test simple del servicio de embeddings...');
    
    const response = await axios.post('http://ms-vector.governare.ai/embed', {
      inputs: "pensión alimenticia hijos menores de edad"
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log('✅ Respuesta recibida');
    console.log('📊 Status:', response.status);
    console.log('📊 Tipo:', typeof response.data);
    console.log('📊 Es array:', Array.isArray(response.data));
    
    if (Array.isArray(response.data)) {
      console.log('📊 Longitud:', response.data.length);
      console.log('📊 Primer elemento:', typeof response.data[0]);
      
      if (response.data.length > 0 && Array.isArray(response.data[0])) {
        console.log('📊 Array anidado - Longitud interna:', response.data[0].length);
      }
    }
    
    console.log('📋 Respuesta completa:', JSON.stringify(response.data, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

testSimple();