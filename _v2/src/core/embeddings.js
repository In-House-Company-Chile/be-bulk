const axios = require('axios');
const config = require('../config');

const RETRY_DELAYS = [2000, 5000, 15000, 30000]; // backoff para 502/timeout

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function getEmbedding(text) {
  const response = await axios.post(
    config.embedding.apiUrl,
    { inputs: text },
    { headers: { 'Content-Type': 'application/json' }, timeout: 30000 }
  );

  const vectors = response.data;
  if (Array.isArray(vectors) && Array.isArray(vectors[0])) return vectors[0];
  if (Array.isArray(vectors)) return vectors;
  throw new Error(`Unexpected response format: ${JSON.stringify(vectors).slice(0, 200)}`);
}

async function getEmbeddingWithRetry(text, index) {
  let lastErr;
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      return await getEmbedding(text);
    } catch (err) {
      lastErr = err;
      const is502 = err.response?.status === 502;
      const isTimeout = err.message?.includes('timeout');

      if (attempt < RETRY_DELAYS.length && (is502 || isTimeout)) {
        const wait = RETRY_DELAYS[attempt];
        console.warn(`[Embeddings] chunk ${index} → ${err.response?.status || 'timeout'}, reintentando en ${wait / 1000}s... (intento ${attempt + 1}/${RETRY_DELAYS.length})`);
        await sleep(wait);
      } else {
        break;
      }
    }
  }
  return null; // todos los reintentos fallaron
}

async function getEmbeddingsBatch(texts, opts = {}) {
  const batchDelay = opts.batchDelay || 200;
  const results = [];

  console.log(`[Embeddings] Generating embeddings for ${texts.length} chunks...`);

  for (let i = 0; i < texts.length; i++) {
    const vector = await getEmbeddingWithRetry(texts[i], i);

    if (vector) {
      results.push({ text: texts[i], vector, index: i });
      if (i === 0) console.log(`[Embeddings] Vector dimension: ${vector.length}`);
    } else {
      console.error(`[Embeddings] Failed chunk ${i} after all retries`);
      results.push({ text: texts[i], vector: null, index: i, error: 'all retries failed' });
    }

    if ((i + 1) % 10 === 0 || i === texts.length - 1) {
      console.log(`[Embeddings] Progress: ${i + 1}/${texts.length}`);
    }

    if (i < texts.length - 1) await sleep(batchDelay);
  }

  const successful = results.filter(r => r.vector !== null).length;
  console.log(`[Embeddings] Completed: ${successful}/${texts.length} successful`);
  return results;
}

module.exports = { getEmbedding, getEmbeddingsBatch };