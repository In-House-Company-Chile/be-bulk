const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

// ─── Registry de secciones ────────────────────────────────────────────────────
const SECTIONS = {
    'normas-generales': {
        file: 'index.php',
        collection: 'do_normas_generales',
        seccion: 'normas_generales',
    },
    'normas-particulares': {
        file: 'normas_particulares.php',
        collection: 'do_normas_particulares',
        seccion: 'normas_particulares',
    },
    'publicaciones-judiciales': {
        file: 'publicaciones_judiciales.php',
        collection: 'do_publicaciones_judiciales',
        seccion: 'publicaciones_judiciales',
    },
    'avisos-destacados': {
        file: 'avisos_destacados.php',
        collection: 'do_avisos_destacados',
        seccion: 'avisos_destacados',
    },
    'empresas-cooperativas': {
        file: 'empresas_cooperativas.php',
        collection: 'do_empresas_y_cooperativas',
        seccion: 'empresas_y_cooperativas',
    },
    'marcas-patentes': {
        file: 'marcas_patentes.php',
        collection: 'do_marcas_y_patentes',
        seccion: 'marcas_y_patentes',
    },
    'bom': {
        file: 'bom.php',
        collection: 'do_boletin_oficial_de_mineria',
        seccion: 'boletin_oficial_mineria',
        extraParams: { subseccion: true },
    },
};

// ─── Clase ────────────────────────────────────────────────────────────────────
class DiarioOficialSource extends BaseSource {

    constructor(section = 'normas-generales') {
        const sectionConfig = SECTIONS[section];
        if (!sectionConfig) {
            throw new Error(
                `Sección desconocida: "${section}". Opciones: ${Object.keys(SECTIONS).join(', ')}`
            );
        }
        super('diario_oficial', sectionConfig.collection);
        this.section = section;
        this.sectionConfig = sectionConfig;
    }

    // ─── Scraping ─────────────────────────────────────────────────────────────

    /**
     * @param {object} params
     * @param {string} params.date      - DD-MM-YYYY
     * @param {string} params.edition   - Número de edición
     * @param {string} [params.subseccion] - Solo requerido para bom
     */
    async scrape(params) {
        const { date, edition, subseccion } = params;

        if (!date || !edition) {
            throw new Error(`diario_oficial requiere --date=DD-MM-YYYY --edition=NNNNN`);
        }

        if (this.sectionConfig.extraParams?.subseccion && !subseccion) {
            throw new Error(`La sección "bom" requiere --subseccion=NNNN`);
        }

        const url = this._buildUrl(date, edition, subseccion);
        console.log(`[DiarioOficial:${this.section}] Fetching: ${url}`);

        const { data: html } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'es-CL,es;q=0.9',
            },
            timeout: 30000,
        });

        const documents = this._parseHtml(html, date, edition);
        console.log(`[DiarioOficial:${this.section}] Found ${documents.length} documents`);
        return documents;
    }

    // ─── URL builder ──────────────────────────────────────────────────────────

    _buildUrl(date, edition, subseccion) {
        const base = `${config.scraper.baseUrl}/edicionelectronica/${this.sectionConfig.file}`;
        const params = new URLSearchParams({ date, edition, v: '1' });

        if (this.sectionConfig.extraParams?.subseccion && subseccion) {
            params.set('subseccion', subseccion);
            params.delete('v'); // bom no usa &v=1
        }

        return `${base}?${params.toString()}`;
    }

    // ─── HTML parser (estructura común a todas las secciones) ─────────────────

    _parseHtml(html, date, edition) {
        const $ = cheerio.load(html);
        const documents = [];
        let currentOrganism = '';

        const [day, month, year] = date.split('-');
        const isoDate = `${year}-${month}-${day}`;

        $('section table').each((_, table) => {
            $(table).find('tr').each((_, row) => {
                const cells = $(row).find('td');

                // Fila de organismo emisor (celda única)
                if (cells.length === 1) {
                    const text = $(cells[0]).text().trim();
                    if (text) currentOrganism = text;
                    return;
                }

                // Fila de documento (contiene link a PDF)
                const link = $(row).find('a[href*=".pdf"]');
                if (link.length === 0) return;

                const href = link.attr('href');
                const linkText = link.text().trim();
                const cveMatch = href.match(/(\d+)\.pdf$/) || linkText.match(/CVE[- ]?(\d+)/i);
                const cve = cveMatch ? cveMatch[1] : null;
                const title = cells.length >= 2 ? $(cells[0]).text().trim() : linkText;

                if (!cve || !href) return;

                const pdfUrl = href.startsWith('http')
                    ? href
                    : `${config.scraper.baseUrl}${href}`;

                documents.push({
                    id: cve,
                    title,
                    pdfUrl,
                    text: null,
                    organism: currentOrganism,
                    metadata: {
                        cve,
                        fecha: isoDate,
                        edicion: edition,
                        seccion: this.sectionConfig.seccion,
                        tipo_documento: this.sectionConfig.seccion,
                        linkText,
                    },
                });
            });
        });

        return documents;
    }

    // ─── Qdrant payload ───────────────────────────────────────────────────────

    getQdrantPayload(doc, chunk, totalChunks) {
        return {
            texto: chunk.text,
            tipo_documento: this.sectionConfig.seccion,
            cve: doc.id,
            titulo: doc.title,
            organismo: doc.organism,
            fecha: doc.metadata.fecha,
            edicion: doc.metadata.edicion,
            seccion: this.sectionConfig.seccion,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            tema: this.inferTema(doc),
        };
    }

    // ─── Tema inference ───────────────────────────────────────────────────────

    inferTema(doc) {
        const t = `${doc.title} ${doc.organism}`.toLowerCase();

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
        if (t.includes('minería') || t.includes('mineria') || t.includes('miner')) return 'mineria';
        if (t.includes('marca') || t.includes('patente')) return 'propiedad_industrial';
        if (t.includes('judicial') || t.includes('tribunal') || t.includes('juzgado')) return 'judicial';
        if (t.includes('sociedad') || t.includes('cooperativa') || t.includes('empresa')) return 'sociedades';
        if (t.includes('aviso')) return 'avisos';

        return 'general';
    }

    // ─── CLI help ─────────────────────────────────────────────────────────────

    static getSections() {
        return Object.keys(SECTIONS);
    }

    static getParamsHelp() {
        return '--date=DD-MM-YYYY --edition=NNNNN [--section=SECCION] [--subseccion=NNNN]';
    }
}

module.exports = DiarioOficialSource;
module.exports.SECTIONS = SECTIONS;