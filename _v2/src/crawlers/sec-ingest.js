#!/usr/bin/env node
/**
 * Ingest masivo de resoluciones SEC
 * Uso:
 * node src/crawlers/sec-ingest.js --only-psql
 * node src/crawlers/sec-ingest.js --page=2 --only-psql
 */

const path = require('path');
const fs = require('fs');
const { runPipeline } = require('../pipeline');
const SecSource = require('../sources/sec');

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
const TO_PAGE = parseInt(args.to ?? (PAGE ?? 2), 10);
const DRY_RUN = args['dry-run'] === true;
const FIX_QDRANT = args['fix-qdrant'] === true;
const ONLY_PSQL = args['only-psql'] === true;

async function main() {
    const source = new SecSource();
    console.log(`\n════════════════════════════════════════`);
    console.log(` SEC Ingest - Resoluciones`);
    console.log(` Páginas   : ${FROM_PAGE} → ${TO_PAGE}`);
    console.log(` Solo PSQL : ${ONLY_PSQL}`);
    console.log(`════════════════════════════════════════\n`);

    for (let page = FROM_PAGE; page <= TO_PAGE; page++) {
        try {
            console.log(`\n🔍 Procesando página ${page}...`);
            const docs = await source.scrape({ page });

            if (docs.length === 0) continue;

            if (DRY_RUN) {
                console.log(`  [dry-run] Primer doc:`, docs[0].id);
                continue;
            }

            const params = { section: 'sec', edition: `pagina-${page}` };
            const opts = {
                skipExisting: !FIX_QDRANT,
                skipQdrant: ONLY_PSQL
            };

            const result = await runPipeline(source, docs, params, opts);
            console.log(`  ✅ Página ${page} terminada. Procesados: ${result.processed}`);

        } catch (err) {
            console.error(`❌ Error en página ${page}: ${err.message}`);
        }
    }
}

main().catch(console.error);