const axios = require('axios');
const cheerio = require('cheerio');
const config = require('./config');

/**
 * Scrape la sección "Normas Generales" del Diario Oficial
 * @param {string} date - Fecha en formato DD-MM-YYYY
 * @param {string} edition - Número de edición
 * @returns {Promise<Array<{title: string, cve: string, pdfUrl: string, organism: string}>>}
 */
async function scrapeNormasGenerales(date, edition) {
  const url = `${config.scraper.baseUrl}/edicionelectronica/index.php?date=${date}&edition=${edition}`;
  console.log(`[Scraper] Fetching: ${url}`);

  const { data: html } = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; DOScraper/1.0)',
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'es-CL,es;q=0.9',
    },
    timeout: 30000,
  });

  const $ = cheerio.load(html);
  const documents = [];
  let currentOrganism = '';

  // La estructura del HTML es una tabla con filas que alternan entre
  // encabezados de organismo y filas con links a PDFs
  // Recorremos todas las tablas dentro de section
  $('section table').each((_, table) => {
    $(table).find('tr').each((_, row) => {
      const cells = $(row).find('td');

      // Detectar encabezados de organismo (filas con una sola celda en bold o con clase especial)
      if (cells.length === 1) {
        const text = $(cells[0]).text().trim();
        if (text && text.length > 0) {
          currentOrganism = text;
        }
        return;
      }

      // Buscar filas con links a PDF
      const link = $(row).find('a[href*=".pdf"]');
      if (link.length > 0) {
        const href = link.attr('href');
        const linkText = link.text().trim();

        // Extraer CVE del texto del link o de la URL
        const cveMatch = href.match(/(\d+)\.pdf$/) || linkText.match(/CVE[- ]?(\d+)/i);
        const cve = cveMatch ? cveMatch[1] : null;

        // El título del documento está en la celda anterior al link
        const titleCell = cells.length >= 2 ? $(cells[0]).text().trim() : linkText;

        if (cve && href) {
          const pdfUrl = href.startsWith('http') ? href : `${config.scraper.baseUrl}${href}`;
          documents.push({
            title: titleCell,
            cve,
            pdfUrl,
            organism: currentOrganism,
            linkText,
          });
        }
      }
    });
  });

  console.log(`[Scraper] Found ${documents.length} documents`);
  return documents;
}

/**
 * Scrape otras secciones si se necesita en el futuro
 */
async function scrapeSection(date, edition, section) {
  const sectionMap = {
    'normas_generales': 'index.php',
    'normas_particulares': 'normas_particulares.php',
    'publicaciones_judiciales': 'publicaciones_judiciales.php',
    'avisos_destacados': 'avisos_destacados.php',
    'empresas_cooperativas': 'empresas_cooperativas.php',
    'marcas_patentes': 'marcas_patentes.php',
  };

  const page = sectionMap[section] || 'index.php';
  const url = `${config.scraper.baseUrl}/edicionelectronica/${page}?date=${date}&edition=${edition}`;

  console.log(`[Scraper] Fetching section "${section}": ${url}`);
  const { data: html } = await axios.get(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; DOScraper/1.0)' },
    timeout: 30000,
  });

  const $ = cheerio.load(html);
  const documents = [];
  let currentOrganism = '';

  $('section table').each((_, table) => {
    $(table).find('tr').each((_, row) => {
      const cells = $(row).find('td');

      if (cells.length === 1) {
        const text = $(cells[0]).text().trim();
        if (text) currentOrganism = text;
        return;
      }

      const link = $(row).find('a[href*=".pdf"]');
      if (link.length > 0) {
        const href = link.attr('href');
        const linkText = link.text().trim();
        const cveMatch = href.match(/(\d+)\.pdf$/) || linkText.match(/CVE[- ]?(\d+)/i);
        const cve = cveMatch ? cveMatch[1] : null;
        const titleCell = cells.length >= 2 ? $(cells[0]).text().trim() : linkText;

        if (cve && href) {
          const pdfUrl = href.startsWith('http') ? href : `${config.scraper.baseUrl}${href}`;
          documents.push({ title: titleCell, cve, pdfUrl, organism: currentOrganism, linkText });
        }
      }
    });
  });

  console.log(`[Scraper] Section "${section}": found ${documents.length} documents`);
  return documents;
}

module.exports = { scrapeNormasGenerales, scrapeSection };