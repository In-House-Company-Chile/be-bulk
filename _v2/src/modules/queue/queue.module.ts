import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScrapingWorker } from './scraping-worker';
import { DatabaseModule } from '../database/database.module';
import { ScrapersModule } from '../scrapers/scrapers.module';
import { IngestionModule } from '../ingestion/ingestion.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: 'scraping' }),
    DatabaseModule,
    ScrapersModule,
    IngestionModule,
  ],
  providers: [ScrapingWorker],
  exports: [BullModule],
})
export class QueueModule {}
