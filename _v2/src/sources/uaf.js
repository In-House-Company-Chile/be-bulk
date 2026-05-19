const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

const COLLECTION = config.qdrant.collection;
const BASE_URL = 'https://www.uaf.cl/es-cl/publicaciones-uaf/sanciones-ejecutoriadas';

class UafSource extends BaseSource {
    constructor() {
        super(COLLECTION, COLLECTION);
    }

    /**
     * Scrape del listado de sanciones ejecutoriadas de la UAF
     */
    async scrape() {
        try {
            console.log(`[UAF] 🌐 Conectando a la UAF: ${BASE_URL}`);

            const response = await axios.get(BASE_URL, {
                headers: {
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                    'Cookie': 'django_language=es-cl'
                },
                timeout: 30000
            });

            const $ = cheerio.load(response.data);
            const documents = [];

            // Selector para iterar por las filas de la tabla de sanciones
            // Usamos un selector general robusto para capturar las tablas dentro del contenedor
            $('table tbody tr').each((i, el) => {
                const cells = $(el).find('td');
                if (cells.length < 5) return;

                // Estructura de columnas típica de la UAF:
                // Col 1 (td[1]): N° Sanción / Registro (Ej: N° 001/2012)
                // Col 2 (td[2]): Persona Natural o Jurídica Sancionada (Sujeto Obligado)
                // Col 3 (td[3]): RUT
                // Col 4 (td[4]): Sector Económico
                // Col 5 (td[5]): Tipo de Sanción / Detalle
                // Col 6 (td[6]): Botón "Descargar" PDF
                const nroSancion = $(cells[0]).text().trim();
                const sujetoObligado = $(cells[1]).text().trim();
                const rut = $(cells[2]).text().trim();
                const sectorEconomico = $(cells[3]).text().trim();
                const tipoSancion = $(cells[4]).text().trim();

                const downloadBtn = $(cells[5]).find('a');
                const pdfUrl = downloadBtn.attr('href');

                if (pdfUrl && sujetoObligado) {
                    let cleanPdfUrl = pdfUrl.trim();
                    // Normalización de URL relativa a absoluta
                    if (!cleanPdfUrl.startsWith('http')) {
                        cleanPdfUrl = `https://www.uaf.cl${cleanPdfUrl.startsWith('/') ? '' : '/'}${cleanPdfUrl}`;
                    }

                    // Extraer nombre del PDF para usarlo como ID único determinístico (Ej: N001-2012_AREP)
                    const filenameMatch = cleanPdfUrl.match(/\/([^\/]+)\.pdf$/i);
                    const pdfName = filenameMatch ? filenameMatch[1] : null;

                    // Si no se puede extraer el nombre, generamos un identificador basado en N° y RUT
                    const baseId = pdfName
                        ? `UAF-SANC-${pdfName}`.replace(/[^a-zA-Z0-9_-]/g, '-')
                        : `UAF-SANC-${nroSancion}-${rut}`.replace(/[^a-zA-Z0-9_-]/g, '-');

                    // Extraer el año del identificador o número de sanción
                    const anioMatch = nroSancion.match(/\d{4}/) || cleanPdfUrl.match(/\d{4}/);
                    const anio = anioMatch ? anioMatch[0] : new Date().getFullYear();

                    documents.push({
                        id: baseId,
                        title: `Sanción UAF N° ${nroSancion}: ${sujetoObligado}`,
                        pdfUrl: cleanPdfUrl,
                        text: null,
                        filename: pdfName ? `${pdfName}.pdf` : `${baseId}.pdf`,
                        organism: 'Unidad de Análisis Financiero',
                        metadata: {
                            nro_sancion: nroSancion,
                            sujeto_obligado: sujetoObligado,
                            rut: rut,
                            sector_economico: sectorEconomico,
                            tipo_sancion: tipoSancion,
                            anio: anio,
                            fuente: 'uaf',
                            tipo_documento: 'sancion_ejecutoriada'
                        }
                    });
                }
            });

            console.log(`[UAF] 📄 Se detectaron ${documents.length} sanciones vigentes.`);
            return documents;

        } catch (error) {
            console.error(`[UAF] ❌ Error en scrape de la UAF: ${error.message}`);
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
            seccion: params.section || 'sanciones',
            edicion: params.edition || 'ejecutoriadas'
        };
    }

    /**
     * Mapeo para Qdrant (mantiene compatibilidad de firma con el pipeline)
     */
    getQdrantPayload(doc, chunk, totalChunks, params) {
        return {
            texto: chunk.text,
            tipo_documento: 'sancion_uaf',
            doc_id: doc.id,
            nro_sancion: doc.metadata.nro_sancion,
            sujeto_obligado: doc.metadata.sujeto_obligado,
            rut: doc.metadata.rut,
            sector_economico: doc.metadata.sector_economico,
            tipo_sancion: doc.metadata.tipo_sancion,
            organismo: doc.organism,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            fuente: 'uaf',
            seccion: params.section || 'sanciones',
            edicion: params.edition || 'ejecutoriadas'
        };
    }

    static getTotalPages() { return 1; }
}

module.exports = UafSource;