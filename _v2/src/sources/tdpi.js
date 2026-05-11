const axios = require('axios');
const cheerio = require('cheerio');
const BaseSource = require('./base');
const config = require('../config');

// Colección específica para TDPI
const COLLECTION = config.qdrant.collection;
const API_URL = 'https://www.tdpi.cl/fallos-relevantes-de-patentes/';

class TdpiSource extends BaseSource {
    constructor() {
        // En el constructor de BaseSource, pasamos la colección de Qdrant
        super(COLLECTION, COLLECTION);
    }

    /**
     * Scrape del listado de fallos del TDPI
     */
    async scrape() {
        const response = await axios.get(API_URL, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            },
            timeout: 30000
        });

        const $ = cheerio.load(response.data);
        const documents = [];

        // Selector basado en el path proporcionado y estructura común de WP
        // Buscamos los enlaces que contienen ".pdf" dentro del área de contenido
        $('a[href$=".pdf"]').each((i, el) => {
            const $el = $(el);
            const text = $el.text().trim();
            const url = $el.attr('href');

            // Solo procesar si parece ser un fallo relevante (contiene ROL)
            if (text.toUpperCase().includes('ROL')) {
                documents.push(this._mapDocument(text, url, i));
            }
        });

        return documents;
    }

    /**
     * Mapeo de elemento HTML a estructura de documento del pipeline
     */
    _mapDocument(text, url, index) {
        // Regex para extraer ROL (ej: 1502-2024)
        const rolMatch = text.match(/ROL\s+TdPI\s+([\d-]+)/i);
        // Regex para extraer fecha (ej: 28-04-2026)
        const fechaMatch = text.match(/(\d{2}-\d{2}-\d{4})/);

        const rol = rolMatch ? rolMatch[1] : `ID-${index}`;
        const fecha = fechaMatch ? fechaMatch[1] : null;

        // Limpiar título eliminando espacios extra y NBSP
        const cleanTitle = text.replace(/\s+/g, ' ').trim();

        return {
            // ID compuesto para evitar colisiones
            id: `TDPI-${rol}`,
            title: cleanTitle,
            pdfUrl: url,
            text: null, // Se extrae en el pipeline vía pdfExtractor
            filename: `TDPI-${rol}.pdf`,
            organism: 'Tribunal de Propiedad Industrial',
            metadata: {
                rol: rol,
                fecha_elaboracion: fecha,
                fuente: 'tdpi',
                seccion: 'fallos-relevantes-patentes',
                original_text: text,
                tipo_documento: 'fallo'
            }
        };
    }

    /**
     * Formato de payload para Qdrant
     */
    getQdrantPayload(doc, chunk, totalChunks) {
        return {
            texto: chunk.text,
            tipo_documento: 'fallo_propiedad_industrial',
            doc_id: doc.id,
            rol: doc.metadata.rol,
            titulo: doc.title,
            organismo: doc.organism,
            fecha: doc.metadata.fecha_elaboracion,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            fuente: 'tdpi'
        };
    }

    // TDPI por ahora es una sola página de listado
    static getTotalPages() { return 1; }
}

module.exports = TdpiSource;