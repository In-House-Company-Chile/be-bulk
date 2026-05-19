#!/usr/bin/env node
/**
 * Ingest masivo de sentencias del Tribunal Ambiental
 * Uso:
 * node src/crawlers/tribunal-ambiental-ingest.js --only-psql
 * node src/crawlers/tribunal-ambiental-ingest.js --only-psql --dry-run
 */

const path = require('path');
const fs   = require('fs');
const { runPipeline } = require('../pipeline');
const TribunalAmbientalSource = require('../sources/tribunal-ambiental');

const args = Object.fromEntries(
    process.argv.slice(2)
        .filter(a => a.startsWith('--'))
        .map(a => {
            const [k, v] = a.slice(2).split('=');
            return [k, v ?? true];
        })
);

const DRY_RUN    = args['dry-run']    === true;
const FIX_QDRANT = args['fix-qdrant'] === true;
const ONLY_PSQL  = args['only-psql']  === true;
const LOG_PATH   = path.join(__dirname, '../../data/tribunal-ambiental-ingest-log.json');

function loadLog() {
    if (!fs.existsSync(LOG_PATH)) return { last_run: null, total_processed: 0 };
    try { return JSON.parse(fs.readFileSync(LOG_PATH, 'utf8')); }
    catch { return { last_run: null, total_processed: 0 }; }
}

function saveLog(log) {
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.writeFileSync(LOG_PATH, JSON.stringify(log, null, 2));
}

async function main() {
    const source = new TribunalAmbientalSource();
    const log    = loadLog();

    console.log(`\n════════════════════════════════════════`);
    console.log(` Tribunal Ambiental Ingest - Sentencias`);
    console.log(` Solo PSQL : ${ONLY_PSQL}`);
    console.log(` Dry-run   : ${DRY_RUN}`);
    console.log(`════════════════════════════════════════\n`);

    try {
        console.log(`🔍 Iniciando scrape del Tribunal Ambiental...`);
        const docs = await source.scrape();

        if (docs.length === 0) {
            console.log(`⚠️ No se encontraron sentencias nuevas.`);
            return;
        }

        console.log(`✨ Procesando ${docs.length} documentos...`);

        if (DRY_RUN) {
            console.log(`[DRY RUN] Ejemplo del primer documento:`, docs[0]);
            return;
        }

        const params = { section: 'jurisprudencia', edition: 'sentencias' };
        const opts   = { 
            skipExisting: !FIX_QDRANT,
            skipQdrant: ONLY_PSQL 
        };

        const result = await runPipeline(source, docs, params, opts);

        console.log(`\n✅ Resumen:`);
        console.log(`  - Exitosos : ${result.processed}`);
        console.log(`  - Fallidos  : ${result.failed}`);
        console.log(`  - Saltados  : ${result.skipped}`);
        console.log(`  - Chunks    : ${result.totalChunks}`);

        log.last_run = new Date().toISOString();
        log.total_processed = (log.total_processed || 0) + result.processed;
        saveLog(log);

    } catch (err) {
        console.error(`❌ Error fatal en el proceso: ${err.message}`);
        process.exit(1);
    }
}

main();