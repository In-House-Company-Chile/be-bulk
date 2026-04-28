const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

const COLLECTION = config.qdrant.collection;
const BASE_URL = 'https://www.sii.cl';

// ─── URLs del listado por año ─────────────────────────────────────────────────
// 2009-2010: estructura distinta (tbody[2])
// 2011-2026: estructura estándar (tbody)

function getListUrl(year) {
    if (year === 2009) return `${BASE_URL}/transparencia/actos_doctos_do_2009.html`;
    if (year === 2010) return `${BASE_URL}/transparencia/actos_doctos_do_2010.html`;
    return `${BASE_URL}/transparencia/${year}/actos_doctos_do.html`;
}

class SiiSource extends BaseSource {

    constructor() {
        super(COLLECTION, COLLECTION);
    }

    // ─── Scrape ───────────────────────────────────────────────────────────────
    // params: { year: number }
    // 1. Fetcha el listado del año
    // 2. Parsea cada fila → extrae metadata + URL del documento
    // 3. Fetcha cada documento HTML → extrae texto de etiquetas <p>
    // Retorna array de documentos listos para el pipeline

    async scrape({ year } = {}) {
        if (!year) throw new Error('SII requiere --year=NNNN');

        const listUrl = getListUrl(parseInt(year));
        console.log(`[SII:${year}] Fetching listado: ${listUrl}`);

        const { data: listHtml } = await axios.get(listUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'es-CL,es;q=0.9' },
            timeout: 30000,
        });

        const rows = this._parseListado(listHtml, year);
        console.log(`[SII:${year}] ${rows.length} resoluciones encontradas`);

        // Fetchar texto de cada documento
        const documents = [];
        for (const row of rows) {
            try {
                const text = await this._fetchDocumento(row.docUrl);
                documents.push({
                    id: `sii-${year}-${row.numero}`,
                    title: row.materia,
                    pdfUrl: null,
                    text: text || null,
                    filename: `sii-${year}-${row.numero}.json`,
                    rawJson: row,
                    organism: 'Servicio de Impuestos Internos',
                    metadata: {
                        numero: row.numero,
                        tipo_documento: row.tipoDocumento,
                        fecha: row.fecha,
                        estado: row.estado,
                        doc_url: row.docUrl,
                        year: String(year),
                        fuente: 'sii',
                        tipo_documento_general: 'resolucion',
                    },
                });
            } catch (err) {
                console.error(`[SII:${year}] ❌ Error en ${row.docUrl}: ${err.message}`);
            }

            // Rate limiting
            await new Promise(r => setTimeout(r, 300));
        }

        return documents;
    }

    // ─── Parser del listado ───────────────────────────────────────────────────

    _parseListado(html, year) {
        const $ = cheerio.load(html);
        const rows = [];

        // 2009-2010 usan tbody:nth-of-type(2), 2011+ usan tbody directo
        const tbodySelector = (year <= 2010) ? 'table tbody:nth-of-type(2) tr' : 'table tbody tr';

        $(tbodySelector).each((_, tr) => {
            const tds = $(tr).find('td');
            if (tds.length < 5) return;

            const materia = $(tds[0]).text().trim();
            const tipoDocumento = $(tds[1]).text().trim();
            const numero = $(tds[2]).text().trim();
            const fecha = $(tds[3]).text().trim();
            const link = $(tds[4]).find('a').attr('href');
            const estado = tds.length >= 6 ? $(tds[5]).text().trim() : '';

            if (!link || !numero) return;

            // Normalizar URL (puede ser relativa o absoluta)
            const docUrl = link.startsWith('http') ? link : `${BASE_URL}${link}`;

            rows.push({ materia, tipoDocumento, numero, fecha, estado, docUrl });
        });

        return rows;
    }

    // ─── Fetch y extracción de texto del documento ────────────────────────────

    async _fetchDocumento(url) {
        const { data: html } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0', 'Accept-Language': 'es-CL,es;q=0.9' },
            timeout: 30000,
        });

        return this._extractText(html);
    }

    _extractText(html) {
        const $ = cheerio.load(html);

        // El texto está distribuido en etiquetas <p> dentro de:
        // /html/body/div/center/table/tbody/tr/td/font
        // Recogemos todos los <p> de ese contenedor y concatenamos
        const container = $('body div center table tbody tr td font');

        const paragraphs = [];

        // Recoger <p> directos y anidados dentro del contenedor
        container.find('p').each((_, el) => {
            const text = $(el).text().trim();
            if (text) paragraphs.push(text);
        });

        // Fallback: si no encontró <p> tomar todo el texto del contenedor
        if (paragraphs.length === 0) {
            const fallback = container.text().trim();
            if (fallback) paragraphs.push(fallback);
        }

        // Fallback final: todo el body
        if (paragraphs.length === 0) {
            paragraphs.push($('body').text().trim());
        }

        return paragraphs.join('\n\n');
    }

    // ─── Qdrant payload ───────────────────────────────────────────────────────

    getQdrantPayload(doc, chunk, totalChunks) {
        return {
            texto: chunk.text,
            tipo_documento: doc.metadata.tipo_documento || 'resolucion',
            doc_id: doc.id,
            numero: doc.metadata.numero,
            titulo: doc.title,
            organismo: doc.organism,
            fecha: doc.metadata.fecha,
            year: doc.metadata.year,
            estado: doc.metadata.estado,
            doc_url: doc.metadata.doc_url,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
        };
    }

    // ─── Tema inference ───────────────────────────────────────────────────────

    inferTema(doc) {
        const t = `${doc.title}`.toLowerCase();

        if (t.includes('iva') || t.includes('valor agregado')) return 'iva';
        if (t.includes('renta') || t.includes('impuesto a la renta')) return 'impuesto_renta';
        if (t.includes('timbre') || t.includes('estampilla')) return 'impuesto_timbres';
        if (t.includes('exporta') || t.includes('devolución')) return 'exportaciones';
        if (t.includes('factura') || t.includes('boleta') || t.includes('dte')) return 'documentos_tributarios';
        if (t.includes('rut') || t.includes('registro')) return 'registro_contribuyentes';
        if (t.includes('fiscalización') || t.includes('fiscalizacion')) return 'fiscalizacion';
        if (t.includes('procedimiento') || t.includes('tramite')) return 'procedimiento_tributario';
        if (t.includes('exención') || t.includes('exencion')) return 'exenciones';
        if (t.includes('herencia') || t.includes('donación')) return 'herencias_donaciones';
        if (t.includes('minería') || t.includes('mineria')) return 'mineria';
        if (t.includes('bienes raíces') || t.includes('bienes raices')) return 'bienes_raices';

        return 'general';
    }

    static getYearRange() {
        return { from: 2009, to: new Date().getFullYear() };
    }

    static getParamsHelp() {
        return '--year=NNNN (2009–presente)';
    }
}

module.exports = SiiSource;