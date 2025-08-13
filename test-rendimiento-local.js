/**
 * Script de prueba específico para configuración local
 * Prueba el rendimiento con servicios locales (Qdrant + GPU RTX 3060)
 */

require('dotenv').config();
const { indexarDocumentosExternos } = require('./puca copy.js');
const fs = require('fs');

// Configuración para tu setup local
const CARPETA_DOCUMENTOS = process.env.FOLDER;
const COLECCION_QDRANT = process.env.QDRANT_COLLECTION;
const TIPO_BASE = process.env.BASE_NAME;

async function testRendimientoLocal() {
  try {
    console.log(`🚀 === PRUEBA DE RENDIMIENTO LOCAL ===\n`);
    
    // Verificar carpeta
    if (!fs.existsSync(CARPETA_DOCUMENTOS)) {
      console.error(`❌ La carpeta no existe: ${CARPETA_DOCUMENTOS}`);
      return;
    }

    const archivos = fs.readdirSync(CARPETA_DOCUMENTOS).filter(file => file.endsWith('.json'));
    console.log(`📊 Archivos encontrados: ${archivos.length}`);
    
    // Limitar a 50 documentos para la prueba
    const limitePrueba = Math.min(archivos.length, 50);
    console.log(`🧪 Probando con ${limitePrueba} documentos\n`);

    // Configuración ultra-optimizada para local
    const options = {
      extensions: ['.json'],
      recursive: false,
      processedDir: null,
      
      indexPinecone: false,
      indexMongo: false,
      indexQdrant: true,
      qdrantCollection: COLECCION_QDRANT,
      
      // Configuración ultra-rápida sin pausas
      batchSize: 25,           // Lotes grandes pero manejables
      maxConcurrency: 12,      // Alta paralelización para local
      delayBetweenBatches: 0,  // SIN pausas entre lotes
      delayBetweenItems: 0     // SIN pausas entre items
    };

    console.log(`⚙️ Configuración de prueba:`);
    console.log(`   📦 Lote: ${options.batchSize} docs`);
    console.log(`   🔄 Concurrencia: ${options.maxConcurrency} lotes paralelos`);
    console.log(`   ⏱️ Pausas: DESACTIVADAS (0ms)`);
    console.log(`   🎯 Target: >100 docs/min\n`);

    // Crear carpeta temporal con subset de archivos para la prueba
    const carpetaPrueba = CARPETA_DOCUMENTOS + '_prueba';
    if (fs.existsSync(carpetaPrueba)) {
      fs.rmSync(carpetaPrueba, { recursive: true });
    }
    fs.mkdirSync(carpetaPrueba);

    // Copiar archivos de prueba
    for (let i = 0; i < limitePrueba; i++) {
      const archivo = archivos[i];
      fs.copyFileSync(
        `${CARPETA_DOCUMENTOS}/${archivo}`, 
        `${carpetaPrueba}/${archivo}`
      );
    }

    console.log(`🔄 Iniciando prueba de rendimiento...\n`);
    const startTime = Date.now();

    // Ejecutar indexación
    const result = await indexarDocumentosExternos(
      carpetaPrueba,
      COLECCION_QDRANT,
      TIPO_BASE,
      options
    );

    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 60000; // minutos

    // Limpiar carpeta temporal
    fs.rmSync(carpetaPrueba, { recursive: true });

    // Mostrar resultados
    console.log(`\n🎉 === RESULTADOS DE PRUEBA ===`);
    
    if (result.success) {
      const velocidadReal = Math.round(result.processed / totalTime);
      
      console.log(`✅ Estado: ÉXITO`);
      console.log(`📊 Documentos procesados: ${result.processed}/${limitePrueba}`);
      console.log(`🚀 Velocidad real: ${velocidadReal} docs/min`);
      console.log(`⏰ Tiempo total: ${totalTime.toFixed(2)} minutos`);
      console.log(`📈 Tasa de éxito: ${((result.processed / limitePrueba) * 100).toFixed(1)}%`);
      
      if (result.errors > 0) {
        console.log(`❌ Errores: ${result.errors}`);
      }

      // Evaluación del rendimiento
      console.log(`\n📊 === EVALUACIÓN ===`);
      if (velocidadReal >= 100) {
        console.log(`🎯 EXCELENTE: ${velocidadReal} docs/min - Tu configuración local es óptima!`);
        console.log(`💡 Recomendación: Usa 'node indexar-qdrant-optimizado.js ultra' para máximo rendimiento`);
      } else if (velocidadReal >= 60) {
        console.log(`✅ BUENO: ${velocidadReal} docs/min - Rendimiento sólido para servicios locales`);
        console.log(`💡 Recomendación: Usa 'node indexar-qdrant-optimizado.js local'`);
      } else if (velocidadReal >= 30) {
        console.log(`⚠️ MODERADO: ${velocidadReal} docs/min - Considera optimizar configuración`);
        console.log(`💡 Recomendación: Verifica que Qdrant y el servicio de embeddings estén corriendo localmente`);
      } else {
        console.log(`❌ LENTO: ${velocidadReal} docs/min - Hay problemas de rendimiento`);
        console.log(`💡 Recomendación: Verifica la configuración de servicios y GPU`);
      }

      // Proyección para volumen completo
      if (archivos.length > limitePrueba) {
        const tiempoCompleto = (archivos.length / velocidadReal).toFixed(1);
        console.log(`\n🔮 Proyección para ${archivos.length} documentos: ~${tiempoCompleto} minutos`);
      }
      
    } else {
      console.log(`❌ Estado: ERROR`);
      console.log(`💥 Mensaje: ${result.message}`);
    }

  } catch (error) {
    console.error(`💥 Error en prueba:`, error.message);
  }
}

// Ejecutar si es el archivo principal
if (require.main === module) {
  testRendimientoLocal().catch(console.error);
}

module.exports = { testRendimientoLocal };