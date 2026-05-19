const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

const COLLECTION = config.qdrant.collection;
const BASE_URL = 'https://tribunalambiental.cl/sentencias-e-informes/sentencias/';

class TribunalAmbientalSource extends BaseSource {
    constructor() {
        super(COLLECTION, COLLECTION);
    }

    /**
     * Scrape del listado de sentencias del Tribunal Ambiental
     */
    async scrape() {
        try {
            console.log(`[TRIBUNAL AMBIENTAL] 🌐 Conectando a: ${BASE_URL}`);
            
            const response = await axios.get(BASE_URL, {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                },
                timeout: 30000
            });

            const $ = cheerio.load(response.data);
            const documents = [];

            // Buscamos todas las filas de la tabla de sentencias
            const rows = $('table tbody tr');
            console.log(`[TRIBUNAL AMBIENTAL] 📊 Filas detectadas en el HTML: ${rows.length}`);

            rows.each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length < 2) return;

                // En la estructura del Tribunal Ambiental:
                // Generalmente td[0] tiene el Rol/Causa o carátula, y td[1] o td[2] contiene los botones/enlaces de descarga.
                const causaTexto = $(cells[0]).text().trim();
                
                // Buscamos el enlace que contenga ".pdf"
                const linkElement = $(el).find('a[href*=".pdf"]');
                const pdfUrl = linkElement.attr('href');

                if (pdfUrl) {
                    let cleanPdfUrl = pdfUrl.trim().replace(/\s/g, '%20');

                    // Intentar extraer metadatos del nombre del archivo PDF (ej: 2025.12.22_Sentencia_D-45-2019.pdf)
                    const filenameMatch = cleanPdfUrl.match(/\/([^\/]+)\.pdf$/i);
                    const pdfFilename = filenameMatch ? filenameMatch[1] : '';

                    // Regex para capturar el Rol/Causa de la resolución (ej: D-45-2019, R-12-2021)
                    const rolMatch = pdfFilename.match(/([DRS]-\d+-\d{4})/i) || causaTexto.match(/([DRS]-\d+-\d{4})/i);
                    const rol = rolMatch ? rolMatch[1].toUpperCase() : `CAUSA-${i}`;

                    // Regex para capturar la fecha del nombre de archivo (ej: 2025.12.22)
                    const fechaMatch = pdfFilename.match(/^(\d{4})[\._](\d{2})[\._](\d{2})/);
                    let fechaResolucion = null;
                    let anio = new Date().getFullYear();

                    if (fechaMatch) {
                        // Formatear a DD-MM-YYYY
                        fechaResolucion = `${fechaMatch[3]}-${fechaMatch[2]}-${fechaMatch[1]}`;
                        anio = fechaMatch[1];
                    } else {
                        // Fallback de año por si no viene al inicio del archivo
                        const anioMatch = pdfFilename.match(/\d{4}/) || causaTexto.match(/\d{4}/);
                        anio = anioMatch ? anioMatch[0] : anio;
                    }

                    // ID determinístico para evitar colisiones en la base de datos
                    const baseId = `TA-SENT-${rol}`.replace(/[^a-zA-Z0-9_-]/g, '-');

                    documents.push({
                        id: baseId,
                        title: `Sentencia Tribunal Ambiental Rol ${rol}: ${causaTexto.substring(0, 100)}`,
                        pdfUrl: cleanPdfUrl,
                        text: null,
                        filename: `${baseId}.pdf`,
                        organism: 'Tribunal Ambiental',
                        metadata: {
                            rol: rol,
                            fecha_resolucion: fechaResolucion,
                            anio: anio,
                            materia: causaTexto,
                            fuente: 'tribunal_ambiental',
                            tipo_documento: 'sentencia'
                        }
                    });
                }
            });

            console.log(`[TRIBUNAL AMBIENTAL] 📄 Se detectaron ${documents.length} sentencias válidas.`);
            return documents;

        } catch (error) {
            console.error(`[TRIBUNAL AMBIENTAL] ❌ Error en el scrape: ${error.message}`);
            throw error;
        }
    }

    /**
     * Retorna la metadata formateada para PostgreSQL
     */
    getPostgresMetadata(doc, params) {
        return {
            ...doc.metadata,
            title: doc.title,
            organism: doc.organism,
            seccion: params.section || 'jurisprudencia',
            edicion: params.edition || 'sentencias'
        };
    }

    /**
     * Mapeo para el payload de Qdrant (mantenemos firma compatible con el pipeline)
     */
    getQdrantPayload(doc, chunk, totalChunks, params) {
        return {
            texto: chunk.text,
            tipo_documento: 'sentencia_tribunal_ambiental',
            doc_id: doc.id,
            rol: doc.metadata.rol,
            materia: doc.metadata.materia,
            fecha: doc.metadata.fecha_resolucion,
            organismo: doc.organism,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            fuente: 'tribunal_ambiental',
            seccion: params.section || 'jurisprudencia',
            edicion: params.edition || 'sentencias'
        };
    }

    static getTotalPages() { return 1; }
}

module.exports = TribunalAmbientalSource;