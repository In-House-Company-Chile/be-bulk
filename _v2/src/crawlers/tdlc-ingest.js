#!/usr/bin/env node
/**
 * Ingest masivo de sentencias del TDLC
 *
 * Uso:
 *   node src/crawlers/tdlc-ingest.js --page=1
 *   node src/crawlers/tdlc-ingest.js --from=1 --to=18
 *   node src/crawlers/tdlc-ingest.js --dry-run
 *   node src/crawlers/tdlc-ingest.js --fix-qdrant
 */

const path = require('path');
const fs = require('fs');

const { runPipeline } = require('../pipeline');
const TdlcSource = require('../sources/tdlc');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => {
            const [k, v] = a.slice(2).split('=');
            return [k, v ?? true];
        })
);

const TOTAL_PAGES = TdlcSource.getTotalPages();
const FROM_PAGE = parseInt(args.page ?? args.from ?? 1, 10);
const TO_PAGE = parseInt(args.page ?? args.to ?? TOTAL_PAGES, 10);
const DRY_RUN = args['dry-run'] === true;
const FIX_QDRANT = args['fix-qdrant'] === true;

// ─── Log de progreso ──────────────────────────────────────────────────────────
const LOG_PATH = path.join(__dirname, '../../data/tdlc-ingest-log.json');

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
    const source = new TdlcSource();
    const log = loadLog();
    const pages = Array.from(
        { length: TO_PAGE - FROM_PAGE + 1 },
        (_, i) => FROM_PAGE + i
    );

    console.log(`\n════════════════════════════════════════`);
    console.log(` TDLC ingest`);
    console.log(` Páginas  : ${FROM_PAGE} → ${TO_PAGE} (${pages.length} páginas)`);
    console.log(` Colección: ${source.collection}`);
    console.log(` Dry-run  : ${DRY_RUN}`);
    console.log(` Fix-qdrant: ${FIX_QDRANT}`);
    console.log(`════════════════════════════════════════\n`);

    let pagesProcessed = 0;
    let pagesSkipped = 0;
    let pagesErrored = 0;
    let totalDocs = 0;
    let totalChunks = 0;
    let totalVectors = 0;

    for (const page of pages) {
        const key = `page_${page}`;
        const entry = log.processed[key];

        if (entry?.pg_done && entry?.qdrant_done && !FIX_QDRANT) {
            console.log(`⏭️  Página ${page} ya procesada — saltando`);
            pagesSkipped++;
            continue;
        }

        console.log(`\n[${pagesProcessed + pagesSkipped + pagesErrored + 1}/${pages.length}] Página ${page}`);

        if (DRY_RUN) {
            console.log(`  [dry-run] saltando`);
            continue;
        }

        try {
            // 1. Scrape: listado → páginas intermedias → PDFs
            const docs = await source.scrape({ page });

            if (docs.length === 0) {
                console.log(`  Sin documentos en página ${page}`);
                log.processed[key] = {
                    pg_done: true, qdrant_done: true,
                    docs: 0, chunks: 0, vectors: 0,
                    processed_at: new Date().toISOString(),
                };
                saveLog(log);
                continue;
            }

            console.log(`  ${docs.length} sentencias encontradas`);

            // 2. Pipeline: PDF → chunking → embeddings → PG + Qdrant
            const params = { section: 'tdlc', edition: null };
            const opts = { skipExisting: !FIX_QDRANT };

            const result = await runPipeline(source, docs, params, opts);

            log.processed[key] = {
                pg_done: true,
                qdrant_done: true,
                docs: docs.length,
                chunks: result.totalChunks,
                vectors: result.totalVectors,
                processed_at: new Date().toISOString(),
            };
            saveLog(log);

            totalDocs += docs.length;
            totalChunks += result.totalChunks;
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

        // Pausa entre páginas
        await sleep(1000);
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