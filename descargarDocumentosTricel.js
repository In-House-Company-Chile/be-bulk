const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');

/**
 * Script para descargar documentos PDF de Tricel basado en los datos extraídos
 * Descarga tanto documentoEscritoIngresoId como documentoSentenciaId
 */
class TricelDocumentDownloader {
    constructor() {
        this.baseURL = 'https://tricel.lexsoft.cl/tce/download/';
        this.inputDir = './tricel_data';
        this.outputDir = './tricel_documentos';
        this.headers = {
            'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
            'accept-language': 'es-419,es;q=0.9'
        };
        this.cookies = '';
        this.downloadedCount = 0;
        this.errorCount = 0;
        this.skippedCount = 0;
        
        // Sistema de checkpoint para reanudar descargas
        this.checkpointFile = path.join(this.outputDir, 'logs', 'checkpoint.json');
        this.checkpoint = {
            lastProcessedIndex: -1,
            lastProcessedCaseId: null,
            totalCases: 0,
            startTime: null,
            lastUpdateTime: null,
            completed: false
        };
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
     * Crea los directorios de salida si no existen
     */
    async createOutputDirectories() {
        const dirs = [
            this.outputDir,
            path.join(this.outputDir, 'escritos_ingreso'),
            path.join(this.outputDir, 'sentencias'),
            path.join(this.outputDir, 'logs')
        ];

        for (const dir of dirs) {
            try {
                await fs.mkdir(dir, { recursive: true });
                console.log(`📁 Directorio creado: ${dir}`);
            } catch (error) {
                console.error(`❌ Error creando directorio ${dir}:`, error.message);
                throw error;
            }
        }
    }

    /**
     * Carga el checkpoint existente si existe
     * @returns {Object} Checkpoint cargado o checkpoint inicial
     */
    async loadCheckpoint() {
        try {
            const checkpointData = await fs.readFile(this.checkpointFile, 'utf8');
            this.checkpoint = JSON.parse(checkpointData);
            console.log(`🔄 Checkpoint cargado: Último caso procesado en índice ${this.checkpoint.lastProcessedIndex}`);
            return this.checkpoint;
        } catch (error) {
            // El archivo no existe, usar checkpoint inicial
            console.log('📍 No se encontró checkpoint previo, iniciando desde el principio');
            return this.checkpoint;
        }
    }

    /**
     * Guarda el checkpoint actual
     * @param {number} processedIndex - Índice del último caso procesado
     * @param {number} caseId - ID del último caso procesado
     */
    async saveCheckpoint(processedIndex, caseId) {
        this.checkpoint.lastProcessedIndex = processedIndex;
        this.checkpoint.lastProcessedCaseId = caseId;
        this.checkpoint.lastUpdateTime = new Date().toISOString();

        try {
            await fs.writeFile(this.checkpointFile, JSON.stringify(this.checkpoint, null, 2), 'utf8');
        } catch (error) {
            console.error('❌ Error guardando checkpoint:', error.message);
        }
    }

    /**
     * Marca el checkpoint como completado
     */
    async markCheckpointCompleted() {
        this.checkpoint.completed = true;
        this.checkpoint.lastUpdateTime = new Date().toISOString();
        
        try {
            await fs.writeFile(this.checkpointFile, JSON.stringify(this.checkpoint, null, 2), 'utf8');
            console.log('✅ Checkpoint marcado como completado');
        } catch (error) {
            console.error('❌ Error marcando checkpoint como completado:', error.message);
        }
    }

    /**
     * Lee todos los archivos JSON de datos de Tricel
     * @returns {Array} Array con todos los resultados de todas las páginas
     */
    async loadTricelData() {
        try {
            const files = await fs.readdir(this.inputDir);
            const dataFiles = files.filter(file => 
                file.startsWith('tricel_page_') && file.endsWith('.json')
            ).sort();

            console.log(`📚 Encontrados ${dataFiles.length} archivos de datos`);

            let allResults = [];
            let totalResultsCount = 0;

            for (const file of dataFiles) {
                const filePath = path.join(this.inputDir, file);
                const content = await fs.readFile(filePath, 'utf8');
                const data = JSON.parse(content);
                
                allResults = allResults.concat(data.results);
                totalResultsCount = data.resultsCount; // Tomar el último count (debería ser el mismo en todos)
                
                console.log(`📄 Cargado ${file}: ${data.results.length} resultados`);
            }

            console.log(`📊 Total de resultados cargados: ${allResults.length}`);
            console.log(`📊 Total esperado según API: ${totalResultsCount}`);

            return allResults;
        } catch (error) {
            console.error('❌ Error cargando datos de Tricel:', error.message);
            throw error;
        }
    }

    /**
     * Descarga un documento específico
     * @param {number} documentId - ID del documento a descargar
     * @param {string} documentType - Tipo de documento ('escrito_ingreso' o 'sentencia')
     * @param {Object} metadata - Metadatos del caso para el nombre del archivo
     * @returns {boolean} true si se descargó exitosamente, false si falló
     */
    async downloadDocument(documentId, documentType, metadata) {
        if (!documentId) {
            console.log(`⏭️  Saltando ${documentType} - ID nulo para caso ${metadata.rol}`);
            this.skippedCount++;
            return false;
        }

        const url = `${this.baseURL}${documentId}?inlineifpossible=true`;
        const subDir = documentType === 'escrito_ingreso' ? 'escritos_ingreso' : 'sentencias';
        
        // Crear nombre de archivo seguro
        const safeRol = metadata.rol.replace(/[<>:"/\\|?*]/g, '_');
        const fileName = `${safeRol}_${documentType}_${documentId}.pdf`;
        const filePath = path.join(this.outputDir, subDir, fileName);

        try {
            // Verificar si el archivo ya existe
            try {
                await fs.access(filePath);
                console.log(`⏭️  Archivo ya existe: ${fileName}`);
                this.skippedCount++;
                return true;
            } catch (accessError) {
                // El archivo no existe, continuar con la descarga
            }

            console.log(`🔄 Descargando ${documentType}: ${documentId} (${metadata.rol})`);

            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 60000, // 60 segundos
                responseType: 'arraybuffer' // Para manejar datos binarios (PDF)
            });

            if (response.status !== 200) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            // Guardar el archivo PDF
            await fs.writeFile(filePath, response.data);
            
            console.log(`✅ Descargado: ${fileName} (${(response.data.length / 1024).toFixed(2)} KB)`);
            this.downloadedCount++;
            
            // Guardar metadatos del documento
            await this.saveDocumentMetadata(documentId, documentType, metadata, filePath, response.data.length);
            
            return true;

        } catch (error) {
            console.error(`❌ Error descargando ${documentType} ${documentId} (${metadata.rol}):`, error.message);
            
            // Detectar si es un error de cookies/autenticación
            if (error.response && (error.response.status === 401 || error.response.status === 403)) {
                console.error('🔐 Error de autenticación detectado - Las cookies han expirado');
                throw new Error('COOKIES_EXPIRED: Las cookies han expirado. Actualiza las cookies y reinicia el proceso.');
            }
            
            // Guardar información del error
            await this.logError(documentId, documentType, metadata, error);
            this.errorCount++;
            
            return false;
        }
    }

    /**
     * Guarda metadatos del documento descargado
     * @param {number} documentId - ID del documento
     * @param {string} documentType - Tipo de documento
     * @param {Object} metadata - Metadatos del caso
     * @param {string} filePath - Ruta del archivo guardado
     * @param {number} fileSize - Tamaño del archivo en bytes
     */
    async saveDocumentMetadata(documentId, documentType, metadata, filePath, fileSize) {
        const metadataEntry = {
            documentId: documentId,
            documentType: documentType,
            rol: metadata.rol,
            causaId: metadata.causaId,
            fecha: metadata.fecha,
            tipo: metadata.tipo,
            materia: metadata.materia,
            partes: metadata.partes,
            filePath: filePath,
            fileSize: fileSize,
            downloadTimestamp: new Date().toISOString()
        };

        const metadataFile = path.join(this.outputDir, 'logs', 'documentos_descargados.json');
        
        try {
            let allMetadata = [];
            
            // Cargar metadatos existentes
            try {
                const existingData = await fs.readFile(metadataFile, 'utf8');
                allMetadata = JSON.parse(existingData);
            } catch (readError) {
                // El archivo no existe, empezar con array vacío
            }
            
            allMetadata.push(metadataEntry);
            
            await fs.writeFile(metadataFile, JSON.stringify(allMetadata, null, 2), 'utf8');
        } catch (error) {
            console.error('❌ Error guardando metadatos:', error.message);
        }
    }

    /**
     * Registra errores de descarga
     * @param {number} documentId - ID del documento
     * @param {string} documentType - Tipo de documento
     * @param {Object} metadata - Metadatos del caso
     * @param {Error} error - Error ocurrido
     */
    async logError(documentId, documentType, metadata, error) {
        const errorEntry = {
            documentId: documentId,
            documentType: documentType,
            rol: metadata.rol,
            causaId: metadata.causaId,
            error: error.message,
            timestamp: new Date().toISOString()
        };

        const errorFile = path.join(this.outputDir, 'logs', 'errores_descarga.json');
        
        try {
            let allErrors = [];
            
            try {
                const existingErrors = await fs.readFile(errorFile, 'utf8');
                allErrors = JSON.parse(existingErrors);
            } catch (readError) {
                // El archivo no existe, empezar con array vacío
            }
            
            allErrors.push(errorEntry);
            
            await fs.writeFile(errorFile, JSON.stringify(allErrors, null, 2), 'utf8');
        } catch (saveError) {
            console.error('❌ Error guardando log de errores:', saveError.message);
        }
    }

    /**
     * Descarga todos los documentos de los datos cargados con soporte para reanudar
     * @param {Array} tricelData - Array con todos los resultados de Tricel
     * @param {Object} options - Opciones de descarga
     */
    async downloadAllDocuments(tricelData, options = {}) {
        const {
            downloadEscritos = true,
            downloadSentencias = true,
            batchSize = 3,
            delayBetweenBatches = 2000
        } = options;

        // Cargar checkpoint
        await this.loadCheckpoint();
        
        // Configurar checkpoint inicial si es nuevo
        if (this.checkpoint.startTime === null) {
            this.checkpoint.startTime = new Date().toISOString();
            this.checkpoint.totalCases = tricelData.length;
        }

        // Determinar punto de inicio basado en checkpoint
        const startIndex = Math.max(0, this.checkpoint.lastProcessedIndex + 1);
        
        console.log(`🚀 Iniciando descarga de documentos...`);
        console.log(`📊 Total de casos: ${tricelData.length}`);
        console.log(`📝 Descargar escritos de ingreso: ${downloadEscritos ? 'Sí' : 'No'}`);
        console.log(`⚖️  Descargar sentencias: ${downloadSentencias ? 'Sí' : 'No'}`);
        console.log(`🔄 Tamaño de lote: ${batchSize}`);
        console.log(`⏱️  Pausa entre lotes: ${delayBetweenBatches}ms`);
        
        if (startIndex > 0) {
            console.log(`🔄 Reanudando desde el índice: ${startIndex} (caso ${startIndex + 1})`);
        }
        console.log('');

        let processedCases = startIndex;
        const totalCases = tricelData.length;

        try {
            for (let i = startIndex; i < tricelData.length; i += batchSize) {
                const batch = tricelData.slice(i, Math.min(i + batchSize, tricelData.length));
                const downloadPromises = [];

                for (let j = 0; j < batch.length; j++) {
                    const caso = batch[j];
                    const currentIndex = i + j;

                    // Descargar escrito de ingreso
                    if (downloadEscritos && caso.documentoEscritoIngresoId) {
                        downloadPromises.push(
                            this.downloadDocument(
                                caso.documentoEscritoIngresoId,
                                'escrito_ingreso',
                                caso
                            )
                        );
                    }

                    // Descargar sentencia
                    if (downloadSentencias && caso.documentoSentenciaId) {
                        downloadPromises.push(
                            this.downloadDocument(
                                caso.documentoSentenciaId,
                                'sentencia',
                                caso
                            )
                        );
                    }
                }

                // Ejecutar el lote actual
                if (downloadPromises.length > 0) {
                    await Promise.all(downloadPromises);
                }

                // Actualizar checkpoint después de cada lote
                const lastProcessedIndex = Math.min(i + batchSize - 1, tricelData.length - 1);
                await this.saveCheckpoint(lastProcessedIndex, tricelData[lastProcessedIndex].causaId);

                processedCases = lastProcessedIndex + 1;
                const progress = ((processedCases / totalCases) * 100).toFixed(1);
                
                console.log(`📈 Progreso: ${processedCases}/${totalCases} casos (${progress}%)`);
                console.log(`📊 Descargados: ${this.downloadedCount}, Errores: ${this.errorCount}, Saltados: ${this.skippedCount}`);
                console.log(`💾 Checkpoint guardado en índice: ${lastProcessedIndex}\n`);

                // Pausa entre lotes (excepto en el último)
                if (i + batchSize < tricelData.length) {
                    console.log(`⏳ Pausa de ${delayBetweenBatches}ms...`);
                    await new Promise(resolve => setTimeout(resolve, delayBetweenBatches));
                }
            }

            // Marcar como completado
            await this.markCheckpointCompleted();
            console.log('🎉 ¡Descarga completada exitosamente!');

        } catch (error) {
            console.error('\n💥 Error durante la descarga:', error.message);
            
            if (error.message.includes('COOKIES_EXPIRED')) {
                console.log('\n🔄 INSTRUCCIONES PARA REANUDAR:');
                console.log('1. Actualiza las cookies siguiendo estos pasos:');
                console.log('   - Ve a https://tricel.lexsoft.cl');
                console.log('   - Abre DevTools (F12) → Network');
                console.log('   - Intenta descargar cualquier documento');
                console.log('   - Copia las cookies del header "Cookie"');
                console.log('2. Actualiza la variable "cookies" en el script');
                console.log('3. Ejecuta nuevamente el script');
                console.log(`4. El proceso se reanudará automáticamente desde el índice: ${this.checkpoint.lastProcessedIndex + 1}`);
                console.log('\n📊 Estado actual:');
                console.log(`   - Casos procesados: ${processedCases}/${totalCases}`);
                console.log(`   - Documentos descargados: ${this.downloadedCount}`);
                console.log(`   - Errores: ${this.errorCount}`);
            }
            
            throw error;
        }
    }

    /**
     * Crea un resumen final de la descarga
     */
    async createFinalSummary(tricelData) {
        const summary = {
            timestamp: new Date().toISOString(),
            totalCases: tricelData.length,
            documentsDownloaded: this.downloadedCount,
            documentsSkipped: this.skippedCount,
            errors: this.errorCount,
            directories: {
                escritosIngreso: path.join(this.outputDir, 'escritos_ingreso'),
                sentencias: path.join(this.outputDir, 'sentencias'),
                logs: path.join(this.outputDir, 'logs')
            }
        };

        const summaryFile = path.join(this.outputDir, 'resumen_descarga.json');
        
        try {
            await fs.writeFile(summaryFile, JSON.stringify(summary, null, 2), 'utf8');
            console.log(`📋 Resumen guardado: ${summaryFile}`);
        } catch (error) {
            console.error('❌ Error guardando resumen:', error.message);
        }

        return summary;
    }

    /**
     * Obtiene información del estado actual del checkpoint
     * @returns {Object} Información del estado
     */
    async getCheckpointStatus() {
        await this.loadCheckpoint();
        
        const status = {
            hasCheckpoint: this.checkpoint.lastProcessedIndex >= 0,
            isCompleted: this.checkpoint.completed,
            lastProcessedIndex: this.checkpoint.lastProcessedIndex,
            totalCases: this.checkpoint.totalCases,
            progress: this.checkpoint.totalCases > 0 ? 
                ((this.checkpoint.lastProcessedIndex + 1) / this.checkpoint.totalCases * 100).toFixed(2) : 0,
            startTime: this.checkpoint.startTime,
            lastUpdateTime: this.checkpoint.lastUpdateTime
        };

        return status;
    }

    /**
     * Limpia el checkpoint (para empezar desde cero)
     */
    async clearCheckpoint() {
        try {
            await fs.unlink(this.checkpointFile);
            console.log('🗑️  Checkpoint eliminado - Se iniciará desde el principio');
            
            // Resetear checkpoint en memoria
            this.checkpoint = {
                lastProcessedIndex: -1,
                lastProcessedCaseId: null,
                totalCases: 0,
                startTime: null,
                lastUpdateTime: null,
                completed: false
            };
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('❌ Error eliminando checkpoint:', error.message);
            } else {
                console.log('📍 No había checkpoint previo');
            }
        }
    }

    /**
     * Muestra información detallada del checkpoint actual
     */
    async showCheckpointInfo() {
        const status = await this.getCheckpointStatus();
        
        console.log('\n📊 INFORMACIÓN DEL CHECKPOINT:');
        console.log('================================');
        
        if (!status.hasCheckpoint) {
            console.log('📍 No se encontró checkpoint previo');
            console.log('🆕 Se iniciará desde el principio');
        } else {
            console.log(`📈 Progreso: ${status.progress}%`);
            console.log(`📊 Casos procesados: ${status.lastProcessedIndex + 1}/${status.totalCases}`);
            console.log(`🕒 Inicio: ${status.startTime}`);
            console.log(`🕒 Última actualización: ${status.lastUpdateTime}`);
            console.log(`✅ Completado: ${status.isCompleted ? 'Sí' : 'No'}`);
            
            if (status.isCompleted) {
                console.log('🎉 La descarga ya está completada');
            } else {
                console.log(`🔄 Se reanudará desde el caso: ${status.lastProcessedIndex + 2}`);
            }
        }
        console.log('================================\n');
        
        return status;
    }
}

// Función principal
async function main() {
    console.log('🚀 Iniciando descarga de documentos de Tricel...\n');

    const downloader = new TricelDocumentDownloader();
    
    // IMPORTANTE: Configura aquí tus cookies actuales
    const cookies = 'JSESSIONID=-LXm-AhSbfU+jKU5Sf-Yvdqq; JSESSIONID=+e2dvjOsl2mhWx+hi8XKD3ZP';
    
    console.log('🔐 Configurando cookies...');
    downloader.setCookies(cookies);

    try {
        // Crear directorios
        await downloader.createOutputDirectories();
        
        // Mostrar información del checkpoint
        const status = await downloader.showCheckpointInfo();
        
        // Si ya está completado, preguntar si se quiere reiniciar
        if (status.isCompleted) {
            console.log('⚠️  La descarga ya está completada.');
            console.log('💡 Si quieres reiniciar desde el principio, elimina el archivo:');
            console.log(`   ${downloader.checkpointFile}`);
            console.log('   O usa downloader.clearCheckpoint() en tu código.');
            return;
        }
        
        // Cargar datos de Tricel
        console.log('📚 Cargando datos de Tricel...');
        const tricelData = await downloader.loadTricelData();
        
        if (tricelData.length === 0) {
            throw new Error('No se encontraron datos de Tricel. Ejecuta primero descargarTricel.js');
        }

        // Configurar opciones de descarga
        const options = {
            downloadEscritos: true,      // Descargar escritos de ingreso
            downloadSentencias: true,    // Descargar sentencias
            batchSize: 3,               // Documentos por lote
            delayBetweenBatches: 2000   // Pausa entre lotes (ms)
        };

        // Descargar todos los documentos
        await downloader.downloadAllDocuments(tricelData, options);
        
        // Crear resumen final
        const summary = await downloader.createFinalSummary(tricelData);
        
        console.log('\n🎉 ¡Descarga completada!');
        console.log(`📊 Documentos descargados: ${summary.documentsDownloaded}`);
        console.log(`⏭️  Documentos saltados: ${summary.documentsSkipped}`);
        console.log(`❌ Errores: ${summary.errors}`);
        console.log(`📁 Archivos guardados en: ${downloader.outputDir}`);

    } catch (error) {
        console.error('\n💥 Error durante la ejecución:', error.message);
        
        if (error.message.includes('Cookies expiradas') || error.message.includes('401') || error.message.includes('403')) {
            console.log('\n🔧 Las cookies han expirado. Actualízalas siguiendo estos pasos:');
            console.log('1. Abre https://tricel.lexsoft.cl en tu navegador');
            console.log('2. Presiona F12 para abrir DevTools');
            console.log('3. Ve a la pestaña "Network" o "Red"');
            console.log('4. Realiza cualquier búsqueda en la página');
            console.log('5. Busca una petición de descarga (download)');
            console.log('6. Copia el valor completo del header "Cookie"');
            console.log('7. Actualiza la variable "cookies" en este script');
        }
        
        process.exit(1);
    }
}

// Ejecutar solo si es llamado directamente
if (require.main === module) {
    main().catch(console.error);
}

module.exports = TricelDocumentDownloader;
