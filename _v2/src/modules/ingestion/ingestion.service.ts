import { Injectable, Logger } from '@nestjs/common';
import { ParsedDocument } from '../../core/interfaces/data-source-scraper.interface';
import { Document as LlamaDocument, IngestionPipeline, SentenceSplitter } from 'llamaindex';
import { EmbeddingsService } from '../embeddings/embeddings.service';
import { QdrantService } from '../vector-store/qdrant.service';

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private pipeline: IngestionPipeline;

  constructor(
    private readonly embeddings: EmbeddingsService,
    private readonly qdrant: QdrantService,
  ) {
    this.pipeline = new IngestionPipeline({
      transformations: [
        new SentenceSplitter({ chunkSize: 800, chunkOverlap: 80 }), // Exacto a tu legacy IndexarQdrant
        this.embeddings.getModel(),
      ],
    });
  }

  async ingest(chunks: ParsedDocument[]): Promise<void> {
    this.logger.log(`Iniciando vectorización e inserción a Qdrant...`);
    
    const documents = chunks.map(chunk =>
      new LlamaDocument({
        text: chunk.body,
        metadata: {
          source: chunk.sourceName,
          externalId: chunk.externalId,
          title: chunk.title,
          ...(chunk.metadata as object),
        },
      })
    );

    // Asignamos el Vector Store de forma dinámica (OnModuleInit lo construye)
    this.pipeline.vectorStore = this.qdrant.getStore();
    
    await this.pipeline.run({ documents });
    this.logger.log(`✔️ Pipeline LlamaIndex completado. Qdrant actualizado exitosamente.`);
  }
}
