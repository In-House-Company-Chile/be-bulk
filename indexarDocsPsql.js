require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const IndexarPsql = require('./functions/shared/IndexarPsql');

/**
 * Función para procesar y indexar todos los archivos JSON de prestaciones en PostgreSQL
 * @param {string} jsonDirectory - Directorio que contiene los archivos JSON
 * @param {string} collectionName - Nombre de la colección/tabla en PostgreSQL
 * @returns {Promise<Object>} - Resumen del procesamiento
 */
async function indexarPrestacionesPsql(jsonDirectory = 'C:/Users/ljutr/Desktop/PRESTACIONES/output', collectionName = 'prestaciones') {
    try {
        console.log('🚀 Iniciando indexación de prestaciones en PostgreSQL...');
        console.log(`📁 Directorio: ${jsonDirectory}`);
        console.log(`🗃️ Colección: ${collectionName}`);

        // Verificar que el directorio existe
        if (!await fs.pathExists(jsonDirectory)) {
            throw new Error(`El directorio ${jsonDirectory} no existe`);
        }

        // Obtener todos los archivos JSON del directorio
        const files = await fs.readdir(jsonDirectory);
        const jsonFiles = files.filter(file => path.extname(file).toLowerCase() === '.json');

        if (jsonFiles.length === 0) {
            console.log(`⚠️ No se encontraron archivos JSON en ${jsonDirectory}`);
            return {
                total: 0,
                procesados: 0,
                errores: 0,
                exitosos: 0
            };
        }

        console.log(`📄 Encontrados ${jsonFiles.length} archivos JSON para procesar`);

        let procesados = 0;
        let exitosos = 0;
        let errores = 0;
        const erroresDetalle = [];

        // Procesar cada archivo JSON
        for (const jsonFile of jsonFiles) {
            try {
                const jsonPath = path.join(jsonDirectory, jsonFile);
                const fileName = path.basename(jsonFile, path.extname(jsonFile));
                
                console.log(`\n📝 Procesando: ${jsonFile}`);

                // Leer el archivo JSON
                const jsonData = await fs.readJSON(jsonPath);
                
                // Validar que el JSON tiene la estructura esperada
                if (!jsonData.id || !jsonData.content) {
                    throw new Error(`JSON inválido: debe tener 'id' y 'content'`);
                }

                // Preparar metadata adicional
                const metadata = {
                    source: 'prestaciones',
                    original_filename: jsonFile,
                    processed_date: new Date().toISOString(),
                    content_length: jsonData.content.length,
                    document_type: 'prestacion_medica'
                };

                // Preparar documento completo para indexar
                const documento = {
                    id: jsonData.id,
                    content: jsonData.content,
                    source: 'prestaciones',
                    processed_at: new Date().toISOString()
                };

                // Indexar en PostgreSQL usando IndexarPsql
                const resultado = await IndexarPsql.create(
                    documento,      // doc
                    collectionName, // tableName
                    metadata,       // metadata
                    jsonData.id     // idDoc
                );

                if (resultado === 'OK' || resultado === 'INSERTED') {
                    exitosos++;
                    console.log(`✅ ${jsonFile} indexado exitosamente`);
                } else {
                    errores++;
                    erroresDetalle.push(`${jsonFile}: Resultado inesperado - ${resultado}`);
                    console.log(`⚠️ ${jsonFile}: ${resultado}`);
                }

                procesados++;

            } catch (error) {
                errores++;
                procesados++;
                erroresDetalle.push(`${jsonFile}: ${error.message}`);
                console.error(`❌ Error procesando ${jsonFile}:`, error.message);
            }
        }

        // Mostrar resumen final
        console.log('\n📊 RESUMEN DE INDEXACIÓN:');
        console.log(`📄 Total de archivos: ${jsonFiles.length}`);
        console.log(`✅ Procesados exitosamente: ${exitosos}`);
        console.log(`❌ Errores: ${errores}`);
        
        if (erroresDetalle.length > 0) {
            console.log('\n❌ Detalles de errores:');
            erroresDetalle.forEach(error => console.log(`  - ${error}`));
        }

        console.log('\n🎉 Indexación completada!');

        return {
            total: jsonFiles.length,
            procesados,
            errores,
            exitosos,
            erroresDetalle
        };

    } catch (error) {
        console.error('❌ Error general en indexación:', error.message);
        throw error;
    }
}

/**
 * Función para indexar un archivo JSON específico
 * @param {string} jsonFilePath - Ruta completa al archivo JSON
 * @param {string} collectionName - Nombre de la colección
 * @returns {Promise<string>} - Resultado de la indexación
 */
async function indexarArchivoEspecifico(jsonFilePath, collectionName = 'prestaciones') {
    try {
        console.log(`📝 Indexando archivo específico: ${jsonFilePath}`);

        // Verificar que el archivo existe
        if (!await fs.pathExists(jsonFilePath)) {
            throw new Error(`El archivo ${jsonFilePath} no existe`);
        }

        // Leer el archivo JSON
        const jsonData = await fs.readJSON(jsonFilePath);
        const fileName = path.basename(jsonFilePath);

        // Validar estructura
        if (!jsonData.id || !jsonData.content) {
            throw new Error(`JSON inválido: debe tener 'id' y 'content'`);
        }

        // Preparar metadata
        const metadata = {
            source: 'prestaciones',
            original_filename: fileName,
            processed_date: new Date().toISOString(),
            content_length: jsonData.content.length,
            document_type: 'prestacion_medica'
        };

        // Preparar documento
        const documento = {
            id: jsonData.id,
            content: jsonData.content,
            source: 'prestaciones',
            processed_at: new Date().toISOString()
        };

        // Indexar
        const resultado = await IndexarPsql.create(
            documento,
            collectionName,
            metadata,
            jsonData.id
        );

        console.log(`✅ Archivo indexado: ${fileName} - Resultado: ${resultado}`);
        return resultado;

    } catch (error) {
        console.error(`❌ Error indexando archivo específico:`, error.message);
        throw error;
    }
}

// Función principal para ejecutar
async function main() {
    try {
        // Indexar todas las prestaciones
        const resultado = await indexarPrestacionesPsql();
        
        if (resultado.exitosos > 0) {
            console.log(`\n🎯 Se indexaron ${resultado.exitosos} documentos exitosamente en PostgreSQL`);
        }

    } catch (error) {
        console.error('❌ Error en función principal:', error.message);
        process.exit(1);
    }
}

module.exports = {
    indexarPrestacionesPsql,
    indexarArchivoEspecifico,
    main
};

// Si se ejecuta directamente
if (require.main === module) {
    main();
}
