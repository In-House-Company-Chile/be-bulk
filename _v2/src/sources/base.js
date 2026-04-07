/**
 * Clase base que toda fuente de datos debe implementar.
 * Define el contrato que el pipeline genérico espera.
 */
class BaseSource {
    /**
     * @param {string} name - Nombre único de la fuente
     * @param {string} collection - Nombre de la colección en Qdrant/PostgreSQL
     */
    constructor(name, collection) {
        this.name = name;
        this.collection = collection;
    }

    /**
     * Scrape la fuente y retorna documentos crudos.
     * Cada fuente decide cómo obtener sus documentos (HTTP, API, filesystem, etc).
     *
     * @param {object} params - Parámetros específicos de la fuente (date, edition, query, etc)
     * @returns {Promise<Array<{
     *   id: string,           // ID único del documento (CVE, ROL, folio, etc)
     *   title: string,        // Título del documento
     *   pdfUrl: string,       // URL del PDF (o null si el texto viene directo)
     *   text: string|null,    // Texto directo (si no hay PDF)
     *   organism: string,     // Organismo/entidad emisora
     *   metadata: object      // Metadata adicional específica de la fuente
     * }>>}
     */
    async scrape(params) {
        throw new Error(`${this.name}: scrape() not implemented`);
    }

    /**
     * Genera la metadata que se guarda en PostgreSQL y Qdrant.
     * Puede ser overrideada para agregar campos específicos.
     *
     * @param {object} doc - Documento crudo del scrape
     * @param {object} params - Parámetros de la ejecución
     * @returns {object} Metadata para PostgreSQL
     */
    getPostgresMetadata(doc, params) {
        return {
            title: doc.title,
            organism: doc.organism,
            source: this.name,
            processedAt: new Date().toISOString(),
            ...doc.metadata,
        };
    }

    /**
     * Genera el payload para cada punto en Qdrant.
     * Puede ser overrideada para agregar campos específicos.
     *
     * @param {object} doc - Documento crudo
     * @param {object} chunk - Chunk de texto {text, index}
     * @param {number} totalChunks - Total de chunks del documento
     * @param {object} params - Parámetros de la ejecución
     * @returns {object} Payload para Qdrant
     */
    getQdrantPayload(doc, chunk, totalChunks, params) {
        return {
            texto: chunk.text,
            documento_id: doc.id,
            titulo: doc.title,
            organismo: doc.organism,
            fuente: this.name,
            chunk_index: chunk.index,
            total_chunks: totalChunks,
            ...doc.metadata,
        };
    }

    /**
     * Infiere un tema/categoría del documento.
     * Cada fuente puede tener su propia lógica de clasificación.
     *
     * @param {object} doc - Documento crudo
     * @returns {string} Tema inferido
     */
    inferTema(doc) {
        return 'general';
    }

    /**
     * Describe los parámetros que acepta esta fuente.
     * Usado para --help.
     */
    static getParamsHelp() {
        return 'No params defined';
    }
}

module.exports = BaseSource;