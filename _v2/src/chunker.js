const config = require('./config');

/**
 * Divide un texto en chunks con overlap para vectorización.
 * Intenta respetar límites de párrafo y oración.
 *
 * @param {string} text - Texto completo a dividir
 * @param {object} opts
 * @param {number} opts.chunkSize - Tamaño máximo en caracteres (default: config)
 * @param {number} opts.chunkOverlap - Overlap entre chunks (default: config)
 * @returns {Array<{text: string, index: number, startChar: number, endChar: number}>}
 */
function chunkText(text, opts = {}) {
  const chunkSize = opts.chunkSize || config.scraper.chunkSize;
  const chunkOverlap = opts.chunkOverlap || config.scraper.chunkOverlap;

  if (!text || text.length === 0) return [];
  if (text.length <= chunkSize) {
    return [{ text, index: 0, startChar: 0, endChar: text.length }];
  }

  const chunks = [];
  let start = 0;
  let idx = 0;

  while (start < text.length) {
    let end = Math.min(start + chunkSize, text.length);

    // Si no estamos al final, buscar un buen punto de corte
    if (end < text.length) {
      end = findBreakPoint(text, start, end);
    }

    const chunk = text.slice(start, end).trim();
    if (chunk.length > 0) {
      chunks.push({
        text: chunk,
        index: idx,
        startChar: start,
        endChar: end,
      });
      idx++;
    }

    // Avanzar con overlap
    start = end - chunkOverlap;
    if (start >= text.length) break;
    // Evitar loop infinito
    if (start <= chunks[chunks.length - 1]?.startChar) {
      start = end;
    }
  }

  console.log(`[Chunker] Split ${text.length} chars into ${chunks.length} chunks (size=${chunkSize}, overlap=${chunkOverlap})`);
  return chunks;
}

/**
 * Encuentra el mejor punto de corte cerca del final del chunk.
 * Prioridad: párrafo > punto seguido > punto y coma > coma > espacio
 */
function findBreakPoint(text, start, end) {
  const searchWindow = text.slice(Math.max(start, end - 200), end);
  const windowStart = Math.max(start, end - 200);

  // Intentar cortar en doble salto de línea (párrafo)
  const paraBreak = searchWindow.lastIndexOf('\n\n');
  if (paraBreak > 0) return windowStart + paraBreak + 2;

  // Intentar cortar después de un punto seguido de espacio o salto
  const sentenceBreak = searchWindow.search(/\.\s[A-ZÁÉÍÓÚÑa-z](?=[^.])/g);
  if (sentenceBreak === -1) {
    // Buscar el último punto seguido de espacio
    const lastDot = searchWindow.lastIndexOf('. ');
    if (lastDot > 0) return windowStart + lastDot + 2;
  }

  // Intentar cortar en salto de línea simple
  const lineBreak = searchWindow.lastIndexOf('\n');
  if (lineBreak > 0) return windowStart + lineBreak + 1;

  // Intentar cortar en punto y coma
  const semicolon = searchWindow.lastIndexOf('; ');
  if (semicolon > 0) return windowStart + semicolon + 2;

  // Último recurso: cortar en espacio
  const space = searchWindow.lastIndexOf(' ');
  if (space > 0) return windowStart + space + 1;

  return end;
}

module.exports = { chunkText };