#!/usr/bin/env node
/**
 * Ingest masivo de resoluciones del SII
 *
 * Uso:
 *   node src/crawlers/sii-ingest.js --year=2024
 *   node src/crawlers/sii-ingest.js --from=2009 --to=2026
 *   node src/crawlers/sii-ingest.js --year=2024 --dry-run
 *   node src/crawlers/sii-ingest.js --fix-qdrant
 */

const path = require('path');
const fs = require('fs');

const { runPipeline } = require('../pipeline');
const SiiSource = require('../sources/sii');

// ─── CLI args ─────────────────────────────────────────────────────────────────
const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => {
            const [k, v] = a.slice(2).split('=');
            return [k, v ?? true];
        })
);

const CURRENT_YEAR = new Date().getFullYear();

// --year=NNNN es shorthand para --from=NNNN --to=NNNN
const FROM_YEAR = parseInt(args.year ?? args.from ?? 2009, 10);
const TO_YEAR = parseInt(args.year ?? args.to ?? CURRENT_YEAR, 10);
const DRY_RUN = args['dry-run'] === true;
const FIX_QDRANT = args['fix-qdrant'] === true;

// ─── Log de progreso ──────────────────────────────────────────────────────────
const LOG_PATH = path.join(__dirname, '../../data/sii-ingest-log.json');

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
    const source = new SiiSource();
    const log = loadLog();
    const years = Array.from(
        { length: TO_YEAR - FROM_YEAR + 1 },
        (_, i) => FROM_YEAR + i
    );

    console.log(`\n════════════════════════════════════════`);
    console.log(` SII ingest`);
    console.log(` Años     : ${FROM_YEAR} → ${TO_YEAR} (${years.length} años)`);
    console.log(` Colección: ${source.collection}`);
    console.log(` Dry-run  : ${DRY_RUN}`);
    console.log(` Fix-qdrant: ${FIX_QDRANT}`);
    console.log(`════════════════════════════════════════\n`);

    let yearsProcessed = 0;
    let yearsSkipped = 0;
    let yearsErrored = 0;
    let totalDocs = 0;
    let totalChunks = 0;
    let totalVectors = 0;

    for (const year of years) {
        const key = `year_${year}`;
        const entry = log.processed[key];

        // Saltar si ya está completo
        if (entry?.pg_done && entry?.qdrant_done && !FIX_QDRANT) {
            console.log(`⏭️  Año ${year} ya procesado — saltando`);
            yearsSkipped++;
            continue;
        }

        console.log(`\n[${yearsProcessed + yearsSkipped + yearsErrored + 1}/${years.length}] Año ${year}`);

        if (DRY_RUN) {
            console.log(`  [dry-run] saltando`);
            continue;
        }

        try {
            // 1. Scrape del año completo (listado + fetch de cada documento)
            const docs = await source.scrape({ year });

            if (docs.length === 0) {
                console.log(`  Sin documentos para ${year}`);
                log.processed[key] = {
                    pg_done: true, qdrant_done: true,
                    docs: 0, chunks: 0, vectors: 0,
                    processed_at: new Date().toISOString(),
                };
                saveLog(log);
                continue;
            }

            console.log(`  ${docs.length} resoluciones encontradas`);

            // 2. Pipeline completo
            const params = { section: 'sii', year: String(year), edition: null };
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
            yearsProcessed++;

            console.log(`  ✅ Año ${year}: ${result.processed} procesados, ${result.skipped} saltados, ${result.totalChunks} chunks`);

        } catch (err) {
            console.error(`❌ Error en año ${year}: ${err.message}`);
            log.processed[key] = {
                pg_done: false, qdrant_done: false,
                error: err.message,
            };
            saveLog(log);
            yearsErrored++;

            console.log(`  ⏳ Esperando 60s antes de continuar...`);
            await sleep(60000);
        }

        // Pausa entre años
        await sleep(1000);
    }

    console.log(`\n════════════════════════════════════════`);
    console.log(` Ingest completado`);
    console.log(`  Años procesados : ${yearsProcessed}`);
    console.log(`  Años saltados   : ${yearsSkipped}`);
    console.log(`  Años con error  : ${yearsErrored}`);
    console.log(`  Docs totales    : ${totalDocs}`);
    console.log(`  Chunks totales  : ${totalChunks}`);
    console.log(`  Vectores totales: ${totalVectors}`);
    console.log(`════════════════════════════════════════\n`);
}

main().catch(err => {
    console.error('Error fatal:', err);
    process.exit(1);
});