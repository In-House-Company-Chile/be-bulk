const { extractTextFromPdf } = require('./core/pdfExtractor');
const { chunkText } = require('./core/chunker');
const { getEmbeddingsBatch } = require('./core/embeddings');
const { upsertDocument, documentExists } = require('./core/postgresStore');
const { ensureCollection, upsertPoints, generatePointId } = require('./core/qdrantStore');

async function runPipeline(source, documents, params, opts = {}) {
    const { skipExisting = true } = opts;
    const collection = source.collection;
    let qdrantCollectionReady = false;
    let allQdrantPoints = [];
    let totalChunks = 0;
    let processed = 0;
    let skipped = 0;

    for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        console.log(`\n${'─'.repeat(50)}`);
        console.log(`📄 Procesando ${i + 1}/${documents.length}: ${doc.id}`);
        console.log(`   ${doc.title.slice(0, 80)}`);
        console.log(`${'─'.repeat(50)}`);

        if (skipExisting) {
            const exists = await documentExists(doc.id, collection);
            if (exists) {
                console.log(`⏭️  Ya existe en PostgreSQL, saltando...`);
                skipped++;
                continue;
            }
        }

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

        console.log('\n✂️  Dividiendo en chunks...');
        const chunks = chunkText(text);
        totalChunks += chunks.length;

        console.log('\n🧠 Generando embeddings...');
        const chunkTexts = chunks.map(c => c.text);
        const embeddings = await getEmbeddingsBatch(chunkTexts);

        // Asegurar colección con el collection dinámico del source
        if (!qdrantCollectionReady && embeddings.length > 0 && embeddings[0].vector) {
            await ensureCollection(embeddings[0].vector.length, collection);
            qdrantCollectionReady = true;
        }

        console.log('\n💾 Guardando en PostgreSQL...');
        await upsertDocument({
            id: doc.id,
            collection,
            filename: doc.pdfUrl ? `${doc.id}.pdf` : `${doc.id}.txt`,
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

    // Batch upsert con el collection dinámico del source
    if (allQdrantPoints.length > 0) {
        console.log(`\n🔮 Guardando ${allQdrantPoints.length} vectores en Qdrant...`);
        await upsertPoints(allQdrantPoints, collection);
    }

    return { processed, skipped, totalChunks, totalVectors: allQdrantPoints.length };
}

module.exports = { runPipeline };