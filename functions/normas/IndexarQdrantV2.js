require('dotenv').config();
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');

const embeddingUrl = 'http://ms-vector.governare.ai/embed';
const qdrantUrl = 'http://ms-qdrant-8f82e7cd-8cc2.governare.ai';



class IndexarQdrantV2 {
  constructor(doc, docText, namespace, metadata) {
    this.doc = doc;
    this.docText = docText;
    this.namespace = namespace;
    this.metadata = metadata;
    this.chunkSize = 800;
    this.chunkOverlap = 80;
  }

  static create(doc, docText, namespace, metadata) {
    return new IndexarQdrantV2(doc, docText, namespace, metadata).indexar();
  }

  async indexar() {
    try {
      const textSplitter = new RecursiveCharacterTextSplitter({
        chunkSize: this.chunkSize,
        chunkOverlap: this.chunkOverlap,
        lengthFunction: (text) => text.length
      });

      const chunks = await textSplitter.splitText(this.docText);
      const documentsWithMetadata = (chunks).map(async (docu) => ({
        id: uuidv4(),
        vector: await this.getEmbedding(docu),
        payload: {
          ...this.metadata,
          text: docu,
          timestamp: new Date().toISOString()
        }
      }));

      await this.upsertToQdrant(await Promise.all(documentsWithMetadata));

      console.log(`✅ Indexado en Qdrant`);

    } catch (embeddingErr) {
      console.warn(`⚠️ Error al generar embedding`, embeddingErr);
    }
  }

  async getEmbedding(text) {
    const response = await axios.post(
      embeddingUrl,
      { inputs: text },
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );

    return response.data[0];

  }

  async upsertToQdrant(points) {
    try {
      await axios.put(
        `${qdrantUrl}/collections/${this.namespace}/points`,
        { points },
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (error) {
      console.error(`❌ Error en upsertToQdrant: ${error}`);
    }
  }
}

module.exports = IndexarQdrantV2;