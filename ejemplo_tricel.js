/**
 * Ejemplo simple de uso del descargador de Tricel
 * Ejecuta: node ejemplo_tricel.js
 */

const TricelDownloader = require('./descargarTricel');

async function ejecutarDescarga() {
    console.log('🚀 Iniciando descarga de datos de Tricel...\n');
    
    const downloader = new TricelDownloader();
    
    // PASO 1: Actualiza estas cookies con las tuyas actuales
    // Para obtener las cookies:
    // 1. Ve a https://tricel.lexsoft.cl en tu navegador
    // 2. Abre DevTools (F12) → Network
    // 3. Realiza una búsqueda
    // 4. Busca la petición 'searchBandeja'
    // 5. Copia el valor del header 'Cookie'
    
    const cookies = 'JSESSIONID=-LXm-AhSbfU+jKU5Sf-Yvdqq; JSESSIONID=+e2dvjOsl2mhWx+hi8XKD3ZP';
    
    downloader.setCookies(cookies);
    
    try {
        // PASO 2: Descargar todos los datos
        await downloader.downloadAllPages();
        
        // PASO 3: Crear resumen
        await downloader.createSummary();
        
        console.log('\n✅ ¡Descarga completada exitosamente!');
        console.log('📁 Revisa la carpeta ./tricel_data/ para ver los archivos descargados');
        
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        
        if (error.message.includes('Cookies expiradas')) {
            console.log('\n💡 Las cookies han expirado. Actualízalas siguiendo estos pasos:');
            console.log('1. Abre https://tricel.lexsoft.cl en tu navegador');
            console.log('2. Presiona F12 para abrir DevTools');
            console.log('3. Ve a la pestaña "Network" o "Red"');
            console.log('4. Realiza cualquier búsqueda en la página');
            console.log('5. Busca la petición que contiene "searchBandeja"');
            console.log('6. En los headers de la petición, copia el valor completo de "Cookie"');
            console.log('7. Reemplaza la variable "cookies" en este archivo');
            console.log('8. Ejecuta nuevamente: node ejemplo_tricel.js');
        }
    }
}

// Ejecutar el ejemplo
if (require.main === module) {
    ejecutarDescarga();
}
