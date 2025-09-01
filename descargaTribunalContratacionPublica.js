const fs = require('fs');
const path = require('path');

/**
 * Función para extraer todos los IDs de sentencias del archivo tribunalContratacionPublicaFile.json
 * Crea un array con rolCausa como clave y los IDs de sentenciaTribunal, sentenciaCA, sentenciaCS
 * Formato: [{rolCausa: {sentenciaTribunal: id, sentenciaCA: id, sentenciaCS: id}}, ...]
 */
function extraerIdsSentencias() {
    try {
        console.log('Iniciando extracción de IDs de sentencias...\n');
        
        // Leer el archivo JSON
        const jsonData = fs.readFileSync('tribunalContratacionPublicaFile.json', 'utf8');
        const data = JSON.parse(jsonData);
        
        // Verificar que existe la propiedad results
        if (!data.results || !Array.isArray(data.results)) {
            throw new Error('El archivo JSON no tiene la estructura esperada (results array)');
        }
        
        const arrayResultado = [];
        let contadores = {
            sentenciaTribunal: 0,
            sentenciaCA: 0,
            sentenciaCS: 0,
            objetosProcesados: 0,
            rolesUnicos: 0
        };
        
        // Procesar cada objeto en results
        data.results.forEach((item, index) => {
            try {
                contadores.objetosProcesados++;
                const rolCausa = item.rolCausa || `sin-rol-${index}`;
                
                // Crear objeto con la estructura solicitada
                const objetoSentencia = {};
                objetoSentencia[rolCausa] = {
                    sentenciaTribunal: null,
                    sentenciaCA: null,
                    sentenciaCS: null
                };
                
                // Extraer ID de sentenciaTribunal
                if (item.sentenciaTribunal && item.sentenciaTribunal.id) {
                    objetoSentencia[rolCausa].sentenciaTribunal = item.sentenciaTribunal.id;
                    contadores.sentenciaTribunal++;
                }
                
                // Extraer ID de sentenciaCA
                if (item.sentenciaCA && item.sentenciaCA.id) {
                    objetoSentencia[rolCausa].sentenciaCA = item.sentenciaCA.id;
                    contadores.sentenciaCA++;
                }
                
                // Extraer ID de sentenciaCS
                if (item.sentenciaCS && item.sentenciaCS.id) {
                    objetoSentencia[rolCausa].sentenciaCS = item.sentenciaCS.id;
                    contadores.sentenciaCS++;
                }
                
                arrayResultado.push(objetoSentencia);
                contadores.rolesUnicos++;
                
            } catch (error) {
                console.error(`✗ Error procesando objeto en índice ${index}:`, error.message);
            }
        });
        
        // Crear el archivo de salida con el array en el formato solicitado
        const outputFile = 'ids_sentencias_tribunal.json';
        fs.writeFileSync(outputFile, JSON.stringify(arrayResultado, null, 2), 'utf8');
        
        // Mostrar resumen
        console.log('=== RESUMEN DE EXTRACCIÓN DE IDs ===');
        console.log(`Total de objetos procesados: ${contadores.objetosProcesados}`);
        console.log(`Total de roles únicos: ${contadores.rolesUnicos}`);
        console.log(`- sentenciaTribunal: ${contadores.sentenciaTribunal} IDs`);
        console.log(`- sentenciaCA: ${contadores.sentenciaCA} IDs`);
        console.log(`- sentenciaCS: ${contadores.sentenciaCS} IDs`);
        console.log(`Archivo creado: ${outputFile}\n`);
        
        // Mostrar algunos ejemplos del formato
        console.log('=== EJEMPLOS DEL FORMATO CREADO ===');
        arrayResultado.slice(0, 5).forEach((item, index) => {
            const rolCausa = Object.keys(item)[0];
            const sentencias = item[rolCausa];
            console.log(`${index + 1}. ${rolCausa}:`);
            console.log(`   sentenciaTribunal: ${sentencias.sentenciaTribunal}`);
            console.log(`   sentenciaCA: ${sentencias.sentenciaCA}`);
            console.log(`   sentenciaCS: ${sentencias.sentenciaCS}`);
        });
        
        return arrayResultado;
        
    } catch (error) {
        console.error('Error al extraer IDs de sentencias:', error.message);
        throw error;
    }
}

/**
 * Función para crear un archivo CSV con los IDs para fácil manipulación
 */
function crearCSVIds() {
    try {
        const jsonFile = 'ids_sentencias_tribunal.json';
        
        if (!fs.existsSync(jsonFile)) {
            console.log('Primero debe ejecutar extraerIdsSentencias()');
            return false;
        }
        
        const arrayData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        const csvFile = 'ids_sentencias_tribunal.csv';
        
        // Crear encabezados CSV
        const headers = [
            'rolCausa',
            'sentenciaTribunal',
            'sentenciaCA',
            'sentenciaCS'
        ];
        
        let csvContent = headers.join(',') + '\n';
        
        // Agregar datos
        arrayData.forEach(item => {
            const rolCausa = Object.keys(item)[0];
            const sentencias = item[rolCausa];
            
            const row = [
                `"${rolCausa}"`,
                sentencias.sentenciaTribunal || 'null',
                sentencias.sentenciaCA || 'null',
                sentencias.sentenciaCS || 'null'
            ];
            csvContent += row.join(',') + '\n';
        });
        
        fs.writeFileSync(csvFile, csvContent, 'utf8');
        console.log(`Archivo CSV creado: ${csvFile}`);
        
        return true;
    } catch (error) {
        console.error('Error creando archivo CSV:', error.message);
        return false;
    }
}

/**
 * Función para obtener estadísticas detalladas
 */
function obtenerEstadisticas() {
    try {
        const jsonFile = 'ids_sentencias_tribunal.json';
        
        if (!fs.existsSync(jsonFile)) {
            console.log('Primero debe ejecutar extraerIdsSentencias()');
            return null;
        }
        
        const arrayData = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        
        const estadisticas = {
            totalRoles: arrayData.length,
            contadores: {
                sentenciaTribunal: 0,
                sentenciaCA: 0,
                sentenciaCS: 0
            },
            idsDuplicados: new Set(),
            rolesConTodasLasSentencias: 0,
            rolesSoloTribunal: 0
        };
        
        const todosLosIds = new Set();
        
        arrayData.forEach(item => {
            const rolCausa = Object.keys(item)[0];
            const sentencias = item[rolCausa];
            
            let tieneSentencias = 0;
            
            // Contar cada tipo de sentencia
            if (sentencias.sentenciaTribunal !== null) {
                estadisticas.contadores.sentenciaTribunal++;
                tieneSentencias++;
                
                if (todosLosIds.has(sentencias.sentenciaTribunal)) {
                    estadisticas.idsDuplicados.add(sentencias.sentenciaTribunal);
                }
                todosLosIds.add(sentencias.sentenciaTribunal);
            }
            
            if (sentencias.sentenciaCA !== null) {
                estadisticas.contadores.sentenciaCA++;
                tieneSentencias++;
                
                if (todosLosIds.has(sentencias.sentenciaCA)) {
                    estadisticas.idsDuplicados.add(sentencias.sentenciaCA);
                }
                todosLosIds.add(sentencias.sentenciaCA);
            }
            
            if (sentencias.sentenciaCS !== null) {
                estadisticas.contadores.sentenciaCS++;
                tieneSentencias++;
                
                if (todosLosIds.has(sentencias.sentenciaCS)) {
                    estadisticas.idsDuplicados.add(sentencias.sentenciaCS);
                }
                todosLosIds.add(sentencias.sentenciaCS);
            }
            
            // Contar roles con todas las sentencias
            if (tieneSentencias === 3) {
                estadisticas.rolesConTodasLasSentencias++;
            }
            
            // Contar roles solo con sentencia tribunal
            if (sentencias.sentenciaTribunal !== null && 
                sentencias.sentenciaCA === null && 
                sentencias.sentenciaCS === null) {
                estadisticas.rolesSoloTribunal++;
            }
        });
        
        console.log('=== ESTADÍSTICAS DETALLADAS ===');
        console.log(`Total de roles procesados: ${estadisticas.totalRoles}`);
        console.log(`Total de IDs únicos: ${todosLosIds.size}`);
        console.log('\nDistribución por tipo de sentencia:');
        console.log(`  sentenciaTribunal: ${estadisticas.contadores.sentenciaTribunal}`);
        console.log(`  sentenciaCA: ${estadisticas.contadores.sentenciaCA}`);
        console.log(`  sentenciaCS: ${estadisticas.contadores.sentenciaCS}`);
        
        console.log('\nAnálisis de completitud:');
        console.log(`  Roles con todas las sentencias (3): ${estadisticas.rolesConTodasLasSentencias}`);
        console.log(`  Roles solo con sentencia tribunal: ${estadisticas.rolesSoloTribunal}`);
        
        if (estadisticas.idsDuplicados.size > 0) {
            console.log(`\nIDs duplicados encontrados: ${estadisticas.idsDuplicados.size}`);
            console.log('IDs duplicados:', Array.from(estadisticas.idsDuplicados).slice(0, 10));
        }
        
        return estadisticas;
        
    } catch (error) {
        console.error('Error obteniendo estadísticas:', error.message);
        return null;
    }
}

// Exportar las funciones
module.exports = {
    extraerIdsSentencias,
    crearCSVIds,
    obtenerEstadisticas
};

// Si se ejecuta directamente, ejecutar la función principal
if (require.main === module) {
    console.log('Iniciando extracción de IDs de sentencias del tribunal...\n');
    extraerIdsSentencias();
    console.log('\nCreando archivo CSV...');
    crearCSVIds();
    console.log('\nObteniendo estadísticas...');
    obtenerEstadisticas();
}
