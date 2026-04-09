/**
 * Crawler de ediciones del Diario Oficial.
 *
 * Itera cada día desde START_DATE hasta hoy, detecta si hay publicación,
 * si es edición simple o múltiple, y guarda el mapa en editions-map.json.
 *
 * Uso:
 *   node src/crawlers/editions-map.js
 *   node src/crawlers/editions-map.js --from=01-01-2020   (reanudar desde fecha)
 *   node src/crawlers/editions-map.js --dry-run           (solo muestra, no guarda)
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');

// ─── Configuración ────────────────────────────────────────────────────────────

const BASE_URL = 'https://www.diariooficial.interior.gob.cl/edicionelectronica';
const START_DATE = new Date('2016-08-16');
const OUTPUT_FILE = path.resolve(__dirname, '../../data/editions-map.json');
const DELAY_MS = 800;    // ms entre requests (respetar el servidor)
const TIMEOUT_MS = 20000;  // timeout por intento
const MAX_RETRIES = 4;      // intentos totales (1 original + 3 reintentos)
const RETRY_BACKOFF = [5000, 10000, 20000]; // espera entre reintentos

// ─── Helpers de fecha ─────────────────────────────────────────────────────────

function toQueryDate(date) {
    const dd = String(date.getDate()).padStart(2, '0');
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const yyyy = date.getFullYear();
    return `${dd}-${mm}-${yyyy}`;
}

function toISODate(date) {
    return date.toISOString().split('T')[0];
}

function addDays(date, n) {
    const d = new Date(date);
    d.setDate(d.getDate() + n);
    return d;
}

function parseQueryDate(str) {
    // DD-MM-YYYY → Date
    const [dd, mm, yyyy] = str.split('-');
    return new Date(`${yyyy}-${mm}-${dd}`);
}

// ─── Delay ────────────────────────────────────────────────────────────────────

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Parsers ──────────────────────────────────────────────────────────────────

/**
 * Extrae el número de edición desde la página index.php (edición simple).
 * Selector exacto: header > div > ul > li.alignleft
 * Contenido: "Edición Núm. 44.418."
 */
function parseEditionFromIndex($) {
    // Selector exacto del li
    const liText = $('header div ul li.alignleft').first().text().trim();
    const match = liText.match(/N[uú]m\.?\s*([\d\.]+)/i);
    if (match) {
        return match[1].replace(/\./g, '').replace(/,$/, ''); // "44.418" → "44418"
    }

    // Fallback: edition= en la URL actual (cuando el servidor ya redirigió con edition en la URL)
    const canonical = $('link[rel="canonical"]').attr('href') || '';
    const urlMatch = canonical.match(/edition=([\d]+-?[A-Z]?)/);
    if (urlMatch) return urlMatch[1];

    return null;
}

/**
 * Extrae las ediciones desde select_edition.php (edición múltiple).
 * Parsea hasta 5 ediciones desde los links de la lista.
 *
 * HTML: <a href="index.php?date=01-04-2026&edition=44415&v=1">
 *       <a href="index.php?date=01-04-2026&edition=44415-B&v=2">
 */
function parseEditionsFromSelect($) {
    const editions = [];

    // Selector exacto: links dentro de section > div > ul > li
    $('section div ul li a').each((_, el) => {
        const href = $(el).attr('href') || '';
        const match = href.match(/edition=([\d]+-?[A-Z]?)/);
        if (match) {
            const edition = match[1];
            if (!editions.includes(edition)) editions.push(edition);
        }
        if (editions.length >= 5) return false; // break
    });

    // Fallback: cualquier link con edition= en la página
    if (editions.length === 0) {
        $('a[href*="edition="]').each((_, el) => {
            const href = $(el).attr('href') || '';
            const match = href.match(/edition=([\d]+-?[A-Z]?)/);
            if (match) {
                const edition = match[1];
                if (!editions.includes(edition)) editions.push(edition);
            }
            if (editions.length >= 5) return false;
        });
    }

    return editions;
}

// ─── Fetch de una fecha ───────────────────────────────────────────────────────

async function fetchEditionsForDate(queryDate) {
    const url = `${BASE_URL}/index.php?date=${queryDate}`;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
            return await _doFetch(url, queryDate, attempt);
        } catch (err) {
            const isLast = attempt === MAX_RETRIES;
            if (isLast) {
                return { status: 'error', error: err.message };
            }
            const wait = RETRY_BACKOFF[attempt - 1] || 20000;
            console.warn(`   ⟳ ${queryDate} → intento ${attempt}/${MAX_RETRIES} falló (${err.message}). Reintentando en ${wait / 1000}s...`);
            await sleep(wait);
        }
    }
}

async function _doFetch(url, queryDate, attempt) {
    if (attempt > 1) console.log(`   🔄 ${queryDate} → intento ${attempt}/${MAX_RETRIES}`);

    try {
        const res = await axios.get(url, {
            timeout: TIMEOUT_MS,
            maxRedirects: 5,
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'es-CL,es;q=0.9',
            },
        });

        const finalUrl = res.request?.res?.responseUrl || res.config?.url || url;
        const $ = cheerio.load(res.data);

        // ── Caso 1: redirigió a select_edition.php ────────────────────────────
        if (finalUrl.includes('select_edition.php')) {
            const editions = parseEditionsFromSelect($);
            return { status: 'multiple', editions };
        }

        // ── Caso 2: página sin contenido de edición (día sin publicación) ─────
        const bodyText = $('body').text();
        if (!bodyText.includes('Edici') && !bodyText.includes('edici')) {
            return { status: 'no_publication' };
        }

        // ── Caso 3: edición simple ─────────────────────────────────────────────
        const edition = parseEditionFromIndex($);
        if (edition) {
            return { status: 'single', editions: [edition] };
        }

        // ── Caso 4: página cargó pero sin edición = día sin publicación ──────
        return { status: 'no_publication' };

    } catch (err) {
        if (err.response?.status === 404) return { status: 'no_publication' };
        throw err; // propagar para que el retry lo capture
    }
}

// ─── Carga / guarda el mapa ───────────────────────────────────────────────────

function loadMap() {
    if (fs.existsSync(OUTPUT_FILE)) {
        return JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
    }
    return { generated_at: null, total_days: 0, total_editions: 0, days: {} };
}

function saveMap(map) {
    const dir = path.dirname(OUTPUT_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    map.generated_at = new Date().toISOString();
    map.total_days = Object.keys(map.days).length;
    map.total_editions = Object.values(map.days)
        .reduce((acc, d) => acc + (d.editions?.length || 0), 0);

    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(map, null, 2));
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = Object.fromEntries(
        process.argv.slice(2)
            .filter(a => a.startsWith('--'))
            .map(a => { const [k, v] = a.slice(2).split('='); return [k, v || true]; })
    );

    const dryRun = args['dry-run'] === true;
    const fromDate = args.from ? parseQueryDate(args.from) : null;

    const map = loadMap();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Determinar desde dónde empezar
    let cursor = fromDate || START_DATE;

    // Si hay datos previos y no se especificó --from, reanudar desde el último día procesado
    if (!fromDate && Object.keys(map.days).length > 0) {
        const lastProcessed = Object.keys(map.days).sort().at(-1); // "2020-03-15"
        cursor = addDays(new Date(lastProcessed), 1);
        console.log(`🔄 Reanudando desde ${toQueryDate(cursor)} (último procesado: ${lastProcessed})`);
    }

    const totalDays = Math.ceil((today - cursor) / (1000 * 60 * 60 * 24)) + 1;
    console.log(`📅 Crawleando desde ${toQueryDate(cursor)} hasta ${toQueryDate(today)}`);
    console.log(`   Total días a procesar: ${totalDays}`);
    console.log(`   Dry run: ${dryRun}`);
    console.log('─'.repeat(60));

    let processed = 0, publications = 0, noPublications = 0, errors = 0;

    while (cursor <= today) {
        const queryDate = toQueryDate(cursor);
        const isoDate = toISODate(cursor);

        // Skip si ya está en el mapa (a menos que sea --from explícito)
        if (map.days[isoDate] && !fromDate) {
            cursor = addDays(cursor, 1);
            continue;
        }

        const result = await fetchEditionsForDate(queryDate);
        processed++;

        switch (result.status) {
            case 'single':
            case 'multiple':
                map.days[isoDate] = { editions: result.editions };
                publications++;
                console.log(`✅ ${queryDate} → [${result.editions.join(', ')}]${result.status === 'multiple' ? ' (múltiple)' : ''}`);
                break;

            case 'no_publication':
                map.days[isoDate] = { editions: [] };
                noPublications++;
                console.log(`⬜ ${queryDate} → sin publicación`);
                break;

            case 'error':
                errors++;
                console.error(`❌ ${queryDate} → ${result.error}`);
                // No guardar en el mapa para poder reintentarlo
                break;
        }

        // Guardar progreso cada 50 días procesados
        if (!dryRun && processed % 50 === 0) {
            saveMap(map);
            console.log(`💾 Progreso guardado (${processed}/${totalDays} días)`);
        }

        cursor = addDays(cursor, 1);
        await sleep(DELAY_MS);
    }

    // Guardar final
    if (!dryRun) {
        saveMap(map);
    }

    console.log('\n' + '='.repeat(60));
    console.log('✅ CRAWLER COMPLETADO');
    console.log(`   Días procesados:     ${processed}`);
    console.log(`   Con publicación:     ${publications}`);
    console.log(`   Sin publicación:     ${noPublications}`);
    console.log(`   Errores:             ${errors}`);
    console.log(`   Output: ${OUTPUT_FILE}`);
    console.log('='.repeat(60));
}

main().catch(err => {
    console.error('❌ Error fatal:', err);
    process.exit(1);
});