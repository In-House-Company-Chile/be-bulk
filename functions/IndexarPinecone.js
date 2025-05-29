require('dotenv').config();
const { OpenAIEmbeddings } = require('@langchain/openai');
const { RecursiveCharacterTextSplitter } = require('@langchain/textSplitters');
const { Pinecone } = require('@pinecone-database/pinecone');
const { PineconeStore } = require('@langchain/pinecone');

const apiKeyPinecone = process.env.PINECONE_API_KEY;
const openaiApiKey = process.env.OPENAI_API_KEY;

class IndexarPinecone {
  constructor(doc, indexName, namespace) {
    this.doc = doc;
    this.indexName = indexName;
    this.namespace = namespace;
  }

  static create(doc, indexName, namespace) {
    return new IndexarPinecone(doc, indexName, namespace).indexar();
  }

  async indexar() {
    const meta = this.doc.data?.metadatos || {};
    const tiposNumeros = meta.tipos_numeros?.[0] || {};

    // Genera el embedding con OpenAI
    try {
      const pc = new Pinecone({ apiKey: apiKeyPinecone });
      const queryEmbedding = new OpenAIEmbeddings({ model: 'text-embedding-3-large', dimensions: 3072, apiKey: openaiApiKey });
      const index = pc.Index(this.indexName);

      const text_splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 800,
        chunkOverlap: 80,
        lengthFunction: (text) => text.length
      });
      const cunks = text_splitter.createDocuments([this.doc.planeText]);
      const documents = text_splitter.splitDocuments(await cunks);

      // Agregar metadata manualmente a cada documento
      const documentsWithMetadata = (await documents).map((docu) => ({
        ...docu,
        metadata: {
          idNorm: this.doc.idNorm,
          compuesto: tiposNumeros.compuesto || '',
          titulo_norma: meta.titulo_norma || '',
          organismos: meta.organismos || [],
          fecha_publicacion: meta.fecha_publicacion || '',
          fecha_promulgacion: meta.fecha_promulgacion || '',
          tipo_version_s: meta.tipo_version_s || '',
          inicio_vigencia: meta.vigencia?.inicio_vigencia || '',
          fin_vigencia: meta.vigencia?.fin_vigencia || '',
          tag: 'norma'
        }
      }));

      await PineconeStore.fromDocuments(documentsWithMetadata, queryEmbedding, {
        pineconeIndex: index,
        maxConcurrency: 5,
        namespace: this.namespace,
      });

      console.log(`✅ Indexado en Pinecone: ${this.doc.idNorm}`);

    } catch (embeddingErr) {
      console.warn(`⚠️ Error al generar embedding para ${this.doc.idNorm}:`, embeddingErr);
    }
  }
}

module.exports = IndexarPinecone;