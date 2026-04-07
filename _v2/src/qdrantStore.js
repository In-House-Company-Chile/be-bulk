const axios = require('axios');
const { v4: uuidv4, v5: uuidv5 } = require('uuid');
const config = require('./config');

// Namespace UUID fijo para generar IDs determinísticos
const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

/**
 * Verifica que la colección existe en Qdrant. Si no, la crea.
 *
 * @param {number} vectorSize - Dimensión del vector de embeddings
 */
async function ensureCollection(vectorSize) {
  const url = `${config.qdrant.url}/collections/${config.qdrant.collection}`;

  try {
    const res = await axios.get(url, { timeout: 10000 });
    const info = res.data?.result;
    const existingSize = info?.config?.params?.vectors?.size || info?.config?.params?.vectors?.default?.size;

    console.log(`[Qdrant] Collection "${config.qdrant.collection}" exists (points: ${info?.points_count || 0}, vectors_size: ${existingSize || 'NOT CONFIGURED'})`);

    // Si la colección existe pero NO tiene vectores configurados, recrearla
    if (!existingSize) {
      console.warn(`[Qdrant] Collection has no vector config! Recreating...`);
      await axios.delete(url, { timeout: 10000 });
      console.log(`[Qdrant] Deleted broken collection`);

      await axios.put(url, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      console.log(`[Qdrant] Recreated with vector_size=${vectorSize}`);
    } else if (existingSize !== vectorSize) {
      throw new Error(`Vector size mismatch: collection has ${existingSize}, embeddings produce ${vectorSize}. Delete and recreate manually.`);
    }

    return true;
  } catch (err) {
    if (err.response?.status === 404) {
      console.log(`[Qdrant] Collection not found, creating with vector_size=${vectorSize}...`);
      await axios.put(url, {
        vectors: {
          size: vectorSize,
          distance: 'Cosine',
        },
      }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 10000,
      });
      console.log(`[Qdrant] Collection "${config.qdrant.collection}" created with vector_size=${vectorSize}`);
      return true;
    }
    throw err;
  }
}

/**
 * Inserta puntos (vectores + payload) en Qdrant.
 * Usa UUIDs determinísticos basados en CVE + chunk_index.
 *
 * @param {Array<{id: string, vector: number[], payload: object}>} points
 */
async function upsertPoints(points) {
  const url = `${config.qdrant.url}/collections/${config.qdrant.collection}/points`;
  const batchSize = 100;

  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);

    const body = {
      points: batch.map(p => ({
        id: p.id,
        vector: { "default": p.vector },
        payload: p.payload,
      })),
    };

    try {
      const res = await axios.put(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });

      console.log(`[Qdrant] Upserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} points) - status: ${res.data?.status || res.status}`);
    } catch (err) {
      const detail = err.response?.data || err.message;
      console.error(`[Qdrant] Error upserting batch: ${JSON.stringify(detail)}`);
      throw new Error(`Qdrant upsert failed: ${JSON.stringify(detail)}`);
    }
  }

  console.log(`[Qdrant] Total upserted: ${points.length} points`);
}

/**
 * Genera un UUID determinístico para Qdrant basado en CVE y chunk index.
 * Mismo CVE + chunk_index siempre genera el mismo UUID (idempotente).
 *
 * @param {string} cve - CVE del documento
 * @param {number} chunkIndex - Índice del chunk
 * @returns {string} UUID v5
 */
function generatePointId(cve, chunkIndex) {
  return uuidv5(`${cve}-chunk-${chunkIndex}`, NAMESPACE_UUID);
}

/**
 * Verifica puntos insertados (para diagnóstico)
 */
async function scrollPoints(limit = 10) {
  const url = `${config.qdrant.url}/collections/${config.qdrant.collection}/points/scroll`;

  try {
    const res = await axios.post(url, {
      limit,
      with_payload: true,
      with_vector: false,
    }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });

    const points = res.data?.result?.points || [];
    console.log(`[Qdrant] Scroll: found ${points.length} points`);
    points.forEach(p => {
      console.log(`  - id: ${p.id}, cve: ${p.payload?.cve}, chunk: ${p.payload?.chunk_index}`);
    });
    return points;
  } catch (err) {
    console.error(`[Qdrant] Scroll error: ${err.response?.data?.status?.error || err.message}`);
    return [];
  }
}

/**
 * Busca puntos similares
 */
async function search(vector, limit = 5) {
  const url = `${config.qdrant.url}/collections/${config.qdrant.collection}/points/search`;

  const res = await axios.post(url, {
    vector: { "name": "default", "vector": vector },
    limit,
    with_payload: true,
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });

  return res.data.result;
}

module.exports = { ensureCollection, upsertPoints, generatePointId, scrollPoints, search };