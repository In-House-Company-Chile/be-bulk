const fs = require('fs');
const path = require('path');
const { extractTextFromPdf } = require('./core/pdfExtractor');
const { chunkText } = require('./core/chunker');
const { getEmbeddingsBatch } = require('./core/embeddings');
const { upsertDocument, documentExists, getDocumentsByEdition } = require('./core/postgresStore');
const { ensureCollection, upsertPoints, pointExists, generatePointId } = require('./core/qdrantStore');

// ─── Failed docs log ──────────────────────────────────────────────────────────

const FAILED_LOG_FILE = path.resolve(__dirname, '../data/failed-docs-log.json');

function loadFailedLog() {
    if (fs.existsSync(FAILED_LOG_FILE)) {
        return JSON.parse(fs.readFileSync(FAILED_LOG_FILE, 'utf-8'));
    }
    return { updated_at: null, failed: [] };
}

function saveFailedDoc(docId, collection, pdfUrl, edition, section, error) {
    const log = loadFailedLog();
    const exists = log.failed.some(f => f.docId === docId && f.collection === collection);
    if (!exists) {
        log.failed.push({
            docId,
            collection,
            pdfUrl,
            edition,
            section,
            error,
            failed_at: new Date().toISOString(),
        });
    }
    log.updated_at = new Date().toISOString();
    fs.writeFileSync(FAILED_LOG_FILE, JSON.stringify(log, null, 2));
}

// ─── Pipeline completo ────────────────────────────────────────────────────────

async function runPipeline(source, documents, params, opts = {}) {
    const { skipExisting = true, onPgDone } = opts;
    const collection = source.collection;
    let qdrantCollectionReady = false;
    let totalChunks = 0;
    let totalVectors = 0;
    let processed = 0;
    let skipped = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

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
                consecutiveErrors++;
                if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                    throw new Error(`Circuit breaker: ${MAX_CONSECUTIVE_ERRORS} errores consecutivos. Deteniendo pipeline.`);
                }
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

        // ── Qdrant upsert por documento (no al final del batch)
        if (points.length > 0) {
            console.log(`\n🔮 Guardando ${points.length} vectores en Qdrant...`);
            await upsertPoints(points, collection);
        }

        totalVectors += points.length;
        processed++;
        consecutiveErrors = 0;
        console.log(`✅ ${doc.id}: ${chunks.length} chunks, ${points.length} vectores`);
    }

    return { processed, skipped, totalChunks, totalVectors: allQdrantPoints.length };
}

// ─── Solo Qdrant (recuperación) ───────────────────────────────────────────────

async function runQdrantOnly(source, params) {
    const collection = source.collection;
    const { edition } = params;
    const rows = await getDocumentsByEdition(edition, collection);

    if (!rows || rows.length === 0) {
        console.log(`⬜ No hay docs en PG para edition=${edition} collection=${collection}`);
        return 0;
    }

    let allPoints = [];
    let qdrantCollectionReady = false;

    for (const row of rows) {
        const chunks = row.content?.chunks || [];
        if (chunks.length === 0) continue;

        console.log(`\n🧠 Regenerando embeddings para ${row.id} (${chunks.length} chunks)...`);
        const embeddings = await getEmbeddingsBatch(chunks.map(c => c.text));

        if (!qdrantCollectionReady && embeddings.length > 0 && embeddings[0].vector) {
            await ensureCollection(embeddings[0].vector.length, collection);
            qdrantCollectionReady = true;
        }

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

// ─── Reinsertar colección completa a Qdrant desde PG ─────────────────────────
// Verifica doc por doc si ya existe en Qdrant antes de regenerar embeddings.

async function reinsertToQdrant(source, rows) {
    const collection = source.collection;
    let allPoints = [];
    let qdrantCollectionReady = false;
    let skipped = 0;
    let inserted = 0;
    const FLUSH_SIZE = 500; // insertar en Qdrant cada 500 vectores acumulados

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const chunks = row.content?.chunks || [];
        if (chunks.length === 0) continue;

        // ── Verificar si chunk-0 ya existe en Qdrant → doc ya vectorizado
        const firstPointId = generatePointId(row.id, 0);
        const exists = await pointExists(collection, firstPointId);
        if (exists) {
            skipped++;
            if (skipped % 500 === 0) {
                console.log(`   ⏭️  ${skipped} docs ya vectorizados (${i + 1}/${rows.length})`);
            }
            continue;
        }

        // ── Regenerar embeddings
        const embeddings = await getEmbeddingsBatch(chunks.map(c => c.text));

        if (!qdrantCollectionReady && embeddings.length > 0 && embeddings[0].vector) {
            await ensureCollection(embeddings[0].vector.length, collection);
            qdrantCollectionReady = true;
        }

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
                payload: source.getQdrantPayload(doc, { text: e.text, index: e.index }, chunks.length, {}),
            }));

        allPoints.push(...points);

        // ── Flush a Qdrant cada FLUSH_SIZE vectores
        if (allPoints.length >= FLUSH_SIZE) {
            await upsertPoints(allPoints, collection);
            inserted += allPoints.length;
            console.log(`   🔮 ${inserted} vectores insertados | ${skipped} saltados | (${i + 1}/${rows.length} docs)`);
            allPoints = [];
        }
    }

    // ── Flush final
    if (allPoints.length > 0) {
        await upsertPoints(allPoints, collection);
        inserted += allPoints.length;
    }

    console.log(`\n✅ Sync completado: ${inserted} vectores insertados, ${skipped} docs saltados`);
    return inserted;
}

module.exports = { runPipeline, runQdrantOnly, reinsertToQdrant };