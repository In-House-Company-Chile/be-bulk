const fs = require('fs-extra');
const path = require('path');
const pdf = require('pdf-parse');

/**
 * Función para extraer texto de un archivo PDF
 * @param {string} pdfPath - Ruta del archivo PDF
 * @returns {Promise<string>} - Texto extraído del PDF
 */
async function extractTextFromPDF(pdfPath) {
    try {
        const dataBuffer = fs.readFileSync(pdfPath);
        const data = await pdf(dataBuffer);
        return data.text;
    } catch (error) {
        console.error(`Error al procesar PDF ${pdfPath}:`, error.message);
        return '';
    }
}

/**
 * Función para procesar todos los PDFs en un directorio y generar JSON
 * @param {string} directoryPath - Ruta del directorio a procesar
 * @param {string} outputPath - Ruta donde guardar el archivo JSON (opcional)
 * @returns {Promise<Object>} - Objeto con el formato {id: nombreCarpeta, content: textoCompleto}
 */
async function processDirectoryPDFs(directoryPath, outputPath = null) {
    try {
        // Verificar que el directorio existe
        if (!await fs.pathExists(directoryPath)) {
            throw new Error(`El directorio ${directoryPath} no existe`);
        }

        const folderName = path.basename(directoryPath);
        let combinedContent = '';

        // Obtener todos los archivos PDF del directorio
        const files = await fs.readdir(directoryPath);
        const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

        if (pdfFiles.length === 0) {
            console.log(`No se encontraron archivos PDF en ${directoryPath}`);
            return {
                id: folderName,
                content: ''
            };
        }

        console.log(`Procesando ${pdfFiles.length} archivos PDF en ${folderName}...`);

        // Procesar cada archivo PDF
        for (const pdfFile of pdfFiles) {
            const pdfPath = path.join(directoryPath, pdfFile);
            console.log(`Procesando: ${pdfFile}`);
            
            const text = await extractTextFromPDF(pdfPath);
            if (text.trim()) {
                combinedContent += `\n--- Contenido de ${pdfFile} ---\n`;
                combinedContent += text;
                combinedContent += `\n--- Fin de ${pdfFile} ---\n\n`;
            }
        }

        const result = {
            id: folderName,
            content: combinedContent.trim()
        };

        // Guardar el resultado si se especifica una ruta de salida
        if (outputPath) {
            await fs.ensureDir(path.dirname(outputPath));
            await fs.writeJSON(outputPath, result, { spaces: 2 });
            console.log(`JSON guardado en: ${outputPath}`);
        }

        return result;

    } catch (error) {
        console.error('Error al procesar directorio:', error.message);
        throw error;
    }
}

/**
 * Función para procesar múltiples directorios
 * @param {string[]} directoryPaths - Array de rutas de directorios
 * @param {string} outputDir - Directorio donde guardar los JSONs generados
 * @returns {Promise<Object[]>} - Array de objetos con formato {id, content}
 */
async function processMultipleDirectories(directoryPaths, outputDir = './output') {
    const results = [];

    await fs.ensureDir(outputDir);

    for (const dirPath of directoryPaths) {
        try {
            const folderName = path.basename(dirPath);
            const outputPath = path.join(outputDir, `${folderName}.json`);
            
            const result = await processDirectoryPDFs(dirPath, outputPath);
            results.push(result);
            
        } catch (error) {
            console.error(`Error procesando ${dirPath}:`, error.message);
        }
    }

    return results;
}

/**
 * Función para procesar un solo archivo PDF
 * @param {string} pdfPath - Ruta del archivo PDF
 * @param {string} customId - ID personalizado (opcional, usa el nombre del archivo si no se especifica)
 * @returns {Promise<Object>} - Objeto con formato {id, content}
 */
async function processSinglePDF(pdfPath, customId = null) {
    try {
        if (!await fs.pathExists(pdfPath)) {
            throw new Error(`El archivo ${pdfPath} no existe`);
        }

        const fileName = path.basename(pdfPath, path.extname(pdfPath));
        const id = customId || fileName;
        
        console.log(`Procesando archivo PDF: ${path.basename(pdfPath)}`);
        const content = await extractTextFromPDF(pdfPath);

        return {
            id: id,
            content: content
        };

    } catch (error) {
        console.error('Error al procesar archivo PDF:', error.message);
        throw error;
    }
}

// Función de ejemplo de uso
async function ejemplo() {
    try {
        // Ejemplo 1: Procesar un directorio
        // const resultado = await processDirectoryPDFs('./mi-directorio-pdfs', './output/resultado.json');
        // console.log('Resultado:', resultado);

        // Ejemplo 2: Procesar múltiples directorios
        // const directorios = ['./dir1', './dir2', './dir3'];
        // const resultados = await processMultipleDirectories(directorios, './output');
        // console.log('Resultados:', resultados);

        // Ejemplo 3: Procesar un solo PDF
        // const resultadoPDF = await processSinglePDF('./archivo.pdf', 'mi-id-personalizado');
        // console.log('Resultado PDF:', resultadoPDF);

        console.log('Funciones disponibles:');
        console.log('- processDirectoryPDFs(directoryPath, outputPath)');
        console.log('- processMultipleDirectories(directoryPaths, outputDir)');
        console.log('- processSinglePDF(pdfPath, customId)');
        console.log('- extractTextFromPDF(pdfPath)');

    } catch (error) {
        console.error('Error en ejemplo:', error.message);
    }
}

module.exports = {
    extractTextFromPDF,
    processDirectoryPDFs,
    processMultipleDirectories,
    processSinglePDF,
    processIndividualPDFs,
    ejemplo
};

/**
 * Función para procesar cada PDF individualmente y crear un JSON por archivo
 * @param {string} directoryPath - Ruta del directorio con los PDFs
 * @param {string} outputDir - Directorio donde guardar los JSONs individuales
 * @returns {Promise<Object[]>} - Array con los resultados de cada PDF
 */
async function processIndividualPDFs(directoryPath, outputDir = './prestaciones/output') {
    try {
        // Verificar que el directorio existe
        if (!await fs.pathExists(directoryPath)) {
            throw new Error(`El directorio ${directoryPath} no existe`);
        }

        // Crear directorio de salida si no existe
        await fs.ensureDir(outputDir);

        // Obtener todos los archivos PDF del directorio
        const files = await fs.readdir(directoryPath);
        const pdfFiles = files.filter(file => path.extname(file).toLowerCase() === '.pdf');

        if (pdfFiles.length === 0) {
            console.log(`No se encontraron archivos PDF en ${directoryPath}`);
            return [];
        }

        console.log(`Encontrados ${pdfFiles.length} archivos PDF para procesar...`);
        const results = [];

        // Procesar cada archivo PDF individualmente
        for (const pdfFile of pdfFiles) {
            try {
                const pdfPath = path.join(directoryPath, pdfFile);
                const fileName = path.basename(pdfFile, path.extname(pdfFile));
                
                console.log(`Procesando: ${pdfFile}`);
                
                // Extraer texto del PDF
                const text = await extractTextFromPDF(pdfPath);
                
                // Crear objeto JSON para este PDF
                const result = {
                    id: fileName,
                    content: text
                };

                // Guardar JSON individual
                const outputPath = path.join(outputDir, `${fileName}.json`);
                await fs.writeJSON(outputPath, result, { spaces: 2 });
                
                console.log(`✅ JSON creado: ${outputPath}`);
                results.push(result);

            } catch (error) {
                console.error(`❌ Error procesando ${pdfFile}:`, error.message);
            }
        }

        return results;

    } catch (error) {
        console.error('Error al procesar PDFs individuales:', error.message);
        throw error;
    }
}

// Función principal para ejecutar el procesamiento
async function main() {
    try {
        console.log('Iniciando procesamiento individual de PDFs...');
        const resultados = await processIndividualPDFs('C:/Users/ljutr/Desktop/PRESTACIONES', 'C:/Users/ljutr/Desktop/PRESTACIONES/output');
        
        console.log('\n📊 RESUMEN DEL PROCESAMIENTO:');
        console.log(`✅ Total de PDFs procesados: ${resultados.length}`);
        
        if (resultados.length > 0) {
            console.log('\n📄 Archivos JSON creados:');
            resultados.forEach(resultado => {
                console.log(`  - ${resultado.id}.json (${resultado.content.length} caracteres)`);
            });
        }
        
        console.log('\n🎉 Procesamiento completado exitosamente!');
        
    } catch (error) {
        console.error('❌ Error durante el procesamiento:', error.message);
    }
}

// Si se ejecuta directamente, ejecutar función principal
if (require.main === module) {
    main();
}
