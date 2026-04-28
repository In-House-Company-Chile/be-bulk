const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

const COLLECTION = config.qdrant.collection;
const BASE_URL = 'https://www.tdlc.cl';
const LIST_URL = `${BASE_URL}/sentencia/`;

class TdlcSource extends BaseSource {

    constructor() {
        super(COLLECTION, COLLECTION);
    }

    // ─── Scrape ───────────────────────────────────────────────────────────────
    // params: { page: number }

    async scrape({ page = 1 } = {}) {
        const listUrl = page === 1 ? LIST_URL : `${LIST_URL}?sf_paged=${page}`;
        console.log(`[TDLC:page${page}] Fetching listado: ${listUrl}`);

        const { data: listHtml } = await axios.get(listUrl, {
            headers: this._browserHeaders(),
            timeout: 30000,
        });

        const sentenciaUrls = this._parseListado(listHtml);
        console.log(`[TDLC:page${page}] ${sentenciaUrls.length} sentencias encontradas`);

        const documents = [];

        for (const sentenciaUrl of sentenciaUrls) {
            try {
                const doc = await this._fetchSentencia(sentenciaUrl);
                if (doc) documents.push(doc);
            } catch (err) {
                console.error(`[TDLC] Error en ${sentenciaUrl}: ${err.message}`);
            }
            // Delay entre requests para no saturar el servidor
            await new Promise(r => setTimeout(r, 600));
        }

        return documents;
    }

    // ─── Headers que simulan un navegador Chrome real ─────────────────────────

    _browserHeaders(referer) {
        const headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'es-CL,es;q=0.9,en;q=0.8',
            'Accept-Encoding': 'gzip, deflate, br',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-User': '?1',
            'Cache-Control': 'max-age=0',
        };
        if (referer) {
            headers['Referer'] = referer;
            headers['Sec-Fetch-Site'] = 'same-origin';
        } else {
            headers['Sec-Fetch-Site'] = 'none';
        }
        return headers;
    }

    // ─── Parser del listado paginado ──────────────────────────────────────────

    _parseListado(html) {
        const $ = cheerio.load(html);
        const urls = [];

        $('article').each((_, article) => {
            // Cada article tiene 2 links:
            // [0] URL corta: /numero-de-sentencia/NNN/
            // [1] URL completa con metadata y PDF: /tdlc-sentencias/...
            const link = $(article).find('a[href*="tdlc-sentencias"]').first().attr('href');
            if (link) urls.push(link);
        });

        return urls;
    }

    // ─── Fetch página intermedia de la sentencia ──────────────────────────────

    async _fetchSentencia(url) {
        const { data: html } = await axios.get(url, {
            headers: this._browserHeaders(LIST_URL),
            timeout: 30000,
        });

        return this._parseSentencia(html, url);
    }

    // ─── Parser de la página de cada sentencia ────────────────────────────────

    _parseSentencia(html, sourceUrl) {
        const $ = cheerio.load(html);

        const titulo = $('h2.elementor-heading-title').first().text().trim();
        if (!titulo) return null;

        const numMatch = titulo.match(/N[°º]?\s*(\d+)[\/\-](\d{4})/i);
        const numeroSentencia = numMatch ? numMatch[1] : null;
        const ano = numMatch ? numMatch[2] : null;

        // Campos dinámicos en orden de aparición
        const dynamicFields = [];
        $('.jet-listing-dynamic-field__content').each((_, el) => {
            dynamicFields.push($(el).html() || '');
        });

        // Taxonomy terms en orden de aparición
        const termFields = [];
        $('.jet-listing-dynamic-terms__link').each((_, el) => {
            termFields.push($(el).text().trim());
        });

        const fechaDictacion = this._textFromHtml(dynamicFields[0] || '');
        const caratula = this._textFromHtml(dynamicFields[1] || '');
        const partesHtml = dynamicFields[2] || '';
        const ministros = this._textFromHtml(dynamicFields[3] || '');
        const ministroRedactor = this._textFromHtml(dynamicFields[4] || '');
        const votoContra = this._textFromHtml(dynamicFields[6] || '');
        const votoPrevención = this._textFromHtml(dynamicFields[7] || '');

        const rolCausa = termFields[0] || '';
        const procedimiento = termFields[1] || '';

        const partes = this._parsePartes(partesHtml);
        const pdfUrl = this._extractPdfUrl($.html());

        if (!pdfUrl) {
            console.warn(`[TDLC] Sin PDF en ${sourceUrl}`);
            return null;
        }

        const id = numeroSentencia
            ? `tdlc-sentencia-${numeroSentencia}-${ano}`
            : `tdlc-${Date.now()}`;

        const rawJson = {
            url: sourceUrl,
            titulo,
            numero_sentencia: numeroSentencia,
            ano,
            fecha_dictacion: fechaDictacion,
            caratula,
            rol_causa: rolCausa,
            procedimiento,
            partes,
            ministros,
            ministro_redactor: ministroRedactor,
            voto_contra: votoContra,
            voto_prevencion: votoPrevención,
            pdf_url: pdfUrl,
        };

        return {
            id,
            title: titulo,
            pdfUrl,
            text: null,
            filename: `${id}.json`,
            rawJson,
            organism: 'Tribunal de Defensa de la Libre Competencia',
            metadata: {
                numero_sentencia: numeroSentencia,
                ano,
                fecha_dictacion: fechaDictacion,
                caratula,
                rol_causa: rolCausa,
                procedimiento,
                partes,
                ministros,
                ministro_redactor: ministroRedactor,
                voto_contra: votoContra,
                voto_prevencion: votoPrevención,
                source_url: sourceUrl,
                pdf_url: pdfUrl,
                tipo_documento: 'sentencia',
                fuente: 'tdlc',
            },
        };
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    _textFromHtml(html) {
        return cheerio.load(html)('*').text().trim().replace(/\s+/g, ' ');
    }

    _extractPdfUrl(html) {
        const $ = cheerio.load(html);
        // Buscar cualquier <a> cuyo href contenga wp-content (PDFs del TDLC)
        // o que contenga .pdf en cualquier parte de la URL
        let url = null;
        $('a').each((_, el) => {
            const href = $(el).attr('href') || '';
            if (href.includes('wp-content') || href.toLowerCase().includes('.pdf')) {
                url = href;
                return false; // break
            }
        });
        return url;
    }

    _parsePartes(html) {
        const texto = cheerio.load(html)('*').text();
        const demandante = texto.match(/Demandante[:\s]+([^\n]+)/i)?.[1]?.trim() || '';
        const demandado = texto.match(/Demandado[:\s]+([^\n]+)/i)?.[1]?.trim() || '';
        return { demandante, demandado, raw: texto.trim() };
    }

    // ─── Qdrant payload ───────────────────────────────────────────────────────

    getQdrantPayload(doc, chunk, totalChunks) {
        return {
            texto: chunk.text,
            tipo_documento: 'sentencia',
            doc_id: doc.id,
            numero_sentencia: doc.metadata.numero_sentencia,
            titulo: doc.title,
            organismo: doc.organism,
            fecha_dictacion: doc.metadata.fecha_dictacion,
            ano: doc.metadata.ano,
            caratula: doc.metadata.caratula,
            rol_causa: doc.metadata.rol_causa,
            procedimiento: doc.metadata.procedimiento,
            ministros: doc.metadata.ministros,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
        };
    }

    // ─── Tema inference ───────────────────────────────────────────────────────

    inferTema(doc) {
        const t = `${doc.title} ${doc.metadata.caratula}`.toLowerCase();

        if (t.includes('fusi') || t.includes('concentraci')) return 'concentracion';
        if (t.includes('colusi') || t.includes('cartel')) return 'colusion';
        if (t.includes('abuso') || t.includes('dominante')) return 'abuso_posicion_dominante';
        if (t.includes('licitaci') || t.includes('concurso')) return 'licitacion';
        if (t.includes('energ') || t.includes('electricidad')) return 'energia';
        if (t.includes('telecomunicaci') || t.includes('telecom')) return 'telecomunicaciones';
        if (t.includes('salud') || t.includes('farmac')) return 'salud';
        if (t.includes('transporte') || t.includes('aerolinea')) return 'transporte';
        if (t.includes('retail') || t.includes('supermercado')) return 'retail';
        if (t.includes('banco') || t.includes('financiero')) return 'financiero';

        return 'libre_competencia';
    }

    static getTotalPages() { return 18; }
    static getParamsHelp() { return '--page=N (1-18)'; }
}

module.exports = TdlcSource;