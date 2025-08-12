/**
 * Configuraciones predefinidas para diferentes escenarios de rendimiento
 * Úsalas según tu hardware y necesidades de velocidad
 */

// 🐌 CONFIGURACIÓN CONSERVADORA
// Para sistemas con recursos limitados o servicios lentos
const CONSERVADORA = {
  batchSize: 10,           // Pocos documentos por lote
  maxConcurrency: 2,       // Poca paralelización
  delayBetweenBatches: 3000, // Pausas largas
  delayBetweenItems: 800   // Más tiempo entre documentos
};

// ⚡ CONFIGURACIÓN BALANCEADA (RECOMENDADA)
// Balance entre velocidad y estabilidad
const BALANCEADA = {
  batchSize: 20,           // Lotes medianos
  maxConcurrency: 3,       // Paralelización moderada
  delayBetweenBatches: 2000, // Pausas moderadas
  delayBetweenItems: 300   // Tiempo normal entre documentos
};

// 🚀 CONFIGURACIÓN AGRESIVA
// Para sistemas potentes y servicios rápidos
const AGRESIVA = {
  batchSize: 30,           // Lotes grandes
  maxConcurrency: 5,       // Alta paralelización
  delayBetweenBatches: 1000, // Pausas cortas
  delayBetweenItems: 100   // Tiempo mínimo entre documentos
};

// 🔥 CONFIGURACIÓN MÁXIMA
// Para sistemas potentes con servicios remotos
const MAXIMA = {
  batchSize: 50,           // Lotes muy grandes
  maxConcurrency: 8,       // Máxima paralelización
  delayBetweenBatches: 500,  // Pausas mínimas
  delayBetweenItems: 50    // Tiempo mínimo absoluto
};

// ⚡ CONFIGURACIÓN LOCAL (NUEVA - SIN PAUSAS)
// Para servicios completamente locales (Qdrant local + GPU local)
const LOCAL = {
  batchSize: 30,           // Lotes grandes pero manejables
  maxConcurrency: 10,      // Alta paralelización
  delayBetweenBatches: 0,  // SIN pausas entre lotes
  delayBetweenItems: 0     // SIN pausas entre items
};

// 🚀 CONFIGURACIÓN ULTRA-RÁPIDA
// Para servicios locales con GPU potente (RTX 3060+)
const ULTRA_RAPIDA = {
  batchSize: 40,           // Lotes muy grandes
  maxConcurrency: 15,      // Máxima paralelización posible
  delayBetweenBatches: 0,  // SIN pausas entre lotes
  delayBetweenItems: 0     // SIN pausas entre items
};

// 🧪 CONFIGURACIÓN DE PRUEBA
// Para hacer pruebas rápidas con pocos documentos
const PRUEBA = {
  batchSize: 5,            // Lotes pequeños
  maxConcurrency: 2,       // Baja paralelización
  delayBetweenBatches: 1000, // Pausas cortas
  delayBetweenItems: 200   // Tiempo corto
};

/**
 * Función para obtener configuración según el tipo
 */
function getConfiguracion(tipo = 'balanceada') {
  const configuraciones = {
    'conservadora': CONSERVADORA,
    'balanceada': BALANCEADA,
    'agresiva': AGRESIVA,
    'maxima': MAXIMA,
    'local': LOCAL,
    'ultra': ULTRA_RAPIDA,
    'ultrarapida': ULTRA_RAPIDA,
    'prueba': PRUEBA
  };

  const config = configuraciones[tipo.toLowerCase()];
  if (!config) {
    console.log(`⚠️ Configuración '${tipo}' no encontrada. Usando 'balanceada'.`);
    return BALANCEADA;
  }

  console.log(`🎯 Usando configuración: ${tipo.toUpperCase()}`);
  console.log(`   📦 Lote: ${config.batchSize} docs`);
  console.log(`   🔄 Concurrencia: ${config.maxConcurrency} lotes paralelos`);
  console.log(`   ⏱️ Pausa entre lotes: ${config.delayBetweenBatches}ms`);
  console.log(`   ⏱️ Pausa entre items: ${config.delayBetweenItems}ms`);
  
  return config;
}

/**
 * Función para calcular rendimiento estimado
 */
function calcularRendimientoEstimado(config, totalDocumentos) {
  // Tiempo estimado por documento (incluyendo procesamiento + pausas)
  const tiempoPorDocumento = (config.delayBetweenItems + 2000) / 1000; // 2s estimado de procesamiento
  const documentosPorLote = config.batchSize;
  const tiempoPorLote = (documentosPorLote * tiempoPorDocumento) + (config.delayBetweenBatches / 1000);
  const lotesPorMinuto = 60 / tiempoPorLote;
  const documentosPorMinuto = Math.round(lotesPorMinuto * documentosPorLote * config.maxConcurrency);
  const tiempoTotalMinutos = Math.round(totalDocumentos / documentosPorMinuto);

  console.log(`\n📊 ESTIMACIÓN DE RENDIMIENTO:`);
  console.log(`   🚀 Velocidad estimada: ${documentosPorMinuto} docs/min`);
  console.log(`   ⏰ Tiempo total estimado: ${tiempoTotalMinutos} minutos`);
  console.log(`   📈 Eficiencia: ${config.maxConcurrency}x paralelización`);

  return {
    documentosPorMinuto,
    tiempoTotalMinutos,
    eficiencia: config.maxConcurrency
  };
}

module.exports = {
  CONSERVADORA,
  BALANCEADA,
  AGRESIVA,
  MAXIMA,
  LOCAL,
  ULTRA_RAPIDA,
  PRUEBA,
  getConfiguracion,
  calcularRendimientoEstimado
};