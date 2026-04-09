const { Pool } = require('pg');
const { v4: uuidv4 } = require('uuid');
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

/**
 * Inserta o actualiza un documento en la tabla documents.
 * El ID es un UUID v4 random. La búsqueda de existencia se hace
 * por (cve, collection) via metadata->>'cve'.
 */
async function upsertDocument(doc) {
  const db = getPool();

  // Verificar si ya existe por CVE + collection (no por UUID)
  const existing = await db.query(
    `SELECT id FROM public.documents
         WHERE metadata->>'cve' = $1 AND collection = $2`,
    [doc.id, doc.collection]
  );

  const uuid = existing.rows[0]?.id || uuidv4();

  const query = `
        INSERT INTO public.documents (id, collection, filename, file_path, content, metadata, file_size, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, NOW(), NOW())
        ON CONFLICT (id)
        DO UPDATE SET
            filename   = EXCLUDED.filename,
            file_path  = EXCLUDED.file_path,
            content    = EXCLUDED.content,
            metadata   = EXCLUDED.metadata,
            file_size  = EXCLUDED.file_size,
            updated_at = NOW()
    `;

  const values = [
    uuid,
    doc.collection,
    doc.filename,
    doc.filePath,
    JSON.stringify(doc.content),
    JSON.stringify(doc.metadata),
    doc.fileSize,
  ];

  await db.query(query, values);
  console.log(`[PostgreSQL] Upserted document: ${doc.id} → ${uuid} in ${doc.collection}`);
}

/**
 * Verifica si un documento ya existe por CVE + collection.
 */
async function documentExists(id, collection) {
  const db = getPool();
  const res = await db.query(
    `SELECT 1 FROM public.documents
         WHERE metadata->>'cve' = $1 AND collection = $2`,
    [id, collection]
  );
  return res.rowCount > 0;
}

/**
 * Obtiene un documento por CVE + collection.
 */
async function getDocument(id, collection) {
  const db = getPool();
  const res = await db.query(
    `SELECT * FROM public.documents
         WHERE metadata->>'cve' = $1 AND collection = $2`,
    [id, collection]
  );
  return res.rows[0] || null;
}

/**
 * Cierra el pool de conexiones.
 */
/**
 * Obtiene todos los documentos de una edition + collection.
 * Usado por runQdrantOnly para recuperar chunks desde PG.
 */
async function getDocumentsByEdition(edition, collection) {
  const db = getPool();
  const res = await db.query(
    `SELECT * FROM public.documents
         WHERE metadata->>'edicion' = $1 AND collection = $2`,
    [edition, collection]
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

module.exports = { upsertDocument, documentExists, getDocument, getDocumentsByEdition, closePool };