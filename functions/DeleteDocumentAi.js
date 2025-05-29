const axios = require('axios');
require('dotenv/config')

class DeleteDocumentAi {
    constructor(filePath) {
        this.filePath = filePath
    }

    static create(filePath) {
        return new DeleteDocumentAi(filePath).extract()
    }

    async extract() {
        try {
            const result = await axios.delete(`${process.env.AI_URL}/document`, { data: { path: this.filePath } });
            return result.data;

        } catch (e) {
            console.error("🚨 Error general en DeleteDocumentAi():", e.message);
            throw new Error("Error al ejecutar la función DeleteDocumentAi()");
        }
    };
}

module.exports = DeleteDocumentAi