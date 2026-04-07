const { scrapeNormasGenerales } = require('./scraper');
const { extractTextFromPdf } = require('./pdfExtractor');
const { chunkText } = require('./chunker');
const { getEmbeddingsBatch } = require('./embeddings');
const { upsertDocument, documentExists, closePool } = require('./postgresStore');
const { ensureCollection, upsertPoints, generatePointId, scrollPoints } = require('./qdrantStore');
const config = require('./config');

/**
 * Parsea argumentos de línea de comandos
 * Uso: node src/index.js --date=30-03-2026 --edition=44413 [--dry-run] [--skip-existing]
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

/**
 * Convierte fecha DD-MM-YYYY a objeto con partes
 */
function parseDate(dateStr) {
  const [day, month, year] = dateStr.split('-');
  return { day, month, year, iso: `${year}-${month}-${day}` };
}

/**
 * Pipeline principal: Scrape → PDF → Chunk → Embed → Store
 */
async function main() {
  const args = parseArgs();
  const date = args.date;
  const edition = args.edition;
  const dryRun = args['dry-run'] === true;
  const skipExisting = args['skip-existing'] !== false; // default true

  if (!date || !edition) {
    console.error('Uso: node src/index.js --date=DD-MM-YYYY --edition=NNNNN');
    console.error('Ejemplo: node src/index.js --date=30-03-2026 --edition=44413');
    console.error('Opciones:');
    console.error('  --dry-run        Solo muestra lo que haría sin ejecutar');
    console.error('  --skip-existing  Salta documentos ya procesados (default: true)');
    process.exit(1);
  }

  const dateInfo = parseDate(date);
  const collection = config.qdrant.collection;

  console.log('='.repeat(60));
  console.log(`DIARIO OFICIAL SCRAPER`);
  console.log(`Fecha: ${date} | Edición: ${edition} | Collection: ${collection}`);
  console.log(`Dry run: ${dryRun}`);
  console.log('='.repeat(60));

  // ── PASO 1: Scraping ──────────────────────────────────────────
  console.log('\n📋 PASO 1: Scraping del Diario Oficial...');
  const documents = await scrapeNormasGenerales(date, edition);

  if (documents.length === 0) {
    console.log('⚠️  No se encontraron documentos. Verifica la URL.');
    process.exit(0);
  }

  console.log(`\nDocumentos encontrados:`);
  documents.forEach((doc, i) => {
    console.log(`  ${i + 1}. [CVE-${doc.cve}] ${doc.title.slice(0, 80)}...`);
    console.log(`     Organismo: ${doc.organism}`);
    console.log(`     PDF: ${doc.pdfUrl}`);
  });

  if (dryRun) {
    console.log('\n🏁 Dry run completado. Usa sin --dry-run para ejecutar.');
    process.exit(0);
  }

  let qdrantCollectionReady = false;
  let allQdrantPoints = [];
  let totalChunks = 0;

  // ── PASO 2-5: Procesar cada documento ─────────────────────────
  for (let i = 0; i < documents.length; i++) {
    const doc = documents[i];
    console.log(`\n${'─'.repeat(50)}`);
    console.log(`📄 Procesando ${i + 1}/${documents.length}: CVE-${doc.cve}`);
    console.log(`${'─'.repeat(50)}`);

    // Verificar si ya existe
    if (skipExisting) {
      const exists = await documentExists(doc.cve, collection);
      if (exists) {
        console.log(`⏭️  Ya existe en PostgreSQL, saltando...`);
        continue;
      }
    }

    // ── PASO 2: Extraer texto del PDF ───────────────────────────
    console.log('\n📥 PASO 2: Extrayendo texto del PDF...');
    let pdfData;
    try {
      pdfData = await extractTextFromPdf(doc.pdfUrl);
    } catch (err) {
      console.error(`❌ Error descargando PDF: ${err.message}`);
      continue;
    }

    if (!pdfData.text || pdfData.text.length < 50) {
      console.warn(`⚠️  Texto extraído muy corto (${pdfData.text?.length || 0} chars), posible PDF imagen.`);
      continue;
    }

    // ── PASO 3: Chunking ────────────────────────────────────────
    console.log('\n✂️  PASO 3: Dividiendo en chunks...');
    const chunks = chunkText(pdfData.text);
    totalChunks += chunks.length;

    // ── PASO 4: Embeddings ──────────────────────────────────────
    console.log('\n🧠 PASO 4: Generando embeddings...');
    const chunkTexts = chunks.map(c => c.text);
    const embeddings = await getEmbeddingsBatch(chunkTexts);

    // Verificar/crear colección en Qdrant con la dimensión del primer vector
    if (!qdrantCollectionReady && embeddings.length > 0 && embeddings[0].vector) {
      const vectorSize = embeddings[0].vector.length;
      await ensureCollection(vectorSize);
      qdrantCollectionReady = true;
    }

    // ── PASO 5: Guardar en PostgreSQL ───────────────────────────
    console.log('\n💾 PASO 5: Guardando en PostgreSQL...');
    await upsertDocument({
      id: doc.cve,
      collection,
      filename: `${doc.cve}.pdf`,
      filePath: doc.pdfUrl,
      content: {
        fullText: pdfData.text,
        chunks: chunks.map((c, idx) => ({
          index: idx,
          text: c.text,
          startChar: c.startChar,
          endChar: c.endChar,
        })),
        extractionInfo: {
          pages: pdfData.pages,
          totalChars: pdfData.text.length,
          totalChunks: chunks.length,
        },
      },
      metadata: {
        title: doc.title,
        organism: doc.organism,
        cve: doc.cve,
        date: dateInfo.iso,
        edition,
        section: 'normas_generales',
        linkText: doc.linkText,
        processedAt: new Date().toISOString(),
      },
      fileSize: pdfData.fileSize,
    });

    // ── Preparar puntos para Qdrant ─────────────────────────────
    const points = embeddings
      .filter(e => e.vector !== null)
      .map(e => ({
        id: generatePointId(doc.cve, e.index),
        vector: e.vector,
        payload: {
          texto: e.text,
          tipo_documento: 'norma_general',
          cve: doc.cve,
          titulo: doc.title,
          organismo: doc.organism,
          fecha: dateInfo.iso,
          edicion: edition,
          seccion: 'normas_generales',
          chunk_index: e.index,
          total_chunks: chunks.length,
          tema: inferTema(doc.title, doc.organism),
        },
      }));

    allQdrantPoints.push(...points);
    console.log(`✅ Documento CVE-${doc.cve}: ${chunks.length} chunks, ${points.length} vectores`);
  }

  // ── PASO 6: Guardar en Qdrant (batch) ─────────────────────────
  if (allQdrantPoints.length > 0) {
    console.log(`\n🔮 PASO 6: Guardando ${allQdrantPoints.length} vectores en Qdrant...`);
    await upsertPoints(allQdrantPoints);
  }

  // ── Verificación Qdrant ─────────────────────────────────────
  if (allQdrantPoints.length > 0) {
    console.log('\n🔍 Verificando puntos en Qdrant...');
    await scrollPoints(5);
  }

  // ── Resumen ───────────────────────────────────────────────────
  console.log('\n' + '='.repeat(60));
  console.log('✅ PIPELINE COMPLETADO');
  console.log(`   Documentos procesados: ${documents.length}`);
  console.log(`   Total chunks: ${totalChunks}`);
  console.log(`   Vectores en Qdrant: ${allQdrantPoints.length}`);
  console.log('='.repeat(60));

  // Cleanup
  await closePool();
}

/**
 * Infiere un tema/categoría basado en el título y organismo
 */
function inferTema(title, organism) {
  const t = (title + ' ' + organism).toLowerCase();

  if (t.includes('tipo de cambio') || t.includes('moneda') || t.includes('paridad')) return 'tipos_cambio';
  if (t.includes('banco central')) return 'banco_central';
  if (t.includes('decreto') && t.includes('alcaldicio')) return 'decreto_alcaldicio';
  if (t.includes('plan comunal') || t.includes('infraestructura')) return 'planificacion_comunal';
  if (t.includes('municipalidad')) return 'municipal';
  if (t.includes('resolución') || t.includes('resolucion')) return 'resolucion';
  if (t.includes('ley')) return 'ley';
  if (t.includes('reglamento')) return 'reglamento';
  if (t.includes('decreto supremo')) return 'decreto_supremo';
  if (t.includes('ministerio')) return 'ministerial';
  if (t.includes('contraloría') || t.includes('contraloria')) return 'contraloria';
  if (t.includes('tributari') || t.includes('impuesto') || t.includes('sii')) return 'tributario';
  if (t.includes('laboral') || t.includes('trabajo')) return 'laboral';
  if (t.includes('salud') || t.includes('sanitari')) return 'salud';
  if (t.includes('educación') || t.includes('educacion')) return 'educacion';
  if (t.includes('medio ambiente') || t.includes('ambiental')) return 'medioambiente';

  return 'general';
}

// Ejecutar
main().catch(err => {
  console.error('❌ Error fatal:', err);
  closePool().finally(() => process.exit(1));
});