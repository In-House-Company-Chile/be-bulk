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
     * Scrape del listado de pronunciamientos con reintentos y mayor timeout
     */
    async scrape(retryCount = 0) {
        try {
            const response = await axios.get(BASE_URL, {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'Accept-Language': 'es-419,es;q=0.9,en;q=0.8',
                    'Cache-Control': 'no-cache',
                    'Pragma': 'no-cache',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
                },
                timeout: 60000 // Aumentado a 60 segundos
            });

            const $ = cheerio.load(response.data);
            const documents = [];

            // Buscamos la tabla de pronunciamientos
            // El selector suele ser table o div.table-responsive table
            const tableRows = $('table tbody tr');

            if (tableRows.length === 0) {
                console.log("⚠️ No se encontraron filas en la tabla. Verificando estructura alternativa...");
            }

            tableRows.each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length < 3) return;

                const nDocumento = $(cells[0]).text().trim();
                const anio = $(cells[1]).text().trim();
                const materia = $(cells[2]).text().trim();

                // Buscar el link al PDF en la fila
                let pdfUrl = null;
                const linkElement = $(el).find('a[href*=".pdf"]');

                if (linkElement.length > 0) {
                    pdfUrl = linkElement.attr('href');
                }

                if (pdfUrl && nDocumento) {
                    const fullPdfUrl = pdfUrl.startsWith('http') ? pdfUrl : `https://www.sesuperior.cl${pdfUrl}`;

                    documents.push({
                        id: `SIES-${nDocumento}-${anio}`.replace(/[\/\s]+/g, '-'),
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

        } catch (error) {
            // Reintento simple si falla por timeout (hasta 2 veces)
            if (retryCount < 2 && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
                console.log(`⏳ Timeout en SIES. Reintentando (${retryCount + 1}/2)...`);
                await new Promise(r => setTimeout(r, 5000));
                return this.scrape(retryCount + 1);
            }
            throw error;
        }
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