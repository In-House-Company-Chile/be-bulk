const fs = require('fs');
const path = require('path');

// Configuración
const API_URL = 'https://www.contraloria.cl/apibusca/search/dictamenes';
const OUTPUT_DIR = './dictamenes';
const MAX_PAGES = 500; // páginas 0-499
const DELAY_BETWEEN_REQUESTS = 100; // ms entre requests para no sobrecargar la API

// Headers para la request
const headers = {
    'Content-Type': 'application/json',
    'Cookie': 'PD_STATEFUL_db835014-ee43-11ef-a1e0-74fe484479fc=%2Fapibusca'
};

// Crear directorio de salida si no existe
if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// Función para hacer delay
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Función para hacer request a una página específica
async function fetchPage(pageNumber) {
    const requestBody = {
        "search": "",
        "options": [],
        "order": "date",
        "date_name": "fecha_documento",
        "source": "dictamenes",
        "page": pageNumber
    };

    try {
        console.log(`Procesando página ${pageNumber}...`);
        
        const response = await fetch(API_URL, {
            method: 'POST',
            headers: headers,
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        
        if (data.hits && data.hits.hits) {
            console.log(`Página ${pageNumber}: ${data.hits.hits.length} hits encontrados`);
            return data.hits.hits;
        } else {
            console.warn(`Página ${pageNumber}: No se encontraron hits`);
            return [];
        }
    } catch (error) {
        console.error(`Error en página ${pageNumber}:`, error.message);
        return null;
    }
}

// Función para generar un nombre de archivo único para duplicados
function generateUniqueFileName(baseId, extension = '.json') {
    let fileName = `${baseId}${extension}`;
    let filePath = path.join(OUTPUT_DIR, fileName);
    
    // Si no existe, usar el nombre original
    if (!fs.existsSync(filePath)) {
        return { fileName, filePath };
    }
    
    // Si existe, generar nombres con sufijo duplicado_nRandom
    let attempts = 0;
    const maxAttempts = 100; // Evitar bucle infinito
    
    while (attempts < maxAttempts) {
        const randomNum = Math.floor(Math.random() * 10000); // Número aleatorio de 0-9999
        const duplicateFileName = `${baseId}_duplicado_${randomNum}${extension}`;
        const duplicateFilePath = path.join(OUTPUT_DIR, duplicateFileName);
        
        if (!fs.existsSync(duplicateFilePath)) {
            return { fileName: duplicateFileName, filePath: duplicateFilePath };
        }
        
        attempts++;
    }
    
    // Si después de 100 intentos no encuentra nombre único, usar timestamp
    const timestamp = Date.now();
    const timestampFileName = `${baseId}_duplicado_${timestamp}${extension}`;
    const timestampFilePath = path.join(OUTPUT_DIR, timestampFileName);
    
    return { fileName: timestampFileName, filePath: timestampFilePath };
}

// Función para guardar un hit como archivo JSON
function saveHit(hit) {
    try {
        const { fileName, filePath } = generateUniqueFileName(hit._id);
        
        fs.writeFileSync(filePath, JSON.stringify(hit, null, 2), 'utf8');
        
        // Determinar si es duplicado
        const isDuplicate = fileName.includes('duplicado_');
        
        // Log diferente si es duplicado
       /*  if (isDuplicate) {
            console.log(`Guardado como duplicado: ${fileName}`);
        } else {
            console.log(`Guardado: ${fileName}`);
        } */
        
        return { success: true, isDuplicate };
    } catch (error) {
        console.error(`Error guardando hit ${hit._id}:`, error.message);
        return { success: false, isDuplicate: false };
    }
}

// Función para descargar páginas específicas
async function downloadSpecificPages(pages) {
    console.log(`Descargando páginas específicas: [${pages.join(', ')}]`);
    console.log(`Directorio de salida: ${OUTPUT_DIR}`);
    
    let totalHits = 0;
    let totalSaved = 0;
    let duplicates = 0;
    let errors = 0;
    const processedPages = [];

    for (const page of pages) {
        if (page < 0 || page >= MAX_PAGES) {
            console.warn(`Página ${page} fuera del rango válido (0-${MAX_PAGES - 1}), saltando...`);
            continue;
        }

        const hits = await fetchPage(page);
        
        if (hits === null) {
            errors++;
            console.log(`Error en página ${page}, continuando...`);
            continue;
        }
        
        if (hits.length === 0) {
            console.log(`Página ${page} vacía`);
            processedPages.push(page);
            continue;
        }
        
        // Guardar cada hit
        for (const hit of hits) {
            totalHits++;
            const result = saveHit(hit);
            if (result.success) {
                totalSaved++;
                if (result.isDuplicate) {
                    duplicates++;
                }
            }
        }
        
        processedPages.push(page);
        console.log(`Página ${page} completada: ${hits.length} hits`);
        
        // Delay entre requests si hay más páginas
        if (pages.indexOf(page) < pages.length - 1) {
            await sleep(DELAY_BETWEEN_REQUESTS);
        }
    }
    
    console.log('\n=== RESUMEN PÁGINAS ESPECÍFICAS ===');
    console.log(`Páginas solicitadas: [${pages.join(', ')}]`);
    console.log(`Páginas procesadas: [${processedPages.join(', ')}]`);
    console.log(`Total hits encontrados: ${totalHits}`);
    console.log(`Archivos guardados: ${totalSaved}`);
    console.log(`Archivos duplicados: ${duplicates}`);
    console.log(`Errores: ${errors}`);
    console.log(`Directorio: ${OUTPUT_DIR}`);
}

// Función para descargar un rango de páginas
async function downloadPageRange(startPage, endPage) {
    if (startPage > endPage) {
        console.error('La página inicial no puede ser mayor que la página final');
        return;
    }
    
    if (startPage < 0 || endPage >= MAX_PAGES) {
        console.error(`El rango debe estar entre 0 y ${MAX_PAGES - 1}`);
        return;
    }

    console.log(`Descargando rango de páginas: ${startPage}-${endPage}`);
    console.log(`Directorio de salida: ${OUTPUT_DIR}`);
    
    let totalHits = 0;
    let totalSaved = 0;
    let duplicates = 0;
    let errors = 0;
    const totalPages = endPage - startPage + 1;

    for (let page = startPage; page <= endPage; page++) {
        const hits = await fetchPage(page);
        
        if (hits === null) {
            errors++;
            console.log(`Error en página ${page}, continuando...`);
            continue;
        }
        
        if (hits.length === 0) {
            console.log(`Página ${page} vacía, continuando...`);
            continue;
        }
        
        // Guardar cada hit
        for (const hit of hits) {
            totalHits++;
            const result = saveHit(hit);
            if (result.success) {
                totalSaved++;
                if (result.isDuplicate) {
                    duplicates++;
                }
            }
        }
        
        // Mostrar progreso cada 10 páginas o al final
        const currentProgress = page - startPage + 1;
        if (currentProgress % 10 === 0 || page === endPage) {
            console.log(`Progreso: ${currentProgress}/${totalPages} páginas procesadas`);
            console.log(`Total hits: ${totalHits}, Guardados: ${totalSaved}, Duplicados: ${duplicates}, Errores: ${errors}`);
        }
        
        // Delay entre requests
        if (page < endPage) {
            await sleep(DELAY_BETWEEN_REQUESTS);
        }
    }
    
    console.log('\n=== RESUMEN RANGO ===');
    console.log(`Rango procesado: ${startPage}-${endPage} (${totalPages} páginas)`);
    console.log(`Total hits encontrados: ${totalHits}`);
    console.log(`Archivos guardados: ${totalSaved}`);
    console.log(`Archivos duplicados: ${duplicates}`);
    console.log(`Errores: ${errors}`);
    console.log(`Directorio: ${OUTPUT_DIR}`);
}

// Función principal (descarga completa)
async function main() {
    console.log(`Iniciando descarga completa de dictámenes...`);
    console.log(`Páginas a procesar: 0-${MAX_PAGES - 1}`);
    console.log(`Directorio de salida: ${OUTPUT_DIR}`);
    
    let totalHits = 0;
    let totalSaved = 0;
    let duplicates = 0;
    let errors = 0;

    for (let page = 0; page < MAX_PAGES; page++) {
        const hits = await fetchPage(page);
        
        if (hits === null) {
            errors++;
            console.log(`Error en página ${page}, continuando...`);
            continue;
        }
        
        if (hits.length === 0) {
            console.log(`Página ${page} vacía, continuando...`);
            continue;
        }
        
        // Guardar cada hit
        for (const hit of hits) {
            totalHits++;
            const result = saveHit(hit);
            if (result.success) {
                totalSaved++;
                if (result.isDuplicate) {
                    duplicates++;
                }
            }
        }
        
        // Mostrar progreso cada 10 páginas
        if ((page + 1) % 10 === 0) {
            console.log(`Progreso: ${page + 1}/${MAX_PAGES} páginas procesadas`);
            console.log(`Total hits: ${totalHits}, Guardados: ${totalSaved}, Duplicados: ${duplicates}, Errores: ${errors}`);
        }
        
        // Delay entre requests
        if (page < MAX_PAGES - 1) {
            await sleep(DELAY_BETWEEN_REQUESTS);
        }
    }
    
    console.log('\n=== RESUMEN FINAL ===');
    console.log(`Páginas procesadas: ${MAX_PAGES}`);
    console.log(`Total hits encontrados: ${totalHits}`);
    console.log(`Archivos guardados: ${totalSaved}`);
    console.log(`Archivos duplicados: ${duplicates}`);
    console.log(`Errores: ${errors}`);
    console.log(`Directorio: ${OUTPUT_DIR}`);
}

// Función para mostrar ayuda
function showHelp() {
    console.log(`
Uso del script de descarga de dictámenes:

DESCARGA COMPLETA:
  node contraloriaFile.js
  - Descarga todas las páginas (0-499)

PÁGINAS ESPECÍFICAS:
  node contraloriaFile.js --pages 0,5,10,25
  - Descarga las páginas especificadas (separadas por comas)

RANGO DE PÁGINAS:
  node contraloriaFile.js --range 10-20
  - Descarga páginas del 10 al 20 (inclusive)

EJEMPLOS:
  node contraloriaFile.js --pages 0,1,2          # Primeras 3 páginas
  node contraloriaFile.js --range 0-9            # Primeras 10 páginas
  node contraloriaFile.js --pages 100            # Solo la página 100
  node contraloriaFile.js --range 490-499        # Últimas 10 páginas

OPCIONES:
  --help, -h    Mostrar esta ayuda
`);
}

// Función para parsear argumentos de línea de comandos
function parseArguments() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        return { mode: 'complete' };
    }
    
    if (args.includes('--help') || args.includes('-h')) {
        return { mode: 'help' };
    }
    
    // Páginas específicas
    const pagesIndex = args.indexOf('--pages');
    if (pagesIndex !== -1 && pagesIndex + 1 < args.length) {
        const pagesStr = args[pagesIndex + 1];
        const pages = pagesStr.split(',').map(p => {
            const num = parseInt(p.trim());
            if (isNaN(num)) {
                throw new Error(`Página inválida: ${p}`);
            }
            return num;
        });
        return { mode: 'specific', pages };
    }
    
    // Rango de páginas
    const rangeIndex = args.indexOf('--range');
    if (rangeIndex !== -1 && rangeIndex + 1 < args.length) {
        const rangeStr = args[rangeIndex + 1];
        const rangeParts = rangeStr.split('-');
        if (rangeParts.length !== 2) {
            throw new Error(`Formato de rango inválido: ${rangeStr}. Use formato: inicio-fin`);
        }
        const startPage = parseInt(rangeParts[0].trim());
        const endPage = parseInt(rangeParts[1].trim());
        if (isNaN(startPage) || isNaN(endPage)) {
            throw new Error(`Rango inválido: ${rangeStr}`);
        }
        return { mode: 'range', startPage, endPage };
    }
    
    throw new Error(`Argumentos no reconocidos: ${args.join(' ')}`);
}

// Ejecutar el script
if (require.main === module) {
    try {
        const config = parseArguments();
        
        switch (config.mode) {
            case 'help':
                showHelp();
                break;
            case 'specific':
                downloadSpecificPages(config.pages).catch(console.error);
                break;
            case 'range':
                downloadPageRange(config.startPage, config.endPage).catch(console.error);
                break;
            case 'complete':
            default:
                main().catch(console.error);
                break;
        }
    } catch (error) {
        console.error('Error:', error.message);
        console.log('\nUsa --help para ver las opciones disponibles.');
        process.exit(1);
    }
}

module.exports = { fetchPage, saveHit, main, downloadSpecificPages, downloadPageRange };
