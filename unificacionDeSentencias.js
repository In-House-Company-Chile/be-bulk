const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

/**
 * Clase para unificar archivos PDF de sentencias con el JSON original
 * Extrae texto plano de PDFs y lo agrega como atributo plain_text
 */
class UnificadorSentencias {
    constructor() {
        this.jsonOriginal = 'tribunalContratacionPublicaFile.json';
        this.jsonBackup = 'tribunalContratacionPublicaFileBKP.json';
        this.jsonUnificado = 'tribunalContratacionPublicaFileUnificado.json';
        this.carpetaPDFs = 'sentencias_descargadas';
        this.archivoProgreso = 'progreso_unificacion.json';
    }

    /**
     * Función principal para unificar PDFs con JSON
     */
    async unificarSentenciasConPDFs() {
        try {
            console.log('🔄 Iniciando unificación de sentencias con PDFs...\n');

            // Verificar archivos necesarios
            this.verificarArchivosNecesarios();

            // Cargar JSON original
            console.log('📖 Cargando archivo JSON original...');
            const jsonData = JSON.parse(fs.readFileSync(this.jsonOriginal, 'utf8'));
            
            if (!jsonData.results || !Array.isArray(jsonData.results)) {
                throw new Error('El JSON no tiene la estructura esperada (results array)');
            }

            // Escanear PDFs disponibles
            console.log('📁 Escaneando PDFs disponibles...');
            const pdfsDisponibles = this.escanearPDFs();
            console.log(`📊 PDFs encontrados: ${pdfsDisponibles.length}`);

            // Crear mapa de PDFs por rolCausa + tipo + ID
            const mapaPDFs = this.crearMapaPDFs(pdfsDisponibles);

            // Procesar cada objeto del JSON
            console.log('\n🔄 Procesando objetos del JSON...');
            const stats = {
                objetosProcesados: 0,
                sentenciasTribunal: 0,
                sentenciasCA: 0,
                sentenciasCS: 0,
                pdfsEncontrados: 0,
                pdfsNoEncontrados: 0,
                erroresExtraccion: 0
            };

            for (let i = 0; i < jsonData.results.length; i++) {
                const objeto = jsonData.results[i];
                stats.objetosProcesados++;

                console.log(`[${i + 1}/${jsonData.results.length}] Procesando: ${objeto.rolCausa || 'sin-rol'}`);

                // Procesar sentenciaTribunal
                if (objeto.sentenciaTribunal && objeto.sentenciaTribunal.id) {
                    await this.procesarSentencia(
                        objeto.sentenciaTribunal, 
                        objeto.rolCausa, 
                        'sentenciaTribunal', 
                        mapaPDFs, 
                        stats
                    );
                    stats.sentenciasTribunal++;
                }

                // Procesar sentenciaCA
                if (objeto.sentenciaCA && objeto.sentenciaCA.id) {
                    await this.procesarSentencia(
                        objeto.sentenciaCA, 
                        objeto.rolCausa, 
                        'sentenciaCA', 
                        mapaPDFs, 
                        stats
                    );
                    stats.sentenciasCA++;
                }

                // Procesar sentenciaCS
                if (objeto.sentenciaCS && objeto.sentenciaCS.id) {
                    await this.procesarSentencia(
                        objeto.sentenciaCS, 
                        objeto.rolCausa, 
                        'sentenciaCS', 
                        mapaPDFs, 
                        stats
                    );
                    stats.sentenciasCS++;
                }

                // Guardar progreso cada 10 objetos
                if ((i + 1) % 10 === 0) {
                    this.guardarProgreso(stats, i + 1, jsonData.results.length);
                    this.mostrarEstadisticasIntermedias(stats, i + 1);
                }

                // Pausa pequeña para no sobrecargar el sistema
                if (i % 5 === 0) {
                    await this.esperar(100);
                }
            }

            // Guardar JSON unificado
            console.log('\n💾 Guardando JSON unificado...');
            fs.writeFileSync(this.jsonUnificado, JSON.stringify(jsonData, null, 2), 'utf8');

            // Mostrar estadísticas finales
            this.mostrarEstadisticasFinales(stats);

            return { exito: true, stats, archivoGenerado: this.jsonUnificado };

        } catch (error) {
            console.error('❌ Error en la unificación:', error.message);
            throw error;
        }
    }

    /**
     * Verifica que existan los archivos necesarios
     */
    verificarArchivosNecesarios() {
        if (!fs.existsSync(this.jsonOriginal)) {
            throw new Error(`No se encuentra el archivo: ${this.jsonOriginal}`);
        }

        if (!fs.existsSync(this.carpetaPDFs)) {
            throw new Error(`No se encuentra la carpeta: ${this.carpetaPDFs}`);
        }

        // Crear backup si no existe
        if (!fs.existsSync(this.jsonBackup)) {
            console.log('📋 Creando backup del JSON original...');
            fs.copyFileSync(this.jsonOriginal, this.jsonBackup);
        }
    }

    /**
     * Escanea la carpeta de PDFs y retorna lista de archivos
     */
    escanearPDFs() {
        const archivos = fs.readdirSync(this.carpetaPDFs)
            .filter(archivo => archivo.endsWith('.pdf'))
            .map(archivo => ({
                nombre: archivo,
                rutaCompleta: path.join(this.carpetaPDFs, archivo),
                tamaño: fs.statSync(path.join(this.carpetaPDFs, archivo)).size
            }));

        return archivos;
    }

    /**
     * Crea un mapa de PDFs organizados por rolCausa + tipo + ID
     */
    crearMapaPDFs(pdfsDisponibles) {
        const mapa = new Map();

        pdfsDisponibles.forEach(pdf => {
            const info = this.parsearNombrePDF(pdf.nombre);
            if (info) {
                const clave = `${info.rolCausa}_${info.tipo}_${info.id}`;
                mapa.set(clave, {
                    ...pdf,
                    ...info
                });
            }
        });

        console.log(`🗺️  Mapa de PDFs creado: ${mapa.size} archivos mapeados`);
        return mapa;
    }

    /**
     * Parsea el nombre del PDF para extraer rolCausa, tipo e ID
     * Formato esperado: rolCausa_[tipo_]ID.pdf
     */
    parsearNombrePDF(nombreArchivo) {
        try {
            // Remover extensión .pdf
            const sinExtension = nombreArchivo.replace('.pdf', '');
            
            // Dividir por guión bajo
            const partes = sinExtension.split('_');
            
            if (partes.length >= 2) {
                let rolCausa, tipo, id;
                
                if (partes.length === 2) {
                    // Formato: rolCausa_ID (sentenciaTribunal)
                    [rolCausa, id] = partes;
                    tipo = 'sentenciaTribunal';
                } else if (partes.length === 3) {
                    // Formato: rolCausa_tipo_ID (sentenciaCA o sentenciaCS)
                    [rolCausa, tipo, id] = partes;
                    
                    // Mapear tipos
                    if (tipo === 'CA') tipo = 'sentenciaCA';
                    else if (tipo === 'CS') tipo = 'sentenciaCS';
                    else tipo = 'sentenciaTribunal';
                }
                
                return {
                    rolCausa,
                    tipo,
                    id: parseInt(id) || id
                };
            }
        } catch (error) {
            console.warn(`⚠️ No se pudo parsear: ${nombreArchivo}`);
        }
        
        return null;
    }

    /**
     * Procesa una sentencia individual agregando el texto del PDF
     */
    async procesarSentencia(sentencia, rolCausa, tipoSentencia, mapaPDFs, stats) {
        try {
            // Crear clave para buscar PDF
            const clave = `${rolCausa}_${tipoSentencia}_${sentencia.id}`;
            const pdf = mapaPDFs.get(clave);

            if (pdf) {
                console.log(`   📄 Extrayendo texto de: ${pdf.nombre}`);
                
                // Extraer texto del PDF
                const textoExtraido = await this.extraerTextoPDF(pdf.rutaCompleta);
                
                if (textoExtraido && textoExtraido.trim().length > 0) {
                    sentencia.plain_text = textoExtraido;
                    stats.pdfsEncontrados++;
                    console.log(`   ✅ Texto extraído: ${textoExtraido.length} caracteres`);
                } else {
                    sentencia.plain_text = null;
                    stats.erroresExtraccion++;
                    console.log(`   ⚠️ PDF vacío o sin texto extraíble`);
                    fs.renameSync(pdf.rutaCompleta, pdf.rutaCompleta + '.error');
                    
                }
            } else {
                sentencia.plain_text = null;
                stats.pdfsNoEncontrados++;
                console.log(`   ❌ PDF no encontrado para: ${rolCausa}_${tipoSentencia}_${sentencia.id}`);
            }

        } catch (error) {
            sentencia.plain_text = null;
            stats.erroresExtraccion++;
            console.log(`   ❌ Error procesando sentencia: ${error.message}`);
        }
    }

    /**
     * Extrae texto plano de un archivo PDF
     */
    async extraerTextoPDF(rutaPDF) {
        try {
            const dataBuffer = fs.readFileSync(rutaPDF);
            const data = await pdf(dataBuffer);
            
            // Limpiar texto extraído
            let texto = data.text || '';
            
            // Normalizar espacios y saltos de línea
            texto = texto
                .replace(/\s+/g, ' ')  // Múltiples espacios a uno solo
                .replace(/\n\s*\n/g, '\n')  // Múltiples saltos de línea
                .trim();

            return texto;
        } catch (error) {
            console.warn(`⚠️ Error extrayendo texto de ${rutaPDF}: ${error.message}`);
            return null;
        }
    }

    /**
     * Guarda el progreso actual
     */
    guardarProgreso(stats, procesamientosActuales, total) {
        const progreso = {
            fechaActualizacion: new Date().toISOString(),
            procesamientosActuales,
            total,
            estadisticas: stats
        };

        fs.writeFileSync(this.archivoProgreso, JSON.stringify(progreso, null, 2), 'utf8');
    }

    /**
     * Muestra estadísticas intermedias
     */
    mostrarEstadisticasIntermedias(stats, procesados) {
        console.log(`\n📊 Progreso: ${procesados} objetos procesados`);
        console.log(`✅ PDFs encontrados: ${stats.pdfsEncontrados}`);
        console.log(`❌ PDFs no encontrados: ${stats.pdfsNoEncontrados}`);
        console.log(`⚠️ Errores de extracción: ${stats.erroresExtraccion}\n`);
    }

    /**
     * Muestra estadísticas finales
     */
    mostrarEstadisticasFinales(stats) {
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMEN FINAL DE UNIFICACIÓN');
        console.log('='.repeat(60));
        console.log(`Objetos procesados: ${stats.objetosProcesados}`);
        console.log(`SentenciasTribunal: ${stats.sentenciasTribunal}`);
        console.log(`SentenciasCA: ${stats.sentenciasCA}`);
        console.log(`SentenciasCS: ${stats.sentenciasCS}`);
        console.log(`PDFs encontrados y procesados: ${stats.pdfsEncontrados}`);
        console.log(`PDFs no encontrados: ${stats.pdfsNoEncontrados}`);
        console.log(`Errores de extracción: ${stats.erroresExtraccion}`);
        console.log(`Archivo generado: ${this.jsonUnificado}`);
        console.log('='.repeat(60));
    }

    /**
     * Función auxiliar para esperar
     */
    esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Función para probar con pocos archivos
     */
    async probarUnificacion(limite = 5) {
        try {
            console.log(`🧪 Modo prueba: procesando ${limite} objetos...\n`);

            const jsonData = JSON.parse(fs.readFileSync(this.jsonOriginal, 'utf8'));
            const objetosPrueba = jsonData.results.slice(0, limite);
            
            // Crear JSON temporal para prueba
            const jsonPrueba = {
                ...jsonData,
                results: objetosPrueba
            };

            // Guardar temporalmente
            const archivoTemporal = 'temp_prueba_unificacion.json';
            fs.writeFileSync(archivoTemporal, JSON.stringify(jsonPrueba, null, 2), 'utf8');

            // Cambiar archivos temporalmente
            const jsonOriginalBackup = this.jsonOriginal;
            const jsonUnificadoBackup = this.jsonUnificado;
            
            this.jsonOriginal = archivoTemporal;
            this.jsonUnificado = 'prueba_unificada.json';

            // Ejecutar unificación
            const resultado = await this.unificarSentenciasConPDFs();

            // Restaurar nombres
            this.jsonOriginal = jsonOriginalBackup;
            this.jsonUnificado = jsonUnificadoBackup;

            // Limpiar archivo temporal
            fs.unlinkSync(archivoTemporal);

            console.log(`\n🧪 Prueba completada. Resultado en: prueba_unificada.json`);
            return resultado;

        } catch (error) {
            console.error('❌ Error en modo prueba:', error.message);
            throw error;
        }
    }
}

// Exportar la clase
module.exports = UnificadorSentencias;

// Si se ejecuta directamente
if (require.main === module) {
    const unificador = new UnificadorSentencias();
    const args = process.argv.slice(2);

    if (args.includes('--prueba')) {
        const limite = parseInt(args[args.indexOf('--prueba') + 1]) || 5;
        unificador.probarUnificacion(limite)
            .then(resultado => {
                console.log('\n🎉 Prueba completada exitosamente!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Error en prueba:', error.message);
                process.exit(1);
            });
    } else if (args.includes('--help')) {
        console.log('🔧 UNIFICADOR DE SENTENCIAS');
        console.log('===========================');
        console.log('Uso: node unificacionDeSentencias.js [opciones]');
        console.log('\nOpciones:');
        console.log('  --help                  Mostrar esta ayuda');
        console.log('  --prueba [N]           Procesar solo N objetos (defecto: 5)');
        console.log('\nEjemplos:');
        console.log('  # Unificación completa');
        console.log('  node unificacionDeSentencias.js');
        console.log('');
        console.log('  # Prueba con 3 objetos');
        console.log('  node unificacionDeSentencias.js --prueba 3');
        console.log('===========================');
    } else {
        unificador.unificarSentenciasConPDFs()
            .then(resultado => {
                console.log('\n🎉 Unificación completada exitosamente!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    }
}
