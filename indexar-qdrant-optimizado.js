require('dotenv').config();

// Importar funciones
const { indexarDocumentosExternos } = require('./puca copy.js');
const { getConfiguracion, calcularRendimientoEstimado } = require('./configuraciones-rendimiento.js');
const fs = require('fs');

// Configuración
const CARPETA_DOCUMENTOS = 'C:/Users/kathe/Desktop/Leo/sentencias/test';
// const CARPETA_DOCUMENTOS = 'C:/Users/kathe/Desktop/Leo/sentencias/ca_vm1_parte2/parte2';
const COLECCION_QDRANT = 'test_jurisprudencia_2';
const TIPO_BASE = 'corte_de_apelaciones';

// Obtener configuración desde argumentos de línea de comandos
const tipoConfiguracion = process.argv[2] || 'balanceada';

/**
 * Función principal
 */
async function main() {
  try {
    console.log(`🚀 === INDEXACIÓN QDRANT OPTIMIZADA ===\n`);
    
    // Verificar configuración de servicios
    const qdrantUrl = process.env.QDRANT_URL || 'http://ms-qdrant-8f82e7cd-8cc2.governare.ai';
    const embeddingUrl = process.env.EMBEDDING_URL || 'http://ms-vector.governare.ai/embed';
    
    console.log(`🔧 Configuración de servicios:`);
    console.log(`   🎯 Qdrant URL: ${qdrantUrl}`);
    console.log(`   🧠 Embedding URL: ${embeddingUrl}`);
    console.log(`   📂 Carpeta: ${CARPETA_DOCUMENTOS}`);
    console.log(`   📦 Colección: ${COLECCION_QDRANT}`);
    console.log(`   🏷️ Tipo de base: ${TIPO_BASE}\n`);
    
    // Verificar que la carpeta existe
    if (!fs.existsSync(CARPETA_DOCUMENTOS)) {
      console.error(`❌ La carpeta no existe: ${CARPETA_DOCUMENTOS}`);
      console.log(`💡 Por favor, actualiza la variable CARPETA_DOCUMENTOS en este archivo`);
      process.exit(1);
    }

    // Contar archivos para estimación
    const archivos = fs.readdirSync(CARPETA_DOCUMENTOS).filter(file => file.endsWith('.json'));
    console.log(`📊 Archivos encontrados: ${archivos.length}\n`);

    // Obtener configuración de rendimiento
    const configRendimiento = getConfiguracion(tipoConfiguracion);
    
    // Calcular estimación de rendimiento
    calcularRendimientoEstimado(configRendimiento, archivos.length);

    // Confirmar antes de proceder
    console.log(`\n❓ ¿Continuar con esta configuración? (Presiona Ctrl+C para cancelar)`);
    console.log(`⏳ Iniciando en 5 segundos...\n`);
    
    await new Promise(resolve => setTimeout(resolve, 5000));

    // Configurar opciones completas
    const options = {
      // Opciones de carga de archivos
      extensions: ['.json'],
      recursive: true,
      processedDir: null,
      
      // Opciones de indexación
      indexPinecone: false,
      indexMongo: false,
      indexQdrant: true,
      qdrantCollection: COLECCION_QDRANT,
      
      // Configuración de rendimiento
      ...configRendimiento
    };

    console.log(`🔄 === INICIANDO INDEXACIÓN ===\n`);
    
    // Ejecutar indexación con monitoreo en tiempo real
    const startTime = Date.now();
    const result = await indexarDocumentosExternos(
      CARPETA_DOCUMENTOS, 
      COLECCION_QDRANT, 
      TIPO_BASE, 
      options
    );

    // Mostrar resultados finales
    const endTime = Date.now();
    const totalTime = (endTime - startTime) / 60000; // minutos

    console.log(`\n🎉 === INDEXACIÓN COMPLETADA ===`);
    
    if (result.success) {
      console.log(`✅ Estado: ÉXITO`);
      console.log(`📊 Documentos procesados: ${result.processed}/${result.total}`);
      console.log(`🚀 Velocidad real: ${result.documentsPerMinute || Math.round(result.processed / totalTime)} docs/min`);
      console.log(`⏰ Tiempo total: ${totalTime.toFixed(1)} minutos`);
      console.log(`📈 Tasa de éxito: ${((result.processed / result.total) * 100).toFixed(1)}%`);
      
      if (result.errors > 0) {
        console.log(`❌ Errores: ${result.errors} (${((result.errors / result.total) * 100).toFixed(1)}%)`);
      }
      
      if (result.skipped > 0) {
        console.log(`⏭️ Omitidos: ${result.skipped} (${((result.skipped / result.total) * 100).toFixed(1)}%)`);
      }

      // Comparar con estimación
      const velocidadReal = result.documentsPerMinute || Math.round(result.processed / totalTime);
      const estimacion = calcularRendimientoEstimado(configRendimiento, result.total);
      const diferencia = ((velocidadReal - estimacion.documentosPorMinuto) / estimacion.documentosPorMinuto * 100).toFixed(1);
      
      console.log(`\n📊 Comparación con estimación:`);
      console.log(`   🎯 Estimado: ${estimacion.documentosPorMinuto} docs/min`);
      console.log(`   ✅ Real: ${velocidadReal} docs/min`);
      console.log(`   📈 Diferencia: ${diferencia > 0 ? '+' : ''}${diferencia}%`);
      
    } else {
      console.log(`❌ Estado: ERROR`);
      console.log(`💥 Mensaje: ${result.message}`);
      process.exit(1);
    }

  } catch (error) {
    console.error(`\n💥 Error crítico:`, error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Ejecutar si es el archivo principal
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { main };