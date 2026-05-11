const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');


const COLLECTION = config.qdrant.collection;
const BASE_URL = 'https://www.sesuperior.cl/es_cl/pronunciamiento/';

class SiesSource extends BaseSource {
    constructor() {
        super(COLLECTION, COLLECTION);
    }

    /**
     * Scrape del listado de pronunciamientos
     */
    async scrape() {
        const response = await axios.get(BASE_URL, {
            headers: {
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 30000
        });

        const $ = cheerio.load(response.data);
        const documents = [];

        // La ruta proporcionada apunta a una tabla. 
        // Iteramos sobre las filas del tbody, saltando el encabezado si es necesario.
        $('table tbody tr').each((i, el) => {
            const cells = $(el).find('td');
            if (cells.length < 3) return;

            // Ajustar índices según la estructura real de la tabla observada
            const nDocumento = $(cells[0]).text().trim();
            const anio = $(cells[1]).text().trim();
            const materia = $(cells[2]).text().trim();
            const linkElement = $(cells[2]).find('a'); // A veces el link está en la materia o una columna dedicada
            const pdfUrl = linkElement.attr('href') || $(el).find('a[href$=".pdf"]').attr('href');

            if (pdfUrl) {
                // Limpiar URL si es relativa
                const fullPdfUrl = pdfUrl.startsWith('http') ? pdfUrl : `https://www.sesuperior.cl${pdfUrl}`;

                documents.push({
                    id: `SIES-${nDocumento}-${anio}`.replace(/\s+/g, '-'),
                    title: `Pronunciamiento ${nDocumento}/${anio}: ${materia}`,
                    pdfUrl: fullPdfUrl,
                    text: null,
                    filename: `sies-${nDocumento}-${anio}.pdf`,
                    organism: 'Subsecretaría de Educación Superior',
                    metadata: {
                        n_documento: nDocumento,
                        anio: anio,
                        materia: materia,
                        fuente: 'sies',
                        tipo_documento: 'pronunciamiento'
                    }
                });
            }
        });

        return documents;
    }

    /**
     * Payload para Qdrant
     */
    getQdrantPayload(doc, chunk, totalChunks) {
        return {
            texto: chunk.text,
            tipo_documento: 'pronunciamiento_sies',
            doc_id: doc.id,
            numero: doc.metadata.n_documento,
            anio: doc.metadata.anio,
            materia: doc.metadata.materia,
            titulo: doc.title,
            organismo: doc.organism,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            fuente: 'sies'
        };
    }

    static getTotalPages() { return 1; }
}

module.exports = SiesSource;