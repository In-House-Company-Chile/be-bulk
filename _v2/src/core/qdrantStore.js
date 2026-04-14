const axios = require('axios');
const { v5: uuidv5 } = require('uuid');
const config = require('../config');

const NAMESPACE_UUID = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function collectionUrl(collection) {
  return `${config.qdrant.url}/collections/${collection}`;
}

// Cache del tipo de vector por colección: true = named, false = plain
const namedVectorCache = {};

async function _isNamedVector(collection) {
  if (namedVectorCache[collection] !== undefined) return namedVectorCache[collection];
  const res = await axios.get(collectionUrl(collection), { timeout: 10000 });
  const params = res.data?.result?.config?.params?.vectors;
  // Named vectors tienen keys con objetos: { "default": { size, distance } }
  // Plain vectors son: { size, distance }
  const isNamed = params && typeof params.size === 'undefined';
  namedVectorCache[collection] = isNamed;
  return isNamed;
}

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

const QDRANT_RETRY_DELAYS = [5000, 15000, 30000];

async function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function upsertPoints(points, collection) {
  const url = `${collectionUrl(collection)}/points`;
  const batchSize = 100;
  const isNamed = await _isNamedVector(collection);

  for (let i = 0; i < points.length; i += batchSize) {
    const batch = points.slice(i, i + batchSize);
    const body = {
      points: batch.map(p => ({
        id: p.id,
        vector: isNamed ? { default: p.vector } : p.vector,
        payload: p.payload,
      })),
    };

    let lastErr;
    for (let attempt = 0; attempt <= QDRANT_RETRY_DELAYS.length; attempt++) {
      try {
        const res = await axios.put(url, body, {
          headers: { 'Content-Type': 'application/json' },
          timeout: 30000,
        });
        console.log(`[Qdrant] Upserted batch ${Math.floor(i / batchSize) + 1} (${batch.length} points) → "${collection}" - status: ${res.data?.status || res.status}`);
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const is502 = err.response?.status === 502;
        const isTimeout = err.message?.includes('timeout');
        if (attempt < QDRANT_RETRY_DELAYS.length && (is502 || isTimeout)) {
          const wait = QDRANT_RETRY_DELAYS[attempt];
          console.warn(`[Qdrant] Batch error (${err.response?.status || 'timeout'}), reintentando en ${wait / 1000}s...`);
          await _sleep(wait);
        } else {
          break;
        }
      }
    }

    if (lastErr) {
      const detail = lastErr.response?.data || lastErr.message;
      console.error(`[Qdrant] Error upserting batch after retries: ${JSON.stringify(detail)}`);
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
  const isNamed = await _isNamedVector(collection);

  const res = await axios.post(url, {
    vector: isNamed ? { name: 'default', vector } : vector,
    limit,
    with_payload: true,
  }, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });

  return res.data.result;
}

module.exports = { ensureCollection, upsertPoints, generatePointId, scrollPoints, search };