const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const { parseStringPromise } = require('xml2js');
const stringSimilarity = require('string-similarity');

const readFileAsync = promisify(fs.readFile);

// const fs = require('fs');
// const path = require('path');
// const stringSimilarity = require('string-similarity');

// 📌 Normaliza una cadena eliminando tildes y caracteres especiales
const normalize = (text) => {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // Elimina acentos
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '') // Elimina caracteres especiales
        .replace(/\s+/g, ' ') // Reemplaza múltiples espacios por uno
        .trim();
};

// 📌 Función para cargar y analizar archivos JSON en un directorio
const loadNormasFromJSON = async (directory) => {
    const files = fs.readdirSync(directory).filter(file => file.endsWith('.json'));
    const normas = [];

    for (const file of files) {
        const filePath = path.join(directory, file);
        const jsonData = fs.readFileSync(filePath, 'utf8');

        try {
            const parsedJson = JSON.parse(jsonData);
            normas.push({
                id: parsedJson.idNorm || '',
                // tipo: parsedJson.metadatos?.tipos_numeros?.[0]?.tipo || '',
                // numero: parsedJson.metadatos?.tipos_numeros?.[0]?.numero || '',
                // titulo: parsedJson.metadatos?.titulo_norma || '',
                planeText: parsedJson.planeText || '', // Extrae el contenido textual
                metadatos: parsedJson.metadatos || '', // Extrae los metadatos
            });
        } catch (error) {
            console.error(`Error al procesar ${file}:`, error);
        }
    }

    return normas;
};

// 📌 Función para buscar normas por similitud en JSON
// const stringSimilarity = require("string-similarity");

// Función para dividir un texto en chunks de tamaño definido
const splitIntoChunks = (text, chunkSize = 300, overlap = 30) => {
    const chunks = [];
    for (let i = 0; i < text.length; i += chunkSize - overlap) {
        chunks.push(text.slice(i, i + chunkSize));
    }
    return chunks;
};

// Función mejorada para búsqueda en normas
const searchNormasInJSON = async (directory, query) => {
    const normas = await loadNormasFromJSON(directory);
    const normalizedQuery = normalize(query);

    return normas.map(norma => {
        // const chunks = splitIntoChunks(normalize(norma.planeText));
        const chunks = splitIntoChunks( `${normalize(norma.planeText)} ${norma.metadatos.toLowerCase()}`);
        let bestMatch = { score: 0, chunkIndex: null, text: '' };

        chunks.forEach((chunk, index) => {
            const score = stringSimilarity.compareTwoStrings(normalizedQuery, chunk);
            if (score > bestMatch.score) {
                bestMatch = { score, chunkIndex: index, text: chunk };
            }
        });

        return {
            id: norma.id,
            score: bestMatch.score,
            chunkIndex: bestMatch.chunkIndex,
            matchingText: bestMatch.text + "..." // Muestra un fragmento del chunk
        };
    }).sort((a, b) => b.score - a.score);
};

// 📌 Uso
const directorioNormasJSON = 'norms'; // Ruta donde están los JSON
const terminoBusqueda = 'ministerio de educacion';

searchNormasInJSON(directorioNormasJSON, terminoBusqueda)
    .then(resultados => console.log('Resultados:', resultados))
    .catch(error => console.error('Error en la búsqueda:', error));




// const LOCAL_DIRECTORY = 'cdn'; // Ruta donde están los archivos XML

// // 📌 Función para obtener una norma por su ID desde el disco local
// const getNormaByIdLocal = async (idNorma) => {
//     try {
//         const filePath = path.join(LOCAL_DIRECTORY, `norma_${idNorma}.xml`);
        
//         // Verificar si el archivo existe
//         if (!fs.existsSync(filePath)) {
//             console.warn(`El archivo norma_${idNorma}.xml no existe.`);
//             return null;
//         }

//         // Leer el archivo XML
//         const xmlData = fs.readFileSync(filePath, 'utf8');
//         return xmlData;
//     } catch (error) {
//         console.error(`Error al leer norma ${idNorma} desde local:`, error.message);
//         return null;
//     }
// };

// // 📌 Ejemplo de Uso
// const idNorma = 1; // Cambia por el ID de la norma que quieres obtener
// getNormaByIdLocal(idNorma).then(data => {
//     if (data) {
//         console.log('Norma obtenida:', data);
//     } else {
//         console.log('No se encontró la norma.');
//     }
// });
