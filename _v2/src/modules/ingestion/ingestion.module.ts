import { Module } from '@nestjs/common';
import { IngestionService } from './ingestion.service';
import { EmbeddingsModule } from '../embeddings/embeddings.module';
import { VectorStoreModule } from '../vector-store/vector-store.module';

@Module({
  imports: [EmbeddingsModule, VectorStoreModule],
  providers: [IngestionService],
  exports: [IngestionService],
})
export class IngestionModule {}
