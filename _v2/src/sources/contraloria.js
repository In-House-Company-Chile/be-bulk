const axios = require('axios');
const BaseSource = require('./base');
const config = require('../config');

const COLLECTION = config.qdrant.collection;
const API_URL    = 'https://www.contraloria.cl/apibusca/search/dictamenes';
const PAGE_SIZE  = 10; // la API retorna 10 hits por página

class ContraloriaSource extends BaseSource {

    constructor() {
        super(COLLECTION, COLLECTION);
    }

    // ─── Scrape ───────────────────────────────────────────────────────────────
    // params: { page: number }
    // Retorna array de documentos con text directo (no hay PDF que descargar).

    async scrape({ page = 0 } = {}) {
        const response = await axios.post(
            API_URL,
            {
                search:       ' ',
                exact_search: false,
                options:      [],
                order:        'date',
                date_name:    'fecha_documento',
                source:       'dictamenes',
                page,
            },
            {
                headers: {
                    'Accept':       'application/json',
                    'Content-Type': 'application/json',
                },
                timeout: 30000,
            }
        );

        const hits = response.data?.hits?.hits ?? [];

        return hits.map(hit => this._mapHit(hit));
    }

    // ─── Mapeo de hit → documento ─────────────────────────────────────────────

    _mapHit(hit) {
        const s = hit._source;

        // texto principal para chunking + embeddings
        const text = [
            s.documento_completo_raw || s.documento_completo || '',
            s.materia_raw            || s.materia            || '',
            s.descriptores           || '',
            s.tema                   || '',
            s.fuentes_legales        || '',
        ]
            .filter(Boolean)
            .join('\n\n')
            .trim();

        return {
            id:       hit._id,                  // ej. "E123456"
            title:    s.materia || s.tema || hit._id,
            pdfUrl:   null,                     // texto viene directo en la API
            text:     text || null,
            organism: s.origen_?.trim() || s.origenes?.trim() || 'Contraloría General de la República',
            metadata: {
                n_dictamen:                 s.n_dictamen,
                doc_id:                     s.doc_id,
                numeric_doc_id:             s.numeric_doc_id,
                year_doc_id:                s.year_doc_id,
                fecha_documento:            s.fecha_documento,
                fecha_indexacion:           s.fecha_indexacion,
                materia:                    s.materia,
                materia_raw:                s.materia_raw,
                tema:                       s.tema,
                descriptores:               s.descriptores,
                fuentes_legales:            s.fuentes_legales,
                destinatarios:              s.destinatarios,
                abogados:                   s.abogados,
                criterio:                   s.criterio,
                caracter:                   s['carácter'],
                origen:                     s['origen_']?.trim(),
                origenes:                   s.origenes?.trim(),
                accion:                     s['acción'],
                is_accion:                  s.is_accion,
                confirmado:                 s.confirmado,
                aclarado:                   s.aclarado,
                complementado:              s.complementado,
                reconsiderado:              s.reconsiderado,
                reconsiderado_parcialmente: s.reconsiderado_parcialmente,
                aplicado:                   s.aplicado,
                alterado:                   s.alterado,
                reactivado:                 s.reactivado,
                nuevo:                      s.nuevo,
                relevante:                  s.relevante,
                boletin:                    s.boletin,
                old_url:                    s.old_url,
                tipo_documento:             'dictamen',
                fuente:                     'contraloria',
            },
        };
    }

    // ─── Qdrant payload ───────────────────────────────────────────────────────

    getQdrantPayload(doc, chunk, totalChunks) {
        return {
            texto:          chunk.text,
            tipo_documento: 'dictamen',
            doc_id:         doc.id,
            n_dictamen:     doc.metadata.n_dictamen,
            titulo:         doc.title,
            organismo:      doc.organism,
            fecha:          doc.metadata.fecha_documento,
            materia:        doc.metadata.materia,
            tema:           doc.metadata.tema,
            descriptores:   doc.metadata.descriptores,
            criterio:       doc.metadata.criterio,
            chunk_index:    chunk.index,
            total_chunks:   totalChunks,
        };
    }

    // ─── Tema inference ───────────────────────────────────────────────────────

    inferTema(doc) {
        const t = `${doc.title} ${doc.metadata.tema} ${doc.metadata.descriptores}`.toLowerCase();

        if (t.includes('municipalidad') || t.includes('municipal'))           return 'municipal';
        if (t.includes('contrato') || t.includes('licitación'))               return 'contratacion_publica';
        if (t.includes('funcionario') || t.includes('estatuto'))              return 'estatuto_administrativo';
        if (t.includes('previsión') || t.includes('pension') || t.includes('jubilación')) return 'prevision_social';
        if (t.includes('obra') || t.includes('infraestructura'))              return 'obras_publicas';
        if (t.includes('presupuesto') || t.includes('financiero') || t.includes('gasto')) return 'finanzas_publicas';
        if (t.includes('salud') || t.includes('sanitari'))                    return 'salud';
        if (t.includes('educación') || t.includes('educacion'))               return 'educacion';
        if (t.includes('medio ambiente') || t.includes('ambiental'))          return 'medioambiente';
        if (t.includes('tributari') || t.includes('impuesto'))                return 'tributario';
        if (t.includes('laboral') || t.includes('trabajo'))                   return 'laboral';
        if (t.includes('minería') || t.includes('mineria'))                   return 'mineria';
        if (t.includes('concesión') || t.includes('concesion'))               return 'concesiones';
        if (t.includes('recurso de protección') || t.includes('recurso proteccion')) return 'recurso_proteccion';

        return 'general';
    }

    // ─── Helpers ──────────────────────────────────────────────────────────────

    static getTotalPages() {
        return 500; // páginas 0–499
    }

    static getParamsHelp() {
        return '--page=N (0–499)';
    }
}

module.exports = ContraloriaSource;