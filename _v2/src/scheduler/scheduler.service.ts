import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../modules/database/prisma.service';

@Injectable()
export class SchedulerService {
  private readonly logger = new Logger(SchedulerService.name);

  constructor(
    @InjectQueue('scraping') private scrapingQueue: Queue,
    private readonly prisma: PrismaService
  ) {}

  // Se ejecuta cada día a las 11:00 AM (similar a node-cron 0 11 * * *)
  @Cron('0 11 * * *', { name: 'bcn_normas_crawler' })
  async triggerBcnNormas() {
    this.logger.log('Disparando CronJob: BCN Normas...');
    
    // 1. Obtiene el último cursor procesado o empieza en 1215894 (tu default heredado)
    const cursorState = await this.prisma.scraperCursor.findUnique({ 
      where: { sourceName: 'BCN_NORMAS' } 
    });
    
    let currentCursorId = cursorState ? parseInt(cursorState.lastCursor, 10) : 1215894;
    
    // 2. Por ejemplificar la encolación dinámica, encolar los próximos 20 elementos.
    const MAX_CONCURRENT_JOBS = 50;
    
    for (let i = 0; i < MAX_CONCURRENT_JOBS; i++) {
      const cursorStr = currentCursorId.toString();
      
      await this.scrapingQueue.add('scrape', {
        source: 'BCN_NORMAS',
        cursor: cursorStr,
      }, {
        attempts: 10,
        backoff: {
          type: 'exponential',
          delay: 5000,
        },
        jobId: `BCN_NORMAS-${cursorStr}`
      });

      currentCursorId++;
    }
    
    this.logger.log(`Se han encolado ${MAX_CONCURRENT_JOBS} tareas para BCN_NORMAS.`);
  }
}
