import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { StorageModule } from '../storage/storage.module';
import { RetentionService } from './retention.service';
import { RetentionProcessor } from './retention.processor';

@Module({
  imports: [ScheduleModule.forRoot(), StorageModule],
  providers: [RetentionService, RetentionProcessor],
  exports: [RetentionService],
})
export class RetentionModule {}
