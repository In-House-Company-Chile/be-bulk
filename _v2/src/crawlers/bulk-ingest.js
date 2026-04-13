const fs = require('fs');
const path = require('path');
const { getSource } = require('../sources');
const { runPipeline, runQdrantOnly, reinsertToQdrant } = require('../pipeline');
const { closePool, getAllDocuments } = require('../core/postgresStore');

// ─── Configuración ────────────────────────────────────────────────────────────

const MAP_FILE = path.resolve(__dirname, '../../data/editions-map.json');
const LOG_FILE = path.resolve(__dirname, '../../data/bulk-ingest-log.json');
const DELAY_MS = 3000;
const DELAY_ON_ERR = 60000;

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
    if (fs.existsSync(LOG_FILE)) return JSON.parse(fs.readFileSync(LOG_FILE, 'utf-8'));
    return { updated_at: null, processed: {} };
}

function saveLog(log) {
    log.updated_at = new Date().toISOString();
    fs.writeFileSync(LOG_FILE, JSON.stringify(log, null, 2));
}

function logKey(isoDate, edition, section) { return `${isoDate}|${edition}|${section}`; }
function getLogEntry(log, isoDate, edition, section) { return log.processed[logKey(isoDate, edition, section)] || null; }

function markPgDone(log, isoDate, edition, section, result) {
    const key = logKey(isoDate, edition, section);
    log.processed[key] = { ...log.processed[key], pg_done: true, qdrant_done: false, done_at: new Date().toISOString(), docs: result.processed, skipped: result.skipped, chunks: result.totalChunks };
}

function markQdrantDone(log, isoDate, edition, section, vectors) {
    const key = logKey(isoDate, edition, section);
    log.processed[key] = { ...log.processed[key], qdrant_done: true, qdrant_at: new Date().toISOString(), vectors };
}

function markFullDone(log, isoDate, edition, section, result) {
    const key = logKey(isoDate, edition, section);
    log.processed[key] = { pg_done: true, qdrant_done: true, done_at: new Date().toISOString(), docs: result.processed, skipped: result.skipped, chunks: result.totalChunks, vectors: result.totalVectors };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs();
    const dryRun = args['dry-run'] === true;
    const fixQdrant = args['fix-qdrant'] === true;
    const syncQdrant = args['sync-qdrant'] === true;

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

    // ─── Modo sync-qdrant: lee desde PG directo, ignora el log ───────────────
    if (syncQdrant) {
        console.log('='.repeat(60));
        console.log('SYNC QDRANT — Reinsertando desde PostgreSQL');
        console.log(`Secciones: ${sections.join(', ')}`);
        console.log('='.repeat(60));

        for (const section of sections) {
            console.log(`\n📦 Sección: ${section}`);
            const source = getSource('diario-oficial', { section });
            const rows = await getAllDocuments(source.collection);
            console.log(`   Documentos en PG: ${rows.length}`);
            if (rows.length === 0) continue;
            const vectors = await reinsertToQdrant(source, rows);
            console.log(`   ✅ Vectores reinsertados: ${vectors}`);
        }

        await closePool();
        return;
    }

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
                if (entry?.pg_done && entry?.qdrant_done) continue;
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

    console.log('='.repeat(60));
    console.log('BULK INGEST — Diario Oficial de Chile');
    console.log(`Secciones:       ${sections.join(', ')}`);
    console.log(`Desde:           ${fromISO || sortedDates[0]}`);
    console.log(`Hasta:           ${toISO || sortedDates.at(-1)}`);
    console.log(`Jobs totales:    ${jobs.length}`);
    console.log(`  → Full:        ${jobs.length - qdrantOnlyCount}`);
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
            console.log(`  ${i + 1}. ${j.isoDate} | edition=${j.edition} | section=${j.section}${j.qdrantOnly ? ' [solo qdrant]' : ''}`);
        });
        await closePool();
        return;
    }

    // ─── Procesamiento ────────────────────────────────────────────────────────

    let totalDocs = 0, totalChunks = 0, totalVectors = 0, errors = 0;

    for (let i = 0; i < jobs.length; i++) {
        const { isoDate, queryDate, edition, section, totalEditions, qdrantOnly } = jobs[i];
        const progress = `[${i + 1}/${jobs.length}]`;

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`${progress} ${queryDate} | edition=${edition} | section=${section}${qdrantOnly ? ' 🔄 QDRANT ONLY' : ''}`);
        console.log('═'.repeat(60));

        try {
            const source = getSource('diario-oficial', { section });
            const params = { date: queryDate, edition, section, totalEditions };

            if (qdrantOnly) {
                const vectors = await runQdrantOnly(source, params);
                markQdrantDone(log, isoDate, edition, section, vectors);
                saveLog(log);
                totalVectors += vectors;
                console.log(`✅ ${progress} Qdrant fix: ${vectors} vectores reinsertados`);

            } else {
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