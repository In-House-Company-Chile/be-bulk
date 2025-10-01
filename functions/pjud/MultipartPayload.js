class MultipartPayload {
    constructor(token, idBuscador, elementPerPage, page) {
        this.token = token;
        this.idBuscador = idBuscador;
        this.elementPerPage = elementPerPage;
        this.page = page;
    }

    static async create(token, idBuscador, elementPerPage, page) {
        return await new MultipartPayload(token, idBuscador, elementPerPage, page).createMultipartPayload();
    }

    async createMultipartPayload() {
        const boundary = '----WebKitFormBoundaryIoELJGS1wrKuLwTC';
        const filtros = JSON.stringify({
            "rol": "",
            "era": "",
            "fec_desde": "",
            "fec_hasta": "",
            "tipo_norma": "",
            "num_norma": "",
            "num_art": "",
            "num_inciso": "",
            "todas": "",
            "algunas": "",
            "excluir": "",
            "literal": "",
            "proximidad": "",
            "distancia": "",
            "analisis_s": "11",
            "submaterias": "",
            "facetas_seleccionadas": "",
            "filtros_omnibox": [{ "categoria": "TEXTO", "valores": [""] }],
            "ids_comunas_seleccionadas_mapa": []
        });
    
        return [
            `--${boundary}`,
            'Content-Disposition: form-data; name="_token"',
            '',
            this.token,
            `--${boundary}`,
            'Content-Disposition: form-data; name="id_buscador"',
            '',
            this.idBuscador,
            `--${boundary}`,
            'Content-Disposition: form-data; name="filtros"',
            '',
            filtros,
            `--${boundary}`,
            'Content-Disposition: form-data; name="numero_filas_paginacion"',
            '',
            this.elementPerPage.toString(),
            `--${boundary}`,
            'Content-Disposition: form-data; name="offset_paginacion"',
            '',
            this.page.toString(),
            `--${boundary}`,
            'Content-Disposition: form-data; name="orden"',
            '',
            'rel',
            `--${boundary}--`
        ].join('\r\n');
    }
}

module.exports = MultipartPayload;