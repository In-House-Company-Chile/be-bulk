/**
 * Bulk Ingest — Diario Oficial de Chile
 *
 * Lee editions-map.json y procesa cada fecha → edición → sección.
 * Usa el pipeline existente (chunk → embed → PostgreSQL + Qdrant).
 *
 * El log registra pg_done y qdrant_done por separado:
 * - Si PG falla     → job completo se reintenta
 * - Si Qdrant falla → solo se reinserta en Qdrant (sin reprocesar PDF/embeddings)
 *
 * Uso:
 *   node src/crawlers/bulk-ingest.js
 *   node src/crawlers/bulk-ingest.js --from=01-01-2020
 *   node src/crawlers/bulk-ingest.js --from=01-01-2020 --to=31-12-2020
 *   node src/crawlers/bulk-ingest.js --section=normas-generales
 *   node src/crawlers/bulk-ingest.js --dry-run
 *   node src/crawlers/bulk-ingest.js --fix-qdrant   (solo reinserta los que faltan en Qdrant)
 */

const fs = require('fs');
const path = require('path');
const { getSource } = require('../sources');
const { runPipeline, runQdrantOnly } = require('../pipeline');
const { closePool } = require('../core/postgresStore');

// ─── Configuración ────────────────────────────────────────────────────────────

const MAP_FILE = path.resolve(__dirname, '../../data/editions-map.json');
const LOG_FILE = path.resolve(__dirname, '../../data/bulk-ingest-log.json');
const DELAY_MS = 1000;
const DELAY_ON_ERR = 60000; // 60 segundos extra tras error de red

const ALL_SECTIONS = [
    'normas-generales',
    'normas-particulares',
    'publicaciones-judiciales',
    'avisos-destacados',
    'empresas-cooperativas',
    'marcas-patentes',
    'bom',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

function parseArgs() {
    const args = {};
    process.argv.slice(2).forEach(arg => {
        if (arg.startsWith('--')) {
            const [k, v] = arg.slice(2).split('=');
            args[k] = v || true;
        }
    });
    return args;
}

function toISODate(ddmmyyyy) {
    const [dd, mm, yyyy] = ddmmyyyy.split('-');
    return `${yyyy}-${mm}-${dd}`;
}

function toQueryDate(isoDate) {
    const [yyyy, mm, dd] = isoDate.split('-');
    return `${dd}-${mm}-${yyyy}`;
}

// ─── Log ──────────────────────────────────────────────────────────────────────

function loadLog() {
    if (fs.existsSync(LOG_FILE)) {
        return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    }
    return { updated_at: null, processed: {} };
}

function saveLog(log) {
    log.updated_at = new Date().toISOString();
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function logKey(isoDate, edition, section) {
    return `${isoDate}|${edition}|${section}`;
}

function getLogEntry(log, isoDate, edition, section) {
    return log.processed[logKey(isoDate, edition, section)] || null;
}

function markPgDone(log, isoDate, edition, section, result) {
    const key = logKey(isoDate, edition, section);
    log.processed[key] = {
        ...log.processed[key],
        pg_done: true,
        qdrant_done: false,
        done_at: new Date().toISOString(),
        docs: result.processed,
        skipped: result.skipped,
        chunks: result.totalChunks,
    };
}

function markQdrantDone(log, isoDate, edition, section, vectors) {
    const key = logKey(isoDate, edition, section);
    log.processed[key] = {
        ...log.processed[key],
        qdrant_done: true,
        qdrant_at: new Date().toISOString(),
        vectors,
    };
}

function markFullDone(log, isoDate, edition, section, result) {
    const key = logKey(isoDate, edition, section);
    log.processed[key] = {
        pg_done: true,
        qdrant_done: true,
        done_at: new Date().toISOString(),
        docs: result.processed,
        skipped: result.skipped,
        chunks: result.totalChunks,
        vectors: result.totalVectors,
    };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs();
    const dryRun = args['dry-run'] === true;
    const fixQdrant = args['fix-qdrant'] === true;

    if (!fs.existsSync(MAP_FILE)) {
        console.error(`❌ No se encontró ${MAP_FILE}`);
        console.error(`   Ejecuta primero: node src/crawlers/editions-map.js`);
        process.exit(1);
    }

    const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8'));
    const log = loadLog();
    const sections = args.section ? [args.section] : ALL_SECTIONS;
    const fromISO = args.from ? toISODate(args.from) : null;
    const toISO = args.to ? toISODate(args.to) : null;

    // ─── Construir jobs ───────────────────────────────────────────────────────

    const jobs = [];
    const sortedDates = Object.keys(map.days).sort();

    for (const isoDate of sortedDates) {
        if (fromISO && isoDate < fromISO) continue;
        if (toISO && isoDate > toISO) continue;

        const { editions } = map.days[isoDate];
        if (!editions || editions.length === 0) continue;

        for (const edition of editions) {
            for (const section of sections) {
                const entry = getLogEntry(log, isoDate, edition, section);

                // Completo → skip
                if (entry?.pg_done && entry?.qdrant_done) continue;

                // --fix-qdrant: solo los que tienen PG pero no Qdrant
                if (fixQdrant && !(entry?.pg_done && !entry?.qdrant_done)) continue;

                jobs.push({
                    isoDate,
                    queryDate: toQueryDate(isoDate),
                    edition,
                    section,
                    totalEditions: editions.length,
                    qdrantOnly: entry?.pg_done && !entry?.qdrant_done,
                });
            }
        }
    }

    // ─── Resumen ──────────────────────────────────────────────────────────────

    const qdrantOnlyCount = jobs.filter(j => j.qdrantOnly).length;
    const fullCount = jobs.length - qdrantOnlyCount;

    console.log('='.repeat(60));
    console.log('BULK INGEST — Diario Oficial de Chile');
    console.log(`Secciones:       ${sections.join(', ')}`);
    console.log(`Desde:           ${fromISO || sortedDates[0]}`);
    console.log(`Hasta:           ${toISO || sortedDates.at(-1)}`);
    console.log(`Jobs totales:    ${jobs.length}`);
    console.log(`  → Full:        ${fullCount}`);
    console.log(`  → Solo Qdrant: ${qdrantOnlyCount}`);
    console.log(`Dry run:         ${dryRun}`);
    console.log('='.repeat(60));

    if (jobs.length === 0) {
        console.log('✅ Nada que procesar.');
        await closePool();
        return;
    }

    if (dryRun) {
        console.log('\nPrimeros 10 jobs:');
        jobs.slice(0, 10).forEach((j, i) => {
            const tag = j.qdrantOnly ? ' [solo qdrant]' : '';
            console.log(`  ${i + 1}. ${j.isoDate} | edition=${j.edition} | section=${j.section}${tag}`);
        });
        await closePool();
        return;
    }

    // ─── Procesamiento ────────────────────────────────────────────────────────

    let totalDocs = 0, totalChunks = 0, totalVectors = 0, errors = 0;

    for (let i = 0; i < jobs.length; i++) {
        const { isoDate, queryDate, edition, section, totalEditions, qdrantOnly } = jobs[i];
        const progress = `[${i + 1}/${jobs.length}]`;
        const tag = qdrantOnly ? ' 🔄 QDRANT ONLY' : '';

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`${progress} ${queryDate} | edition=${edition} | section=${section}${tag}`);
        console.log('═'.repeat(60));

        try {
            const source = getSource('diario-oficial', { section });
            const params = { date: queryDate, edition, section, totalEditions };

            if (syncQdrant || qdrantOnly) {
                // ── Solo reinsertar en Qdrant desde PostgreSQL ────────────────
                const vectors = await runQdrantOnly(source, params);
                markQdrantDone(log, isoDate, edition, section, vectors);
                saveLog(log);
                totalVectors += vectors;
                console.log(`✅ ${progress} Qdrant fix: ${vectors} vectores reinsertados`);

            } else {
                // ── Pipeline completo ─────────────────────────────────────────
                const documents = await source.scrape(params);

                if (documents.length === 0) {
                    console.log(`⬜ Sin documentos en esta sección/edición`);
                    markFullDone(log, isoDate, edition, section, { processed: 0, skipped: 0, totalChunks: 0, totalVectors: 0 });
                    saveLog(log);
                    continue;
                }

                const result = await runPipeline(source, documents, params, {
                    skipExisting: true,
                    onPgDone: (res) => {
                        markPgDone(log, isoDate, edition, section, res);
                        saveLog(log);
                    },
                });

                markFullDone(log, isoDate, edition, section, result);
                saveLog(log);

                totalDocs += result.processed;
                totalChunks += result.totalChunks;
                totalVectors += result.totalVectors;

                console.log(`✅ ${progress} Docs: ${result.processed} | Chunks: ${result.totalChunks} | Vectors: ${result.totalVectors}`);
            }

        } catch (err) {
            errors++;
            console.error(`❌ ${progress} Error en ${queryDate}|${edition}|${section}: ${err.message}`);
            // Espera extra tras error de red para evitar rate limiting
            console.log(`   ⏳ Esperando ${DELAY_ON_ERR / 1000}s antes de continuar...`);
            await sleep(DELAY_ON_ERR);
        }

        await sleep(DELAY_MS);
    }

    // ─── Resumen final ────────────────────────────────────────────────────────

    await closePool();

    console.log('\n' + '='.repeat(60));
    console.log('✅ BULK INGEST COMPLETADO');
    console.log(`   Jobs procesados:  ${jobs.length - errors}`);
    console.log(`   Errores:          ${errors}`);
    console.log(`   Total docs:       ${totalDocs}`);
    console.log(`   Total chunks:     ${totalChunks}`);
    console.log(`   Total vectors:    ${totalVectors}`);
    console.log(`   Log: ${LOG_FILE}`);
    console.log('='.repeat(60));
}

main().catch(async err => {
    console.error('❌ Error fatal:', err);
    await closePool();
    process.exit(1);
});