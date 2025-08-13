const axios = require('axios');

// Posibles endpoints para el servicio de embeddings
const POSSIBLE_ENDPOINTS = [
  '',
  '/embed',
  '/embeddings',
  '/v1/embed',
  '/v1/embeddings',
  '/api/embed',
  '/api/embeddings',
  '/api/v1/embed',
  '/encode',
  '/inference',
  '/predict'
];

const BASE_URL = 'http://localhost:11441';
const TEST_TEXT = 'prueba de embedding';

async function findWorkingEndpoint() {
  console.log('🔍 Buscando endpoint correcto para embeddings...\n');
  
  const http = axios.create({ timeout: 5000 });
  
  // Primero verificar conectividad básica
  console.log('📡 Verificando conectividad básica:');
  try {
    const response = await http.get(BASE_URL);
    console.log(`✅ Servicio responde: ${response.status}`);
    if (response.data) {
      console.log(`📊 Respuesta:`, JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.log(`❌ Servicio no responde: ${error.message}`);
    return;
  }
  
  console.log('\n🔍 Probando endpoints de embeddings:');
  
  // Probar cada endpoint posible
  for (const endpoint of POSSIBLE_ENDPOINTS) {
    const url = `${BASE_URL}${endpoint}`;
    const displayUrl = endpoint || '/ (raíz)';
    
    try {
      // Probar GET primero
      try {
        const getResponse = await http.get(url);
        console.log(`✅ GET ${displayUrl}: ${getResponse.status} - ${JSON.stringify(getResponse.data).substring(0, 100)}...`);
      } catch (getError) {
        // Si GET falla, probar POST
        if (getError.response?.status === 405) {
          console.log(`⚠️  GET ${displayUrl}: Method not allowed, probando POST...`);
        }
      }
      
      // Probar POST con datos de embedding
      const postResponse = await http.post(url, {
        inputs: TEST_TEXT
      }, {
        headers: { 'Content-Type': 'application/json' }
      });
      
      console.log(`🎯 ¡ENCONTRADO! POST ${displayUrl}: ${postResponse.status}`);
      
      // Verificar si la respuesta parece un embedding
      const data = postResponse.data;
      if (Array.isArray(data) && typeof data[0] === 'number') {
        console.log(`   📊 Embedding válido: ${data.length} dimensiones`);
        console.log(`   🎉 URL CORRECTA: ${url}`);
        return url;
      } else if (Array.isArray(data) && Array.isArray(data[0])) {
        console.log(`   📊 Batch embedding válido: ${data[0].length} dimensiones`);
        console.log(`   🎉 URL CORRECTA: ${url}`);
        return url;
      } else {
        console.log(`   ⚠️  Respuesta no parece embedding: ${JSON.stringify(data).substring(0, 100)}...`);
      }
      
    } catch (error) {
      if (error.response) {
        console.log(`❌ ${displayUrl}: ${error.response.status} - ${error.response.statusText}`);
      } else {
        console.log(`❌ ${displayUrl}: ${error.message}`);
      }
    }
  }
  
  console.log('\n❌ No se encontró un endpoint válido para embeddings');
  
  // Sugerencias adicionales
  console.log('\n💡 Sugerencias:');
  console.log('1. Verificar logs del contenedor de embeddings:');
  console.log('   docker logs <container_id>');
  console.log('2. Verificar documentación del servicio:');
  console.log('   curl http://localhost:11441/docs');
  console.log('3. Verificar variables de entorno del contenedor');
  console.log('4. Verificar si el servicio necesita autenticación');
}

// Función para probar un endpoint específico
async function testSpecificEndpoint(endpoint) {
  const url = `${BASE_URL}${endpoint}`;
  console.log(`🧪 Probando endpoint específico: ${url}`);
  
  const http = axios.create({ timeout: 10000 });
  
  try {
    const response = await http.post(url, {
      inputs: TEST_TEXT
    }, {
      headers: { 'Content-Type': 'application/json' }
    });
    
    console.log(`✅ Éxito: ${response.status}`);
    console.log(`📊 Respuesta:`, JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
    if (error.response) {
      console.log(`   Status: ${error.response.status}`);
      console.log(`   Data:`, error.response.data);
    }
  }
}

// Ejecutar
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length > 0) {
    testSpecificEndpoint(args[0]);
  } else {
    findWorkingEndpoint();
  }
}

module.exports = { findWorkingEndpoint, testSpecificEndpoint };
