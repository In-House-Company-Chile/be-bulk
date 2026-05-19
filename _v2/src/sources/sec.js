const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

const COLLECTION = config.qdrant.collection;
const BASE_URL = 'https://www.sec.cl/transparencia/';

class SecSource extends BaseSource {
    constructor() {
        super(COLLECTION, COLLECTION);
    }

    /**
     * Scrape de las páginas de la SEC
     * page 1 -> diariooficial.html
     * page 2 -> diariooficial-2.html
     */
    async scrape({ page = 1 } = {}) {
        const targetUrl = page === 2
            ? `${BASE_URL}diariooficial-2.html`
            : `${BASE_URL}diariooficial.html`;

        try {
            console.log(`[SEC] 🌐 Conectando a: ${targetUrl}`);

            const response = await axios.get(targetUrl, {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
                },
                timeout: 30000
            });

            const $ = cheerio.load(response.data);
            const documents = [];

            // Selector basado en el XPath: /html/body/div[4]/table/tbody/tr
            // Ajustamos el selector para ser más flexible si div[4] varía
            $('table tbody tr').each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length < 3) return;

                // Estructura común: [Fecha/Número, Materia, ..., Descarga]
                // Basado en tu XPath td[5] es el link
                const materia = $(cells[1]).text().trim();
                const identificador = $(cells[0]).text().trim();
                const linkElement = $(cells[4]).find('a').length > 0
                    ? $(cells[4]).find('a')
                    : $(el).find('a[href*=".pdf"]');

                const pdfUrl = linkElement.attr('href');

                if (pdfUrl && identificador) {
                    // Limpieza de URL
                    let cleanPdfUrl = pdfUrl.trim();
                    if (!cleanPdfUrl.startsWith('http')) {
                        cleanPdfUrl = cleanPdfUrl.startsWith('/')
                            ? `https://www.sec.cl${cleanPdfUrl}`
                            : `https://www.sec.cl/transparencia/${cleanPdfUrl}`;
                    }

                    // Extraer año para ID
                    const anioMatch = identificador.match(/\d{4}/) || materia.match(/\d{4}/);
                    const anio = anioMatch ? anioMatch[0] : new Date().getFullYear();

                    const baseId = `SEC-RESOL-${identificador}-${anio}`.replace(/[^a-zA-Z0-9]/g, '-');

                    documents.push({
                        id: baseId,
                        title: materia.substring(0, 200),
                        pdfUrl: cleanPdfUrl,
                        text: null,
                        filename: `${baseId}.pdf`,
                        organism: 'Superintendencia de Electricidad y Combustibles',
                        metadata: {
                            identificador,
                            materia,
                            anio,
                            fuente: 'sec',
                            tipo_documento: 'resolucion_do'
                        }
                    });
                }
            });

            console.log(`[SEC] 📄 Se detectaron ${documents.length} documentos en la página ${page}.`);
            return documents;

        } catch (error) {
            console.error(`[SEC] ❌ Error en scrape página ${page}: ${error.message}`);
            throw error;
        }
    }

    getPostgresMetadata(doc, params) {
        return {
            ...doc.metadata,
            title: doc.title,
            organism: doc.organism,
            seccion: params.section || 'transparencia',
            edicion: params.edition || 'diario-oficial'
        };
    }

    getQdrantPayload(doc, chunk, totalChunks, params) {
        return {
            texto: chunk.text,
            tipo_documento: 'resolucion_sec',
            doc_id: doc.id,
            materia: doc.metadata.materia,
            identificador: doc.metadata.identificador,
            organismo: doc.organism,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            fuente: 'sec'
        };
    }

    static getTotalPages() { return 2; }
}

module.exports = SecSource;