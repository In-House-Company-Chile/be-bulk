const { extractTextFromPdf } = require('./core/pdfExtractor');
const { chunkText } = require('./core/chunker');
const { getEmbeddingsBatch } = require('./core/embeddings');
const { upsertDocument, documentExists, getDocument } = require('./core/postgresStore');
const { ensureCollection, upsertPoints, generatePointId } = require('./core/qdrantStore');

// ─── Pipeline completo ────────────────────────────────────────────────────────

async function runPipeline(source, documents, params, opts = {}) {
    const { skipExisting = true, onPgDone } = opts;
    const collection = source.collection;
    let qdrantCollectionReady = false;
    let allQdrantPoints = [];
    let totalChunks = 0;
    let processed = 0;
    let skipped = 0;

    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];

        // ── ID compuesto: CVE + edition para evitar colisiones en ediciones dobles
        const cve = doc.id;
        doc.id = params.edition ? `${cve}-${params.edition}` : cve;
        doc.metadata = { ...doc.metadata, cve };

        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📄 Procesando ${i + 1}/${documents.length}: ${doc.id}`);
        console.log(`   ${doc.title.slice(0, 80)}`);
        console.log(`${'─'.repeat(50)}`);

        // ── Skip si ya existe en PG
        if (skipExisting) {
            const exists = await documentExists(doc.id, collection);
            if (exists) {
                console.log(`⏭️  Ya existe en PostgreSQL, saltando...`);
                skipped++;
                continue;
            }
        }

        // ── Obtener texto
        let text, pages = 0, fileSize = 0;

        if (doc.pdfUrl) {
            console.log('\n📥 Extrayendo texto del PDF...');
            try {
                const pdfData = await extractTextFromPdf(doc.pdfUrl);
                text = pdfData.text;
                pages = pdfData.pages;
                fileSize = pdfData.fileSize;
            } catch (err) {
                console.error(`❌ Error con PDF: ${err.message}`);
                saveFailedDoc(doc.id, collection, doc.pdfUrl, params.edition, params.section, err.message);
                continue;
            }
        } else if (doc.text) {
            text = doc.text;
            fileSize = Buffer.byteLength(text, 'utf-8');
        } else {
            console.warn(`⚠️  Documento sin PDF ni texto, saltando...`);
            continue;
        }

        if (!text || text.length < 50) {
            console.warn(`⚠️  Texto muy corto (${text?.length || 0} chars), saltando...`);
            continue;
        }

        // ── Chunking
        console.log('\n✂️  Dividiendo en chunks...');
        const chunks = chunkText(text);
        totalChunks += chunks.length;

        // ── Embeddings
        console.log('\n🧠 Generando embeddings...');
        const embeddings = await getEmbeddingsBatch(chunks.map(c => c.text));

        // ── Asegurar colección Qdrant
        if (!qdrantCollectionReady && embeddings.length > 0 && embeddings[0].vector) {
            await ensureCollection(embeddings[0].vector.length, collection);
            qdrantCollectionReady = true;
        }

        // ── PostgreSQL
        console.log('\n💾 Guardando en PostgreSQL...');
        await upsertDocument({
            id: doc.id,
            collection,
            filename: doc.pdfUrl ? `${cve}.pdf` : `${cve}.txt`,
            filePath: doc.pdfUrl || null,
            content: {
                fullText: text,
                chunks: chunks.map((c, idx) => ({
                    index: idx,
                    text: c.text,
                    startChar: c.startChar,
                    endChar: c.endChar,
                })),
                extractionInfo: { pages, totalChars: text.length, totalChunks: chunks.length },
            },
            metadata: source.getPostgresMetadata(doc, params),
            fileSize,
        });

        // ── Notificar que PG está done (para el log del bulk-ingest)
        if (onPgDone) {
            onPgDone({ processed: 1, skipped: 0, totalChunks: chunks.length });
        }

        // ── Qdrant points
        const points = embeddings
            .filter(e => e.vector !== null)
            .map(e => ({
                id: generatePointId(doc.id, e.index),
                vector: e.vector,
                payload: source.getQdrantPayload(doc, { text: e.text, index: e.index }, chunks.length, params),
            }));

        allQdrantPoints.push(...points);
        processed++;
        console.log(`✅ ${doc.id}: ${chunks.length} chunks, ${points.length} vectores`);
    }

    // ── Batch upsert Qdrant
    if (allQdrantPoints.length > 0) {
        console.log(`\n🔮 Guardando ${allQdrantPoints.length} vectores en Qdrant...`);
        await upsertPoints(allQdrantPoints, collection);
    }

    return { processed, skipped, totalChunks, totalVectors: allQdrantPoints.length };
}

// ─── Solo Qdrant (recuperación) ───────────────────────────────────────────────
// Lee los chunks desde PostgreSQL y los reinserta en Qdrant sin reprocesar PDFs.

async function runQdrantOnly(source, params) {
    const collection = source.collection;
    const { date, edition, section } = params;

    // Buscar todos los docs de esta combinación fecha+edition+section en PG
    const db = require('./core/postgresStore').getPool
        ? require('./core/postgresStore')
        : require('./core/postgresStore');

    const rows = await db.getDocumentsByEdition(edition, collection);

    if (!rows || rows.length === 0) {
        console.log(`⬜ No hay docs en PG para edition=${edition} collection=${collection}`);
        return 0;
    }

    let allPoints = [];
    let qdrantCollectionReady = false;

    for (const row of rows) {
        const chunks = row.content?.chunks || [];
        if (chunks.length === 0) continue;

        // Regenerar embeddings desde el texto guardado en PG
        console.log(`\n🧠 Regenerando embeddings para ${row.id} (${chunks.length} chunks)...`);
        const embeddings = await getEmbeddingsBatch(chunks.map(c => c.text));

        if (!qdrantCollectionReady && embeddings.length > 0 && embeddings[0].vector) {
            await ensureCollection(embeddings[0].vector.length, collection);
            qdrantCollectionReady = true;
        }

        // Reconstruir doc desde metadata de PG
        const doc = {
            id: row.id,
            title: row.metadata?.title || '',
            organism: row.metadata?.organism || '',
            metadata: row.metadata || {},
        };

        const points = embeddings
            .filter(e => e.vector !== null)
            .map(e => ({
                id: generatePointId(row.id, e.index),
                vector: e.vector,
                payload: source.getQdrantPayload(doc, { text: e.text, index: e.index }, chunks.length, params),
            }));

        allPoints.push(...points);
        console.log(`   ${row.id}: ${points.length} vectores listos`);
    }

    if (allPoints.length > 0) {
        console.log(`\n🔮 Reinsertando ${allPoints.length} vectores en Qdrant...`);
        await upsertPoints(allPoints, collection);
    }

    return allPoints.length;
}

module.exports = { runPipeline, runQdrantOnly };