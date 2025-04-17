const fs = require('fs');
const path = require('path');

class LoadNormasFromJSON {
    constructor(filePath) {
        this.filePath = filePath
    }

    static create(filePath) {
        return new LoadNormasFromJSON(filePath).extract()
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
                        planeText: parsedJson.planeText || '',
                    });

                    // Mover archivo a la carpeta 'processed'
                    const processedDir = 'vectorized';
                    if (!fs.existsSync(processedDir)) {
                        fs.mkdirSync(processedDir);
                    }

                    const processedFilePath = path.join(processedDir, file);
                    fs.renameSync(filePath, processedFilePath);
                    console.log("🚀 ~ Archivo movido a 'processed':", processedFilePath);
                } catch (error) {
                    console.error(`Error al procesar ${file}:`);
                }
            }

            return normas;

        } catch (e) {
            console.error("🚨 Error general en LoadNormasFromJSON():", e.message);
            throw new Error("Error al ejecutar la función LoadNormasFromJSON()");
        }
    };
}

module.exports = LoadNormasFromJSON