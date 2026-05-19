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
        try {
            return JSON.parse(fs.readFileSync(FAILED_LOG_FILE, 'utf-8'));
        } catch (e) {
            return { updated_at: null, failed: [] };
        }
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
    fs.mkdirSync(path.dirname(FAILED_LOG_FILE), { recursive: true });
    fs.writeFileSync(FAILED_LOG_FILE, JSON.stringify(log, null, 2));
}

// ─── Pipeline principal ───────────────────────────────────────────────────────

/**
 * Ejecuta el flujo completo de ingestión: PDF -> Texto -> Chunks -> Embeddings -> PG -> Qdrant
 */
async function runPipeline(source, documents, params, opts = {}) {
    const { skipExisting = true, onPgDone, skipQdrant = false } = opts;
    const collection = source.collection;

    let qdrantCollectionReady = false;
    let totalChunks = 0;
    let totalVectors = 0;
    let processed = 0;
    let skipped = 0;
    let failed = 0;
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 10;

    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];

        // ── Normalización de ID 
        const originalId = doc.id;
        // Si hay edición, creamos ID compuesto para evitar colisiones (ej: 123-44415-B)
        const finalId = params.edition ? `${originalId}-${params.edition}` : originalId;
        doc.id = finalId;

        // Preservamos el ID original (CVE) en metadata si el documento tiene el campo
        if (doc.metadata) {
            doc.metadata.cve = originalId;
        }

        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📄 Procesando ${i + 1}/${documents.length}: ${doc.id}`);
        console.log(`   ${(doc.title || '').slice(0, 80)}`);
        console.log(`${'─'.repeat(50)}`);

        // ── Verificación de duplicados en PostgreSQL
        if (skipExisting) {
            const exists = await documentExists(doc.id, collection);
            if (exists) {
                console.log(`⏭️  Ya existe en PostgreSQL, saltando...`);
                skipped++;
                continue;
            }
        }

        // ── Obtención de texto (PDF o Directo)
        let text = "";
        let pages = 0;
        let fileSize = 0;

        try {
            if (doc.pdfUrl) {
                console.log('📥 Extrayendo texto del PDF...');
                const pdfData = await extractTextFromPdf(doc.pdfUrl);
                text = pdfData.text;
                pages = pdfData.pages;
                fileSize = pdfData.fileSize;
            } else if (doc.text) {
                text = doc.text;
                fileSize = Buffer.byteLength(text, 'utf-8');
            }

            if (!text || text.length < 50) {
                throw new Error(`Texto extraído insuficiente o vacío (${text?.length || 0} caracteres)`);
            }

            consecutiveErrors = 0; // Reset si logramos extraer texto
        } catch (err) {
            console.error(`❌ Error en extracción: ${err.message}`);
            saveFailedDoc(doc.id, collection, doc.pdfUrl || 'N/A', params.edition, params.section, err.message);

            failed++;
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                throw new Error(`Circuit breaker: ${MAX_CONSECUTIVE_ERRORS} errores consecutivos. Deteniendo pipeline.`);
            }
            continue; // Saltar al siguiente documento de forma segura
        }

        // ── Fragmentación (Chunking)
        console.log('✂️  Dividiendo en fragmentos...');
        const chunks = chunkText(text);
        totalChunks += chunks.length;

        // ── Generación de Embeddings e Inserción Vectorial
        let points = [];
        if (!skipQdrant) {
            console.log('🧠 Generando embeddings...');
            try {
                const embeddings = await getEmbeddingsBatch(chunks.map(c => c.text));

                if (!qdrantCollectionReady && embeddings.length > 0 && embeddings[0].vector) {
                    await ensureCollection(embeddings[0].vector.length, collection);
                    qdrantCollectionReady = true;
                }

                points = embeddings
                    .filter(e => e.vector !== null)
                    .map(e => ({
                        id: generatePointId(doc.id, e.index),
                        vector: e.vector,
                        payload: source.getQdrantPayload(doc, { text: e.text, index: e.index }, chunks.length, params),
                    }));
            } catch (err) {
                console.error(`⚠️ Error en vectores: ${err.message}. El documento se guardará solo en PG.`);
            }
        } else {
            console.log('⏭️  Saltando Qdrant (--only-psql activo)');
        }

        // ── Persistencia en PostgreSQL
        console.log('💾 Guardando en PostgreSQL...');
        try {
            const pgMetadata = source.getPostgresMetadata ?
                source.getPostgresMetadata(doc, params) :
                { ...doc.metadata, title: doc.title, organism: doc.organism };

            await upsertDocument({
                id: doc.id,
                collection,
                filename: doc.filename || (doc.pdfUrl ? `${originalId}.pdf` : `${originalId}.txt`),
                filePath: doc.pdfUrl || null,
                content: {
                    ...(doc.rawJson || {}),
                    fullText: text,
                    chunks: chunks.map((c, idx) => ({
                        index: idx,
                        text: c.text,
                        startChar: c.startChar,
                        endChar: c.endChar,
                    })),
                    extractionInfo: { pages, totalChars: text.length, totalChunks: chunks.length },
                },
                metadata: pgMetadata,
                fileSize,
            });

            if (onPgDone) {
                onPgDone({ processed: 1, skipped: 0, totalChunks: chunks.length });
            }
        } catch (err) {
            console.error(`❌ Error crítico guardando en PostgreSQL: ${err.message}`);
            failed++;
            continue;
        }

        // ── Persistencia en Qdrant (Upsert por documento para evitar pérdidas)
        if (points.length > 0 && !skipQdrant) {
            console.log(`🔮 Guardando ${points.length} vectores en Qdrant...`);
            try {
                await upsertPoints(points, collection);
                totalVectors += points.length;
            } catch (err) {
                console.error(`❌ Error guardando en Qdrant: ${err.message}`);
            }
        }

        processed++;
        console.log(`✅ Finalizado ${doc.id}: ${chunks.length} chunks`);
    }

    return { processed, skipped, failed, totalChunks, totalVectors };
}

// ─── Otras utilidades (Sync / Recovery) ──────────────────────────────────────

async function reinsertToQdrant(source, rows) {
    const collection = source.collection;
    let batchPoints = [];
    let qdrantCollectionReady = false;
    let skipped = 0;
    let inserted = 0;
    const FLUSH_SIZE = 100;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const chunks = row.content?.chunks || [];
        if (chunks.length === 0) continue;

        // Verificar si ya existe para evitar re-procesar
        const firstPointId = generatePointId(row.id, 0);
        const exists = await pointExists(collection, firstPointId);
        if (exists) {
            skipped++;
            continue;
        }

        try {
            const embeddings = await getEmbeddingsBatch(chunks.map(c => c.text));
            if (!qdrantCollectionReady && embeddings.length > 0) {
                await ensureCollection(embeddings[0].vector.length, collection);
                qdrantCollectionReady = true;
            }

            const doc = {
                id: row.id,
                title: row.metadata?.title || '',
                organism: row.metadata?.organism || '',
                metadata: row.metadata || {},
            };

            const dummyParams = { section: row.metadata?.seccion || 'recovery', edition: row.metadata?.edicion || 'bulk' };

            const points = embeddings
                .filter(e => e.vector !== null)
                .map(e => ({
                    id: generatePointId(row.id, e.index),
                    vector: e.vector,
                    payload: source.getQdrantPayload(doc, { text: e.text, index: e.index }, chunks.length, dummyParams),
                }));

            batchPoints.push(...points);

            if (batchPoints.length >= FLUSH_SIZE) {
                await upsertPoints(batchPoints, collection);
                inserted += batchPoints.length;
                batchPoints = [];
                console.log(`   🔮 ${inserted} vectores sincronizados...`);
            }
        } catch (err) {
            console.error(`❌ Error sincronizando ${row.id}: ${err.message}`);
        }
    }

    if (batchPoints.length > 0) {
        await upsertPoints(batchPoints, collection);
        inserted += batchPoints.length;
    }

    return inserted;
}

module.exports = { runPipeline, reinsertToQdrant };