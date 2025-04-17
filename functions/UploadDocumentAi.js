const axios = require('axios')
require('dotenv/config')

class UploadDocumentAi {
    constructor(filePath, chunkSize, extension, namespace, deleteBot, metadata) {
        this.filePath = filePath
        this.chunkSize = chunkSize
        this.extension = extension
        this.namespace = namespace
        this.deleteBot = deleteBot
        this.metadata = metadata
    }

    static create(filePath, chunkSize, extension, namespace, deleteBot, metadata) {
        return new UploadDocumentAi(filePath, chunkSize, extension, namespace, deleteBot, metadata).extract()
    }

    async extract() {
        try {
            const data = {
                "filePath": this.filePath,
                "chunkSize": this.chunkSize,
                "extension": this.extension,
                "namespace": this.namespace,
                "deleteBot": this.deleteBot,
                "metadata": this.metadata
            };
            const result = await axios.post(`${process.env.AI_URL}/v2/upload-document/`, { data: data },)
            return result.data;
        } catch (e) {
            console.error("🚨 Error general en UploadDocumentAi():", e.message);
            throw new Error("Error al ejecutar la función UploadDocumentAi()");
        }
    };
}

module.exports = UploadDocumentAi