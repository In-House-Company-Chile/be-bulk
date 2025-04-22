const fs = require('fs');
const path = require('path');

const normPath = path.join(__dirname, 'vectorized'); // Cambia esto a la ruta de tu carpeta de normas

const searchFacets = async(selectedFacets) => {
    try {
            // Leer facets.json
            const facetsFilePath = 'facets.json';
            let facets = {};

            if (fs.existsSync(facetsFilePath)) {
                const facetsData = fs.readFileSync(facetsFilePath, 'utf8');
                facets = JSON.parse(facetsData);
            }

            // Leer todos los archivos que contienen normas
            const files = fs.readdirSync(normPath).filter(file => file.endsWith('.json'));
            const matchedFilesSet = new Set();

            for (const file of files) {
                const filePath = path.join(normPath, file);
                const jsonData = fs.readFileSync(filePath, 'utf8');

                try {
                    const parsedJson = JSON.parse(jsonData);
                    const norma = {
                        id: parsedJson.idNorm || '',
                        fecha_publicacion: parsedJson.data.metadatos.fecha_publicacion || '',
                        fecha_promulgacion: parsedJson.data.metadatos.fecha_promulgacion || '',
                        compuesto: parsedJson.data.metadatos.tipos_numeros || [],
                        titulo_norma: parsedJson.data.metadatos.titulo_norma || '',
                        organismos: parsedJson.data.metadatos.organismos || [],
                    };
                    console.log("🚀 ~ searchFacets ~ norma:", norma)

                    // Verificar si la norma coincide con los filtros seleccionados
                    let isMatch = true;
                    for (let facet in selectedFacets) {
                        if (selectedFacets[facet].length > 0) {
                            if (!selectedFacets[facet].some(val => norma[facet].includes(val))) {
                                isMatch = false;
                                break;
                            }
                        }
                    }

                    if (isMatch) {
                        // Convertir el objeto norma en una cadena JSON para almacenarlo en un Set y evitar duplicados
                        matchedFilesSet.add(JSON.stringify(norma)); // Usamos JSON.stringify para comparar el objeto completo
                    }

                } catch (error) {
                    console.error(`Error al procesar ${file}:`, error);
                }
            }

            // Convertir el Set a un array y parsear los objetos JSON
            const matchedFiles = Array.from(matchedFilesSet).map(file => JSON.parse(file));
            return matchedFiles;
    } catch (e) {
        console.error("🚨 Error en la búsqueda de facetas:", e.message);
        throw new Error("Error al ejecutar la búsqueda de facetas.");
    }
}

const selectedFacets = {
    // fecha_publicacion: ["2023-12-19"],
    // fecha_promulgacion: ["2023-12-19"],
    // organismos: ["COMISIÓN CLASIFICADORA DE RIESGO"]
};

searchFacets(selectedFacets)
    .then(matchedFiles => {
        console.log("Normas encontradas:", matchedFiles);
    })
    .catch(error => {
        console.error("Error en la búsqueda:", error);
    });