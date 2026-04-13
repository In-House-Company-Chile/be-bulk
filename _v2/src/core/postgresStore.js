const { Pool } = require('pg');
const config = require('../config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      host: config.postgres.host,
      port: config.postgres.port,
      user: config.postgres.user,
      password: config.postgres.password,
      database: config.postgres.database,
      max: 5,
      idleTimeoutMillis: 30000,
    });
    pool.on('error', (err) => {
      console.error('[PostgreSQL] Pool error:', err.message);
    });
  }
  return pool;
}

async function upsertDocument(doc) {
  const db = getPool();

  const query = `
        INSERT INTO public.documents (id, collection, filename, file_path, content, metadata, file_size, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW(), NOW())
        ON CONFLICT (id, collection)
        DO UPDATE SET
            filename   = EXCLUDED.filename,
            file_path  = EXCLUDED.file_path,
            content    = EXCLUDED.content,
            metadata   = EXCLUDED.metadata,
            file_size  = EXCLUDED.file_size,
            updated_at = NOW()
    `;

  await db.query(query, [
    doc.id,
    doc.collection,
    doc.filename,
    doc.filePath,
    JSON.stringify(doc.content),
    JSON.stringify(doc.metadata),
    doc.fileSize,
  ]);

  console.log(`[PostgreSQL] Upserted document: ${doc.id} in ${doc.collection}`);
}

async function documentExists(id, collection) {
  const db = getPool();
  const res = await db.query(
    `SELECT 1 FROM public.documents WHERE id = $1 AND collection = $2`,
    [id, collection]
  );
  return res.rowCount > 0;
}

async function getDocument(id, collection) {
  const db = getPool();
  const res = await db.query(
    `SELECT * FROM public.documents WHERE id = $1 AND collection = $2`,
    [id, collection]
  );
  return res.rows[0] || null;
}

async function getDocumentsByEdition(edition, collection) {
  const db = getPool();
  const res = await db.query(
    `SELECT * FROM public.documents
         WHERE metadata->>'edicion' = $1 AND collection = $2`,
    [edition, collection]
  );
  return res.rows;
}

async function getAllDocuments(collection) {
  const db = getPool();
  const res = await db.query(
    `SELECT id, content, metadata FROM public.documents WHERE collection = $1 ORDER BY created_at ASC`,
    [collection]
  );
  return res.rows;
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('[PostgreSQL] Pool closed');
  }
}

module.exports = { getPool, upsertDocument, documentExists, getDocument, getDocumentsByEdition, getAllDocuments, closePool };