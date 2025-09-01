const fs = require('fs');
const path = require('path');
const pdf = require('pdf-parse');

/**
 * Clase para extraer texto de archivos PDF y crear archivos TXT correspondientes
 */
class ExtractorTextoPDF {
    constructor(carpetaPDFs = 'sentencias_descargadas') {
        this.carpetaPDFs = carpetaPDFs;
    }

    /**
     * Función principal para extraer texto de todos los PDFs y crear archivos TXT
     */
    async extraerTextoTodosLosPDFs() {
        try {
            console.log('📄 Iniciando extracción de texto de PDFs a archivos TXT...\n');

            // Verificar carpeta de PDFs
            if (!fs.existsSync(this.carpetaPDFs)) {
                throw new Error(`No se encuentra la carpeta: ${this.carpetaPDFs}`);
            }

            // Escanear todos los PDFs
            const archivosPDF = fs.readdirSync(this.carpetaPDFs)
                .filter(archivo => archivo.endsWith('.pdf'))
                .map(archivo => ({
                    nombre: archivo,
                    nombreTXT: archivo.replace('.pdf', '.txt'),
                    rutaPDF: path.join(this.carpetaPDFs, archivo),
                    rutaTXT: path.join(this.carpetaPDFs, archivo.replace('.pdf', '.txt')),
                    tamaño: fs.statSync(path.join(this.carpetaPDFs, archivo)).size
                }));

            console.log(`📊 PDFs encontrados: ${archivosPDF.length}`);

            const stats = {
                totalProcesados: 0,
                exitosos: 0,
                yaExisten: 0,
                errores: 0,
                archivosVacios: 0,
                inicioTiempo: new Date()
            };

            // Procesar cada PDF
            for (let i = 0; i < archivosPDF.length; i++) {
                const archivo = archivosPDF[i];
                const progreso = `[${i + 1}/${archivosPDF.length}]`;

                console.log(`${progreso} Procesando: ${archivo.nombre} (${archivo.tamaño} bytes)`);

                try {
                    stats.totalProcesados++;

                    // Verificar si el archivo TXT ya existe
                    if (fs.existsSync(archivo.rutaTXT)) {
                        stats.yaExisten++;
                        console.log(`   ⏭️  Ya existe: ${archivo.nombreTXT}`);
                        continue;
                    }

                    // Verificar si es archivo vacío
                    if (archivo.tamaño === 0) {
                        stats.archivosVacios++;
                        // Crear archivo TXT vacío para archivos PDF vacíos
                        fs.writeFileSync(archivo.rutaTXT, '[ARCHIVO PDF VACÍO]', 'utf8');
                        console.log(`   ⚠️  PDF vacío, creado TXT con marcador`);
                        continue;
                    }

                    // Extraer texto del PDF
                    const textoExtraido = await this.extraerTextoPDF(archivo.rutaPDF);

                    if (textoExtraido !== null) {
                        // Crear archivo TXT
                        fs.writeFileSync(archivo.rutaTXT, textoExtraido, 'utf8');
                        stats.exitosos++;
                        console.log(`   ✅ Creado: ${archivo.nombreTXT} (${textoExtraido.length} caracteres)`);
                    } else {
                        stats.errores++;
                        // Crear archivo TXT con mensaje de error
                        fs.writeFileSync(archivo.rutaTXT, '[ERROR: NO SE PUDO EXTRAER TEXTO DEL PDF]', 'utf8');
                        console.log(`   ❌ Error de extracción, creado TXT con marcador de error`);
                    }

                } catch (error) {
                    stats.errores++;
                    console.log(`   ❌ Error procesando: ${error.message}`);
                    
                    // Crear archivo TXT con mensaje de error
                    try {
                        fs.writeFileSync(archivo.rutaTXT, `[ERROR: ${error.message}]`, 'utf8');
                    } catch (writeError) {
                        console.log(`   ❌ Error adicional creando TXT: ${writeError.message}`);
                    }
                }

                // Pausa pequeña cada 10 archivos
                if (i % 10 === 9) {
                    await this.esperar(200);
                    this.mostrarEstadisticasIntermedias(stats, i + 1);
                }
            }

            // Mostrar estadísticas finales
            this.mostrarEstadisticasFinales(stats);

            return stats;

        } catch (error) {
            console.error('❌ Error en extracción de texto:', error.message);
            throw error;
        }
    }

    /**
     * Función para procesar solo una carpeta específica
     */
    async extraerTextoCarpeta(carpeta) {
        const carpetaOriginal = this.carpetaPDFs;
        this.carpetaPDFs = carpeta;
        
        try {
            const resultado = await this.extraerTextoTodosLosPDFs();
            return resultado;
        } finally {
            this.carpetaPDFs = carpetaOriginal;
        }
    }

    /**
     * Función para procesar un archivo específico
     */
    async extraerTextoArchivo(rutaPDF, rutaTXT = null) {
        try {
            if (!fs.existsSync(rutaPDF)) {
                throw new Error(`No se encuentra el archivo: ${rutaPDF}`);
            }

            // Si no se especifica ruta TXT, usar la misma carpeta y nombre
            if (!rutaTXT) {
                const dirName = path.dirname(rutaPDF);
                const baseName = path.basename(rutaPDF, '.pdf');
                rutaTXT = path.join(dirName, `${baseName}.txt`);
            }

            console.log(`📄 Extrayendo texto de: ${path.basename(rutaPDF)}`);

            const textoExtraido = await this.extraerTextoPDF(rutaPDF);

            if (textoExtraido !== null) {
                fs.writeFileSync(rutaTXT, textoExtraido, 'utf8');
                console.log(`✅ Archivo TXT creado: ${path.basename(rutaTXT)} (${textoExtraido.length} caracteres)`);
                return { exito: true, caracteres: textoExtraido.length };
            } else {
                fs.writeFileSync(rutaTXT, '[ERROR: NO SE PUDO EXTRAER TEXTO DEL PDF]', 'utf8');
                console.log(`❌ Error de extracción, creado TXT con marcador de error`);
                return { exito: false, error: 'No se pudo extraer texto' };
            }

        } catch (error) {
            console.error(`❌ Error procesando archivo: ${error.message}`);
            throw error;
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

            return texto.length > 0 ? texto : '[PDF SIN TEXTO EXTRAÍBLE]';
        } catch (error) {
            console.warn(`⚠️ Error extrayendo texto: ${error.message}`);
            return null;
        }
    }

    /**
     * Función auxiliar para esperar
     */
    esperar(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Muestra estadísticas intermedias
     */
    mostrarEstadisticasIntermedias(stats, procesados) {
        const tiempoTranscurrido = (new Date() - stats.inicioTiempo) / 1000;
        const velocidad = procesados / tiempoTranscurrido;
        const tiempoRestante = (stats.totalProcesados - procesados) / velocidad;

        console.log(`\n📊 Progreso: ${procesados} archivos procesados`);
        console.log(`✅ Exitosos: ${stats.exitosos} | ⏭️ Ya existían: ${stats.yaExisten} | ❌ Errores: ${stats.errores}`);
        console.log(`⏱️  Tiempo transcurrido: ${Math.round(tiempoTranscurrido)}s | Estimado restante: ${Math.round(tiempoRestante)}s\n`);
    }

    /**
     * Muestra estadísticas finales
     */
    mostrarEstadisticasFinales(stats) {
        const tiempoTotal = (new Date() - stats.inicioTiempo) / 1000;
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMEN FINAL DE EXTRACCIÓN DE TEXTO');
        console.log('='.repeat(60));
        console.log(`Total archivos procesados: ${stats.totalProcesados}`);
        console.log(`✅ Extracciones exitosas: ${stats.exitosos}`);
        console.log(`⏭️  Archivos que ya existían: ${stats.yaExisten}`);
        console.log(`⚠️  Archivos vacíos: ${stats.archivosVacios}`);
        console.log(`❌ Errores: ${stats.errores}`);
        console.log(`⏱️  Tiempo total: ${Math.round(tiempoTotal)}s (${Math.round(tiempoTotal/60)}m)`);
        console.log(`📁 Carpeta procesada: ${this.carpetaPDFs}`);
        console.log('='.repeat(60));
    }

    /**
     * Función para limpiar archivos TXT existentes
     */
    limpiarArchivosTXT() {
        try {
            console.log('🧹 Limpiando archivos TXT existentes...');

            const archivosTXT = fs.readdirSync(this.carpetaPDFs)
                .filter(archivo => archivo.endsWith('.txt'));

            let eliminados = 0;
            archivosTXT.forEach(archivo => {
                const rutaTXT = path.join(this.carpetaPDFs, archivo);
                fs.unlinkSync(rutaTXT);
                eliminados++;
            });

            console.log(`✅ ${eliminados} archivos TXT eliminados`);
            return eliminados;

        } catch (error) {
            console.error('❌ Error limpiando archivos TXT:', error.message);
            throw error;
        }
    }

    /**
     * Función para contar archivos
     */
    contarArchivos() {
        try {
            const archivos = fs.readdirSync(this.carpetaPDFs);
            const pdfs = archivos.filter(archivo => archivo.endsWith('.pdf')).length;
            const txts = archivos.filter(archivo => archivo.endsWith('.txt')).length;

            console.log(`📊 Archivos en ${this.carpetaPDFs}:`);
            console.log(`   PDFs: ${pdfs}`);
            console.log(`   TXTs: ${txts}`);
            console.log(`   Diferencia: ${pdfs - txts} PDFs sin TXT`);

            return { pdfs, txts, diferencia: pdfs - txts };

        } catch (error) {
            console.error('❌ Error contando archivos:', error.message);
            throw error;
        }
    }
}

// Exportar la clase
module.exports = ExtractorTextoPDF;

// Si se ejecuta directamente
if (require.main === module) {
    const extractor = new ExtractorTextoPDF();
    const args = process.argv.slice(2);

    if (args.includes('--help')) {
        console.log('📄 EXTRACTOR DE TEXTO PDF A TXT');
        console.log('================================');
        console.log('Uso: node extraccionTextoPdf.js [opciones]');
        console.log('\nOpciones:');
        console.log('  --help                  Mostrar esta ayuda');
        console.log('  --carpeta [RUTA]       Procesar carpeta específica');
        console.log('  --archivo [PDF] [TXT]  Procesar archivo específico');
        console.log('  --contar               Contar archivos PDF y TXT');
        console.log('  --limpiar              Eliminar archivos TXT existentes');
        console.log('\nEjemplos:');
        console.log('  # Procesar carpeta por defecto (sentencias_descargadas)');
        console.log('  node extraccionTextoPdf.js');
        console.log('');
        console.log('  # Procesar carpeta específica');
        console.log('  node extraccionTextoPdf.js --carpeta error');
        console.log('');
        console.log('  # Procesar archivo específico');
        console.log('  node extraccionTextoPdf.js --archivo archivo.pdf archivo.txt');
        console.log('');
        console.log('  # Contar archivos');
        console.log('  node extraccionTextoPdf.js --contar');
        console.log('================================');
    } else if (args.includes('--carpeta')) {
        const carpetaIndex = args.indexOf('--carpeta');
        const carpeta = args[carpetaIndex + 1] || 'sentencias_descargadas';
        
        extractor.extraerTextoCarpeta(carpeta)
            .then(stats => {
                console.log('\n🎉 Extracción de carpeta completada!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    } else if (args.includes('--archivo')) {
        const archivoIndex = args.indexOf('--archivo');
        const rutaPDF = args[archivoIndex + 1];
        const rutaTXT = args[archivoIndex + 2];
        
        if (!rutaPDF) {
            console.error('❌ Debe especificar la ruta del archivo PDF');
            process.exit(1);
        }
        
        extractor.extraerTextoArchivo(rutaPDF, rutaTXT)
            .then(resultado => {
                console.log('\n🎉 Extracción de archivo completada!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    } else if (args.includes('--contar')) {
        extractor.contarArchivos();
    } else if (args.includes('--limpiar')) {
        extractor.limpiarArchivosTXT();
    } else {
        // Extracción por defecto
        extractor.extraerTextoTodosLosPDFs()
            .then(stats => {
                console.log('\n🎉 Extracción completada!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    }
}
