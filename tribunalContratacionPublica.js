const fs = require('fs');
const path = require('path');

/**
 * Función para extraer objetos del archivo tribunalContratacionPublicaFileUnificado.json
 * y crear archivos individuales para cada sentenciaTribunal.id
 */
function extraerSentenciasTribunal() {
    try {
        // Leer el archivo JSON
        const jsonData = fs.readFileSync('tribunalContratacionPublicaFileUnificado.json', 'utf8');
        const data = JSON.parse(jsonData);
        
        // Verificar que existe la propiedad results
        if (!data.results || !Array.isArray(data.results)) {
            throw new Error('El archivo JSON no tiene la estructura esperada (results array)');
        }
        
        // Crear directorio para almacenar los archivos extraídos si no existe
        const outputDir = 'sentencias_extraidas';
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }
        
        let archivosCreados = 0;
        let errores = 0;
        
        // Procesar cada objeto en results
        data.results.forEach((item, index) => {
            try {
                // Verificar que existe sentenciaTribunal y tiene id
                if (item.sentenciaTribunal && item.sentenciaTribunal.id) {
                    const sentenciaId = item.sentenciaTribunal.id;
                    const fileName = `${sentenciaId}.json`;
                    const filePath = path.join(outputDir, fileName);
                    
                    // Escribir el objeto completo al archivo
                    fs.writeFileSync(filePath, JSON.stringify(item, null, 2), 'utf8');
                    archivosCreados++;
                    
                    console.log(`✓ Archivo creado: ${fileName}`);
                } else {
                    console.warn(`⚠ Objeto en índice ${index} no tiene sentenciaTribunal.id válido`);
                    errores++;
                }
            } catch (error) {
                console.error(`✗ Error procesando objeto en índice ${index}:`, error.message);
                errores++;
            }
        });
        
        // Resumen final
        console.log('\n=== RESUMEN DE EXTRACCIÓN ===');
        console.log(`Total de objetos procesados: ${data.results.length}`);
        console.log(`Archivos creados exitosamente: ${archivosCreados}`);
        console.log(`Errores encontrados: ${errores}`);
        console.log(`Directorio de salida: ${outputDir}`);
        
        return {
            totalProcesados: data.results.length,
            archivosCreados,
            errores,
            directorioSalida: outputDir
        };
        
    } catch (error) {
        console.error('Error al procesar el archivo JSON:', error.message);
        throw error;
    }
}

/**
 * Función auxiliar para verificar la estructura de un archivo específico
 * @param {string} sentenciaId - ID de la sentencia a verificar
 */
function verificarSentencia(sentenciaId) {
    try {
        const filePath = path.join('sentencias_extraidas', `${sentenciaId}.json`);
        
        if (!fs.existsSync(filePath)) {
            console.log(`Archivo ${sentenciaId}.json no existe`);
            return false;
        }
        
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        console.log(`Archivo ${sentenciaId}.json:`);
        console.log(`- ID Causa: ${data.idCausa}`);
        console.log(`- Rol Causa: ${data.rolCausa}`);
        console.log(`- Carátula: ${data.caratula}`);
        console.log(`- Estado: ${data.estado}`);
        console.log(`- Sentencia Tribunal ID: ${data.sentenciaTribunal?.id}`);
        console.log(`- Nombre archivo: ${data.sentenciaTribunal?.nombre}`);
        
        return true;
    } catch (error) {
        console.error(`Error verificando sentencia ${sentenciaId}:`, error.message);
        return false;
    }
}

/**
 * Función para listar todos los archivos creados
 */
function listarSentenciasExtraidas() {
    try {
        const outputDir = 'sentencias_extraidas';
        
        if (!fs.existsSync(outputDir)) {
            console.log('El directorio de sentencias extraídas no existe aún');
            return [];
        }
        
        const archivos = fs.readdirSync(outputDir)
            .filter(archivo => archivo.endsWith('.json'))
            .sort((a, b) => {
                const idA = parseInt(a.replace('.json', ''));
                const idB = parseInt(b.replace('.json', ''));
                return idA - idB;
            });
        
        console.log(`\nSe encontraron ${archivos.length} archivos de sentencias:`);
        archivos.forEach((archivo, index) => {
            if (index < 10) { // Mostrar solo los primeros 10
                console.log(`- ${archivo}`);
            } else if (index === 10) {
                console.log(`... y ${archivos.length - 10} más`);
            }
        });
        
        return archivos;
    } catch (error) {
        console.error('Error listando sentencias extraídas:', error.message);
        return [];
    }
}

// Exportar las funciones para uso en otros módulos
module.exports = {
    extraerSentenciasTribunal,
    verificarSentencia,
    listarSentenciasExtraidas
};

// Si se ejecuta directamente, ejecutar la función principal
if (require.main === module) {
    console.log('Iniciando extracción de sentencias del tribunal...\n');
    extraerSentenciasTribunal();
}
