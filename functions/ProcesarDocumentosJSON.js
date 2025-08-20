require('dotenv').config();
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const IndexarQdrantJSON = require('./IndexarQdrantJson');

/**
 * Clase para procesar archivos JSON masivos y indexar documentos en Qdrant
 */
class ProcesarDocumentosJSON {
    constructor(jsonFilePath, collectionName, options = {}) {
        this.jsonFilePath = jsonFilePath;
        this.collectionName = collectionName;
        this.batchSize = options.batchSize || 50; // Procesar en lotes para no saturar
        this.startFrom = options.startFrom || 0; // Índice para resumir procesamiento
        this.maxDocuments = options.maxDocuments || null; // Límite máximo (null = todos)
        this.logInterval = options.logInterval || 100; // Cada cuántos documentos loggear progreso
        this.pauseBetweenBatches = options.pauseBetweenBatches || 2000; // Pausa en ms entre lotes
        
        // Archivos de control
        this.progressFile = `progress_${collectionName}.json`;
        this.errorLogFile = `errors_${collectionName}.log`;
        this.processedCount = 0;
        this.errorCount = 0;
        this.skippedCount = 0;
        
        // Métricas de rendimiento
        this.startTime = null;
        this.endTime = null;
        this.chunksProcessed = 0;
        this.totalVectorTime = 0;
        this.totalIndexTime = 0;
        this.interrupted = false;
        
        // Configurar manejo de interrupción
        this.setupInterruptHandler();
    }

    /**
     * Configura el manejo de interrupción con Ctrl+C
     */
    setupInterruptHandler() {
        process.on('SIGINT', () => {
            console.log('\n\n🛑 Interrupción detectada (Ctrl+C)...');
            this.interrupted = true;
            this.endTime = new Date();
            this.mostrarMetricasFinales(true);
            process.exit(0);
        });
    }

    /**
     * Carga el progreso previo si existe
     */
    loadProgress() {
        try {
            if (fs.existsSync(this.progressFile)) {
                const progress = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
                this.processedCount = progress.processedCount || 0;
                this.errorCount = progress.errorCount || 0;
                this.skippedCount = progress.skippedCount || 0;
                this.startFrom = progress.lastProcessedIndex + 1 || 0;
                console.log(`📊 Progreso cargado: ${this.processedCount} procesados, ${this.errorCount} errores, desde índice ${this.startFrom}`);
            }
        } catch (error) {
            console.error('❌ Error cargando progreso:', error.message);
        }
    }

    /**
     * Guarda el progreso actual
     */
    saveProgress(lastProcessedIndex) {
        try {
            const progress = {
                processedCount: this.processedCount,
                errorCount: this.errorCount,
                skippedCount: this.skippedCount,
                lastProcessedIndex: lastProcessedIndex,
                timestamp: new Date().toISOString(),
                collectionName: this.collectionName
            };
            fs.writeFileSync(this.progressFile, JSON.stringify(progress, null, 2));
        } catch (error) {
            console.error('❌ Error guardando progreso:', error.message);
        }
    }

    /**
     * Registra un error en el archivo de log
     */
    logError(index, document, error) {
        try {
            const errorEntry = {
                timestamp: new Date().toISOString(),
                index: index,
                idNorm: document?.idNorm || 'unknown',
                error: error.message,
                stack: error.stack
            };
            fs.appendFileSync(this.errorLogFile, JSON.stringify(errorEntry) + '\n');
        } catch (logError) {
            console.error('❌ Error escribiendo log de errores:', logError.message);
        }
    }

    /**
     * Muestra métricas detalladas de rendimiento
     */
    mostrarMetricasFinales(interrumpido = false) {
        const duracionTotal = this.endTime ? (this.endTime - this.startTime) / 1000 : 0;
        const totalDocumentos = this.processedCount + this.errorCount + this.skippedCount;
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 MÉTRICAS DE RENDIMIENTO');
        console.log('='.repeat(60));
        
        if (interrumpido) {
            console.log('⚠️  PROCESAMIENTO INTERRUMPIDO');
        } else {
            console.log('✅ PROCESAMIENTO COMPLETADO');
        }
        
        console.log('\n📈 Estadísticas Generales:');
        console.log(`   📄 Documentos procesados: ${this.processedCount.toLocaleString()}`);
        console.log(`   ❌ Errores: ${this.errorCount.toLocaleString()}`);
        console.log(`   ⚠️  Saltados: ${this.skippedCount.toLocaleString()}`);
        console.log(`   📊 Total procesados: ${totalDocumentos.toLocaleString()}`);
        console.log(`   🧩 Chunks vectorizados: ${this.chunksProcessed.toLocaleString()}`);
        
        console.log('\n⏱️  Tiempos de Procesamiento:');
        console.log(`   🕐 Duración total: ${this.formatearTiempo(duracionTotal)}`);
        console.log(`   🔢 Tiempo promedio por documento: ${totalDocumentos > 0 ? (duracionTotal / totalDocumentos).toFixed(2) : 0}s`);
        console.log(`   🧠 Tiempo total vectorización: ${this.formatearTiempo(this.totalVectorTime / 1000)}`);
        console.log(`   💾 Tiempo total indexación: ${this.formatearTiempo(this.totalIndexTime / 1000)}`);
        
        console.log('\n🚀 Rendimiento:');
        if (duracionTotal > 0) {
            const docsPerSecond = totalDocumentos / duracionTotal;
            const docsPerMinute = docsPerSecond * 60;
            const docsPerHour = docsPerMinute * 60;
            
            console.log(`   📊 Documentos/segundo: ${docsPerSecond.toFixed(2)}`);
            console.log(`   📊 Documentos/minuto: ${docsPerMinute.toFixed(0)}`);
            console.log(`   📊 Documentos/hora: ${docsPerHour.toFixed(0)}`);
            
            if (this.chunksProcessed > 0) {
                const chunksPerSecond = this.chunksProcessed / duracionTotal;
                console.log(`   🧩 Chunks/segundo: ${chunksPerSecond.toFixed(2)}`);
                console.log(`   🧩 Chunks promedio por documento: ${(this.chunksProcessed / totalDocumentos).toFixed(1)}`);
            }
        }
        
        console.log('\n💾 Información del Archivo:');
        try {
            const stats = fs.statSync(this.jsonFilePath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            const fileSizeGB = (stats.size / (1024 * 1024 * 1024)).toFixed(2);
            
            console.log(`   📁 Tamaño del archivo: ${fileSizeMB} MB (${fileSizeGB} GB)`);
            
            if (duracionTotal > 0) {
                const mbPerSecond = (stats.size / (1024 * 1024)) / duracionTotal;
                console.log(`   📊 Velocidad de lectura: ${mbPerSecond.toFixed(2)} MB/s`);
            }
        } catch (e) {
            console.log(`   📁 No se pudo obtener información del archivo`);
        }
        
        console.log('\n🎯 Eficiencia:');
        if (totalDocumentos > 0) {
            const tasaExito = (this.processedCount / totalDocumentos) * 100;
            const tasaError = (this.errorCount / totalDocumentos) * 100;
            const tasaSaltados = (this.skippedCount / totalDocumentos) * 100;
            
            console.log(`   ✅ Tasa de éxito: ${tasaExito.toFixed(1)}%`);
            console.log(`   ❌ Tasa de error: ${tasaError.toFixed(1)}%`);
            console.log(`   ⚠️  Tasa de saltados: ${tasaSaltados.toFixed(1)}%`);
        }

        // Mostrar estimación de tiempo si hay datos suficientes
        this.mostrarEstimacionTiempo(duracionTotal, totalDocumentos, interrumpido);
        
        if (this.errorCount > 0) {
            console.log(`\n📋 Log de errores disponible en: ${this.errorLogFile}`);
        }
        
        console.log('\n' + '='.repeat(60));
        console.log(`🏁 Finalizado: ${new Date().toLocaleString()}`);
        console.log('='.repeat(60));
    }

    /**
     * Formatea tiempo en segundos a formato legible
     */
    formatearTiempo(segundos) {
        if (segundos < 60) {
            return `${segundos.toFixed(1)}s`;
        } else if (segundos < 3600) {
            const minutos = Math.floor(segundos / 60);
            const segs = Math.floor(segundos % 60);
            return `${minutos}m ${segs}s`;
        } else {
            const horas = Math.floor(segundos / 3600);
            const minutos = Math.floor((segundos % 3600) / 60);
            const segs = Math.floor(segundos % 60);
            return `${horas}h ${minutos}m ${segs}s`;
        }
    }

    /**
     * Estima el total de documentos en el archivo basado en el tamaño
     */
    estimarTotalDocumentos() {
        try {
            // Basándose en tu archivo: 4.8GB con ~400K documentos
            // Promedio: ~12KB por documento
            const stats = fs.statSync(this.jsonFilePath);
            const fileSizeKB = stats.size / 1024;
            const estimatedDocs = Math.round(fileSizeKB / 12); // ~12KB por documento
            return estimatedDocs;
        } catch (e) {
            // Fallback: usar el número conocido de ~400K documentos para tu archivo
            return 400000;
        }
    }

    /**
     * Muestra estimación de tiempo de finalización
     */
    mostrarEstimacionTiempo(duracionActual, documentosProcesados, interrumpido) {
        if (documentosProcesados < 10) {
            console.log('\n⏰ Estimación de Tiempo:');
            console.log('   ⚠️  Necesitamos más datos para una estimación precisa (mínimo 10 documentos)');
            return;
        }

        console.log('\n⏰ Estimación de Tiempo:');
        
        try {
            const totalDocumentosEstimados = this.estimarTotalDocumentos();
            const documentosRestantes = totalDocumentosEstimados - (this.processedCount + this.errorCount + this.skippedCount);
            
            if (documentosRestantes <= 0) {
                console.log('   🎉 ¡Procesamiento completado!');
                return;
            }

            // Calcular velocidad actual (documentos por segundo)
            const velocidadActual = documentosProcesados / duracionActual;
            
            // Tiempo restante estimado
            const tiempoRestanteSegundos = documentosRestantes / velocidadActual;
            
            // Calcular tiempo total estimado
            const tiempoTotalEstimado = totalDocumentosEstimados / velocidadActual;
            
            // Calcular progreso
            const progresoActual = ((documentosProcesados / totalDocumentosEstimados) * 100);
            
            // Estimación de finalización
            const ahora = new Date();
            const tiempoFinalizacion = new Date(ahora.getTime() + (tiempoRestanteSegundos * 1000));
            
            console.log(`   📊 Total estimado de documentos: ${totalDocumentosEstimados.toLocaleString()}`);
            console.log(`   📈 Progreso actual: ${progresoActual.toFixed(1)}% completado`);
            console.log(`   📄 Documentos restantes: ${documentosRestantes.toLocaleString()}`);
            console.log(`   ⚡ Velocidad actual: ${velocidadActual.toFixed(2)} docs/segundo`);
            console.log(`   ⏱️  Tiempo restante estimado: ${this.formatearTiempo(tiempoRestanteSegundos)}`);
            console.log(`   🕐 Tiempo total estimado: ${this.formatearTiempo(tiempoTotalEstimado)}`);
            console.log(`   🎯 Finalización estimada: ${tiempoFinalizacion.toLocaleString()}`);
            
            // Mostrar diferentes escenarios
            console.log('\n📊 Escenarios de Rendimiento:');
            
            // Escenario optimista (20% más rápido)
            const velocidadOptimista = velocidadActual * 1.2;
            const tiempoOptimista = documentosRestantes / velocidadOptimista;
            const finalizacionOptimista = new Date(ahora.getTime() + (tiempoOptimista * 1000));
            
            // Escenario pesimista (20% más lento)
            const velocidadPesimista = velocidadActual * 0.8;
            const tiempoPesimista = documentosRestantes / velocidadPesimista;
            const finalizacionPesimista = new Date(ahora.getTime() + (tiempoPesimista * 1000));
            
            console.log(`   🚀 Optimista (+20% velocidad): ${this.formatearTiempo(tiempoOptimista)} → ${finalizacionOptimista.toLocaleString()}`);
            console.log(`   🎯 Realista (velocidad actual): ${this.formatearTiempo(tiempoRestanteSegundos)} → ${tiempoFinalizacion.toLocaleString()}`);
            console.log(`   🐌 Pesimista (-20% velocidad): ${this.formatearTiempo(tiempoPesimista)} → ${finalizacionPesimista.toLocaleString()}`);
            
            // Advertencias y recomendaciones
            if (tiempoRestanteSegundos > 86400) { // Más de 24 horas
                console.log('\n⚠️  Recomendaciones:');
                console.log('   • El procesamiento tomará más de 24 horas');
                console.log('   • Considera ejecutar en un servidor dedicado');
                console.log('   • Asegúrate de que el sistema no se suspenda');
                console.log('   • Monitorea el uso de memoria y CPU');
            }
            
            if (interrumpido) {
                console.log('\n🔄 Para Continuar:');
                console.log(`   • Ejecuta: node procesar-json-masivo.js resumir`);
                console.log(`   • El progreso se guardó automáticamente`);
                console.log(`   • Continuará desde el documento ${(this.processedCount + this.errorCount + this.skippedCount + 1).toLocaleString()}`);
            }
            
        } catch (error) {
            console.log(`   ❌ Error calculando estimación: ${error.message}`);
        }
    }

    /**
     * Transforma un documento del JSON al formato esperado por IndexarQdrant
     */
    transformDocument(doc) {
        // Extraer metadatos principales (mismo formato que IndexarMongo.js)
        const meta = doc.data?.metadatos || {};
        const tiposNumeros = meta.tipos_numeros?.[0] || {};
        
        const metadata = {
            _id: doc._id?.$oid || `doc_${doc.idNorm}`, // ID único para el documento
            idNorm: doc.idNorm,
            compuesto: tiposNumeros.compuesto || '',
            titulo_norma: meta.titulo_norma || '',
            organismos: meta.organismos || [],
            fecha_publicacion: meta.fecha_publicacion || '',
            fecha_promulgacion: meta.fecha_promulgacion || '',
            tipo_version_s: meta.tipo_version_s || '',
            inicio_vigencia: meta.vigencia?.inicio_vigencia || '',
            fin_vigencia: meta.vigencia?.fin_vigencia || '',
            tag: 'norma'
        };

        // El texto completo para vectorizar
        const textoCompleto = doc.planeText || '';

        return {
            texto: textoCompleto,
            metadata: metadata
        };
    }

    /**
     * Valida que un documento tenga los campos mínimos requeridos
     */
    isValidDocument(doc) {
        if (!doc) return false;
        if (!doc.idNorm && !doc._id?.$oid) return false;
        if (!doc.planeText || doc.planeText.trim().length === 0) return false;
        return true;
    }

    /**
     * Procesa un lote de documentos
     */
    async processBatch(documents, startIndex) {
        const results = {
            processed: 0,
            errors: 0,
            skipped: 0
        };

        for (let i = 0; i < documents.length; i++) {
            const doc = documents[i];
            const currentIndex = startIndex + i;

            try {
                // Validar documento
                if (!this.isValidDocument(doc)) {
                    console.log(`⚠️ Documento ${currentIndex} inválido (idNorm: ${doc?.idNorm}), saltando...`);
                    results.skipped++;
                    continue;
                }

                // Transformar documento
                const transformedDoc = this.transformDocument(doc);

                // Medir tiempo de vectorización/indexación
                const startTime = Date.now();
                
                // Indexar en Qdrant
                const result = await IndexarQdrantJSON.create(
                    transformedDoc.texto,
                    this.collectionName,
                    transformedDoc.metadata
                );
                
                const endTime = Date.now();
                const processingTime = endTime - startTime;
                
                // Actualizar métricas
                this.totalIndexTime += processingTime;
                if (result && result.chunks_processed) {
                    this.chunksProcessed += result.chunks_processed;
                }

                results.processed++;

                // Log progreso cada cierto número de documentos
                if ((this.processedCount + results.processed) % this.logInterval === 0) {
                    console.log(`📈 Progreso: ${this.processedCount + results.processed} procesados, ${this.errorCount + results.errors} errores`);
                }

            } catch (error) {
                console.error(`❌ Error procesando documento ${currentIndex} (idNorm: ${doc?.idNorm}):`, error.message);
                this.logError(currentIndex, doc, error);
                results.errors++;

                // Si hay muchos errores consecutivos, pausar y continuar
                if (results.errors > 10 && results.processed === 0) {
                    console.log('⚠️ Muchos errores consecutivos, pausando 5 segundos...');
                    await new Promise(resolve => setTimeout(resolve, 5000));
                }
            }
        }

        return results;
    }

    /**
     * Cuenta el total de líneas en el archivo para estimar progreso
     */
    async contarLineasArchivo() {
        return new Promise((resolve, reject) => {
            let lineCount = 0;
            const rl = readline.createInterface({
                input: fs.createReadStream(this.jsonFilePath),
                crlfDelay: Infinity
            });

            rl.on('line', () => {
                lineCount++;
            });

            rl.on('close', () => {
                resolve(lineCount);
            });

            rl.on('error', (error) => {
                reject(error);
            });
        });
    }

    /**
     * Procesa el archivo JSON usando streaming para arrays JSON gigantes
     */
    async procesarArchivoStreaming() {
        console.log(`🚀 Iniciando procesamiento streaming de ${this.jsonFilePath}`);
        console.log(`📊 Configuración: lotes de ${this.batchSize}, pausa de ${this.pauseBetweenBatches}ms`);
        
        // Iniciar métricas de tiempo
        this.startTime = new Date();
        
        // Cargar progreso previo
        this.loadProgress();

        try {
            // Obtener tamaño del archivo
            const stats = fs.statSync(this.jsonFilePath);
            const fileSizeMB = (stats.size / (1024 * 1024)).toFixed(2);
            console.log(`📏 Tamaño del archivo: ${fileSizeMB} MB`);

            console.log('📖 Leyendo archivo JSON como stream...');

            // Crear un stream parser JSON manual para arrays gigantes
            const fileStream = fs.createReadStream(this.jsonFilePath, { encoding: 'utf8' });
            
            let buffer = '';
            let documentsFound = 0;
            let batch = [];
            let isProcessingBatch = false;
            let insideArray = false;
            let braceDepth = 0;
            let currentDocument = '';

            return new Promise((resolve, reject) => {
                fileStream.on('data', async (chunk) => {
                    buffer += chunk;
                    
                    // Procesar el buffer carácter por carácter
                    let i = 0;
                    while (i < buffer.length) {
                        const char = buffer[i];
                        
                        if (!insideArray && char === '[') {
                            insideArray = true;
                            console.log('📄 Iniciando lectura del array JSON...');
                            i++;
                            continue;
                        }
                        
                        if (!insideArray) {
                            i++;
                            continue;
                        }
                        
                        // Si encontramos el final del array
                        if (char === ']' && braceDepth === 0) {
                            // Procesar último documento si existe
                            if (currentDocument.trim()) {
                                try {
                                    const doc = JSON.parse(currentDocument.trim());
                                    if (documentsFound >= this.startFrom && this.isValidDocument(doc)) {
                                        batch.push(doc);
                                    }
                                    documentsFound++;
                                } catch (e) {
                                    console.log(`⚠️ Error parseando documento ${documentsFound}: ${e.message.substring(0, 50)}...`);
                                }
                            }
                            break;
                        }
                        
                        if (char === '{') {
                            if (braceDepth === 0) {
                                currentDocument = '';
                            }
                            braceDepth++;
                            currentDocument += char;
                        } else if (char === '}') {
                            currentDocument += char;
                            braceDepth--;
                            
                            if (braceDepth === 0) {
                                // Documento completo
                                try {
                                    const doc = JSON.parse(currentDocument.trim());
                                    
                                    // Solo procesar si estamos en el rango correcto
                                    if (documentsFound >= this.startFrom) {
                                        if (this.maxDocuments && (documentsFound - this.startFrom) >= this.maxDocuments) {
                                            console.log(`🎯 Alcanzado límite máximo de ${this.maxDocuments} documentos`);
                                            // Procesar lote final
                                            if (batch.length > 0) {
                                                await this.processBatchFinal(batch, documentsFound);
                                            }
                                            return resolve();
                                        }
                                        
                                        if (this.isValidDocument(doc)) {
                                            batch.push(doc);
                                            
                                            // Procesar lote cuando esté completo
                                            if (batch.length >= this.batchSize && !isProcessingBatch) {
                                                isProcessingBatch = true;
                                                fileStream.pause(); // Pausar lectura mientras procesamos
                                                
                                                console.log(`\n📦 Procesando lote: documentos ${documentsFound - batch.length + 1} a ${documentsFound}`);
                                                
                                                const batchResults = await this.processBatch([...batch], documentsFound - batch.length);
                                                
                                                // Actualizar contadores
                                                this.processedCount += batchResults.processed;
                                                this.errorCount += batchResults.errors;
                                                this.skippedCount += batchResults.skipped;

                                                // Guardar progreso
                                                this.saveProgress(documentsFound);

                                                // Mostrar estadísticas del lote
                                                console.log(`✅ Lote completado: ${batchResults.processed} procesados, ${batchResults.errors} errores, ${batchResults.skipped} saltados`);
                                                console.log(`📊 Total acumulado: ${this.processedCount} procesados, ${this.errorCount} errores, ${this.skippedCount} saltados`);
                                                console.log(`📈 Progreso: ${documentsFound} documentos procesados`);

                                                // Limpiar lote
                                                batch = [];
                                                isProcessingBatch = false;
                                                
                                                // Pausa entre lotes
                                                console.log(`⏸️ Pausa de ${this.pauseBetweenBatches}ms...`);
                                                await new Promise(resolve => setTimeout(resolve, this.pauseBetweenBatches));
                                                
                                                fileStream.resume(); // Reanudar lectura
                                            }
                                        }
                                    }
                                    
                                    documentsFound++;
                                    
                                    // Mostrar progreso cada cierto número de documentos
                                    if (documentsFound % this.logInterval === 0) {
                                        console.log(`📈 Documentos leídos: ${documentsFound.toLocaleString()}`);
                                    }
                                    
                                } catch (parseError) {
                                    console.log(`⚠️ Error parseando documento ${documentsFound}: ${parseError.message.substring(0, 50)}...`);
                                }
                                
                                currentDocument = '';
                            }
                        } else if (braceDepth > 0) {
                            currentDocument += char;
                        }
                        
                        i++;
                    }
                    
                    // Limpiar buffer procesado
                    buffer = buffer.substring(i);
                });

                fileStream.on('end', async () => {
                    // Procesar lote final si queda algo
                    if (batch.length > 0) {
                        await this.processBatchFinal(batch, documentsFound);
                    }

                    // Finalizar métricas de tiempo
                    this.endTime = new Date();
                    
                    // Mostrar métricas finales
                    this.mostrarMetricasFinales(false);
                    
                    resolve();
                });

                fileStream.on('error', (error) => {
                    console.error('❌ Error leyendo archivo:', error.message);
                    reject(error);
                });
            });

        } catch (error) {
            console.error('❌ Error procesando archivo:', error.message);
            throw error;
        }
    }

    /**
     * Procesa el lote final
     */
    async processBatchFinal(batch, documentsFound) {
        console.log(`\n📦 Procesando lote final: ${batch.length} documentos restantes`);
        const batchResults = await this.processBatch(batch, documentsFound - batch.length);
        
        this.processedCount += batchResults.processed;
        this.errorCount += batchResults.errors;
        this.skippedCount += batchResults.skipped;
        
        this.saveProgress(documentsFound);
    }

    /**
     * Procesa todo el archivo JSON (método principal que decide si usar streaming o no)
     */
    async procesarArchivo() {
        try {
            // Verificar tamaño del archivo
            const stats = fs.statSync(this.jsonFilePath);
            const fileSizeMB = stats.size / (1024 * 1024);
            
            // Si el archivo es mayor a 100MB, usar streaming
            if (fileSizeMB > 100) {
                console.log(`📁 Archivo grande detectado (${fileSizeMB.toFixed(2)} MB), usando procesamiento streaming...`);
                return await this.procesarArchivoStreaming();
            } else {
                console.log(`📁 Archivo pequeño (${fileSizeMB.toFixed(2)} MB), cargando en memoria...`);
                return await this.procesarArchivoEnMemoria();
            }
        } catch (error) {
            console.error('❌ Error determinando método de procesamiento:', error.message);
            // Fallback a streaming si hay problemas
            return await this.procesarArchivoStreaming();
        }
    }

    /**
     * Método original para archivos pequeños (mantener compatibilidad)
     */
    async procesarArchivoEnMemoria() {
        console.log(`🚀 Iniciando procesamiento en memoria de ${this.jsonFilePath}`);
        console.log(`📊 Configuración: lotes de ${this.batchSize}, pausa de ${this.pauseBetweenBatches}ms`);
        
        // Iniciar métricas de tiempo
        this.startTime = new Date();
        
        // Cargar progreso previo
        this.loadProgress();

        try {
            // Leer el archivo JSON
            console.log('📖 Leyendo archivo JSON...');
            const jsonContent = fs.readFileSync(this.jsonFilePath, 'utf8');
            
            // Parsear JSON - asumiendo que es un array de documentos
            let documents;
            try {
                documents = JSON.parse(jsonContent);
            } catch (parseError) {
                // Si el JSON no es válido, intentar leerlo línea por línea (JSONL)
                console.log('📋 Archivo no es JSON válido, intentando leer como JSONL...');
                const lines = jsonContent.split('\n').filter(line => line.trim());
                documents = lines.map(line => JSON.parse(line));
            }

            if (!Array.isArray(documents)) {
                throw new Error('El archivo JSON debe contener un array de documentos');
            }

            const totalDocuments = documents.length;
            console.log(`📄 Total de documentos encontrados: ${totalDocuments.toLocaleString()}`);

            // Aplicar límites
            const endIndex = this.maxDocuments ? 
                Math.min(this.startFrom + this.maxDocuments, totalDocuments) : 
                totalDocuments;

            console.log(`🎯 Procesando desde índice ${this.startFrom} hasta ${endIndex} (${endIndex - this.startFrom} documentos)`);

            // Procesar en lotes
            for (let i = this.startFrom; i < endIndex; i += this.batchSize) {
                const batchEnd = Math.min(i + this.batchSize, endIndex);
                const batch = documents.slice(i, batchEnd);
                
                console.log(`\n📦 Procesando lote ${Math.floor(i / this.batchSize) + 1}: documentos ${i} a ${batchEnd - 1}`);
                
                const batchResults = await this.processBatch(batch, i);
                
                // Actualizar contadores
                this.processedCount += batchResults.processed;
                this.errorCount += batchResults.errors;
                this.skippedCount += batchResults.skipped;

                // Guardar progreso
                this.saveProgress(batchEnd - 1);

                // Mostrar estadísticas del lote
                console.log(`✅ Lote completado: ${batchResults.processed} procesados, ${batchResults.errors} errores, ${batchResults.skipped} saltados`);
                console.log(`📊 Total acumulado: ${this.processedCount} procesados, ${this.errorCount} errores, ${this.skippedCount} saltados`);

                // Pausa entre lotes para no saturar los servicios
                if (i + this.batchSize < endIndex) {
                    console.log(`⏸️ Pausa de ${this.pauseBetweenBatches}ms...`);
                    await new Promise(resolve => setTimeout(resolve, this.pauseBetweenBatches));
                }
            }

            // Finalizar métricas de tiempo
            this.endTime = new Date();
            
            // Mostrar métricas finales
            this.mostrarMetricasFinales(false);

        } catch (error) {
            console.error('❌ Error procesando archivo:', error.message);
            throw error;
        }
    }

    /**
     * Método estático para procesamiento rápido
     */
    static async procesarArchivo(jsonFilePath, collectionName, options = {}) {
        const processor = new ProcesarDocumentosJSON(jsonFilePath, collectionName, options);
        return await processor.procesarArchivo();
    }

    /**
     * Obtiene estadísticas del procesamiento
     */
    getStats() {
        return {
            processedCount: this.processedCount,
            errorCount: this.errorCount,
            skippedCount: this.skippedCount,
            totalProcessed: this.processedCount + this.errorCount + this.skippedCount
        };
    }
}

module.exports = ProcesarDocumentosJSON;
