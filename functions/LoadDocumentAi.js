const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');
require('dotenv/config')

class LoadDocumentAi {
    constructor(filePath) {
        this.filePath = filePath
    }

    static create(filePath) {
        return new LoadDocumentAi(filePath).extract()
    }

    async extract() {
        try {
            const form = new FormData();
            form.append('file', fs.createReadStream(this.filePath));

            const data = {
                'file': form,
            };
            const response = await axios.post(`${process.env.AI_URL}/load-document/`, data.file, {
                headers: {
                    ...form.getHeaders(),
                },
            });

            return response.data;

        } catch (e) {
            console.error("🚨 Error general en LoadDocumentAi():", e.message);
            throw new Error("Error al ejecutar la función LoadDocumentAi()");
        }
    };
}

module.exports = LoadDocumentAi