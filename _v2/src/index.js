const { getSource, listSources } = require('./sources');
const { runPipeline } = require('./pipeline');
const { closePool } = require('./core/postgresStore');

/**
 * Parsea argumentos de línea de comandos
 * Uso: node src/index.js --source=diario-oficial --date=30-03-2026 --edition=44413
 */
function parseArgs() {
  const args = {};
  process.argv.slice(2).forEach(arg => {
    if (arg.startsWith('--')) {
      const [key, val] = arg.slice(2).split('=');
      args[key] = val || true;
    }
  });
  return args;
}

async function main() {
  const args = parseArgs();

  // Help
  if (args.help || args.h) {
    console.log('Uso: node src/index.js --source=FUENTE [--dry-run] [params...]');
    console.log('\nFuentes disponibles:');
    listSources().forEach(s => {
      console.log(`  ${s.name}: ${s.params}`);
    });
    process.exit(0);
  }

  // Determinar fuente (default: diario-oficial para compatibilidad)
  const sourceName = args.source || 'diario-oficial';
  const dryRun = args['dry-run'] === true;
  const skipExisting = args['skip-existing'] !== 'false';

  let source;
  try {
    source = getSource(sourceName);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log(`DOCUMENT INGESTION PIPELINE`);
  console.log(`Fuente: ${source.name} | Colección: ${source.collection}`);
  console.log(`Params: ${JSON.stringify(args)}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('='.repeat(60));

  // Scrape
  console.log('\n📋 PASO 1: Scraping...');
  const documents = await source.scrape(args);

  if (documents.length === 0) {
    console.log('⚠️  No se encontraron documentos.');
    process.exit(0);
  }

  console.log(`\nDocumentos encontrados:`);
  documents.forEach((doc, i) => {
    console.log(`  ${i + 1}. [${doc.id}] ${doc.title.slice(0, 80)}`);
    console.log(`     Organismo: ${doc.organism}`);
  });

  if (dryRun) {
    console.log('\n🏁 Dry run completado.');
    process.exit(0);
  }

  // Pipeline
  const result = await runPipeline(source, documents, args, { skipExisting });

  // Resumen
  console.log('\n' + '='.repeat(60));
  console.log('✅ PIPELINE COMPLETADO');
  console.log(`   Fuente: ${source.name}`);
  console.log(`   Documentos procesados: ${result.processed}`);
  console.log(`   Documentos saltados: ${result.skipped}`);
  console.log(`   Total chunks: ${result.totalChunks}`);
  console.log(`   Vectores en Qdrant: ${result.totalVectors}`);
  console.log('='.repeat(60));

  await closePool();
}

main().catch(err => {
  console.error('❌ Error fatal:', err);
  closePool().finally(() => process.exit(1));
});