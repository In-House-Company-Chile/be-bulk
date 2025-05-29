const LoadNormasFromJSON = require('./LoadNormasFromDir');
const LoadDocumentAi = require('./LoadDocumentAi');
const UploadDocumentAi = require('./UploadDocumentAi');
const DeleteDocumentAi = require('./DeleteDocumentAi');
const fs = require('fs');
const path = require('path');
const NormalizeWord = require('./NormalizeWord');

class UploadFiles {
    constructor(filePath, chunkSize = 800, extension = 'txt', namespace = 'pruebaNormas1', deleteBot = 'false') {
        this.filePath = filePath
        this.chunkSize = chunkSize;
        this.extension = extension;
        this.namespace = namespace;
        this.deleteBot = deleteBot;
    }

    static create(filePath, chunkSize = 800, extension = 'txt', namespace = 'pruebaNormas1', deleteBot = 'false') {
        return new UploadFiles(filePath, chunkSize, extension, namespace, deleteBot).extract()
    }

    async extract() {
        try {
            const normas = await LoadNormasFromJSON.create(this.filePath);

            // Asegurar que exista la carpeta 'filtred'
            if (!fs.existsSync('filtred')) {
                fs.mkdirSync('filtred');
            }

            for (const [index, item] of normas.entries()) {
                const fileName = `norma_${item.id}_filtered.txt`;
                const filePathFiltred = path.join('filtred', fileName);

                // 1. Guardar archivo plano
                fs.writeFileSync(filePathFiltred, item.planeText);
                console.log("🚀 ~ Guardado:", filePathFiltred);

                try {
                    // 2. Cargar a DocumentAI
                    const res = await LoadDocumentAi.create(filePathFiltred);

                    // 3. Subir con metadatos
                    await UploadDocumentAi.create(res.data, this.chunkSize, this.extension, this.namespace, this.deleteBot, {
                        metadata: {
                            id: item.id,
                            fechaPublicacion: item.fecha_publicacion,
                            fechaPromulgacion: item.fecha_promulgacion,
                            compuesto: NormalizeWord.create(item.compuesto[0].compuesto),
                            tituloNorma: NormalizeWord.create(item.titulo_norma),
                            organismos: item.organismos.map(e => NormalizeWord.create(e)),
                            fuente: NormalizeWord.create(item.fuente),
                            inicioVigencia: item.inicio_vigencia,
                            fin_vigencia: item.fin_vigencia,
                            tipoVersion: NormalizeWord.create(item.tipo_version_s),
                        }
                    });

                    // 4. Eliminar temporal
                    await DeleteDocumentAi.create(res.data);

                    fs.unlinkSync(filePathFiltred);
                    console.log("🚀 ~ Archivo eliminado:", filePathFiltred);

                } catch (error) {
                    console.error(`Error procesando norma ${item.id} (índice ${index}):`, error.message);
                }
            }

            return { status: 'created' };

        } catch (e) {
            console.error("🚨 Error general en UploadFiles():", e.message);
            throw new Error("Error al ejecutar la función UploadFiles()");
        }
    };
}

module.exports = UploadFiles