require('dotenv').config();

module.exports = {
  postgres: {
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: parseInt(process.env.POSTGRES_PORT || '54320'),
    user: process.env.POSTGRES_USER || 'docuser',
    password: process.env.POSTGRES_PASSWORD || 'postgres123',
    database: process.env.POSTGRES_DATABASE || 'documents_db',
  },
  qdrant: {
    url: process.env.QDRANT_URL || 'http://localhost:6333',
    collection: process.env.QDRANT_COLLECTION || 'test',
  },
  embedding: {
    apiUrl: process.env.EMBEDDING_API_URL || 'http://ms-vector.governare.ai/embed',
  },
  scraper: {
    baseUrl: process.env.DIARIO_OFICIAL_BASE_URL || 'https://www.diariooficial.interior.gob.cl',
    chunkSize: parseInt(process.env.CHUNK_SIZE || '800'),
    chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '100'),
  },
};