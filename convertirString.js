const fs = require('fs');
const path = require('path');

/**
 * Clase para convertir archivos TXT en strings simples y limpios
 */
class ConvertirString {
    constructor(carpetaTXT = 'sentencias_descargadas') {
        this.carpetaTXT = carpetaTXT;
    }

    /**
     * Función principal para convertir todos los archivos TXT a strings simples
     */
    async convertirTodosLosTXT() {
        try {
            console.log('📝 Iniciando conversión de archivos TXT a strings simples...\n');

            // Verificar carpeta
            if (!fs.existsSync(this.carpetaTXT)) {
                throw new Error(`No se encuentra la carpeta: ${this.carpetaTXT}`);
            }

            // Escanear todos los archivos TXT
            const archivosTXT = fs.readdirSync(this.carpetaTXT)
                .filter(archivo => archivo.endsWith('.txt'))
                .map(archivo => ({
                    nombre: archivo,
                    nombreString: archivo.replace('.txt', '_string.txt'),
                    rutaOriginal: path.join(this.carpetaTXT, archivo),
                    rutaString: path.join(this.carpetaTXT, archivo.replace('.txt', '_string.txt')),
                    tamaño: fs.statSync(path.join(this.carpetaTXT, archivo)).size
                }));

            console.log(`📊 Archivos TXT encontrados: ${archivosTXT.length}`);

            const stats = {
                totalProcesados: 0,
                exitosos: 0,
                yaExisten: 0,
                errores: 0,
                archivosVacios: 0,
                caracteresOriginales: 0,
                caracteresLimpios: 0,
                inicioTiempo: new Date()
            };

            // Procesar cada archivo TXT
            for (let i = 0; i < archivosTXT.length; i++) {
                const archivo = archivosTXT[i];
                const progreso = `[${i + 1}/${archivosTXT.length}]`;

                console.log(`${progreso} Procesando: ${archivo.nombre} (${archivo.tamaño} bytes)`);

                try {
                    stats.totalProcesados++;

                    // Verificar si el archivo string ya existe
                    if (fs.existsSync(archivo.rutaString)) {
                        stats.yaExisten++;
                        console.log(`   ⏭️  Ya existe: ${archivo.nombreString}`);
                        continue;
                    }

                    // Verificar si es archivo vacío
                    if (archivo.tamaño === 0) {
                        stats.archivosVacios++;
                        fs.writeFileSync(archivo.rutaString, '', 'utf8');
                        console.log(`   ⚠️  Archivo vacío, creado string vacío`);
                        continue;
                    }

                    // Leer contenido del archivo TXT
                    const contenidoOriginal = fs.readFileSync(archivo.rutaOriginal, 'utf8');
                    stats.caracteresOriginales += contenidoOriginal.length;

                    // Convertir a string simple
                    const stringLimpio = this.convertirAStringSimple(contenidoOriginal);
                    stats.caracteresLimpios += stringLimpio.length;

                    // Guardar string limpio
                    fs.writeFileSync(archivo.rutaString, stringLimpio, 'utf8');
                    stats.exitosos++;

                    const reduccion = Math.round(((contenidoOriginal.length - stringLimpio.length) / contenidoOriginal.length) * 100);
                    console.log(`   ✅ Convertido: ${archivo.nombreString} (${stringLimpio.length} chars, -${reduccion}%)`);

                } catch (error) {
                    stats.errores++;
                    console.log(`   ❌ Error procesando: ${error.message}`);
                    
                    // Crear archivo con mensaje de error
                    try {
                        fs.writeFileSync(archivo.rutaString, `[ERROR CONVIRTIENDO: ${error.message}]`, 'utf8');
                    } catch (writeError) {
                        console.log(`   ❌ Error adicional escribiendo: ${writeError.message}`);
                    }
                }

                // Pausa pequeña cada 20 archivos
                if (i % 20 === 19) {
                    await this.esperar(100);
                    this.mostrarEstadisticasIntermedias(stats, i + 1);
                }
            }

            // Mostrar estadísticas finales
            this.mostrarEstadisticasFinales(stats);

            return stats;

        } catch (error) {
            console.error('❌ Error en conversión de strings:', error.message);
            throw error;
        }
    }

    /**
     * Función para convertir un archivo TXT específico
     */
    async convertirArchivoTXT(rutaTXT, rutaString = null) {
        try {
            if (!fs.existsSync(rutaTXT)) {
                throw new Error(`No se encuentra el archivo: ${rutaTXT}`);
            }

            // Si no se especifica ruta de salida, usar la misma carpeta
            if (!rutaString) {
                const dirName = path.dirname(rutaTXT);
                const baseName = path.basename(rutaTXT, '.txt');
                rutaString = path.join(dirName, `${baseName}_string.txt`);
            }

            console.log(`📝 Convirtiendo: ${path.basename(rutaTXT)}`);

            const contenidoOriginal = fs.readFileSync(rutaTXT, 'utf8');
            const stringLimpio = this.convertirAStringSimple(contenidoOriginal);

            fs.writeFileSync(rutaString, stringLimpio, 'utf8');

            const reduccion = Math.round(((contenidoOriginal.length - stringLimpio.length) / contenidoOriginal.length) * 100);
            console.log(`✅ Convertido: ${path.basename(rutaString)} (${stringLimpio.length} chars, -${reduccion}%)`);

            return { 
                exito: true, 
                caracteresOriginales: contenidoOriginal.length,
                caracteresLimpios: stringLimpio.length,
                reduccion: reduccion
            };

        } catch (error) {
            console.error(`❌ Error convirtiendo archivo: ${error.message}`);
            throw error;
        }
    }

    /**
     * Función principal que convierte texto a string simple y limpio
     */
    convertirAStringSimple(texto) {
        if (!texto || typeof texto !== 'string') {
            return '';
        }

        let stringLimpio = texto;

        // 1. Remover caracteres de control y especiales
        stringLimpio = stringLimpio.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '');

        // 2. Normalizar espacios en blanco
        stringLimpio = stringLimpio.replace(/\s+/g, ' ');

        // 3. Remover múltiples saltos de línea
        stringLimpio = stringLimpio.replace(/\n\s*\n\s*\n/g, '\n\n');

        // 4. Limpiar espacios al inicio y final de líneas
        stringLimpio = stringLimpio.replace(/^[ \t]+|[ \t]+$/gm, '');

        // 5. Remover líneas que solo contienen espacios
        stringLimpio = stringLimpio.replace(/^\s*$/gm, '');

        // 6. Normalizar puntuación
        stringLimpio = stringLimpio.replace(/\s+([.,;:!?])/g, '$1');
        stringLimpio = stringLimpio.replace(/([.,;:!?])\s+/g, '$1 ');

        // 7. Limpiar comillas y caracteres especiales
        stringLimpio = stringLimpio.replace(/[""]/g, '"');
        stringLimpio = stringLimpio.replace(/['']/g, "'");

        // 8. Remover espacios excesivos alrededor de paréntesis
        stringLimpio = stringLimpio.replace(/\s*\(\s*/g, ' (');
        stringLimpio = stringLimpio.replace(/\s*\)\s*/g, ') ');

        // 9. Limpiar números y fechas
        stringLimpio = stringLimpio.replace(/\s+(\d)/g, ' $1');
        stringLimpio = stringLimpio.replace(/(\d)\s+/g, '$1 ');

        // 10. Remover espacios múltiples finales
        stringLimpio = stringLimpio.replace(/ +/g, ' ');

        // 11. Limpiar inicio y final del texto completo
        stringLimpio = stringLimpio.trim();

        // 12. Limitar saltos de línea consecutivos a máximo 2
        stringLimpio = stringLimpio.replace(/\n{3,}/g, '\n\n');

        return stringLimpio;
    }

    /**
     * Función para limpiar string de manera más agresiva (solo texto esencial)
     */
    convertirAStringMinimo(texto) {
        if (!texto || typeof texto !== 'string') {
            return '';
        }

        let stringMinimo = texto;

        // Aplicar limpieza básica primero
        stringMinimo = this.convertirAStringSimple(stringMinimo);

        // Limpieza más agresiva
        // 1. Remover números de página, referencias, etc.
        stringMinimo = stringMinimo.replace(/^\d+\s*$/gm, '');
        stringMinimo = stringMinimo.replace(/^página\s+\d+.*$/gmi, '');

        // 2. Remover líneas muy cortas (probablemente encabezados o números)
        stringMinimo = stringMinimo.replace(/^.{1,3}$/gm, '');

        // 3. Remover patrones comunes de documentos legales
        stringMinimo = stringMinimo.replace(/^(CONSIDERANDO|VISTOS|POR TANTO):/gmi, '$1:');

        // 4. Convertir todo a un párrafo continuo (opcional)
        // stringMinimo = stringMinimo.replace(/\n+/g, ' ');

        // 5. Limpiar espacios finales
        stringMinimo = stringMinimo.replace(/ +/g, ' ').trim();

        return stringMinimo;
    }

    /**
     * Función para obtener solo las primeras N palabras
     */
    obtenerResumen(texto, numPalabras = 100) {
        if (!texto || typeof texto !== 'string') {
            return '';
        }

        const palabras = texto.split(/\s+/).filter(palabra => palabra.length > 0);
        const resumen = palabras.slice(0, numPalabras).join(' ');
        
        if (palabras.length > numPalabras) {
            return resumen + '...';
        }
        
        return resumen;
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
        const reduccionPromedio = stats.caracteresOriginales > 0 ? 
            Math.round(((stats.caracteresOriginales - stats.caracteresLimpios) / stats.caracteresOriginales) * 100) : 0;

        console.log(`\n📊 Progreso: ${procesados} archivos procesados`);
        console.log(`✅ Exitosos: ${stats.exitosos} | ⏭️ Ya existían: ${stats.yaExisten} | ❌ Errores: ${stats.errores}`);
        console.log(`📝 Reducción promedio: ${reduccionPromedio}%`);
        console.log(`⏱️  Tiempo transcurrido: ${Math.round(tiempoTranscurrido)}s\n`);
    }

    /**
     * Muestra estadísticas finales
     */
    mostrarEstadisticasFinales(stats) {
        const tiempoTotal = (new Date() - stats.inicioTiempo) / 1000;
        const reduccionTotal = stats.caracteresOriginales > 0 ? 
            Math.round(((stats.caracteresOriginales - stats.caracteresLimpios) / stats.caracteresOriginales) * 100) : 0;
        
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMEN FINAL DE CONVERSIÓN A STRINGS');
        console.log('='.repeat(60));
        console.log(`Total archivos procesados: ${stats.totalProcesados}`);
        console.log(`✅ Conversiones exitosas: ${stats.exitosos}`);
        console.log(`⏭️  Archivos que ya existían: ${stats.yaExisten}`);
        console.log(`⚠️  Archivos vacíos: ${stats.archivosVacios}`);
        console.log(`❌ Errores: ${stats.errores}`);
        console.log(`📝 Caracteres originales: ${stats.caracteresOriginales.toLocaleString()}`);
        console.log(`📝 Caracteres limpios: ${stats.caracteresLimpios.toLocaleString()}`);
        console.log(`📉 Reducción total: ${reduccionTotal}%`);
        console.log(`⏱️  Tiempo total: ${Math.round(tiempoTotal)}s (${Math.round(tiempoTotal/60)}m)`);
        console.log(`📁 Carpeta procesada: ${this.carpetaTXT}`);
        console.log('='.repeat(60));
    }

    /**
     * Función para limpiar archivos string existentes
     */
    limpiarArchivosString() {
        try {
            console.log('🧹 Limpiando archivos string existentes...');

            const archivosString = fs.readdirSync(this.carpetaTXT)
                .filter(archivo => archivo.includes('_string.txt'));

            let eliminados = 0;
            archivosString.forEach(archivo => {
                const rutaString = path.join(this.carpetaTXT, archivo);
                fs.unlinkSync(rutaString);
                eliminados++;
            });

            console.log(`✅ ${eliminados} archivos string eliminados`);
            return eliminados;

        } catch (error) {
            console.error('❌ Error limpiando archivos string:', error.message);
            throw error;
        }
    }

    /**
     * Función para contar archivos
     */
    contarArchivos() {
        try {
            const archivos = fs.readdirSync(this.carpetaTXT);
            const txts = archivos.filter(archivo => archivo.endsWith('.txt') && !archivo.includes('_string')).length;
            const strings = archivos.filter(archivo => archivo.includes('_string.txt')).length;

            console.log(`📊 Archivos en ${this.carpetaTXT}:`);
            console.log(`   TXTs originales: ${txts}`);
            console.log(`   Strings convertidos: ${strings}`);
            console.log(`   Diferencia: ${txts - strings} TXTs sin convertir`);

            return { txts, strings, diferencia: txts - strings };

        } catch (error) {
            console.error('❌ Error contando archivos:', error.message);
            throw error;
        }
    }
}

// Exportar la clase
module.exports = ConvertirString;

// Si se ejecuta directamente
if (require.main === module) {
    const convertidor = new ConvertirString();
    const args = process.argv.slice(2);

    if (args.includes('--help')) {
        console.log('📝 CONVERTIDOR TXT A STRING SIMPLE');
        console.log('==================================');
        console.log('Uso: node convertirString.js [opciones]');
        console.log('\nOpciones:');
        console.log('  --help                  Mostrar esta ayuda');
        console.log('  --carpeta [RUTA]       Procesar carpeta específica');
        console.log('  --archivo [TXT] [OUT]  Procesar archivo específico');
        console.log('  --contar               Contar archivos TXT y strings');
        console.log('  --limpiar              Eliminar archivos string existentes');
        console.log('\nEjemplos:');
        console.log('  # Procesar carpeta por defecto (sentencias_descargadas)');
        console.log('  node convertirString.js');
        console.log('');
        console.log('  # Procesar carpeta específica');
        console.log('  node convertirString.js --carpeta error');
        console.log('');
        console.log('  # Procesar archivo específico');
        console.log('  node convertirString.js --archivo archivo.txt salida.txt');
        console.log('');
        console.log('  # Contar archivos');
        console.log('  node convertirString.js --contar');
        console.log('==================================');
    } else if (args.includes('--carpeta')) {
        const carpetaIndex = args.indexOf('--carpeta');
        const carpeta = args[carpetaIndex + 1] || 'sentencias_descargadas';
        
        const convertidorCarpeta = new ConvertirString(carpeta);
        convertidorCarpeta.convertirTodosLosTXT()
            .then(stats => {
                console.log('\n🎉 Conversión de carpeta completada!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    } else if (args.includes('--archivo')) {
        const archivoIndex = args.indexOf('--archivo');
        const rutaTXT = args[archivoIndex + 1];
        const rutaString = args[archivoIndex + 2];
        
        if (!rutaTXT) {
            console.error('❌ Debe especificar la ruta del archivo TXT');
            process.exit(1);
        }
        
        convertidor.convertirArchivoTXT(rutaTXT, rutaString)
            .then(resultado => {
                console.log('\n🎉 Conversión de archivo completada!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    } else if (args.includes('--contar')) {
        convertidor.contarArchivos();
    } else if (args.includes('--limpiar')) {
        convertidor.limpiarArchivosString();
    } else {
        // Conversión por defecto
        convertidor.convertirTodosLosTXT()
            .then(stats => {
                console.log('\n🎉 Conversión completada!');
                process.exit(0);
            })
            .catch(error => {
                console.error('\n💥 Error fatal:', error.message);
                process.exit(1);
            });
    }
}
