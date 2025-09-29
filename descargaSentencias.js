const fs = require('fs');
const https = require('https');
const http = require('http');
const path = require('path');
const url = require('url');

// Función para descargar un archivo
function descargarArchivo(urlArchivo, nombreArchivo, directorio = './sentencias') {
    return new Promise((resolve, reject) => {
        // Crear directorio si no existe
        if (!fs.existsSync(directorio)) {
            fs.mkdirSync(directorio, { recursive: true });
        }

        const rutaCompleta = path.join(directorio, nombreArchivo);
        
        // Verificar si el archivo ya existe
        if (fs.existsSync(rutaCompleta)) {
            console.log(`⚠️  El archivo ${nombreArchivo} ya existe, saltando descarga.`);
            resolve(rutaCompleta);
            return;
        }

        const parsedUrl = url.parse(urlArchivo);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        console.log(`📥 Descargando: ${nombreArchivo}`);
        
        const archivo = fs.createWriteStream(rutaCompleta);
        
        const request = protocol.get(urlArchivo, (response) => {
            // Manejar redirecciones (301, 302, 307, 308)
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
                archivo.close();
                fs.unlink(rutaCompleta, () => {}); // Eliminar archivo parcial
                
                console.log(`🔄 Redirigiendo ${nombreArchivo} a: ${response.headers.location}`);
                
                // Llamada recursiva con la nueva URL
                descargarArchivo(response.headers.location, nombreArchivo, directorio)
                    .then(resolve)
                    .catch(reject);
                return;
            }
            
            // Verificar código de estado
            if (response.statusCode !== 200) {
                archivo.close();
                fs.unlink(rutaCompleta, () => {}); // Eliminar archivo parcial
                reject(new Error(`Error HTTP: ${response.statusCode} para ${urlArchivo}`));
                return;
            }

            response.pipe(archivo);
            
            archivo.on('finish', () => {
                archivo.close();
                console.log(`✅ Descargado: ${nombreArchivo}`);
                resolve(rutaCompleta);
            });
        });

        request.on('error', (error) => {
            archivo.close();
            fs.unlink(rutaCompleta, () => {}); // Eliminar archivo parcial
            reject(error);
        });

        archivo.on('error', (error) => {
            archivo.close();
            fs.unlink(rutaCompleta, () => {}); // Eliminar archivo parcial
            reject(error);
        });
    });
}

// Función para extraer información completa de una URL
function extraerInformacionDeURL(url) {
    const info = {
        rol: null,
        caratulado: null,
        fechaElaboracion: null,
        url: url
    };
    
    // Extraer el nombre del archivo de la URL
    const nombreArchivo = url.substring(url.lastIndexOf('/') + 1);
    
    // Patrones para extraer rol
    const patternsRol = [
        /ROL-TdPI-(\d{4}-\d{4})/i,
        /ROL-TYDPI-N°-(\d{4}-\d{4})/i,
        /TdPI-(\d{4}-\d{4})/i,
        /TYDPI-N°-(\d{4}-\d{4})/i
    ];
    
    // Extraer rol
    for (const pattern of patternsRol) {
        const match = nombreArchivo.match(pattern);
        if (match) {
            info.rol = match[1];
            break;
        }
    }
    
    // Extraer caratulado (tipo de patente)
    const patternsCaratulado = [
        /PATENTE-DE-INVENCION-([A-Z-\s]+)-ROL/i,
        /PATENTE-DE-INVENCION-([A-Z-\s]+)\./i,
        /(\d+-)?PATENTE-DE-INVENCION-([A-Z-\s]+)-ROL/i
    ];
    
    for (const pattern of patternsCaratulado) {
        const match = nombreArchivo.match(pattern);
        if (match) {
            // Tomar el último grupo capturado que no sea un número
            let caratulado = match[match.length - 1] || match[1];
            if (caratulado) {
                // Limpiar y formatear
                caratulado = caratulado.replace(/-/g, ' ').trim();
                caratulado = `PATENTE DE INVENCIÓN ${caratulado}`;
                info.caratulado = caratulado;
                break;
            }
        }
    }
    
    // Extraer fecha de elaboración (formato DD-MM-YYYY antes de .pdf)
    const patternFecha = /(\d{2}-\d{2}-\d{4})\.pdf$/i;
    const matchFecha = nombreArchivo.match(patternFecha);
    if (matchFecha) {
        info.fechaElaboracion = matchFecha[1];
    }
    
    return info;
}

// Función para extraer el rol de una URL (mantener compatibilidad)
function extraerRolDeURL(url) {
    const info = extraerInformacionDeURL(url);
    return info.rol;
}

// Función para extraer enlaces PDF y roles del contenido HTML
function extraerEnlacesPDF(contenidoHTML) {
    const enlaces = [];
    const urlsVistas = new Set();
    
    // Regex para encontrar TODOS los enlaces con href que contengan .pdf
    const regexEnlaces = /<a\s+[^>]*href="([^"]*\.pdf[^"]*)"[^>]*>/g;
    
    let match;
    while ((match = regexEnlaces.exec(contenidoHTML)) !== null) {
        const urlPDF = match[1];
        
        // Extraer rol directamente de la URL
        const rol = extraerRolDeURL(urlPDF);
        
        if (rol) {
            const enlaceInfo = {
                url: urlPDF,
                rol: rol,
                nombreArchivo: `${rol}.pdf`,
                esDuplicado: urlsVistas.has(urlPDF)
            };
            
            enlaces.push(enlaceInfo);
            urlsVistas.add(urlPDF);
        } else {
            console.log(`⚠️  No se pudo extraer el rol de la URL: ${urlPDF}`);
        }
    }
    
    return enlaces;
}

// Función para crear array de objetos con información estructurada
function crearArrayInformacion(contenidoHTML) {
    const arrayInformacion = [];
    const urlsVistas = new Set();
    
    // Regex para encontrar TODOS los enlaces con href que contengan .pdf
    const regexEnlaces = /<a\s+[^>]*href="([^"]*\.pdf[^"]*)"[^>]*>/g;
    
    let match;
    while ((match = regexEnlaces.exec(contenidoHTML)) !== null) {
        const urlPDF = match[1];
        
        // Evitar duplicados exactos
        if (urlsVistas.has(urlPDF)) {
            continue;
        }
        urlsVistas.add(urlPDF);
        
        // Extraer información completa
        const info = extraerInformacionDeURL(urlPDF);
        
        if (info.rol) {
            arrayInformacion.push({
                rol: info.rol,
                caratulado: info.caratulado || 'PATENTE DE INVENCIÓN',
                fechaElaboracion: info.fechaElaboracion || 'No disponible',
                url: info.url
            });
        }
    }
    
    return arrayInformacion;
}

// Función principal
async function descargarTodasLasSentencias() {
    try {
        console.log('🚀 Iniciando descarga de sentencias...');
        
        // Leer el archivo page.txt
        if (!fs.existsSync('page.txt')) {
            throw new Error('El archivo page.txt no existe');
        }
        
        const contenido = fs.readFileSync('page.txt', 'utf8');
        console.log('📖 Archivo page.txt leído correctamente');
        
        // Crear array de información estructurada
        const arrayInformacion = crearArrayInformacion(contenido);
        console.log(`📋 Se creó array con ${arrayInformacion.length} objetos de información`);
        
        // Guardar array de información en archivo JSON
        fs.writeFileSync('informacion_patentes.json', JSON.stringify(arrayInformacion, null, 2));
        console.log('💾 Array de información guardado en: informacion_patentes.json');
        
        // Extraer enlaces PDF
        const enlaces = extraerEnlacesPDF(contenido);
        console.log(`🔍 Se encontraron ${enlaces.length} enlaces PDF`);
        
        if (enlaces.length === 0) {
            console.log('❌ No se encontraron enlaces PDF para descargar');
            return;
        }
        
        // Separar enlaces únicos y duplicados
        const enlacesUnicos = [];
        const duplicados = [];
        const nombresArchivos = {};
        const urlsVistas = new Set();
        
        enlaces.forEach(enlace => {
            // Si es la primera vez que vemos esta URL, es único
            if (!urlsVistas.has(enlace.url)) {
                enlacesUnicos.push(enlace);
                urlsVistas.add(enlace.url);
                
                // Trackear nombres de archivo para detectar diferentes URLs con mismo rol
                if (!nombresArchivos[enlace.nombreArchivo]) {
                    nombresArchivos[enlace.nombreArchivo] = [];
                }
                nombresArchivos[enlace.nombreArchivo].push(enlace);
            } else {
                // Es una URL duplicada exacta
                duplicados.push({
                    tipo: 'url_duplicada',
                    enlace: enlace,
                    razon: 'URL exacta duplicada'
                });
            }
        });
        
        // Detectar diferentes URLs que apuntan al mismo archivo (mismo rol)
        Object.keys(nombresArchivos).forEach(nombreArchivo => {
            const enlacesConMismoNombre = nombresArchivos[nombreArchivo];
            if (enlacesConMismoNombre.length > 1) {
                // El primero se mantiene como único, los demás son duplicados
                for (let i = 1; i < enlacesConMismoNombre.length; i++) {
                    duplicados.push({
                        tipo: 'mismo_rol',
                        enlace: enlacesConMismoNombre[i],
                        razon: `Mismo rol que ${enlacesConMismoNombre[0].url}`
                    });
                }
                // Remover duplicados de enlaces únicos
                enlacesUnicos.splice(enlacesUnicos.findIndex(e => e.url === enlacesConMismoNombre[1].url), enlacesConMismoNombre.length - 1);
            }
        });
        
        // Mostrar resumen de archivos a descargar
        console.log('\n📋 Enlaces únicos a descargar:');
        enlacesUnicos.forEach((enlace, index) => {
            console.log(`${index + 1}. ${enlace.nombreArchivo} - ${enlace.url.substring(enlace.url.lastIndexOf('/') + 1)}`);
        });
        
        if (duplicados.length > 0) {
            console.log('\n🔄 Enlaces duplicados encontrados:');
            duplicados.forEach((dup, index) => {
                console.log(`${index + 1}. ${dup.enlace.nombreArchivo} - ${dup.razon}`);
            });
        }
        
        console.log('\n🔄 Iniciando descargas...');
        
        // Estadísticas de seguimiento
        let exitosos = 0;
        let errores = 0;
        let yaExistian = 0;
        let duplicadosDescargados = 0;
        const erroresDetallados = [];
        
        // Función para generar timestamp
        const generarTimestamp = () => {
            const now = new Date();
            return now.toISOString().replace(/[:.]/g, '-').replace('T', '_').substring(0, 19);
        };
        
        // Descargar archivos únicos
        for (let i = 0; i < enlacesUnicos.length; i++) {
            const enlace = enlacesUnicos[i];
            try {
                const directorio = './sentencias';
                const rutaCompleta = path.join(directorio, enlace.nombreArchivo);
                
                // Verificar si ya existe antes de intentar descargar
                if (fs.existsSync(rutaCompleta)) {
                    yaExistian++;
                    console.log(`⚠️  El archivo ${enlace.nombreArchivo} ya existe, saltando descarga.`);
                } else {
                    await descargarArchivo(enlace.url, enlace.nombreArchivo, directorio);
                    exitosos++;
                }
                
                // Pequeña pausa entre descargas para ser respetuosos con el servidor
                if (i < enlacesUnicos.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            } catch (error) {
                console.error(`❌ Error descargando ${enlace.nombreArchivo}: ${error.message}`);
                errores++;
                erroresDetallados.push({
                    archivo: enlace.nombreArchivo,
                    url: enlace.url,
                    error: error.message
                });
            }
        }
        
        // Descargar duplicados en carpeta separada
        if (duplicados.length > 0) {
            console.log('\n📂 Descargando duplicados en carpeta separada...');
            
            for (let i = 0; i < duplicados.length; i++) {
                const dup = duplicados[i];
                const enlace = dup.enlace;
                
                try {
                    const directorioDescarga = './sentencias/duplicados';
                    const timestamp = generarTimestamp();
                    const nombreConTimestamp = `${enlace.rol}-${timestamp}.pdf`;
                    
                    await descargarArchivo(enlace.url, nombreConTimestamp, directorioDescarga);
                    duplicadosDescargados++;
                    console.log(`✅ Duplicado descargado: ${nombreConTimestamp}`);
                    
                    // Pequeña pausa entre descargas
                    if (i < duplicados.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                } catch (error) {
                    console.error(`❌ Error descargando duplicado ${enlace.nombreArchivo}: ${error.message}`);
                    errores++;
                    erroresDetallados.push({
                        archivo: enlace.nombreArchivo + ' (duplicado)',
                        url: enlace.url,
                        error: error.message
                    });
                }
            }
        }
        
        // Resumen final detallado
        console.log('\n' + '='.repeat(70));
        console.log('📊 RESUMEN FINAL DE DESCARGAS');
        console.log('='.repeat(70));
        console.log(`🔍 Total URLs encontradas: ${enlaces.length}`);
        console.log(`📋 Enlaces únicos: ${enlacesUnicos.length}`);
        console.log(`🔄 Enlaces duplicados: ${duplicados.length}`);
        console.log(`✅ Archivos únicos descargados: ${exitosos}`);
        console.log(`📂 Duplicados descargados: ${duplicadosDescargados}`);
        console.log(`⚠️  Archivos que ya existían: ${yaExistian}`);
        console.log(`❌ Errores: ${errores}`);
        console.log(`📁 Directorio principal: ./sentencias/`);
        console.log(`📁 Directorio duplicados: ./sentencias/duplicados/`);
        
        // Mostrar duplicados detallados si existen
        if (duplicados.length > 0) {
            console.log('\n🔄 DUPLICADOS DETECTADOS Y PROCESADOS:');
            console.log('-'.repeat(50));
            duplicados.forEach((dup, index) => {
                console.log(`${index + 1}. ${dup.enlace.nombreArchivo}`);
                console.log(`   Tipo: ${dup.tipo === 'url_duplicada' ? 'URL exacta duplicada' : 'Mismo rol, diferente URL'}`);
                console.log(`   URL: ${dup.enlace.url}`);
                console.log(`   Razón: ${dup.razon}`);
                console.log('');
            });
        } else {
            console.log('\n✅ No se detectaron URLs duplicadas');
        }
        
        // Mostrar errores detallados si existen
        if (erroresDetallados.length > 0) {
            console.log('\n❌ ERRORES DETALLADOS:');
            console.log('-'.repeat(40));
            erroresDetallados.forEach((error, index) => {
                console.log(`${index + 1}. ${error.archivo}`);
                console.log(`   URL: ${error.url}`);
                console.log(`   Error: ${error.error}`);
                console.log('');
            });
        }
        
        console.log('='.repeat(60));
        
    } catch (error) {
        console.error('❌ Error general:', error.message);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    descargarTodasLasSentencias();
}

// Función independiente para solo crear el array de información
async function crearArrayInformacionSolo() {
    try {
        console.log('🚀 Creando array de información de patentes...');
        
        // Leer el archivo page.txt
        if (!fs.existsSync('page.txt')) {
            throw new Error('El archivo page.txt no existe');
        }
        
        const contenido = fs.readFileSync('page.txt', 'utf8');
        console.log('📖 Archivo page.txt leído correctamente');
        
        // Crear array de información estructurada
        const arrayInformacion = crearArrayInformacion(contenido);
        console.log(`📋 Se creó array con ${arrayInformacion.length} objetos de información`);
        
        // Guardar array de información en archivo JSON
        fs.writeFileSync('informacion_patentes.json', JSON.stringify(arrayInformacion, null, 2));
        console.log('💾 Array de información guardado en: informacion_patentes.json');
        
        // Mostrar algunos ejemplos
        console.log('\n📋 Primeros 3 objetos del array:');
        arrayInformacion.slice(0, 3).forEach((obj, index) => {
            console.log(`${index + 1}. Rol: ${obj.rol}`);
            console.log(`   Caratulado: ${obj.caratulado}`);
            console.log(`   Fecha Elaboración: ${obj.fechaElaboracion}`);
            console.log(`   URL: ${obj.url.substring(0, 80)}...`);
            console.log('');
        });
        
        console.log(`✅ Proceso completado. Array con ${arrayInformacion.length} objetos guardado en informacion_patentes.json`);
        
        return arrayInformacion;
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        return null;
    }
}

module.exports = {
    descargarTodasLasSentencias,
    crearArrayInformacionSolo,
    crearArrayInformacion,
    extraerInformacionDeURL,
    extraerEnlacesPDF,
    descargarArchivo
};
