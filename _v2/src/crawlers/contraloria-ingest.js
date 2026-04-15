#!/usr/bin/env node
/**
 * Ingest masivo de dictámenes de Contraloría General de la República
 *
 * Uso:
 *   node src/crawlers/contraloria-ingest.js
 *   node src/crawlers/contraloria-ingest.js --from=100
 *   node src/crawlers/contraloria-ingest.js --from=0 --to=50
 *   node src/crawlers/contraloria-ingest.js --dry-run
 *   node src/crawlers/contraloria-ingest.js --fix-qdrant
 */

const path = require('path');
const fs   = require('fs');

const { runPipeline, reinsertToQdrant } = require('../pipeline');
const ContraloriaSource = require('../sources/contraloria');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => {
            const [k, v] = a.slice(2).split('=');
            return [k, v ?? true];
        })
);

const FROM_PAGE  = parseInt(args.from ?? 0,   10);
const TO_PAGE    = parseInt(args.to   ?? 499,  10);
const DRY_RUN    = args['dry-run']    === true;
const FIX_QDRANT = args['fix-qdrant'] === true;

// ─── Log de progreso ──────────────────────────────────────────────────────────
const LOG_PATH = path.join(__dirname, '../../data/contraloria-ingest-log.json');

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
    const source = new ContraloriaSource();
    const log    = loadLog();
    const total  = TO_PAGE - FROM_PAGE + 1;

    console.log(`\n════════════════════════════════════════`);
    console.log(` Contraloría ingest`);
    console.log(` Páginas  : ${FROM_PAGE} → ${TO_PAGE} (${total} páginas)`);
    console.log(` Colección: ${source.collection}`);
    console.log(` Dry-run  : ${DRY_RUN}`);
    console.log(` Fix-qdrant: ${FIX_QDRANT}`);
    console.log(`════════════════════════════════════════\n`);

    let pagesProcessed = 0;
    let pagesSkipped   = 0;
    let pagesErrored   = 0;
    let totalDocs      = 0;
    let totalChunks    = 0;
    let totalVectors   = 0;

    for (let page = FROM_PAGE; page <= TO_PAGE; page++) {
        const key   = `page_${page}`;
        const entry = log.processed[key];

        // Saltar si ya está completo
        if (entry?.pg_done && entry?.qdrant_done && !FIX_QDRANT) {
            pagesSkipped++;
            continue;
        }

        console.log(`\n[${page - FROM_PAGE + 1}/${total}] Página ${page}`);

        if (DRY_RUN) {
            console.log(`  [dry-run] saltando`);
            continue;
        }

        try {
            // 1. Scrape de la página → array de documentos
            const docs = await source.scrape({ page });

            if (docs.length === 0) {
                console.log(`  Sin documentos — saltando`);
                log.processed[key] = {
                    pg_done: true, qdrant_done: true,
                    docs: 0, chunks: 0, vectors: 0,
                    processed_at: new Date().toISOString(),
                };
                saveLog(log);
                continue;
            }

            console.log(`  ${docs.length} dictámenes en esta página`);

            // 2. Pasar el array completo a runPipeline
            //    params.edition = null (los docs de Contraloría no tienen edición)
            //    params.section = 'contraloria'
            //    skipExisting = true (saltar docs ya en PG), false si fix-qdrant
            const params = { section: 'contraloria', edition: null };
            const opts   = { skipExisting: !FIX_QDRANT };

            const result = await runPipeline(source, docs, params, opts);

            log.processed[key] = {
                pg_done:      true,
                qdrant_done:  true,
                docs:         docs.length,
                chunks:       result.totalChunks,
                vectors:      result.totalVectors,
                processed_at: new Date().toISOString(),
            };
            saveLog(log);

            totalDocs    += docs.length;
            totalChunks  += result.totalChunks;
            totalVectors += result.totalVectors;
            pagesProcessed++;

            console.log(`  ✅ Página ${page}: ${result.processed} procesados, ${result.skipped} saltados, ${result.totalChunks} chunks`);

        } catch (err) {
            console.error(`❌ Error en página ${page}: ${err.message}`);
            log.processed[key] = {
                pg_done: false, qdrant_done: false,
                error: err.message,
            };
            saveLog(log);
            pagesErrored++;

            console.log(`  ⏳ Esperando 60s antes de continuar...`);
            await sleep(60000);
        }

        // Delay entre páginas para no saturar la API de Contraloría
        await sleep(500);
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(` Ingest completado`);
    console.log(`  Páginas procesadas : ${pagesProcessed}`);
    console.log(`  Páginas saltadas   : ${pagesSkipped}`);
    console.log(`  Páginas con error  : ${pagesErrored}`);
    console.log(`  Docs totales       : ${totalDocs}`);
    console.log(`  Chunks totales     : ${totalChunks}`);
    console.log(`  Vectores totales   : ${totalVectors}`);
    console.log(`════════════════════════════════════════\n`);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});