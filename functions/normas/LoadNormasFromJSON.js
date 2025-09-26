const fs = require('fs');
const path = require('path');

class LoadNormasFromJSON {
    constructor(doc, filePath) {
        this.doc = doc;
        this.filePath = filePath
    }

    static create(doc, filePath) {
        return new LoadNormasFromJSON(doc, filePath).extract()
    }

    updateFacets(normas) {
        const facetsFilePath = 'facets/facets.json';

        // Si facets.json no existe, crear uno vacío
        let facets = {};
        if (fs.existsSync(facetsFilePath)) {
            const facetsData = fs.readFileSync(facetsFilePath, 'utf8');
            facets = JSON.parse(facetsData);
        }

        // Actualizar los valores en facets
        facets.id = [...new Set([...facets.id || [], ...normas.map(n => n.id)])];
        facets.fecha_publicacion = [...new Set([...facets.fecha_publicacion || [], ...normas.map(n => n.fecha_publicacion)])];
        facets.fecha_promulgacion = [...new Set([...facets.fecha_promulgacion || [], ...normas.map(n => n.fecha_promulgacion)])];
        facets.compuesto = [...new Set([...facets.compuesto || [], ...normas.map(n => n.compuesto.map(e => e.compuesto)).flat()])];
        facets.titulo_norma = [...new Set([...facets.titulo_norma || [], ...normas.map(n => n.titulo_norma)])];
        facets.organismos = [...new Set([...facets.organismos || [], ...normas.map(n => n.organismos).flat()])];
        facets.fuente = [...new Set([...facets.fuente || [], ...normas.map(n => n.fuente)])];
        facets.inicio_vigencia = [...new Set([...facets.inicio_vigencia || [], ...normas.map(n => n.inicio_vigencia)])];
        facets.fin_vigencia = [...new Set([...facets.fin_vigencia || [], ...normas.map(n => n.fin_vigencia)])];
        facets.tipo_version_s = [...new Set([...facets.tipo_version_s || [], ...normas.map(n => n.tipo_version_s)])];

        // Guardar el archivo facets.json actualizado
        fs.writeFileSync(facetsFilePath, JSON.stringify(facets, null, 2), 'utf8');
    }


    async extract() {
        const normas = [];

        try {
            normas.push({
                id: this.doc.idNorm || '',
                fecha_publicacion: this.doc.data.metadatos.fecha_publicacion || '',
                fecha_promulgacion: this.doc.data.metadatos.fecha_promulgacion || '',
                compuesto: this.doc.data.metadatos.tipos_numeros || [],
                titulo_norma: this.doc.data.metadatos.titulo_norma || '',
                organismos: this.doc.data.metadatos.organismos || [],
                fuente: this.doc.data.metadatos.fuente || '',
                inicio_vigencia: this.doc.data.metadatos.vigencia.inicio_vigencia || '',
                fin_vigencia: this.doc.data.metadatos.vigencia.fin_vigencia || '',
                tipo_version_s: this.doc.data.metadatos.tipo_version_s || '',
                planeText: this.doc.planeText || '',
            });

            this.updateFacets(normas);
            console.log(`✅ Normas extraídas y facets actualizados: ${this.doc.idNorm}`);
        } catch (e) {
            console.error("🚨 Error general en LoadNormasFromJSON():", e.message);
            throw new Error("Error al ejecutar la función LoadNormasFromJSON()");
        }
    }
}

module.exports = LoadNormasFromJSON