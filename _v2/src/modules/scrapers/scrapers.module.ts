import { Module } from '@nestjs/common';
import { BcnNormasScraperService } from './bcn-normas-scraper.service';
import { PjudSentenciasScraperService } from './pjud-sentencias-scraper.service';

@Module({
  providers: [BcnNormasScraperService, PjudSentenciasScraperService],
  exports: [BcnNormasScraperService, PjudSentenciasScraperService],
})
export class ScrapersModule {}
