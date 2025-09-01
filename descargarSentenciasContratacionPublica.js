const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

/**
 * Función para descargar archivos PDF de sentencias del Tribunal de Contratación Pública
 * Usa los IDs del archivo ids_sentencias_tribunal.json
 * URL base: https://tcp.lexsoft.cl/tcp/download/:ID?inlineifpossible=true
 */
class DescargadorSentencias {
    constructor(cookieJSESSIONID = 'UhcNcsr6anOtugRG4SgLi1hr') {
        this.baseUrl = 'https://tcp.lexsoft.cl/tcp/download/';
        this.downloadDir = 'sentencias_descargadas';
        this.delayMs = 2000; // 2 segundos entre descargas
        this.maxRetries = 3;
        this.timeoutMs = 30000; // 30 segundos timeout
        this.cookieJSESSIONID = cookieJSESSIONID;
        this.progressFile = 'progreso_descarga.json';
        this.pausedFile = 'descarga_pausada.flag';
    }

    /**
     * Guarda el progreso actual en un archivo JSON
     */
    guardarProgreso(stats, indiceActual, totalDescargas) {
        const progreso = {
            fechaUltimaActualizacion: new Date().toISOString(),
            indiceActual: indiceActual,
            totalDescargas: totalDescargas,
            estadisticas: stats,
            cookieUsada: this.cookieJSESSIONID
        };
        
        fs.writeFileSync(this.progressFile, JSON.stringify(progreso, null, 2), 'utf8');
    }

    /**
     * Carga el progreso previo si existe
     */
    cargarProgreso() {
        if (fs.existsSync(this.progressFile)) {
            try {
                const progreso = JSON.parse(fs.readFileSync(this.progressFile, 'utf8'));
                return progreso;
            } catch (error) {
                console.log('⚠️ Error leyendo archivo de progreso, comenzando desde el inicio');
                return null;
            }
        }
        return null;
    }

    /**
     * Detecta si el error es por cookie expirada o problemas de autenticación
     */
    esErrorDeAutenticacion(error) {
        const mensajeError = error.message.toLowerCase();
        return mensajeError.includes('401') || 
               mensajeError.includes('403') || 
               mensajeError.includes('unauthorized') ||
               mensajeError.includes('forbidden') ||
               mensajeError.includes('session') ||
               (mensajeError.includes('302') && mensajeError.includes('redirect'));
    }

    /**
     * Pausa la descarga y guarda el estado
     */
    pausarDescarga(motivo, stats, indiceActual, totalDescargas) {
        console.log(`\n⏸️ DESCARGA PAUSADA: ${motivo}`);
        
        // Guardar progreso
        this.guardarProgreso(stats, indiceActual, totalDescargas);
        
        // Crear archivo de pausa
        const pausaInfo = {
            fechaPausa: new Date().toISOString(),
            motivo: motivo,
            indiceActual: indiceActual,
            totalDescargas: totalDescargas,
            instrucciones: 'Para reanudar: actualiza la cookie y ejecuta con --reanudar'
        };
        
        fs.writeFileSync(this.pausedFile, JSON.stringify(pausaInfo, null, 2), 'utf8');
        
        console.log('📁 Progreso guardado en:', this.progressFile);
        console.log('🔄 Para reanudar, actualiza la cookie y ejecuta:');
        console.log('   node descargarSentenciasContratacionPublica.js --reanudar --cookie "NUEVA_COOKIE"');
        
        return true;
    }

    /**
     * Función principal para descargar todas las sentencias
     */
    async descargarTodasLasSentencias(reanudar = false) {
        try {
            // Verificar si se está reanudando
            let progresoAnterior = null;
            let indiceInicio = 0;
            
            if (reanudar) {
                progresoAnterior = this.cargarProgreso();
                if (progresoAnterior) {
                    indiceInicio = progresoAnterior.indiceActual;
                    console.log(`🔄 Reanudando descarga desde el archivo ${indiceInicio + 1}...`);
                    console.log(`📅 Última actualización: ${progresoAnterior.fechaUltimaActualizacion}\n`);
                } else {
                    console.log('⚠️ No se encontró progreso previo, comenzando desde el inicio\n');
                }
            } else {
                console.log('🚀 Iniciando descarga de sentencias...\n');
                // Limpiar archivos de progreso previos
                if (fs.existsSync(this.progressFile)) fs.unlinkSync(this.progressFile);
                if (fs.existsSync(this.pausedFile)) fs.unlinkSync(this.pausedFile);
            }

            // Leer el archivo con los IDs
            if (!fs.existsSync('ids_sentencias_tribunal.json')) {
                throw new Error('No se encuentra el archivo ids_sentencias_tribunal.json. Ejecuta primero descargaTribunalContratacionPublica.js');
            }

            const idsData = JSON.parse(fs.readFileSync('ids_sentencias_tribunal.json', 'utf8'));
            
            // Crear directorio de descarga
            if (!fs.existsSync(this.downloadDir)) {
                fs.mkdirSync(this.downloadDir, { recursive: true });
            }

            // Extraer todos los IDs únicos
            const descargas = this.extraerIDsParaDescarga(idsData);
            
            console.log(`📊 Total de archivos a descargar: ${descargas.length}`);
            console.log(`📁 Directorio de descarga: ${this.downloadDir}`);
            console.log(`⏱️  Pausa entre descargas: ${this.delayMs}ms`);
            if (indiceInicio > 0) {
                console.log(`🔄 Reanudando desde archivo: ${indiceInicio + 1}/${descargas.length}`);
            }
            console.log();

            // Estadísticas (restaurar si se está reanudando)
            const stats = progresoAnterior ? progresoAnterior.estadisticas : {
                total: descargas.length,
                exitosos: 0,
                errores: 0,
                omitidos: 0,
                inicioTiempo: new Date()
            };

            let erroresConsecutivos = 0;
            const maxErroresConsecutivos = 5;

            // Procesar descargas con pausas (desde el índice de inicio)
            for (let i = indiceInicio; i < descargas.length; i++) {
                const descarga = descargas[i];
                const progreso = `[${i + 1}/${descargas.length}]`;
                
                try {
                    console.log(`${progreso} Descargando: ${descarga.nombreArchivo} (ID: ${descarga.id})`);
                    
                    const resultado = await this.descargarArchivo(descarga);
                    
                    if (resultado.omitido) {
                        stats.omitidos++;
                        erroresConsecutivos = 0; // Reset contador de errores
                        console.log(`⏭️  ${progreso} Archivo ya existe: ${descarga.nombreArchivo}`);
                    } else if (resultado.exitoso) {
                        stats.exitosos++;
                        erroresConsecutivos = 0; // Reset contador de errores
                        console.log(`✅ ${progreso} Descarga exitosa: ${descarga.nombreArchivo} (${resultado.tamaño} bytes)`);
                    } else {
                        stats.errores++;
                        erroresConsecutivos++;
                        console.log(`❌ ${progreso} Error: ${resultado.error}`);
                        
                        // Verificar si es error de autenticación
                        if (this.esErrorDeAutenticacion(new Error(resultado.error))) {
                            this.pausarDescarga('Cookie expirada o error de autenticación', stats, i, descargas.length);
                            return { pausado: true, stats, indice: i };
                        }
                    }

                } catch (error) {
                    stats.errores++;
                    erroresConsecutivos++;
                    console.log(`❌ ${progreso} Error inesperado: ${error.message}`);
                    
                    // Verificar si es error de autenticación
                    if (this.esErrorDeAutenticacion(error)) {
                        this.pausarDescarga('Cookie expirada o error de autenticación', stats, i, descargas.length);
                        return { pausado: true, stats, indice: i };
                    }
                }

                // Verificar si hay demasiados errores consecutivos
                if (erroresConsecutivos >= maxErroresConsecutivos) {
                    this.pausarDescarga(`Demasiados errores consecutivos (${erroresConsecutivos})`, stats, i, descargas.length);
                    return { pausado: true, stats, indice: i };
                }

                // Pausa entre descargas (excepto en la última)
                if (i < descargas.length - 1) {
                    await this.esperar(this.delayMs);
                }

                // Guardar progreso y mostrar estadísticas cada 10 archivos
                if ((i + 1) % 10 === 0) {
                    this.guardarProgreso(stats, i, descargas.length);
                    this.mostrarEstadisticasIntermedias(stats, i + 1);
                }
            }

            // Estadísticas finales
            this.mostrarEstadisticasFinales(stats);
            return stats;

        } catch (error) {
            console.error('❌ Error general en la descarga:', error.message);
            throw error;
        }
    }

    /**
     * Extrae todos los IDs únicos del archivo JSON para descarga
     */
    extraerIDsParaDescarga(idsData) {
        const descargas = [];
        const idsVistos = new Set();

        idsData.forEach(item => {
            const rolCausa = Object.keys(item)[0];
            const sentencias = item[rolCausa];

            // Procesar sentenciaTribunal
            if (sentencias.sentenciaTribunal && !idsVistos.has(sentencias.sentenciaTribunal)) {
                descargas.push({
                    id: sentencias.sentenciaTribunal,
                    rolCausa: rolCausa,
                    tipo: 'sentenciaTribunal',
                    nombreArchivo: `${rolCausa}_${sentencias.sentenciaTribunal}.pdf`
                });
                idsVistos.add(sentencias.sentenciaTribunal);
            }

            // Procesar sentenciaCA
            if (sentencias.sentenciaCA && !idsVistos.has(sentencias.sentenciaCA)) {
                descargas.push({
                    id: sentencias.sentenciaCA,
                    rolCausa: rolCausa,
                    tipo: 'sentenciaCA',
                    nombreArchivo: `${rolCausa}_CA_${sentencias.sentenciaCA}.pdf`
                });
                idsVistos.add(sentencias.sentenciaCA);
            }

            // Procesar sentenciaCS
            if (sentencias.sentenciaCS && !idsVistos.has(sentencias.sentenciaCS)) {
                descargas.push({
                    id: sentencias.sentenciaCS,
                    rolCausa: rolCausa,
                    tipo: 'sentenciaCS',
                    nombreArchivo: `${rolCausa}_CS_${sentencias.sentenciaCS}.pdf`
                });
                idsVistos.add(sentencias.sentenciaCS);
            }
        });

        return descargas;
    }

    /**
     * Descarga un archivo individual
     */
    async descargarArchivo(descarga) {
        const rutaArchivo = path.join(this.downloadDir, descarga.nombreArchivo);
        
        // Verificar si el archivo ya existe
        if (fs.existsSync(rutaArchivo)) {
            return { omitido: true };
        }

        const url = `${this.baseUrl}${descarga.id}?inlineifpossible=true`;

        for (let intento = 1; intento <= this.maxRetries; intento++) {
            try {
                const resultado = await this.realizarDescarga(url, rutaArchivo);
                return { exitoso: true, tamaño: resultado.tamaño };
            } catch (error) {
                if (intento === this.maxRetries) {
                    return { exitoso: false, error: `Falló después de ${this.maxRetries} intentos: ${error.message}` };
                }
                console.log(`⚠️  Intento ${intento} falló, reintentando... (${error.message})`);
                await this.esperar(1000 * intento); // Pausa incremental
            }
        }
    }

    /**
     * Realiza la descarga HTTP/HTTPS con manejo de redirecciones y cabeceras completas
     */
    realizarDescarga(url, rutaArchivo, maxRedirects = 5) {
        return new Promise((resolve, reject) => {
            const protocolo = url.startsWith('https:') ? https : http;
            const URL = require('url').URL;
            const urlObj = new URL(url);
            
            // Configurar opciones con todas las cabeceras del curl
            const options = {
                hostname: urlObj.hostname,
                port: urlObj.port,
                path: urlObj.pathname + urlObj.search,
                method: 'GET',
                headers: {
                    'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
                    'accept-language': 'es-ES,es;q=0.9',
                    'cache-control': 'no-cache',
                    'cookie': `JSESSIONID=${this.cookieJSESSIONID}`,
                    'pragma': 'no-cache',
                    'priority': 'u=0, i',
                    'referer': 'https://tcp.lexsoft.cl/tcp/sentencia',
                    'sec-ch-ua': '"Not;A=Brand";v="99", "Google Chrome";v="139", "Chromium";v="139"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'document',
                    'sec-fetch-mode': 'navigate',
                    'sec-fetch-site': 'same-origin',
                    'sec-fetch-user': '?1',
                    'upgrade-insecure-requests': '1',
                    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36'
                }
            };
            
            const request = protocolo.request(options, (response) => {
                // Manejar redirecciones
                if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                    if (maxRedirects <= 0) {
                        reject(new Error('Demasiadas redirecciones'));
                        return;
                    }
                    
                    let nuevaUrl = response.headers.location;
                    
                    // Si la redirección es relativa, hacerla absoluta
                    if (!nuevaUrl.startsWith('http')) {
                        const baseUrl = `${urlObj.protocol}//${urlObj.hostname}${urlObj.port ? ':' + urlObj.port : ''}`;
                        if (nuevaUrl.startsWith('/')) {
                            nuevaUrl = baseUrl + nuevaUrl;
                        } else {
                            nuevaUrl = baseUrl + urlObj.pathname.substring(0, urlObj.pathname.lastIndexOf('/') + 1) + nuevaUrl;
                        }
                    }
                    
                    console.log(`   🔄 Redirigiendo a: ${nuevaUrl}`);
                    
                    // Llamada recursiva con la nueva URL
                    this.realizarDescarga(nuevaUrl, rutaArchivo, maxRedirects - 1)
                        .then(resolve)
                        .catch(reject);
                    return;
                }

                // Verificar código de estado
                if (response.statusCode !== 200) {
                    reject(new Error(`HTTP ${response.statusCode}: ${response.statusMessage}`));
                    return;
                }

                // Verificar que es un PDF (más flexible)
                const contentType = response.headers['content-type'];
                if (contentType && 
                    !contentType.includes('application/pdf') && 
                    !contentType.includes('application/octet-stream') &&
                    !contentType.includes('binary/octet-stream')) {
                    console.log(`   ⚠️ Tipo de contenido: ${contentType} (continuando...)`);
                }

                // Crear stream de escritura
                const fileStream = fs.createWriteStream(rutaArchivo);
                let tamaño = 0;

                response.on('data', (chunk) => {
                    tamaño += chunk.length;
                });

                response.pipe(fileStream);

                fileStream.on('finish', () => {
                    fileStream.close();
                    
                    // Verificar que el archivo no esté vacío
                    if (tamaño === 0) {
                        fs.unlink(rutaArchivo, () => {});
                        reject(new Error('Archivo descargado vacío'));
                        return;
                    }
                    
                    resolve({ tamaño });
                });

                fileStream.on('error', (error) => {
                    fs.unlink(rutaArchivo, () => {}); // Limpiar archivo parcial
                    reject(error);
                });

            }).on('error', (error) => {
                reject(error);
            });

            // Timeout
            request.setTimeout(this.timeoutMs, () => {
                request.destroy();
                reject(new Error('Timeout de descarga'));
            });

            // Iniciar la petición
            request.end();
        });
    }

    /**
     * Función auxiliar para esperar
     */
    esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Mostrar estadísticas intermedias
     */
    mostrarEstadisticasIntermedias(stats, procesados) {
        const tiempoTranscurrido = (new Date() - stats.inicioTiempo) / 1000;
        const velocidad = procesados / tiempoTranscurrido;
        const tiempoRestante = (stats.total - procesados) / velocidad;

        console.log(`\n📊 Progreso: ${procesados}/${stats.total}`);
        console.log(`✅ Exitosos: ${stats.exitosos} | ❌ Errores: ${stats.errores} | ⏭️ Omitidos: ${stats.omitidos}`);
        console.log(`⏱️  Tiempo transcurrido: ${Math.round(tiempoTranscurrido)}s | Tiempo estimado restante: ${Math.round(tiempoRestante)}s\n`);
    }

    /**
     * Mostrar estadísticas finales
     */
    mostrarEstadisticasFinales(stats) {
        const tiempoTotal = (new Date() - stats.inicioTiempo) / 1000;
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMEN FINAL DE DESCARGAS');
        console.log('='.repeat(60));
        console.log(`Total de archivos procesados: ${stats.total}`);
        console.log(`✅ Descargas exitosas: ${stats.exitosos}`);
        console.log(`❌ Errores: ${stats.errores}`);
        console.log(`⏭️  Archivos omitidos (ya existían): ${stats.omitidos}`);
        console.log(`⏱️  Tiempo total: ${Math.round(tiempoTotal)}s (${Math.round(tiempoTotal/60)}m)`);
        console.log(`📁 Directorio: ${this.downloadDir}`);
        console.log('='.repeat(60));
    }

    /**
     * Función para mostrar información sobre la configuración
     */
    mostrarConfiguracion() {
        console.log('🔧 CONFIGURACIÓN DEL DESCARGADOR');
        console.log('================================');
        console.log(`URL base: ${this.baseUrl}`);
        console.log(`Directorio de descarga: ${this.downloadDir}`);
        console.log(`Pausa entre descargas: ${this.delayMs}ms`);
        console.log(`Máximo reintentos: ${this.maxRetries}`);
        console.log(`Timeout por descarga: ${this.timeoutMs}ms`);
        console.log('\n📋 CABECERAS HTTP CONFIGURADAS:');
        console.log('- User-Agent: Chrome 139.0.0.0');
        console.log('- Cookie: JSESSIONID incluida');
        console.log('- Accept: HTML, XML, PDF, imágenes');
        console.log('- Referer: https://tcp.lexsoft.cl/tcp/sentencia');
        console.log('- Cache-Control: no-cache');
        console.log('================================\n');
    }

    /**
     * Función para descargar solo algunos archivos de prueba
     */
    async descargarPrueba(cantidad = 5) {
        try {
            console.log(`🧪 Modo prueba: descargando ${cantidad} archivos...\n`);
            
            const idsData = JSON.parse(fs.readFileSync('ids_sentencias_tribunal.json', 'utf8'));
            const todasLasDescargas = this.extraerIDsParaDescarga(idsData);
            const descargasPrueba = todasLasDescargas.slice(0, cantidad);

            // Crear directorio de prueba
            const pruebaDir = 'sentencias_prueba';
            if (!fs.existsSync(pruebaDir)) {
                fs.mkdirSync(pruebaDir, { recursive: true });
            }

            const dirOriginal = this.downloadDir;
            this.downloadDir = pruebaDir;

            for (let i = 0; i < descargasPrueba.length; i++) {
                const descarga = descargasPrueba[i];
                console.log(`[${i + 1}/${cantidad}] Descargando: ${descarga.nombreArchivo}`);
                
                const resultado = await this.descargarArchivo(descarga);
                
                if (resultado.exitoso) {
                    console.log(`✅ Exitoso: ${descarga.nombreArchivo} (${resultado.tamaño} bytes)`);
                } else {
                    console.log(`❌ Error: ${resultado.error}`);
                }

                if (i < descargasPrueba.length - 1) {
                    await this.esperar(this.delayMs);
                }
            }

            this.downloadDir = dirOriginal;
            console.log(`\n🧪 Prueba completada. Archivos en: ${pruebaDir}`);

        } catch (error) {
            console.error('❌ Error en modo prueba:', error.message);
        }
    }
}

// Exportar la clase
module.exports = DescargadorSentencias;

// Si se ejecuta directamente
if (require.main === module) {
    // Verificar argumentos de línea de comandos
    const args = process.argv.slice(2);
    
    // Extraer cookie si se proporciona
    let cookieJSESSIONID = 'UhcNcsr6anOtugRG4SgLi1hr'; // Cookie por defecto
    const cookieIndex = args.indexOf('--cookie');
    if (cookieIndex !== -1 && args[cookieIndex + 1]) {
        cookieJSESSIONID = args[cookieIndex + 1];
        console.log('🍪 Usando cookie personalizada');
    }
    
    const descargador = new DescargadorSentencias(cookieJSESSIONID);
    
    if (args.includes('--help') || args.includes('-h')) {
        console.log('🔧 DESCARGADOR DE SENTENCIAS TCP');
        console.log('================================');
        console.log('Uso: node descargarSentenciasContratacionPublica.js [opciones]');
        console.log('\nOpciones:');
        console.log('  --help, -h              Mostrar esta ayuda');
        console.log('  --config                Mostrar configuración actual');
        console.log('  --estado                Mostrar estado del progreso guardado');
        console.log('  --prueba [N]            Descargar N archivos de prueba (defecto: 5)');
        console.log('  --reanudar              Reanudar descarga desde último punto');
        console.log('  --cookie "JSESSIONID"   Usar cookie personalizada');
        console.log('  --limpiar               Limpiar archivos de progreso');
        console.log('\nEjemplos:');
        console.log('  # Descarga completa');
        console.log('  node descargarSentenciasContratacionPublica.js');
        console.log('');
        console.log('  # Prueba con 3 archivos');
        console.log('  node descargarSentenciasContratacionPublica.js --prueba 3');
        console.log('');
        console.log('  # Reanudar con nueva cookie');
        console.log('  node descargarSentenciasContratacionPublica.js --reanudar --cookie "ABC123"');
        console.log('');
        console.log('  # Ver estado actual');
        console.log('  node descargarSentenciasContratacionPublica.js --estado');
        console.log('================================');
    } else if (args.includes('--config')) {
        descargador.mostrarConfiguracion();
    } else if (args.includes('--estado')) {
        // Mostrar estado de progreso
        const progreso = descargador.cargarProgreso();
        if (progreso) {
            console.log('📊 ESTADO DEL PROGRESO');
            console.log('======================');
            console.log(`Última actualización: ${progreso.fechaUltimaActualizacion}`);
            console.log(`Progreso: ${progreso.indiceActual + 1}/${progreso.totalDescargas}`);
            console.log(`Exitosos: ${progreso.estadisticas.exitosos}`);
            console.log(`Errores: ${progreso.estadisticas.errores}`);
            console.log(`Omitidos: ${progreso.estadisticas.omitidos}`);
            console.log(`Cookie usada: ${progreso.cookieUsada}`);
        } else {
            console.log('⚠️ No se encontró progreso guardado');
        }
    } else if (args.includes('--reanudar')) {
        descargador.mostrarConfiguracion();
        descargador.descargarTodasLasSentencias(true)
            .then(resultado => {
                if (resultado.pausado) {
                    console.log('\n⏸️ Descarga pausada por errores de autenticación');
                    process.exit(2);
                } else {
                    console.log('\n🎉 Descarga reanudada y completada!');
                    process.exit(0);
                }
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    } else if (args.includes('--prueba')) {
        const cantidad = parseInt(args[args.indexOf('--prueba') + 1]) || 5;
        descargador.mostrarConfiguracion();
        descargador.descargarPrueba(cantidad);
    } else if (args.includes('--limpiar')) {
        // Limpiar archivos de progreso
        if (fs.existsSync('progreso_descarga.json')) {
            fs.unlinkSync('progreso_descarga.json');
            console.log('✅ Archivo de progreso eliminado');
        }
        if (fs.existsSync('descarga_pausada.flag')) {
            fs.unlinkSync('descarga_pausada.flag');
            console.log('✅ Archivo de pausa eliminado');
        }
        console.log('🧹 Limpieza completada');
    } else {
        descargador.mostrarConfiguracion();
        descargador.descargarTodasLasSentencias()
            .then(resultado => {
                if (resultado.pausado) {
                    console.log('\n⏸️ Descarga pausada por errores de autenticación');
                    console.log('🔄 Actualiza la cookie y ejecuta: --reanudar --cookie "NUEVA_COOKIE"');
                    process.exit(2);
                } else {
                    console.log('\n🎉 Proceso de descarga completado!');
                    process.exit(0);
                }
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    }
}
