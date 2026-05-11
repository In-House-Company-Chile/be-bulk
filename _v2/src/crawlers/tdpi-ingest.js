#!/usr/bin/env node
/**
 * Ingest masivo de fallos del Tribunal de Propiedad Industrial (TDPI)
 * * Uso:
 * node src/crawlers/tdpi-ingest.js
 * node src/crawlers/tdpi-ingest.js --page=1
 * node src/crawlers/tdpi-ingest.js --from=1 --to=5
 * node src/crawlers/tdpi-ingest.js --dry-run
 * node src/crawlers/tdpi-ingest.js --fix-qdrant
 * node src/crawlers/tdpi-ingest.js --only-psql
 */

const path = require('path');
const fs = require('fs');
const { runPipeline } = require('../pipeline');
const TdpiSource = require('../sources/tdpi');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => {
            const [k, v] = a.slice(2).split('=');
            return [k, v ?? true];
        })
);

const PAGE = args.page ? parseInt(args.page, 10) : null;
const FROM_PAGE = parseInt(args.from ?? (PAGE ?? 1), 10);
const TO_PAGE = parseInt(args.to ?? (PAGE ?? 1), 10);
const DRY_RUN = args['dry-run'] === true;
const FIX_QDRANT = args['fix-qdrant'] === true;
const ONLY_PSQL = args['only-psql'] === true;

// ─── Log de progreso ──────────────────────────────────────────────────────────
const LOG_PATH = path.join(__dirname, '../../data/tdpi-ingest-log.json');

function loadLog() {
    if (!fs.existsSync(LOG_PATH)) return { processed: {} };
    try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
    catch { return { processed: {} }; }
}

function saveLog(log) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
    const source = new TdpiSource();
    const log = loadLog();
    const total = TO_PAGE - FROM_PAGE + 1;

    console.log(`\n════════════════════════════════════════`);
    console.log(` TDPI Ingest - Fallos Patentes`);
    console.log(` Páginas   : ${FROM_PAGE} → ${TO_PAGE}`);
    console.log(` Solo PSQL : ${ONLY_PSQL}`);
    console.log(` Fix Qdrant: ${FIX_QDRANT}`);
    console.log(` Dry-run   : ${DRY_RUN}`);
    console.log(`════════════════════════════════════════\n`);

    let pagesProcessed = 0;
    let totalDocs = 0;

    for (let page = FROM_PAGE; page <= TO_PAGE; page++) {
        const key = `page_${page}`;
        const entry = log.processed[key];

        // Saltar si ya está completo (y no estamos forzando fix-qdrant)
        if (entry?.pg_done && entry?.qdrant_done && !FIX_QDRANT) {
            console.log(`[${page}] Ya procesada. Saltando...`);
            continue;
        }

        if (DRY_RUN) {
            console.log(`[${page}] Mode dry-run activo.`);
        }

        try {
            console.log(`🔍 [${page}/${TO_PAGE}] Scrapeando listado...`);

            // Aunque TDPI es hoy una sola página, pasamos el parámetro por si el source lo implementa
            const docs = await source.scrape({ page });

            if (docs.length === 0) {
                console.log(`  ⚠️ Sin documentos encontrados.`);
                continue;
            }

            console.log(`  ✨ ${docs.length} documentos encontrados.`);

            if (DRY_RUN) {
                console.log(`  [dry-run] Primer doc:`, docs[0].id);
                continue;
            }

            // Configuración de la ejecución del pipeline
            const params = { section: 'patentes', edition: 'relevantes' };
            const opts = {
                skipExisting: !FIX_QDRANT,
                skipQdrant: ONLY_PSQL // Flag para omitir Qdrant si se solicita
            };

            const result = await runPipeline(source, docs, params, opts);

            // Actualizar log
            log.processed[key] = {
                pg_done: true,
                qdrant_done: !ONLY_PSQL,
                docs_count: docs.length,
                processed_at: new Date().toISOString()
            };
            saveLog(log);

            totalDocs += docs.length;
            pagesProcessed++;

            console.log(`  ✅ OK: ${result.processed} procesados, ${result.skipped} saltados.`);

        } catch (err) {
            console.error(`❌ Error en página ${page}: ${err.message}`);

            console.log(`  ⏳ Esperando 30s antes de reintentar o continuar...`);
            await sleep(30000);
        }

        // Pequeño delay de cortesía
        await sleep(1000);
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(` Ingest finalizado`);
    console.log(` Páginas procesadas: ${pagesProcessed}`);
    console.log(` Docs encontrados  : ${totalDocs}`);
    console.log(`════════════════════════════════════════\n`);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});