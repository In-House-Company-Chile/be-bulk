import { Module } from '@nestjs/common';
import { SchedulerService } from './scheduler.service';
import { QueueModule } from '../modules/queue/queue.module';
import { DatabaseModule } from '../modules/database/database.module';

@Module({
  imports: [QueueModule, DatabaseModule],
  providers: [SchedulerService],
})
export class SchedulerModule {}
