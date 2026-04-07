const axios = require('axios');
const { v5: uuidv5 } = require('uuid');
const config = require('../config');

const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectionUrl(collection) {
  return `${config.qdrant.url}/collections/${collection}`;
}

// ─── ensureCollection ─────────────────────────────────────────────────────────

async function ensureCollection(vectorSize, collection) {
  const url = collectionUrl(collection);

  try {
    const res = await axios.get(url, { timeout: 10000 });
    const info = res.data?.result;
    const existingSize =
      info?.config?.params?.vectors?.size ||
      info?.config?.params?.vectors?.default?.size;

    console.log(`[Qdrant] Collection "${collection}" exists (points: ${info?.points_count || 0}, vectors_size: ${existingSize || 'NOT CONFIGURED'})`);

    if (!existingSize) {
      console.warn(`[Qdrant] Collection has no vector config! Recreating...`);
      await axios.delete(url, { timeout: 10000 });
      await _createCollection(url, collection, vectorSize);
    } else if (existingSize !== vectorSize) {
      throw new Error(
        `Vector size mismatch: collection has ${existingSize}, embeddings produce ${vectorSize}. Delete and recreate manually.`
      );
    }

    return true;
  } catch (err) {
    if (err.response?.status === 404) {
      console.log(`[Qdrant] Collection "${collection}" not found, creating...`);
      await _createCollection(url, collection, vectorSize);
      return true;
    }
    throw err;
  }
}

async function _createCollection(url, collection, vectorSize) {
  await axios.put(url, {
    vectors: { size: vectorSize, distance: 'Cosine' },
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });
  console.log(`[Qdrant] Collection "${collection}" created (vector_size=${vectorSize})`);
}

// ─── upsertPoints ─────────────────────────────────────────────────────────────

async function upsertPoints(points, collection) {
  const url = `${collectionUrl(collection)}/points`;
  const batchSize = 100;

  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);

    const body = {
      points: batch.map(p => ({
        id: p.id,
        vector: { default: p.vector },
        payload: p.payload,
      })),
    };

    try {
      const res = await axios.put(url, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000,
      });
      console.log(`[Qdrant] Upserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} points) → "${collection}" - status: ${res.data?.status || res.status}`);
    } catch (err) {
      const detail = err.response?.data || err.message;
      console.error(`[Qdrant] Error upserting batch: ${JSON.stringify(detail)}`);
      throw new Error(`Qdrant upsert failed: ${JSON.stringify(detail)}`);
    }
  }

  console.log(`[Qdrant] Total upserted: ${points.length} points → "${collection}"`);
}

// ─── generatePointId ──────────────────────────────────────────────────────────

function generatePointId(cve, chunkIndex) {
  return uuidv5(`${cve}-chunk-${chunkIndex}`, NAMESPACE_UUID);
}

// ─── scrollPoints ─────────────────────────────────────────────────────────────

async function scrollPoints(collection, limit = 10) {
  const url = `${collectionUrl(collection)}/points/scroll`;

  try {
    const res = await axios.post(url, { limit, with_payload: true, with_vector: false }, {
      headers: { 'Content-Type': 'application/json' },
      timeout: 10000,
    });
    const points = res.data?.result?.points || [];
    console.log(`[Qdrant] Scroll "${collection}": found ${points.length} points`);
    points.forEach(p => {
      console.log(`  - id: ${p.id}, cve: ${p.payload?.cve}, chunk: ${p.payload?.chunk_index}`);
    });
    return points;
  } catch (err) {
    console.error(`[Qdrant] Scroll error: ${err.response?.data?.status?.error || err.message}`);
    return [];
  }
}

// ─── search ───────────────────────────────────────────────────────────────────

async function search(vector, collection, limit = 5) {
  const url = `${collectionUrl(collection)}/points/search`;

  const res = await axios.post(url, {
    vector: { name: 'default', vector },
    limit,
    with_payload: true,
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });

  return res.data.result;
}

module.exports = { ensureCollection, upsertPoints, generatePointId, scrollPoints, search };