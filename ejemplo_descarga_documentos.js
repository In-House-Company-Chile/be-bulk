/**
 * Ejemplo simple para descargar documentos PDF de Tricel
 * Ejecuta: node ejemplo_descarga_documentos.js
 */

const TricelDocumentDownloader = require('./descargarDocumentosTricel');

async function ejecutarDescargaDocumentos() {
    console.log('🚀 Iniciando descarga de documentos PDF de Tricel...\n');
    
    const downloader = new TricelDocumentDownloader();
    
    // PASO 1: Actualiza estas cookies con las tuyas actuales
    // Deben ser las mismas que usaste para descargar los datos iniciales
    const cookies = 'JSESSIONID=-LXm-AhSbfU+jKU5Sf-Yvdqq; JSESSIONID=+e2dvjOsl2mhWx+hi8XKD3ZP';
    
    downloader.setCookies(cookies);
    
    try {
        // PASO 2: Crear directorios necesarios
        await downloader.createOutputDirectories();
        
        // PASO 2.5: Verificar estado del checkpoint
        console.log('🔍 Verificando estado de descarga previa...');
        const status = await downloader.showCheckpointInfo();
        
        // Si ya está completado, mostrar opciones
        if (status.isCompleted) {
            console.log('⚠️  La descarga ya está completada.');
            console.log('\n💡 Opciones disponibles:');
            console.log('1. Para reiniciar desde el principio:');
            console.log('   - Elimina el archivo: ./tricel_documentos/logs/checkpoint.json');
            console.log('   - O usa: await downloader.clearCheckpoint()');
            console.log('2. Para verificar archivos descargados:');
            console.log('   - Revisa: ./tricel_documentos/');
            return;
        }
        
        // PASO 3: Cargar datos previamente descargados
        console.log('📚 Cargando datos de Tricel...');
        const tricelData = await downloader.loadTricelData();
        
        if (tricelData.length === 0) {
            throw new Error('❌ No se encontraron datos. Ejecuta primero: node ejemplo_tricel.js');
        }

        console.log(`📊 Se encontraron ${tricelData.length} casos para procesar\n`);

        // PASO 4: Configurar opciones de descarga
        const opciones = {
            downloadEscritos: true,      // ¿Descargar escritos de ingreso?
            downloadSentencias: true,    // ¿Descargar sentencias?
            batchSize: 2,               // Documentos por lote (ajustar según velocidad deseada)
            delayBetweenBatches: 3000   // Pausa entre lotes en milisegundos
        };

        console.log('⚙️  Configuración de descarga:');
        console.log(`   📝 Escritos de ingreso: ${opciones.downloadEscritos ? 'Sí' : 'No'}`);
        console.log(`   ⚖️  Sentencias: ${opciones.downloadSentencias ? 'Sí' : 'No'}`);
        console.log(`   🔄 Lote: ${opciones.batchSize} documentos`);
        console.log(`   ⏱️  Pausa: ${opciones.delayBetweenBatches}ms\n`);

        // PASO 5: Descargar todos los documentos (con soporte de reanudación)
        await downloader.downloadAllDocuments(tricelData, opciones);
        
        // PASO 6: Crear resumen final
        const resumen = await downloader.createFinalSummary(tricelData);
        
        console.log('\n✅ ¡Descarga completada exitosamente!');
        console.log(`📊 Documentos descargados: ${resumen.documentsDownloaded}`);
        console.log(`⏭️  Documentos ya existían: ${resumen.documentsSkipped}`);
        console.log(`❌ Errores: ${resumen.errors}`);
        console.log('\n📁 Estructura de archivos creada:');
        console.log(`   ${downloader.outputDir}/`);
        console.log(`   ├── escritos_ingreso/     (Documentos de ingreso)`);
        console.log(`   ├── sentencias/           (Documentos de sentencias)`);
        console.log(`   └── logs/                 (Metadatos, errores y checkpoint)`);
        console.log(`       ├── checkpoint.json          (Estado de la descarga)`);
        console.log(`       ├── documentos_descargados.json`);
        console.log(`       └── errores_descarga.json`);
        
        if (resumen.errors > 0) {
            console.log(`\n⚠️  Se produjeron ${resumen.errors} errores.`);
            console.log(`   Revisa: ${downloader.outputDir}/logs/errores_descarga.json`);
        }
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        
        if (error.message.includes('No se encontraron datos')) {
            console.log('\n💡 Solución:');
            console.log('1. Primero ejecuta: node ejemplo_tricel.js');
            console.log('2. Espera a que termine la descarga de datos');
            console.log('3. Luego ejecuta: node ejemplo_descarga_documentos.js');
        }
        
        if (error.message.includes('Cookies expiradas') || 
            error.message.includes('COOKIES_EXPIRED') ||
            error.message.includes('401') || 
            error.message.includes('403')) {
            console.log('\n🔄 PROCESO DE REANUDACIÓN CON COOKIES ACTUALIZADAS:');
            console.log('1. Actualiza las cookies:');
            console.log('   - Ve a https://tricel.lexsoft.cl en tu navegador');
            console.log('   - Abre DevTools (F12) → Network');
            console.log('   - Intenta descargar cualquier documento');
            console.log('   - Busca una petición a "download/"');
            console.log('   - Copia las cookies del header "Cookie"');
            console.log('2. Actualiza la variable "cookies" en este archivo');
            console.log('3. Ejecuta nuevamente: node ejemplo_descarga_documentos.js');
            console.log('4. ✅ El proceso se reanudará automáticamente desde donde se detuvo');
            console.log('\n💡 No necesitas empezar desde cero - el checkpoint guardará tu progreso');
        }
    }
}

// UTILIDADES ADICIONALES PARA MANEJO DE CHECKPOINT

/**
 * Función para verificar solo el estado del checkpoint sin ejecutar descarga
 */
async function verificarEstado() {
    const downloader = new TricelDocumentDownloader();
    await downloader.createOutputDirectories();
    
    const status = await downloader.showCheckpointInfo();
    
    if (status.hasCheckpoint && !status.isCompleted) {
        console.log('🔄 Puedes reanudar la descarga ejecutando:');
        console.log('   node ejemplo_descarga_documentos.js');
    }
    
    return status;
}

/**
 * Función para limpiar checkpoint y empezar desde cero
 */
async function reiniciarDescarga() {
    console.log('🗑️  Limpiando checkpoint para reiniciar...');
    
    const downloader = new TricelDocumentDownloader();
    await downloader.createOutputDirectories();
    await downloader.clearCheckpoint();
    
    console.log('✅ Checkpoint eliminado. Ahora puedes ejecutar:');
    console.log('   node ejemplo_descarga_documentos.js');
}

// CONFIGURACIONES AVANZADAS (opcional)
async function configuracionPersonalizada() {
    const downloader = new TricelDocumentDownloader();
    
    // Personalizar directorios
    downloader.outputDir = './mis_documentos_tricel';
    
    // Configurar cookies
    downloader.setCookies('TUS_COOKIES_AQUI');
    
    // Cargar datos
    const datos = await downloader.loadTricelData();
    
    // Descargar solo los primeros 10 casos (para pruebas)
    const datosPrueba = datos.slice(0, 10);
    
    // Solo sentencias, sin escritos de ingreso
    const opciones = {
        downloadEscritos: false,
        downloadSentencias: true,
        batchSize: 1,
        delayBetweenBatches: 5000
    };
    
    await downloader.downloadAllDocuments(datosPrueba, opciones);
}

// Ejecutar el ejemplo principal
if (require.main === module) {
    ejecutarDescargaDocumentos();
    
    // EJEMPLOS DE USO DE UTILIDADES:
    
    // Para verificar solo el estado sin descargar:
    // verificarEstado();
    
    // Para limpiar checkpoint y empezar desde cero:
    // reiniciarDescarga();
    
    // Para configuración personalizada:
    // configuracionPersonalizada();
}
