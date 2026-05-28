import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { IStorageClient } from '@cureocity/storage';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { STORAGE_CLIENT } from '../storage/storage.module';

export interface RetentionReport {
  cutoff: string;
  scanned: number;
  purged: number;
  s3Failures: number;
  dbFailures: number;
  dryRun: boolean;
  durationMs: number;
}

/**
 * Daily audio retention sweep.
 *
 * Policy: audio_chunks older than AUDIO_RETENTION_DAYS (default 30) are
 * eligible for purge. We delete the S3 object first, then the DB row.
 * If S3 deletion fails (object already missing / network), we leave
 * the row in place so the next run re-tries. If DB deletion fails
 * after S3 succeeded, we have an orphan S3 deletion — accept that as a
 * cost of keeping the operation idempotent.
 *
 * Pairs with an S3 bucket lifecycle policy (configured in
 * infrastructure/docker-compose.yml + Terraform later) that ALSO
 * expires objects at 30 days. The cron job is the DB-side complement.
 *
 * RETENTION_DRY_RUN=true: reports counts without deleting anything.
 * Useful for smoke-testing in staging before flipping on.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);
  private readonly retentionDays: number;
  private readonly bucket: string;
  private readonly dryRun: boolean;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    config: ConfigService,
    @Inject(STORAGE_CLIENT) private readonly storage: IStorageClient,
  ) {
    this.retentionDays = Number(config.get('AUDIO_RETENTION_DAYS') ?? 30);
    this.bucket = config.get<string>('S3_BUCKET_AUDIO') ?? 'cureocity-mind-audio';
    this.dryRun = Boolean(config.get('RETENTION_DRY_RUN'));
  }

  /**
   * Runs one retention pass. Idempotent — re-runs only retry the rows
   * that failed previously.
   */
  async runDailyPurge(now: Date = new Date()): Promise<RetentionReport> {
    const start = Date.now();
    const cutoff = new Date(now.getTime() - this.retentionDays * 24 * 3600 * 1000);

    const eligible = await this.prisma.audioChunk.findMany({
      where: { uploadedAt: { lt: cutoff } },
      select: { id: true, sessionId: true, s3Key: true },
      orderBy: { uploadedAt: 'asc' },
    });

    let purged = 0;
    let s3Failures = 0;
    let dbFailures = 0;

    for (const chunk of eligible) {
      if (this.dryRun) continue;
      try {
        await this.storage.delete({ bucket: this.bucket, key: chunk.s3Key });
      } catch (e) {
        s3Failures += 1;
        this.logger.warn(`Retention: S3 delete failed for ${chunk.s3Key}: ${(e as Error).message}`);
        continue;
      }
      try {
        await this.prisma.audioChunk.delete({ where: { id: chunk.id } });
        await this.audit.log({
          actorType: 'SYSTEM',
          action: 'AUDIO_RETENTION_PURGED',
          targetType: 'AudioChunk',
          targetId: chunk.id,
          metadata: {
            sessionId: chunk.sessionId,
            s3Key: chunk.s3Key,
            retentionDays: this.retentionDays,
            cutoff: cutoff.toISOString(),
          },
        });
        purged += 1;
      } catch (e) {
        dbFailures += 1;
        this.logger.error(
          `Retention: DB delete failed for chunk ${chunk.id} (S3 already deleted): ${(e as Error).message}`,
        );
      }
    }

    return {
      cutoff: cutoff.toISOString(),
      scanned: eligible.length,
      purged,
      s3Failures,
      dbFailures,
      dryRun: this.dryRun,
      durationMs: Date.now() - start,
    };
  }
}
