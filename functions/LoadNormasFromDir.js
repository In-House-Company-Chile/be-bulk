const fs = require('fs');
const path = require('path');

class LoadNormasFromDir {
    constructor(filePath) {
        this.filePath = filePath
    }

    static create(filePath) {
        return new LoadNormasFromDir(filePath).extract()
    }

    updateFacets(normas) {
        const facetsFilePath = 'facets.json';

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
        console.log('facets.json actualizado correctamente.');
    }


    async extract() {
        try {
            const files = fs.readdirSync(this.filePath).filter(file => file.endsWith('.json'));
            const normas = [];

            for (const file of files) {
                const filePath = path.join(this.filePath, file);
                const jsonData = fs.readFileSync(filePath, 'utf8');

                try {
                    const parsedJson = JSON.parse(jsonData);
                    normas.push({
                        id: parsedJson.idNorm || '',
                        fecha_publicacion: parsedJson.data.metadatos.fecha_publicacion || '',
                        fecha_promulgacion: parsedJson.data.metadatos.fecha_promulgacion || '',
                        compuesto: parsedJson.data.metadatos.tipos_numeros || [],
                        titulo_norma: parsedJson.data.metadatos.titulo_norma || '',
                        organismos: parsedJson.data.metadatos.organismos || [],
                        fuente: parsedJson.data.metadatos.fuente || '',
                        inicio_vigencia: parsedJson.data.metadatos.inicio_vigencia || '',
                        fin_vigencia: parsedJson.data.metadatos.fin_vigencia || '',
                        tipo_version_s: parsedJson.data.metadatos.tipo_version_s || '',
                        planeText: parsedJson.planeText || '',
                    });

                    // Mover archivo a la carpeta 'processed'
                    const processedDir = 'C:/Users/ljutr/Desktop/Norms/vm';
                    if (!fs.existsSync(processedDir)) {
                        fs.mkdirSync(processedDir);
                    }

                    const processedFilePath = path.join(processedDir, file);
                    fs.renameSync(filePath, processedFilePath);
                    console.log("🚀 ~ Archivo movido a 'processed':", processedFilePath);
                } catch (error) {
                    console.error(`Error al procesar ${file}:`, error);
                }
            }

            // Llamar a la función updateFacets para actualizar facets.json
            this.updateFacets(normas);

            return normas;

        } catch (e) {
            console.error("🚨 Error general en LoadNormasFromDir():", e.message);
            throw new Error("Error al ejecutar la función LoadNormasFromDir()");
        }
    }
}

module.exports = LoadNormasFromDir