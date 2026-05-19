const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

const COLLECTION = config.qdrant.collection;
const BASE_URL = 'https://snifa.sma.gob.cl/Resolucion/Programa';

class SnifaSource extends BaseSource {
    constructor() {
        super(COLLECTION, COLLECTION);
    }

    /**
     * Scrape del listado de resoluciones SNIFA
     */
    async scrape(retryCount = 0) {
        try {
            console.log(`[SNIFA] 🌐 Conectando a SMA: ${BASE_URL}`);

            const response = await axios.get(BASE_URL, {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Cache-Control': 'no-cache'
                },
                timeout: 60000
            });

            const $ = cheerio.load(response.data);
            const documents = [];
            const auditLog = []; // Nuevo array para auditoría detallada

            const rows = $('table tbody tr');

            if (rows.length === 0) {
                console.warn('[SNIFA] ⚠️ No se encontraron filas en la tabla.');
                return [];
            }

            console.log(`[SNIFA] 📊 Filas detectadas en el HTML: ${rows.length}`);

            rows.each((i, el) => {
                const cells = $(el).find('td');

                // Extraer datos básicos para la auditoría aunque no tenga PDF
                const nroResolucion = $(cells[0]).text().trim() || 'S/N';
                const fecha = $(cells[1]).text().trim() || 'S/F';
                const materia = $(cells[3]).text().trim().replace(/\s+/g, ' ') || 'Sin materia';

                // Buscamos cualquier enlace en la fila, priorizando los que parecen ser descargas
                const allLinks = $(el).find('a');
                let pdfUrl = null;

                allLinks.each((_, link) => {
                    const href = $(link).attr('href');
                    if (href && (href.toLowerCase().includes('.pdf') || href.toLowerCase().includes('download') || href.toLowerCase().includes('/doc/'))) {
                        pdfUrl = href;
                    }
                });

                if (!pdfUrl) {
                    auditLog.push({ nro: nroResolucion, url: 'N/A', status: '⚠️ SIN LINK DE DESCARGA' });
                    return;
                }

                let cleanPdfUrl = pdfUrl.trim().replace(/\s/g, '%20');

                // Normalización de protocolos
                if (cleanPdfUrl.startsWith('//')) {
                    cleanPdfUrl = `https:${cleanPdfUrl}`;
                } else if (!cleanPdfUrl.startsWith('http')) {
                    const root = 'https://snifa.sma.gob.cl';
                    cleanPdfUrl = `${root}${cleanPdfUrl.startsWith('/') ? '' : '/'}${cleanPdfUrl}`;
                }

                // Filtrado por subdominio antiguo (exclusión solicitada)
                if (cleanPdfUrl.includes('snifa.sma.gob.cl/documentos/')) {
                    auditLog.push({ nro: nroResolucion, url: cleanPdfUrl, status: '❌ EXCLUIDA (Subdominio antiguo)' });
                    return;
                }

                // Si llegamos aquí, la URL es válida e incluida
                auditLog.push({ nro: nroResolucion, url: cleanPdfUrl, status: '✅ INCLUIDA' });

                const anioMatch = fecha.match(/\d{4}/) || materia.match(/\d{4}/);
                const anio = anioMatch ? anioMatch[0] : 'XXXX';
                const baseId = `SMA-RESOL-${nroResolucion}-${anio}`.replace(/[^a-zA-Z0-9]/g, '-');

                documents.push({
                    id: baseId,
                    title: `Resolución SMA Nº ${nroResolucion}: ${materia.substring(0, 150).trim()}${materia.length > 150 ? '...' : ''}`,
                    pdfUrl: cleanPdfUrl,
                    text: null,
                    filename: `${baseId}.pdf`,
                    organism: 'Superintendencia del Medio Ambiente',
                    metadata: {
                        nro_resolucion: nroResolucion,
                        fecha: fecha,
                        anio: anio,
                        materia: materia,
                        fuente: 'snifa',
                        tipo_documento: 'resolucion_exenta'
                    }
                });
            });

            // 3. Imprimimos por consola la auditoría completa de las 107 filas
            console.log(`\n${'='.repeat(80)}`);
            console.log(` AUDITORÍA DETALLADA DE FILAS (Total: ${rows.length})`);
            console.log(`${'='.repeat(80)}`);
            auditLog.forEach((item, idx) => {
                console.log(`[${(idx + 1).toString().padStart(3, '0')}] Resol: ${item.nro.padEnd(10)} | ${item.status.padEnd(30)} | URL: ${item.url}`);
            });
            console.log(`${'='.repeat(80)}\n`);

            console.log(`[SNIFA] 📄 Total filas analizadas: ${rows.length}`);
            console.log(`[SNIFA] 📄 Válidas para procesar: ${documents.length}`);

            return documents;

        } catch (error) {
            console.error(`[SNIFA] ❌ Error en scrape: ${error.message}`);
            if (retryCount < 2 && (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')) {
                console.log(`[SNIFA] ⏳ Reintentando en 10s...`);
                await new Promise(r => setTimeout(r, 10000));
                return this.scrape(retryCount + 1);
            }
            throw error;
        }
    }

    getPostgresMetadata(doc, params) {
        return {
            ...doc.metadata,
            title: doc.title,
            organism: doc.organism,
            seccion: params.section || 'general',
            edicion: params.edition || 'unica'
        };
    }

    getQdrantPayload(doc, chunk, totalChunks, params) {
        return {
            texto: chunk.text,
            tipo_documento: 'resolucion_sma',
            doc_id: doc.id,
            nro_resolucion: doc.metadata.nro_resolucion,
            materia: doc.metadata.materia,
            fecha: doc.metadata.fecha,
            organismo: doc.organism,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            fuente: 'snifa',
            seccion: params.section || 'general',
            edicion: params.edition || 'unica'
        };
    }

    static getTotalPages() { return 1; }
}

module.exports = SnifaSource;