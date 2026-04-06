import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QdrantVectorStore } from '@llamaindex/qdrant';
import { QdrantClient } from '@qdrant/js-client-rest';

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private vectorStore: QdrantVectorStore;

  async onModuleInit() {
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    const collectionName = 'TEST'; // Puedes cambiarlo a 'normas_y_sentencias' si lo prefieres
    this.logger.log(`Conectando QdrantVectorStore apuntando a ${qdrantUrl}...`);

    // 1. Usamos el cliente nativo de Qdrant para gobernar la Colección
    try {
      const qdrantClient = new QdrantClient({ url: qdrantUrl });
      const { collections } = await qdrantClient.getCollections();
      const exists = collections.some(c => c.name === collectionName);

      if (!exists) {
        this.logger.log(`Colección '${collectionName}' no encontrada. Creando con configuraciones optimizadas...`);
        await qdrantClient.createCollection(collectionName, {
          vectors: {
            size: 1024,
            distance: 'Cosine'
          },
          optimizers_config: {
            default_segment_number: 6,
            max_segment_size: 2000000,
            max_optimization_threads: 6,
            memmap_threshold: 50000
          },
          shard_number: 2
        });
        this.logger.log(`Colección '${collectionName}' creada exitosamente.`);
      } else {
        this.logger.log(`Colección '${collectionName}' ya existe, se omitirá la creación.`);
      }
    } catch (e) {
      this.logger.warn(`Error conectando a Qdrant en Iniciar: ${e.message}`);
    }

    // 2. Inicializamos la Store de LlamaIndex asegurando que la colección ya tiene tu formato exacto
    this.vectorStore = new QdrantVectorStore({
      url: qdrantUrl,
      collectionName: collectionName,
    });
  }

  getStore(): QdrantVectorStore {
    return this.vectorStore;
  }
}
