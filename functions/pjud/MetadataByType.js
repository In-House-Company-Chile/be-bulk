class MetadataByType {
    constructor(data, tipoBase) {
        this.data = data;
        this.tipoBase = tipoBase;
    }

    static create(data, tipoBase) {
        return new MetadataByType(data, tipoBase).indexar();
    }

    indexar() {
        const jsonData = this.data;
        const baseMetadata = {
            idSentence: jsonData.id,
            base: this.tipoBase,
            url: jsonData.url_corta_acceso_sentencia || '',
        };

        switch (this.tipoBase.toLowerCase()) {
            case 'civil':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_sup_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    tribunal: jsonData.gls_juz_s || '',
                    juez: jsonData.gls_juez_ss || '',
                    materia: jsonData.gls_materia_s || '',
                };

            case 'penal':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_sup_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    tribunal: jsonData.gls_juz_s || '',
                    materia: jsonData.gls_materia_ss || [],
                    juez: jsonData.gls_juez_ss || [],
                    resultado: jsonData.sent__GLS_DECISION_s || '',
                };

            case 'familia':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_sup_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    tribunal: jsonData.gls_juz_s || '',
                    materia: jsonData.cod_materia_s || [],
                    juez: jsonData.gls_juez_ss || [],
                };

            case 'salud_corte_de_apelaciones':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_ape_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    corte: jsonData.gls_corte_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    sala: jsonData.gls_sala_sup_s || '',
                    resultado: jsonData.resultado_recurso_sup_s || '',
                    tematicaDeSalud: jsonData.tematica_ss || [],
                    era: jsonData.era_sup_i || 0,
                    isapre: jsonData.isapre_ss || [],
                };

            case 'salud_corte_suprema':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_sup_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    institucionesRecurridas: jsonData.organismo_ss || [],
                    tematicaDeSalud: jsonData.tematica_ss || [],
                    medicamento: jsonData.medicamento_ss || [],
                    enfermedad: jsonData.enfermedad_ss || [],
                    corte: jsonData.gls_corte_s || '',
                    resultado: jsonData.resultado_recurso_sup_s || '',
                    sala: jsonData.gls_sala_sup_s || '',
                    era: jsonData.era_sup_i || 0,
                    tipoRecurso: jsonData.gls_tip_recurso_sup_s || ''
                };

            case 'cobranza':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_sup_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    tribunal: jsonData.gls_juz_s || '',
                    juez: jsonData.gls_juez_ss || '',
                };

            case 'corte_suprema':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_sup_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    sala: jsonData.gls_sala_sup_s || '',
                    corte: jsonData.gls_corte_s || '',
                    era: jsonData.era_sup_i || 0,
                    categorizacion: jsonData.sent__categorizacion_s || '',
                    resultado: jsonData.resultado_recurso_sup_s || '',
                    redactor: jsonData.gls_relator_s || '',
                    ministro: jsonData.gls_ministro_ss || [],
                    tipoRecurso: jsonData.gls_tip_recurso_sup_s || '',
                    descriptores: jsonData.gls_descriptor_ss || [],
                    idNorm: jsonData.id_norma_ss || [],
                    articulo: jsonData.norma_articulo_ss || [],
                };

            case 'laboral':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_sup_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    era: jsonData.era_sup_i || 0,
                    categorizacion: jsonData.gls_materia_s || [],
                    tribunal: jsonData.gls_juz_s || '',
                    juez: jsonData.gls_juez_ss || '',
                };

            case 'corte_de_apelaciones':
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_ape_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: jsonData.fec_sentencia_sup_dt || '',
                    era: jsonData.era_sup_i || 0,
                    categorizacion: jsonData.gls_materia_s || '',
                    sala: jsonData.gls_sala_sup_s || '',
                    corte: jsonData.gls_corte_s || '',
                    resultado: jsonData.resultado_recurso_sup_s || '',
                    tipoRecurso: jsonData.tip_recurso_s || '',
                    juzgado: jsonData.gls_juz_s || '',
                };

            default:
                return {
                    ...baseMetadata,
                    rol: jsonData.rol_era_sup_s || '',
                    caratulado: jsonData.caratulado_s || '',
                    fechaSentencia: this.jsonData.fec_sentencia_sup_dt || '',
                    tribunal: this.jsonData.gls_juz_s || '',
                    juez: this.jsonData.gls_juez_ss || '',
                };
        }
    }


}

module.exports = MetadataByType;