const axios = require('axios');
const pdfParse = require('pdf-parse');

/**
 * Descarga un PDF desde una URL y extrae su texto.
 * Incluye reintentos y timeout extendido para servidores lentos.
 *
 * @param {string} pdfUrl - URL del PDF
 * @param {object} opts
 * @param {number} opts.maxRetries - Intentos máximos (default: 3)
 * @param {number} opts.timeout - Timeout en ms (default: 120000)
 * @returns {Promise<{text: string, pages: number, fileSize: number}>}
 */
async function extractTextFromPdf(pdfUrl, opts = {}) {
  const maxRetries = opts.maxRetries || 3;
  const timeout = opts.timeout || 120000;

  let lastError;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`[PDF] Downloading (attempt ${attempt}/${maxRetries}): ${pdfUrl}`);

      const response = await axios.get(pdfUrl, {
        responseType: 'arraybuffer',
        timeout,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/pdf,*/*',
          'Accept-Language': 'es-CL,es;q=0.9',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        },
        // Desactivar proxy si hay problemas de red
        proxy: false,
        // Permitir redirects
        maxRedirects: 5,
      });

      const buffer = Buffer.from(response.data);
      const fileSize = buffer.length;

      console.log(`[PDF] Downloaded ${(fileSize / 1024).toFixed(1)} KB, parsing...`);

      const pdf = await pdfParse(buffer);
      const cleanText = cleanPdfText(pdf.text);

      console.log(`[PDF] Extracted ${cleanText.length} chars from ${pdf.numpages} pages`);

      return {
        text: cleanText,
        rawText: pdf.text,
        pages: pdf.numpages,
        fileSize,
      };
    } catch (err) {
      lastError = err;
      const isTimeout = err.code === 'ECONNABORTED' || err.message.includes('timeout');
      const isNetwork = err.code === 'ECONNRESET' || err.code === 'ENOTFOUND' || err.code === 'ECONNREFUSED';

      console.warn(`[PDF] Attempt ${attempt} failed: ${err.message}`);

      if (attempt < maxRetries && (isTimeout || isNetwork)) {
        const delay = attempt * 5000; // 5s, 10s, 15s backoff
        console.log(`[PDF] Retrying in ${delay / 1000}s...`);
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${lastError.message}`);
}

/**
 * Limpia el texto extraído de un PDF
 */
function cleanPdfText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map(line => line.trim())
    .join('\n')
    .replace(/DIARIO OFICIAL DE LA REPÚBLICA DE CHILE\n?/gi, '')
    .replace(/Núm\.\s*\d+[\.\d]*\s*/g, '')
    .replace(/CVE\s*\d+/gi, '')
    .trim();
}

module.exports = { extractTextFromPdf };