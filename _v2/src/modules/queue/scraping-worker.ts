import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { BcnNormasScraperService } from '../scrapers/bcn-normas-scraper.service';
import { PrismaService } from '../database/prisma.service';
import { IngestionService } from '../ingestion/ingestion.service';

@Processor('scraping')
export class ScrapingWorker extends WorkerHost {
  private readonly logger = new Logger(ScrapingWorker.name);

  constructor(
    private readonly bcnScraper: BcnNormasScraperService,
    private readonly prisma: PrismaService,
    private readonly ingestion: IngestionService,
  ) {
    super();
  }

  async process(job: Job<{ source: string; cursor: string }>) {
    this.logger.log(`Procesando tarea ${job.id} | Fuente: ${job.data.source} | Cursor: ${job.data.cursor}`);
    
    let scraper;
    if (job.data.source === 'BCN_NORMAS') {
      scraper = this.bcnScraper;
    } else {
      throw new Error(`Fuente no soportada: ${job.data.source}`);
    }

    try {
      const rawDocs = await scraper.fetchAvailableDocuments(job.data.cursor);
      if (rawDocs.length === 0) {
        this.logger.warn(`Documento no encontrado o vacío en cursor ${job.data.cursor}. Saltando...`);
        return;
      }

      for (const raw of rawDocs) {
        const parsed = await scraper.processDocument(raw);
        
        // Guardado Raw/PostgreSQL
        await this.prisma.document.upsert({
          where: {
            sourceName_externalId: {
              sourceName: parsed.sourceName,
              externalId: parsed.externalId,
            }
          },
          update: {
            title: parsed.title,
            body: parsed.body,
            metadata: parsed.metadata as any,
            publishedAt: parsed.publishedAt,
          },
          create: {
            externalId: parsed.externalId,
            sourceName: parsed.sourceName,
            title: parsed.title,
            body: parsed.body,
            metadata: parsed.metadata as any,
            publishedAt: parsed.publishedAt,
          }
        });
        this.logger.log(`Documento ${parsed.externalId} almacenado rígidamente en Postgres.`);

        // Ingesta Vectorial / Qdrant
        const chunks = await scraper.chunkDocument(parsed);
        await this.ingestion.ingest(chunks);

        // Actualizar Cursor
        await this.prisma.scraperCursor.upsert({
          where: { sourceName: parsed.sourceName },
          update: { lastCursor: parsed.externalId },
          create: { sourceName: parsed.sourceName, lastCursor: parsed.externalId },
        });
      }
    } catch (e) {
      this.logger.error(`Error en ScrapingWorker para ${job.data.source}: ${e.message}`, e.stack);
      throw e;
    }
  }
}
