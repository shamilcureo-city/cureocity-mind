import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { RetentionService } from './retention.service';

/**
 * Schedules the daily retention sweep at 02:00 UTC. The actual policy
 * lives in RetentionService — this class just glues the cron to it.
 *
 * Disabled when NODE_ENV=test (vitest never wants a real cron firing
 * mid-suite; tests call RetentionService.runDailyPurge() directly).
 */
@Injectable()
export class RetentionProcessor {
  private readonly logger = new Logger(RetentionProcessor.name);

  constructor(private readonly service: RetentionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { disabled: process.env['NODE_ENV'] === 'test' })
  async daily(): Promise<void> {
    this.logger.log('Daily retention sweep starting');
    const report = await this.service.runDailyPurge();
    this.logger.log(
      `Retention sweep complete: scanned=${report.scanned} purged=${report.purged} s3Failures=${report.s3Failures} dbFailures=${report.dbFailures} dryRun=${report.dryRun} durationMs=${report.durationMs}`,
    );
  }
}
