#!/usr/bin/env node
/**
 * Ingest masivo de pronunciamientos de la SIES
 * * Uso:
 * node src/crawlers/sies-ingest.js
 * node src/crawlers/sies-ingest.js --only-psql
 * node src/crawlers/sies-ingest.js --fix-qdrant
 */

const path = require('path');
const fs = require('fs');
const { runPipeline } = require('../pipeline');
const SiesSource = require('../sources/sies');

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => {
            const [k, v] = a.slice(2).split('=');
            return [k, v ?? true];
        })
);

const DRY_RUN = args['dry-run'] === true;
const FIX_QDRANT = args['fix-qdrant'] === true;
const ONLY_PSQL = args['only-psql'] === true;
const LOG_PATH = path.join(__dirname, '../../data/sies-ingest-log.json');

function loadLog() {
    if (!fs.existsSync(LOG_PATH)) return { last_run: null, processed_count: 0 };
    try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
    catch { return { last_run: null, processed_count: 0 }; }
}

function saveLog(log) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

async function main() {
    const source = new SiesSource();
    const log = loadLog();

    console.log(`\n════════════════════════════════════════`);
    console.log(` SIES Ingest - Pronunciamientos`);
    console.log(` Solo PSQL : ${ONLY_PSQL}`);
    console.log(` Fix Qdrant: ${FIX_QDRANT}`);
    console.log(`════════════════════════════════════════\n`);

    try {
        console.log(`🔍 Scrapeando listado de SIES...`);
        const docs = await source.scrape();
        console.log(`✨ Se encontraron ${docs.length} pronunciamientos.`);

        if (DRY_RUN) {
            console.log(`[DRY RUN] Muestra:`, docs[0]);
            return;
        }

        const params = { section: 'pronunciamientos', edition: 'general' };
        const opts = {
            skipExisting: !FIX_QDRANT,
            skipQdrant: ONLY_PSQL
        };

        const result = await runPipeline(source, docs, params, opts);

        console.log(`\n✅ Proceso completado:`);
        console.log(`  - Procesados: ${result.processed}`);
        console.log(`  - Saltados:   ${result.skipped}`);
        console.log(`  - Chunks:     ${result.totalChunks}`);

        log.last_run = new Date().toISOString();
        log.processed_count = (log.processed_count || 0) + result.processed;
        saveLog(log);

    } catch (err) {
        console.error(`❌ Error fatal: ${err.message}`);
        process.exit(1);
    }
}

main();