require('dotenv').config();
const fs = require('fs-extra');
const path = require('path');
const IndexarQdrantV2 = require('./functions/shared/IndexarQdrantV2');

/**
 * Función para procesar y indexar todos los archivos JSON de prestaciones en Qdrant
 * @param {string} jsonDirectory - Directorio que contiene los archivos JSON
 * @param {string} namespace - Namespace/colección en Qdrant
 * @returns {Promise<Object>} - Resumen del procesamiento
 */
async function indexarPrestacionesQdrant(jsonDirectory = 'C:/Users/ljutr/Desktop/PRESTACIONES/output', namespace = 'prestaciones') {
    try {
        console.log('🚀 Iniciando indexación de prestaciones en Qdrant...');
        console.log(`📁 Directorio: ${jsonDirectory}`);
        console.log(`🗃️ Namespace: ${namespace}`);

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

                // Preparar metadata específica para Qdrant
                const metadata = {
                    document_id: jsonData.id,
                    source: 'prestaciones',
                    document_type: 'prestacion_medica',
                    original_filename: jsonFile,
                    processed_date: new Date().toISOString(),
                    content_length: jsonData.content.length,
                    collection: namespace
                };

                // Preparar documento completo para indexar
                const documento = {
                    id: jsonData.id,
                    content: jsonData.content,
                    source: 'prestaciones',
                    filename: jsonFile,
                    processed_at: new Date().toISOString()
                };

                // El texto que se va a vectorizar (contenido principal)
                const textoParaVectorizar = jsonData.content;

                console.log(`🔄 Generando embeddings y chunks para: ${jsonData.id}`);
                console.log(`📏 Longitud del texto: ${textoParaVectorizar.length} caracteres`);

                // Indexar en Qdrant usando IndexarQdrantV2
                await IndexarQdrantV2.create(
                    documento,           // doc - documento completo
                    textoParaVectorizar, // docText - texto para vectorizar
                    namespace,           // namespace - colección en Qdrant
                    metadata            // metadata - información adicional
                );

                exitosos++;
                console.log(`✅ ${jsonFile} indexado exitosamente en Qdrant`);

                procesados++;

                // Pequeña pausa para no sobrecargar el servicio de embeddings
                await new Promise(resolve => setTimeout(resolve, 100));

            } catch (error) {
                errores++;
                procesados++;
                erroresDetalle.push(`${jsonFile}: ${error.message}`);
                console.error(`❌ Error procesando ${jsonFile}:`, error.message);
                
                // Pausa más larga en caso de error para evitar rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));
            }
        }

        // Mostrar resumen final
        console.log('\n📊 RESUMEN DE INDEXACIÓN EN QDRANT:');
        console.log(`📄 Total de archivos: ${jsonFiles.length}`);
        console.log(`✅ Procesados exitosamente: ${exitosos}`);
        console.log(`❌ Errores: ${errores}`);
        console.log(`🗃️ Namespace utilizado: ${namespace}`);
        
        if (erroresDetalle.length > 0) {
            console.log('\n❌ Detalles de errores:');
            erroresDetalle.forEach(error => console.log(`  - ${error}`));
        }

        console.log('\n🎉 Indexación en Qdrant completada!');

        return {
            total: jsonFiles.length,
            procesados,
            errores,
            exitosos,
            erroresDetalle,
            namespace
        };

    } catch (error) {
        console.error('❌ Error general en indexación Qdrant:', error.message);
        throw error;
    }
}

/**
 * Función para indexar un archivo JSON específico en Qdrant
 * @param {string} jsonFilePath - Ruta completa al archivo JSON
 * @param {string} namespace - Namespace en Qdrant
 * @returns {Promise<string>} - Resultado de la indexación
 */
async function indexarArchivoEspecificoQdrant(jsonFilePath, namespace = 'prestaciones') {
    try {
        console.log(`📝 Indexando archivo específico en Qdrant: ${jsonFilePath}`);

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
            document_id: jsonData.id,
            source: 'prestaciones',
            document_type: 'prestacion_medica',
            original_filename: fileName,
            processed_date: new Date().toISOString(),
            content_length: jsonData.content.length,
            collection: namespace
        };

        // Preparar documento
        const documento = {
            id: jsonData.id,
            content: jsonData.content,
            source: 'prestaciones',
            filename: fileName,
            processed_at: new Date().toISOString()
        };

        // Indexar en Qdrant
        await IndexarQdrantV2.create(
            documento,
            jsonData.content,
            namespace,
            metadata
        );

        console.log(`✅ Archivo indexado en Qdrant: ${fileName}`);
        return 'OK';

    } catch (error) {
        console.error(`❌ Error indexando archivo específico en Qdrant:`, error.message);
        throw error;
    }
}

/**
 * Función para procesar un lote específico de archivos (útil para procesamiento por partes)
 * @param {string} jsonDirectory - Directorio con JSONs
 * @param {string} namespace - Namespace en Qdrant
 * @param {number} batchSize - Tamaño del lote
 * @param {number} startIndex - Índice de inicio
 * @returns {Promise<Object>} - Resultado del procesamiento del lote
 */
async function indexarLoteQdrant(jsonDirectory, namespace = 'prestaciones', batchSize = 50, startIndex = 0) {
    try {
        console.log(`🔄 Procesando lote desde índice ${startIndex}, tamaño: ${batchSize}`);

        const files = await fs.readdir(jsonDirectory);
        const jsonFiles = files.filter(file => path.extname(file).toLowerCase() === '.json');
        
        const lote = jsonFiles.slice(startIndex, startIndex + batchSize);
        
        if (lote.length === 0) {
            console.log('⚠️ No hay archivos en este lote');
            return { procesados: 0, errores: 0, exitosos: 0 };
        }

        console.log(`📦 Procesando ${lote.length} archivos en este lote`);

        let exitosos = 0;
        let errores = 0;

        for (const jsonFile of lote) {
            try {
                const jsonPath = path.join(jsonDirectory, jsonFile);
                await indexarArchivoEspecificoQdrant(jsonPath, namespace);
                exitosos++;
                
                // Pausa entre archivos
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                errores++;
                console.error(`❌ Error en lote con ${jsonFile}:`, error.message);
            }
        }

        console.log(`📊 Lote completado: ${exitosos} exitosos, ${errores} errores`);
        
        return {
            procesados: lote.length,
            errores,
            exitosos,
            siguienteIndice: startIndex + batchSize
        };

    } catch (error) {
        console.error('❌ Error procesando lote:', error.message);
        throw error;
    }
}

// Función principal para ejecutar
async function main() {
    try {
        console.log('🌟 Iniciando indexación masiva en Qdrant...');
        
        // Indexar todas las prestaciones
        const resultado = await indexarPrestacionesQdrant();
        
        if (resultado.exitosos > 0) {
            console.log(`\n🎯 Se indexaron ${resultado.exitosos} documentos exitosamente en Qdrant`);
            console.log(`🔍 Los documentos están disponibles para búsqueda vectorial en el namespace: ${resultado.namespace}`);
        }

    } catch (error) {
        console.error('❌ Error en función principal:', error.message);
        process.exit(1);
    }
}

module.exports = {
    indexarPrestacionesQdrant,
    indexarArchivoEspecificoQdrant,
    indexarLoteQdrant,
    main
};

// Si se ejecuta directamente
if (require.main === module) {
    main();
}
