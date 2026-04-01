import { BaseEmbedding } from 'llamaindex';
import { Logger } from '@nestjs/common';
import axios from 'axios';

export class GovernareEmbedding extends BaseEmbedding {
  private url: string;
  private readonly logger = new Logger(GovernareEmbedding.name);

  constructor() {
    super();
    this.url = process.env.EMBEDDING_URL || 'http://ms-vector.governare.ai/embed';
  }

  async getTextEmbedding(text: string): Promise<number[]> {
    try {
      const response = await axios.post(
        this.url,
        { inputs: text },
        { headers: { 'Content-Type': 'application/json' } }
      );
      
      if (Array.isArray(response.data)) {
         if (typeof response.data[0] === 'number') {
           return response.data;
         } else if (Array.isArray(response.data[0])) {
           return response.data[0];
         }
      }
      throw new Error('Formato de embedding devuelto por ms-vector es inesperado');
    } catch (e) {
      this.logger.error(`Error obteniendo embedding HTTP: ${e.message}`);
      throw e;
    }
  }

  async getQueryEmbedding(query: import('llamaindex').MessageContentDetail): Promise<number[] | null> {
    const text = typeof query === 'string' ? query : (query as any).text;
    if (!text) return null;
    return this.getTextEmbedding(text);
  }
}
