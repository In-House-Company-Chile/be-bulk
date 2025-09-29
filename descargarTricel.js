const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * Script para descargar datos de Tricel con paginación automática
 * Maneja cookies dinámicas y guarda resultados en archivos JSON separados por página
 */
class TricelDownloader {
    constructor() {
        this.baseURL = 'https://tricel.lexsoft.cl/tce/rest/archivo/searchBandeja';
        this.pageSize = 100;
        this.outputDir = './tricel_data';
        this.headers = {
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'accept-language': 'es-419,es;q=0.9',
            'Content-Type': 'application/json'
        };
        this.cookies = '';
        this.totalResults = 0;
        this.totalPages = 0;
    }

    /**
     * Configura las cookies para las peticiones
     * @param {string} cookies - String de cookies en formato "key1=value1; key2=value2"
     */
    setCookies(cookies) {
        this.cookies = cookies;
        this.headers['Cookie'] = cookies;
    }

    /**
     * Crea el directorio de salida si no existe
     */
    async createOutputDirectory() {
        try {
            await fs.mkdir(this.outputDir, { recursive: true });
            console.log(`📁 Directorio creado: ${this.outputDir}`);
        } catch (error) {
            console.error('❌ Error creando directorio:', error.message);
            throw error;
        }
    }

    /**
     * Realiza una petición a una página específica
     * @param {number} page - Número de página (empezando en 1)
     * @returns {Object} Respuesta de la API
     */
    async fetchPage(page) {
        const payload = {
            page: page,
            pageSize: this.pageSize,
            query: null,
            facetFilters: {}
        };

        try {
            console.log(`🔄 Descargando página ${page}...`);
            
            const response = await axios.post(this.baseURL, payload, {
                headers: this.headers,
                timeout: 30000 // 30 segundos de timeout
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            return response.data;
        } catch (error) {
            if (error.response) {
                console.error(`❌ Error HTTP ${error.response.status} en página ${page}:`, error.response.data);
                
                // Si es error 401/403, las cookies probablemente expiraron
                if (error.response.status === 401 || error.response.status === 403) {
                    throw new Error('🔐 Cookies expiradas. Por favor, actualiza las cookies y ejecuta nuevamente el script.');
                }
            } else if (error.code === 'ECONNABORTED') {
                console.error(`⏱️ Timeout en página ${page}`);
            } else {
                console.error(`❌ Error de red en página ${page}:`, error.message);
            }
            throw error;
        }
    }

    /**
     * Guarda los datos de una página en un archivo JSON
     * @param {number} page - Número de página
     * @param {Object} data - Datos a guardar
     */
    async savePageData(page, data) {
        const fileName = `tricel_page_${page.toString().padStart(3, '0')}.json`;
        const filePath = path.join(this.outputDir, fileName);
        
        try {
            await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
            console.log(`💾 Guardado: ${fileName} (${data.results.length} resultados)`);
        } catch (error) {
            console.error(`❌ Error guardando página ${page}:`, error.message);
            throw error;
        }
    }

    /**
     * Obtiene información inicial (total de resultados) haciendo la primera petición
     */
    async getInitialInfo() {
        const firstPageData = await this.fetchPage(1);
        this.totalResults = firstPageData.resultsCount;
        this.totalPages = Math.ceil(this.totalResults / this.pageSize);
        
        console.log(`📊 Total de resultados: ${this.totalResults}`);
        console.log(`📄 Total de páginas: ${this.totalPages}`);
        
        return firstPageData;
    }

    /**
     * Descarga todas las páginas de datos
     */
    async downloadAllPages() {
        console.log('🚀 Iniciando descarga de datos de Tricel...\n');

        if (!this.cookies) {
            throw new Error('❌ No se han configurado las cookies. Usa setCookies() primero.');
        }

        await this.createOutputDirectory();
        
        // Obtener información inicial y guardar primera página
        const firstPageData = await this.getInitialInfo();
        await this.savePageData(1, firstPageData);

        // Descargar las páginas restantes
        const downloadPromises = [];
        for (let page = 2; page <= this.totalPages; page++) {
            downloadPromises.push(this.downloadAndSavePage(page));
            
            // Procesar en lotes de 5 para no sobrecargar el servidor
            if (downloadPromises.length >= 5 || page === this.totalPages) {
                await Promise.all(downloadPromises);
                downloadPromises.length = 0; // Limpiar el array
                
                // Pausa breve entre lotes
                if (page < this.totalPages) {
                    console.log('⏳ Pausa breve...');
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }
        }

        console.log('\n✅ Descarga completada!');
        console.log(`📁 Archivos guardados en: ${this.outputDir}`);
        console.log(`📊 Total descargado: ${this.totalResults} resultados en ${this.totalPages} archivos`);
    }

    /**
     * Descarga y guarda una página específica
     * @param {number} page - Número de página
     */
    async downloadAndSavePage(page) {
        try {
            const data = await this.fetchPage(page);
            await this.savePageData(page, data);
        } catch (error) {
            console.error(`❌ Error procesando página ${page}:`, error.message);
            
            // Reintentar una vez después de una pausa
            console.log(`🔄 Reintentando página ${page} en 3 segundos...`);
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            try {
                const data = await this.fetchPage(page);
                await this.savePageData(page, data);
                console.log(`✅ Página ${page} descargada correctamente en el segundo intento`);
            } catch (retryError) {
                console.error(`❌ Error en segundo intento para página ${page}:`, retryError.message);
                // Guardar información del error para revisión posterior
                await this.saveErrorInfo(page, retryError);
            }
        }
    }

    /**
     * Guarda información de errores para revisión posterior
     * @param {number} page - Número de página con error
     * @param {Error} error - Error ocurrido
     */
    async saveErrorInfo(page, error) {
        const errorInfo = {
            page: page,
            timestamp: new Date().toISOString(),
            error: error.message,
            stack: error.stack
        };
        
        const errorFile = path.join(this.outputDir, 'errors.json');
        
        try {
            let errors = [];
            try {
                const existingErrors = await fs.readFile(errorFile, 'utf8');
                errors = JSON.parse(existingErrors);
            } catch (readError) {
                // El archivo no existe, empezar con array vacío
            }
            
            errors.push(errorInfo);
            await fs.writeFile(errorFile, JSON.stringify(errors, null, 2), 'utf8');
        } catch (saveError) {
            console.error('❌ Error guardando información de error:', saveError.message);
        }
    }

    /**
     * Crea un resumen consolidado de todos los datos descargados
     */
    async createSummary() {
        try {
            const files = await fs.readdir(this.outputDir);
            const dataFiles = files.filter(file => file.startsWith('tricel_page_') && file.endsWith('.json'));
            
            let totalProcessed = 0;
            const summary = {
                timestamp: new Date().toISOString(),
                totalFiles: dataFiles.length,
                totalResults: this.totalResults,
                filesProcessed: []
            };

            for (const file of dataFiles.sort()) {
                const filePath = path.join(this.outputDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(content);
                
                totalProcessed += data.results.length;
                summary.filesProcessed.push({
                    file: file,
                    resultsCount: data.results.length,
                    page: parseInt(file.match(/\d+/)[0])
                });
            }

            summary.totalProcessedResults = totalProcessed;
            
            const summaryFile = path.join(this.outputDir, 'summary.json');
            await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
            
            console.log(`📋 Resumen creado: ${summaryFile}`);
            console.log(`📊 Resultados procesados: ${totalProcessed}/${this.totalResults}`);
            
        } catch (error) {
            console.error('❌ Error creando resumen:', error.message);
        }
    }
}

// Función principal para ejecutar el script
async function main() {
    const downloader = new TricelDownloader();
    
    // IMPORTANTE: Configura aquí tus cookies actuales
    // Reemplaza con las cookies válidas obtenidas de tu navegador
    const cookies = 'JSESSIONID=-LXm-AhSbfU+jKU5Sf-Yvdqq; JSESSIONID=+e2dvjOsl2mhWx+hi8XKD3ZP';
    
    console.log('🔐 Configurando cookies...');
    downloader.setCookies(cookies);
    
    try {
        await downloader.downloadAllPages();
        await downloader.createSummary();
        
        console.log('\n🎉 ¡Proceso completado exitosamente!');
        
    } catch (error) {
        console.error('\n💥 Error durante la ejecución:', error.message);
        
        if (error.message.includes('Cookies expiradas')) {
            console.log('\n🔧 Solución:');
            console.log('1. Abre tu navegador y ve a https://tricel.lexsoft.cl');
            console.log('2. Abre las herramientas de desarrollador (F12)');
            console.log('3. Ve a la pestaña Network/Red');
            console.log('4. Realiza una búsqueda en la página');
            console.log('5. Busca la petición a "searchBandeja"');
            console.log('6. Copia las cookies del header "Cookie"');
            console.log('7. Actualiza la variable "cookies" en este script');
            console.log('8. Ejecuta el script nuevamente');
        }
        
        process.exit(1);
    }
}

// Ejecutar solo si es llamado directamente
if (require.main === module) {
    main().catch(console.error);
}

module.exports = TricelDownloader;
