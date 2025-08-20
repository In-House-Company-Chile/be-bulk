require('dotenv').config();
const ProcesarDocumentosJSON = require('./functions/ProcesarDocumentosJSON');
const path = require('path');

/**
 * Script principal para procesar el archivo JSON masivo
 */
async function main() {
    try {
        console.log('🚀 Iniciando procesamiento de archivo JSON masivo...\n');

        // Configuración del procesamiento
        const config = {
            // Ruta al archivo JSON (ajusta según tu ubicación)
            jsonFilePath: process.env.JSON_FILE_PATH || 'c:\\Users\\ljutr\\Desktop\\buscadorDB.normas.json',
            
            // Nombre de la colección en Qdrant
            collectionName: process.env.QDRANT_COLLECTION || 'normas_juridicas',
            
            // Opciones de procesamiento
            options: {
                batchSize: parseInt(process.env.BATCH_SIZE) || 25,          // Lotes más pequeños para JSON masivo
                startFrom: parseInt(process.env.START_FROM) || 0,           // Índice para resumir
                maxDocuments: parseInt(process.env.MAX_DOCUMENTS) || null,  // Límite (null = todos)
                logInterval: parseInt(process.env.LOG_INTERVAL) || 50,      // Log cada 50 docs
                pauseBetweenBatches: parseInt(process.env.PAUSE_MS) || 3000 // Pausa 3 segundos entre lotes
            }
        };

        console.log('📋 Configuración del procesamiento:');
        console.log(`   📄 Archivo JSON: ${config.jsonFilePath}`);
        console.log(`   🗂️ Colección: ${config.collectionName}`);
        console.log(`   📦 Tamaño de lote: ${config.options.batchSize}`);
        console.log(`   🎯 Empezar desde: ${config.options.startFrom}`);
        console.log(`   📊 Máximo documentos: ${config.options.maxDocuments || 'Todos'}`);
        console.log(`   ⏱️ Log cada: ${config.options.logInterval} documentos`);
        console.log(`   ⏸️ Pausa entre lotes: ${config.options.pauseBetweenBatches}ms\n`);

        // Verificar que el archivo existe
        const fs = require('fs');
        if (!fs.existsSync(config.jsonFilePath)) {
            throw new Error(`Archivo no encontrado: ${config.jsonFilePath}`);
        }

        // Obtener tamaño del archivo
        const stats = fs.statSync(config.jsonFilePath);
        const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
        console.log(`📏 Tamaño del archivo: ${fileSizeMB} MB\n`);

        // Crear procesador y ejecutar
        const processor = new ProcesarDocumentosJSON(
            config.jsonFilePath,
            config.collectionName,
            config.options
        );

        // Iniciar procesamiento
        await processor.procesarArchivo();

        // Mostrar estadísticas finales
        const stats_final = processor.getStats();
        console.log('\n📊 Estadísticas finales:');
        console.log(`   ✅ Procesados exitosamente: ${stats_final.processedCount.toLocaleString()}`);
        console.log(`   ❌ Errores: ${stats_final.errorCount.toLocaleString()}`);
        console.log(`   ⚠️ Saltados: ${stats_final.skippedCount.toLocaleString()}`);
        console.log(`   📄 Total procesados: ${stats_final.totalProcessed.toLocaleString()}`);

        if (stats_final.errorCount > 0) {
            console.log(`\n📋 Para revisar errores detallados, consulta: errors_${config.collectionName}.log`);
        }

        console.log('\n🎉 Procesamiento completado exitosamente!');

    } catch (error) {
        console.error('\n❌ Error en el procesamiento:', error.message);
        console.error('📋 Stack trace:', error.stack);
        process.exit(1);
    }
}

/**
 * Función para procesar solo una muestra pequeña (para pruebas)
 */
async function procesarMuestra() {
    try {
        console.log('🧪 Procesando muestra de prueba...\n');

        const config = {
            jsonFilePath: process.env.JSON_FILE_PATH || 'c:\\Users\\ljutr\\Desktop\\buscadorDB.normas.json',
            collectionName: 'normas_test', // Colección de prueba
            options: {
                batchSize: 5,
                startFrom: 0,
                maxDocuments: 20, // Solo 20 documentos para prueba
                logInterval: 5,
                pauseBetweenBatches: 1000
            }
        };

        const processor = new ProcesarDocumentosJSON(
            config.jsonFilePath,
            config.collectionName,
            config.options
        );

        await processor.procesarArchivo();
        
        const stats = processor.getStats();
        console.log('\n🧪 Muestra completada:');
        console.log(`   ✅ Procesados: ${stats.processedCount}`);
        console.log(`   ❌ Errores: ${stats.errorCount}`);
        console.log(`   ⚠️ Saltados: ${stats.skippedCount}`);

    } catch (error) {
        console.error('\n❌ Error en la muestra:', error.message);
    }
}

/**
 * Función para resumir un procesamiento interrumpido
 */
async function resumirProcesamiento() {
    try {
        console.log('🔄 Resumiendo procesamiento interrumpido...\n');

        const collectionName = process.env.QDRANT_COLLECTION || 'normas_juridicas';
        
        // El procesador automáticamente cargará el progreso del archivo progress_*.json
        const processor = new ProcesarDocumentosJSON(
            process.env.JSON_FILE_PATH || 'c:\\Users\\ljutr\\Desktop\\buscadorDB.normas.json',
            collectionName,
            {
                batchSize: parseInt(process.env.BATCH_SIZE) || 25,
                logInterval: parseInt(process.env.LOG_INTERVAL) || 50,
                pauseBetweenBatches: parseInt(process.env.PAUSE_MS) || 3000
            }
        );

        await processor.procesarArchivo();
        console.log('\n🎉 Procesamiento resumido completado!');

    } catch (error) {
        console.error('\n❌ Error resumiendo procesamiento:', error.message);
    }
}

// Ejecutar según el argumento de línea de comandos
const command = process.argv[2];

switch (command) {
    case 'muestra':
    case 'test':
        procesarMuestra();
        break;
    case 'resumir':
    case 'resume':
        resumirProcesamiento();
        break;
    case 'completo':
    case 'full':
    default:
        main();
        break;
}

module.exports = {
    main,
    procesarMuestra,
    resumirProcesamiento
};
