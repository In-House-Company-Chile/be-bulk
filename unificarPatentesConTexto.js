const fs = require('fs');
const path = require('path');

// Función para leer todos los archivos _string.txt de la carpeta sentencias_descargadas
function leerArchivosString(directorioSentencias = './sentencias_descargadas') {
    const archivosString = {};
    
    try {
        if (!fs.existsSync(directorioSentencias)) {
            console.log(`⚠️  El directorio ${directorioSentencias} no existe`);
            return archivosString;
        }
        
        const archivos = fs.readdirSync(directorioSentencias);
        const archivosStringTxt = archivos.filter(archivo => archivo.endsWith('_string.txt'));
        
        console.log(`📁 Encontrados ${archivosStringTxt.length} archivos _string.txt`);
        
        archivosStringTxt.forEach(archivo => {
            try {
                // Extraer el rol del nombre del archivo (ej: "0002-2020_string.txt" -> "0002-2020")
                const rol = archivo.replace('_string.txt', '');
                
                // Leer el contenido del archivo
                const rutaCompleta = path.join(directorioSentencias, archivo);
                const contenido = fs.readFileSync(rutaCompleta, 'utf8');
                
                archivosString[rol] = contenido.trim();
                console.log(`✅ Leído: ${archivo} (${contenido.length} caracteres)`);
            } catch (error) {
                console.error(`❌ Error leyendo ${archivo}: ${error.message}`);
            }
        });
        
    } catch (error) {
        console.error(`❌ Error accediendo al directorio ${directorioSentencias}: ${error.message}`);
    }
    
    return archivosString;
}

// Función para unificar patentes con texto plano
function unificarPatentesConTexto() {
    try {
        console.log('🚀 Iniciando unificación de patentes con texto...');
        
        // Leer el archivo de información de patentes
        if (!fs.existsSync('informacion_patentes.json')) {
            throw new Error('El archivo informacion_patentes.json no existe. Ejecuta primero crearArrayPatentes.js');
        }
        
        const patentes = JSON.parse(fs.readFileSync('informacion_patentes.json', 'utf8'));
        console.log(`📋 Cargadas ${patentes.length} patentes del archivo JSON`);
        
        // Leer archivos _string.txt
        const archivosString = leerArchivosString();
        const rolesConTexto = Object.keys(archivosString);
        console.log(`📝 Encontrados textos para ${rolesConTexto.length} roles`);
        
        // Unificar datos
        let patentesConTexto = 0;
        let patentesSinTexto = 0;
        
        const patentesUnificadas = patentes.map(patente => {
            const patenteUnificada = {
                ...patente,
                plain_text: null
            };
            
            // Buscar texto correspondiente al rol
            if (archivosString[patente.rol]) {
                patenteUnificada.plain_text = archivosString[patente.rol];
                patentesConTexto++;
                console.log(`✅ Texto agregado para rol: ${patente.rol}`);
            } else {
                patentesSinTexto++;
                console.log(`⚠️  Sin texto para rol: ${patente.rol}`);
            }
            
            return patenteUnificada;
        });
        
        // Guardar resultado
        const nombreArchivoSalida = 'patentes_unificadas.json';
        fs.writeFileSync(nombreArchivoSalida, JSON.stringify(patentesUnificadas, null, 2));
        
        // Mostrar estadísticas
        console.log('\n' + '='.repeat(60));
        console.log('📊 RESUMEN DE UNIFICACIÓN');
        console.log('='.repeat(60));
        console.log(`📋 Total patentes procesadas: ${patentes.length}`);
        console.log(`✅ Patentes con texto: ${patentesConTexto}`);
        console.log(`⚠️  Patentes sin texto: ${patentesSinTexto}`);
        console.log(`📁 Archivos _string.txt encontrados: ${rolesConTexto.length}`);
        console.log(`💾 Archivo de salida: ${nombreArchivoSalida}`);
        
        // Mostrar roles sin texto si existen
        if (patentesSinTexto > 0) {
            console.log('\n⚠️  ROLES SIN TEXTO ENCONTRADO:');
            console.log('-'.repeat(40));
            patentes.forEach(patente => {
                if (!archivosString[patente.rol]) {
                    console.log(`   - ${patente.rol}`);
                }
            });
        }
        
        // Mostrar archivos de texto sin patente correspondiente
        const rolesSinPatente = rolesConTexto.filter(rol => 
            !patentes.some(patente => patente.rol === rol)
        );
        
        if (rolesSinPatente.length > 0) {
            console.log('\n📝 ARCHIVOS DE TEXTO SIN PATENTE CORRESPONDIENTE:');
            console.log('-'.repeat(50));
            rolesSinPatente.forEach(rol => {
                console.log(`   - ${rol}_string.txt`);
            });
        }
        
        console.log('='.repeat(60));
        console.log('✅ Unificación completada exitosamente');
        
        return patentesUnificadas;
        
    } catch (error) {
        console.error('❌ Error en la unificación:', error.message);
        return null;
    }
}

// Función para mostrar ejemplo de patente unificada
function mostrarEjemplo() {
    try {
        if (!fs.existsSync('patentes_unificadas.json')) {
            console.log('❌ Archivo patentes_unificadas.json no existe. Ejecuta primero la unificación.');
            return;
        }
        
        const patentesUnificadas = JSON.parse(fs.readFileSync('patentes_unificadas.json', 'utf8'));
        
        // Buscar una patente que tenga texto
        const patenteConTexto = patentesUnificadas.find(p => p.plain_text);
        
        if (patenteConTexto) {
            console.log('\n📋 EJEMPLO DE PATENTE UNIFICADA:');
            console.log('='.repeat(50));
            console.log(`Rol: ${patenteConTexto.rol}`);
            console.log(`Caratulado: ${patenteConTexto.caratulado}`);
            console.log(`Fecha Elaboración: ${patenteConTexto.fechaElaboracion}`);
            console.log(`URL: ${patenteConTexto.url.substring(0, 80)}...`);
            console.log(`Texto (primeros 200 caracteres): ${patenteConTexto.plain_text.substring(0, 200)}...`);
            console.log('='.repeat(50));
        } else {
            console.log('⚠️  No se encontraron patentes con texto para mostrar ejemplo');
        }
        
    } catch (error) {
        console.error('❌ Error mostrando ejemplo:', error.message);
    }
}

// Ejecutar si se llama directamente
if (require.main === module) {
    const resultado = unificarPatentesConTexto();
    if (resultado) {
        mostrarEjemplo();
    }
}

module.exports = {
    unificarPatentesConTexto,
    leerArchivosString,
    mostrarEjemplo
};
