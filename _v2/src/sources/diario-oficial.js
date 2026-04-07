const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

class DiarioOficialSource extends BaseSource {
    constructor() {
        super('diario_oficial', 'do_normas_generales');
    }

    /**
     * Scrape Normas Generales del Diario Oficial.
     * @param {object} params
     * @param {string} params.date - Fecha DD-MM-YYYY
     * @param {string} params.edition - Número de edición
     */
    async scrape(params) {
        const { date, edition } = params;
        if (!date || !edition) {
            throw new Error('diario_oficial requiere --date=DD-MM-YYYY --edition=NNNNN');
        }

        const url = `${config.scraper.baseUrl}/edicionelectronica/index.php?date=${date}&edition=${edition}`;
        console.log(`[DiarioOficial] Fetching: ${url}`);

        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'es-CL,es;q=0.9',
            },
            timeout: 30000,
        });

        const $ = cheerio.load(html);
        const documents = [];
        let currentOrganism = '';

        const [day, month, year] = date.split('-');
        const isoDate = `${year}-${month}-${day}`;

        $('section table').each((_, table) => {
            $(table).find('tr').each((_, row) => {
                const cells = $(row).find('td');

                if (cells.length === 1) {
                    const text = $(cells[0]).text().trim();
                    if (text && text.length > 0) currentOrganism = text;
                    return;
                }

                const link = $(row).find('a[href*=".pdf"]');
                if (link.length > 0) {
                    const href = link.attr('href');
                    const linkText = link.text().trim();
                    const cveMatch = href.match(/(\d+)\.pdf$/) || linkText.match(/CVE[- ]?(\d+)/i);
                    const cve = cveMatch ? cveMatch[1] : null;
                    const titleCell = cells.length >= 2 ? $(cells[0]).text().trim() : linkText;

                    if (cve && href) {
                        const pdfUrl = href.startsWith('http') ? href : `${config.scraper.baseUrl}${href}`;
                        documents.push({
                            id: cve,
                            title: titleCell,
                            pdfUrl,
                            text: null,
                            organism: currentOrganism,
                            metadata: {
                                cve,
                                fecha: isoDate,
                                edicion: edition,
                                seccion: 'normas_generales',
                                tipo_documento: 'norma_general',
                                linkText,
                            },
                        });
                    }
                }
            });
        });

        console.log(`[DiarioOficial] Found ${documents.length} documents`);
        return documents;
    }

    getQdrantPayload(doc, chunk, totalChunks, params) {
        return {
            texto: chunk.text,
            tipo_documento: 'norma_general',
            cve: doc.id,
            titulo: doc.title,
            organismo: doc.organism,
            fecha: doc.metadata.fecha,
            edicion: doc.metadata.edicion,
            seccion: 'normas_generales',
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            tema: this.inferTema(doc),
        };
    }

    inferTema(doc) {
        const t = (doc.title + ' ' + doc.organism).toLowerCase();
        if (t.includes('tipo de cambio') || t.includes('moneda') || t.includes('paridad')) return 'tipos_cambio';
        if (t.includes('banco central')) return 'banco_central';
        if (t.includes('decreto') && t.includes('alcaldicio')) return 'decreto_alcaldicio';
        if (t.includes('plan comunal') || t.includes('infraestructura')) return 'planificacion_comunal';
        if (t.includes('municipalidad')) return 'municipal';
        if (t.includes('resolución') || t.includes('resolucion')) return 'resolucion';
        if (t.includes('ley')) return 'ley';
        if (t.includes('reglamento')) return 'reglamento';
        if (t.includes('decreto supremo')) return 'decreto_supremo';
        if (t.includes('ministerio')) return 'ministerial';
        if (t.includes('contraloría') || t.includes('contraloria')) return 'contraloria';
        if (t.includes('tributari') || t.includes('impuesto') || t.includes('sii')) return 'tributario';
        if (t.includes('laboral') || t.includes('trabajo')) return 'laboral';
        if (t.includes('salud') || t.includes('sanitari')) return 'salud';
        if (t.includes('educación') || t.includes('educacion')) return 'educacion';
        if (t.includes('medio ambiente') || t.includes('ambiental')) return 'medioambiente';
        return 'general';
    }

    static getParamsHelp() {
        return '--date=DD-MM-YYYY --edition=NNNNN';
    }
}

module.exports = DiarioOficialSource;