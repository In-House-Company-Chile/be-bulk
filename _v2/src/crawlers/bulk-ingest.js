/**
 * Bulk Ingest — Diario Oficial de Chile
 *
 * Lee editions-map.json y procesa cada fecha → edición → sección.
 * Usa el pipeline existente (chunk → embed → PostgreSQL + Qdrant).
 *
 * Uso:
 *   node src/crawlers/bulk-ingest.js
 *   node src/crawlers/bulk-ingest.js --from=01-01-2020
 *   node src/crawlers/bulk-ingest.js --from=01-01-2020 --to=31-12-2020
 *   node src/crawlers/bulk-ingest.js --section=normas-generales
 *   node src/crawlers/bulk-ingest.js --dry-run
 */

const fs = require('fs');
const path = require('path');
const { getSource } = require('../sources');
const { runPipeline } = require('../pipeline');
const { closePool } = require('../core/postgresStore');

// ─── Configuración ────────────────────────────────────────────────────────────

const MAP_FILE = path.resolve(__dirname, '../../data/editions-map.json');
const LOG_FILE = path.resolve(__dirname, '../../data/bulk-ingest-log.json');
const DELAY_MS = 1000; // ms entre secciones (respetar el servidor)

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

function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
}

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

// ─── Log de progreso ──────────────────────────────────────────────────────────
// Registra qué combinaciones (date + edition + section) ya fueron procesadas.
// Permite reanudar sin reprocesar lo ya hecho.

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

function markDone(log, isoDate, edition, section, result) {
    log.processed[logKey(isoDate, edition, section)] = {
        done_at: new Date().toISOString(),
        docs: result.processed,
        skipped: result.skipped,
        chunks: result.totalChunks,
        vectors: result.totalVectors,
    };
}

function isDone(log, isoDate, edition, section) {
    return !!log.processed[logKey(isoDate, edition, section)];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const args = parseArgs();

    // Validar que existe el mapa
    if (!fs.existsSync(MAP_FILE)) {
        console.error(`❌ No se encontró ${MAP_FILE}`);
        console.error(`   Ejecuta primero: node src/crawlers/editions-map.js`);
        process.exit(1);
    }

    const map = JSON.parse(fs.readFileSync(MAP_FILE, 'utf-8'));
    const log = loadLog();
    const dryRun = args['dry-run'] === true;

    // Filtro de secciones
    const sections = args.section
        ? [args.section]
        : ALL_SECTIONS;

    // Filtro de fechas
    const fromISO = args.from ? toISODate(args.from) : null;
    const toISO = args.to ? toISODate(args.to) : null;

    // Construir lista de trabajos: { isoDate, queryDate, edition, section }
    const jobs = [];

    const sortedDates = Object.keys(map.days).sort();

    for (const isoDate of sortedDates) {
        // Filtro de rango
        if (fromISO && isoDate < fromISO) continue;
        if (toISO && isoDate > toISO) continue;

        const { editions } = map.days[isoDate];
        if (!editions || editions.length === 0) continue; // día sin publicación

        for (const edition of editions) {
            for (const section of sections) {
                if (isDone(log, isoDate, edition, section)) continue; // ya procesado
                jobs.push({ isoDate, queryDate: toQueryDate(isoDate), edition, section });
            }
        }
    }

    // Resumen
    console.log('='.repeat(60));
    console.log('BULK INGEST — Diario Oficial de Chile');
    console.log(`Secciones:  ${sections.join(', ')}`);
    console.log(`Desde:      ${fromISO || map.days[sortedDates[0]] ? sortedDates[0] : '—'}`);
    console.log(`Hasta:      ${toISO || sortedDates.at(-1)}`);
    console.log(`Jobs:       ${jobs.length}`);
    console.log(`Dry run:    ${dryRun}`);
    console.log('='.repeat(60));

    if (jobs.length === 0) {
        console.log('✅ Nada que procesar — todo ya está en el log.');
        await closePool();
        return;
    }

    if (dryRun) {
        console.log('\nPrimeros 10 jobs:');
        jobs.slice(0, 10).forEach((j, i) => {
            console.log(`  ${i + 1}. ${j.isoDate} | edition=${j.edition} | section=${j.section}`);
        });
        await closePool();
        return;
    }

    // ─── Procesamiento ────────────────────────────────────────────────────────

    let totalDocs = 0, totalChunks = 0, totalVectors = 0, errors = 0;

    for (let i = 0; i < jobs.length; i++) {
        const { isoDate, queryDate, edition, section } = jobs[i];
        const progress = `[${i + 1}/${jobs.length}]`;

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`${progress} ${queryDate} | edition=${edition} | section=${section}`);
        console.log('═'.repeat(60));

        try {
            const source = getSource('diario-oficial', { section });
            const params = { date: queryDate, edition, section };
            const documents = await source.scrape(params);

            if (documents.length === 0) {
                console.log(`⬜ Sin documentos en esta sección/edición`);
                markDone(log, isoDate, edition, section, { processed: 0, skipped: 0, totalChunks: 0, totalVectors: 0 });
                saveLog(log);
                continue;
            }

            const result = await runPipeline(source, documents, params, { skipExisting: true });

            markDone(log, isoDate, edition, section, result);
            saveLog(log);

            totalDocs += result.processed;
            totalChunks += result.totalChunks;
            totalVectors += result.totalVectors;

            console.log(`✅ ${progress} Docs: ${result.processed} | Chunks: ${result.totalChunks} | Vectors: ${result.totalVectors}`);

        } catch (err) {
            errors++;
            console.error(`❌ ${progress} Error en ${queryDate}|${edition}|${section}: ${err.message}`);
            // No marcar como done → se reintentará en la próxima ejecución
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