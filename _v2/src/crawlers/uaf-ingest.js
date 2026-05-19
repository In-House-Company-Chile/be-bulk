#!/usr/bin/env node
/**
 * Ingest masivo de sanciones ejecutoriadas de la UAF
 * Uso:
 * node src/crawlers/uaf-ingest.js --only-psql
 * node src/crawlers/uaf-ingest.js --only-psql --dry-run
 */

const path = require('path');
const fs = require('fs');
const { runPipeline } = require('../pipeline');
const UafSource = require('../sources/uaf');

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
const LOG_PATH = path.join(__dirname, '../../data/uaf-ingest-log.json');

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
    const source = new UafSource();
    const log = loadLog();

    console.log(`\n════════════════════════════════════════`);
    console.log(` UAF Ingest - Sanciones Ejecutoriadas`);
    console.log(` Solo PSQL : ${ONLY_PSQL}`);
    console.log(` Dry-run   : ${DRY_RUN}`);
    console.log(`════════════════════════════════════════\n`);

    try {
        console.log(`🔍 Iniciando scrape de la UAF...`);
        const docs = await source.scrape();

        if (docs.length === 0) {
            console.log(`⚠️ No se encontraron documentos nuevos.`);
            return;
        }

        console.log(`✨ Procesando ${docs.length} documentos...`);

        if (DRY_RUN) {
            console.log(`[DRY RUN] Ejemplo del primer documento:`, docs[0]);
            return;
        }

        const params = { section: 'sanciones', edition: 'ejecutoriadas' };
        const opts = {
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