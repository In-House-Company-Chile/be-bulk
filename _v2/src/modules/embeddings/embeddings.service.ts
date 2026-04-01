import { Injectable } from '@nestjs/common';
import { GovernareEmbedding } from './governare.embedding';

@Injectable()
export class EmbeddingsService {
  private readonly model = new GovernareEmbedding();

  getModel() {
    return this.model;
  }
}
