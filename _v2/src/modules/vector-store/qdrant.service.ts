import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QdrantVectorStore } from '@llamaindex/qdrant';

@Injectable()
export class QdrantService implements OnModuleInit {
  private readonly logger = new Logger(QdrantService.name);
  private vectorStore: QdrantVectorStore;

  async onModuleInit() {
    const qdrantUrl = process.env.QDRANT_URL || 'http://localhost:6333';
    this.logger.log(`Conectando QdrantVectorStore apuntando a ${qdrantUrl}...`);

    this.vectorStore = new QdrantVectorStore({
      url: qdrantUrl,
      collectionName: 'normas_y_sentencias',
    });
  }

  getStore(): QdrantVectorStore {
    return this.vectorStore;
  }
}
