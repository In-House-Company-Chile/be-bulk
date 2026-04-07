const axios = require('axios');
const config = require('./config');

/**
 * Genera embedding para un texto individual.
 * El endpoint retorna [[0.003, -0.010, ...]] (array de arrays).
 *
 * @param {string} text - Texto a vectorizar
 * @returns {Promise<number[]>} Vector de embeddings
 */
async function getEmbedding(text) {
  const response = await axios.post(
    config.embedding.apiUrl,
    { inputs: text },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );

  // El response es [[float, float, ...]] → tomamos el primer array
  const vectors = response.data;

  if (Array.isArray(vectors) && Array.isArray(vectors[0])) {
    return vectors[0];
  }

  // Fallback: si el formato cambia
  if (Array.isArray(vectors)) {
    return vectors;
  }

  throw new Error(`[Embeddings] Unexpected response format: ${JSON.stringify(vectors).slice(0, 200)}`);
}

/**
 * Genera embeddings para múltiples textos con rate limiting.
 *
 * @param {string[]} texts - Array de textos
 * @param {object} opts
 * @param {number} opts.batchDelay - Delay en ms entre requests (default: 200)
 * @returns {Promise<Array<{text: string, vector: number[], index: number}>>}
 */
async function getEmbeddingsBatch(texts, opts = {}) {
  const batchDelay = opts.batchDelay || 200;
  const results = [];

  console.log(`[Embeddings] Generating embeddings for ${texts.length} chunks...`);

  for (let i = 0; i < texts.length; i++) {
    try {
      const vector = await getEmbedding(texts[i]);
      results.push({ text: texts[i], vector, index: i });

      if (i === 0) {
        console.log(`[Embeddings] Vector dimension: ${vector.length}`);
      }

      // Progress log cada 10 chunks
      if ((i + 1) % 10 === 0 || i === texts.length - 1) {
        console.log(`[Embeddings] Progress: ${i + 1}/${texts.length}`);
      }

      // Rate limiting
      if (i < texts.length - 1) {
        await sleep(batchDelay);
      }
    } catch (err) {
      console.error(`[Embeddings] Error on chunk ${i}: ${err.message}`);
      // Retry una vez
      try {
        await sleep(1000);
        const vector = await getEmbedding(texts[i]);
        results.push({ text: texts[i], vector, index: i });
      } catch (retryErr) {
        console.error(`[Embeddings] Retry failed for chunk ${i}: ${retryErr.message}`);
        results.push({ text: texts[i], vector: null, index: i, error: retryErr.message });
      }
    }
  }

  const successful = results.filter(r => r.vector !== null).length;
  console.log(`[Embeddings] Completed: ${successful}/${texts.length} successful`);
  return results;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

module.exports = { getEmbedding, getEmbeddingsBatch };