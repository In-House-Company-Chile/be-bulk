const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

/**
 * Función para agregar un ID único a cada objeto dentro de patentes_unificadas.json
 * @param {string} inputFile - Ruta del archivo JSON de entrada
 * @param {string} outputFile - Ruta del archivo JSON de salida (opcional, si no se especifica sobrescribe el archivo original)
 * @param {string} idField - Nombre del campo para el ID único (por defecto 'id')
 */
function agregarIdsUnicos(inputFile = 'patentes_unificadas.json', outputFile = null, idField = 'id') {
    try {
        console.log(`Leyendo archivo: ${inputFile}`);
        
        // Leer el archivo JSON
        const data = fs.readFileSync(inputFile, 'utf8');
        const jsonData = JSON.parse(data);
        
        // Verificar que existe la estructura esperada
        if (!jsonData.results || !Array.isArray(jsonData.results)) {
            throw new Error('El archivo no tiene la estructura esperada. Se esperaba un objeto con propiedad "results" que sea un array.');
        }
        
        console.log(`Total de objetos encontrados: ${jsonData.results.length}`);
        
        // Agregar ID único a cada objeto
        let contadorIds = 0;
        jsonData.results.forEach((item, index) => {
            // Solo agregar ID si no existe ya
            if (!item[idField]) {
                item[idField] = uuidv4();
                contadorIds++;
            }
        });
        
        console.log(`IDs únicos agregados: ${contadorIds}`);
        
        // Determinar archivo de salida
        const archivoSalida = outputFile || inputFile;
        
        // Escribir el archivo actualizado
        fs.writeFileSync(archivoSalida, JSON.stringify(jsonData, null, 2), 'utf8');
        
        console.log(`Archivo actualizado guardado en: ${archivoSalida}`);
        
        return {
            success: true,
            totalObjetos: jsonData.results.length,
            idsAgregados: contadorIds,
            archivoSalida: archivoSalida
        };
        
    } catch (error) {
        console.error('Error al procesar el archivo:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Función alternativa que genera IDs secuenciales en lugar de UUIDs
 * @param {string} inputFile - Ruta del archivo JSON de entrada
 * @param {string} outputFile - Ruta del archivo JSON de salida (opcional)
 * @param {string} idField - Nombre del campo para el ID único
 * @param {string} prefix - Prefijo para los IDs secuenciales (por defecto 'PAT')
 */
function agregarIdsSecuenciales(inputFile = 'patentes_unificadas.json', outputFile = null, idField = 'id', prefix = 'PAT') {
    try {
        console.log(`Leyendo archivo: ${inputFile}`);
        
        const data = fs.readFileSync(inputFile, 'utf8');
        const jsonData = JSON.parse(data);
        
        if (!jsonData.results || !Array.isArray(jsonData.results)) {
            throw new Error('El archivo no tiene la estructura esperada. Se esperaba un objeto con propiedad "results" que sea un array.');
        }
        
        console.log(`Total de objetos encontrados: ${jsonData.results.length}`);
        
        // Agregar ID secuencial a cada objeto
        let contadorIds = 0;
        jsonData.results.forEach((item, index) => {
            if (!item[idField]) {
                item[idField] = `${prefix}_${String(index + 1).padStart(6, '0')}`;
                contadorIds++;
            }
        });
        
        console.log(`IDs secuenciales agregados: ${contadorIds}`);
        
        const archivoSalida = outputFile || inputFile;
        fs.writeFileSync(archivoSalida, JSON.stringify(jsonData, null, 2), 'utf8');
        
        console.log(`Archivo actualizado guardado en: ${archivoSalida}`);
        
        return {
            success: true,
            totalObjetos: jsonData.results.length,
            idsAgregados: contadorIds,
            archivoSalida: archivoSalida
        };
        
    } catch (error) {
        console.error('Error al procesar el archivo:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

// Función para uso desde línea de comandos
if (require.main === module) {
    const args = process.argv.slice(2);
    const tipoId = args[0] || 'uuid'; // 'uuid' o 'secuencial'
    const inputFile = args[1] || 'patentes_unificadas.json';
    const outputFile = args[2] || null;
    
    console.log('=== Agregando IDs únicos a patentes ===');
    console.log(`Tipo de ID: ${tipoId}`);
    console.log(`Archivo de entrada: ${inputFile}`);
    console.log(`Archivo de salida: ${outputFile || 'mismo archivo de entrada'}`);
    console.log('=====================================\n');
    
    let resultado;
    if (tipoId === 'secuencial') {
        resultado = agregarIdsSecuenciales(inputFile, outputFile);
    } else {
        resultado = agregarIdsUnicos(inputFile, outputFile);
    }
    
    if (resultado.success) {
        console.log('\n✅ Proceso completado exitosamente');
        console.log(`📊 Total de objetos: ${resultado.totalObjetos}`);
        console.log(`🆔 IDs agregados: ${resultado.idsAgregados}`);
    } else {
        console.log('\n❌ Error en el proceso:', resultado.error);
        process.exit(1);
    }
}

module.exports = {
    agregarIdsUnicos,
    agregarIdsSecuenciales
};
