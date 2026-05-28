import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ConfigService } from '@nestjs/config';
import { InMemoryStorageClient } from '@cureocity/storage';
import { RetentionService } from './retention.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const BUCKET = 'audio';

function makeConfig(overrides?: Record<string, unknown>): ConfigService {
  const v: Record<string, unknown> = {
    AUDIO_RETENTION_DAYS: 30,
    S3_BUCKET_AUDIO: BUCKET,
    RETENTION_DRY_RUN: false,
    ...overrides,
  };
  return { get: (k: string) => v[k] } as ConfigService;
}

function makeDeps(opts: {
  audioRows?: Array<{ id: string; sessionId: string; s3Key: string }>;
  s3Throws?: Set<string>;
  dbThrows?: Set<string>;
}) {
  const findMany = vi.fn().mockResolvedValue(opts.audioRows ?? []);
  const dbDelete = vi.fn().mockImplementation(async ({ where }) => {
    if (opts.dbThrows?.has(where.id)) throw new Error('db nope');
    return { id: where.id };
  });
  const storage = new InMemoryStorageClient();
  // pre-populate S3 with all eligible rows
  for (const row of opts.audioRows ?? []) {
    void storage.put({ bucket: BUCKET, key: row.s3Key, body: Buffer.alloc(10) });
  }
  // wrap delete to optionally throw
  const realDelete = storage.delete.bind(storage);
  storage.delete = async (input: { bucket: string; key: string }) => {
    if (opts.s3Throws?.has(input.key)) throw new Error('s3 nope');
    return realDelete(input);
  };
  const prisma = {
    audioChunk: { findMany, delete: dbDelete },
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return { prisma, audit, storage, findMany, dbDelete };
}

describe('RetentionService.runDailyPurge', () => {
  beforeEach(() => vi.clearAllMocks());

  it('purges all eligible rows when both S3 and DB succeed', async () => {
    const deps = makeDeps({
      audioRows: [
        { id: 'c1', sessionId: 's1', s3Key: 'sessions/s1/0.pcm' },
        { id: 'c2', sessionId: 's1', s3Key: 'sessions/s1/1.pcm' },
      ],
    });
    const svc = new RetentionService(deps.prisma, deps.audit, makeConfig(), deps.storage);
    const report = await svc.runDailyPurge();
    expect(report.scanned).toBe(2);
    expect(report.purged).toBe(2);
    expect(report.s3Failures).toBe(0);
    expect(report.dbFailures).toBe(0);
    expect(deps.audit.log).toHaveBeenCalledTimes(2);
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AUDIO_RETENTION_PURGED', actorType: 'SYSTEM' }),
    );
  });

  it('skips DB delete and leaves row in place when S3 delete fails', async () => {
    const deps = makeDeps({
      audioRows: [{ id: 'c1', sessionId: 's1', s3Key: 'sessions/s1/0.pcm' }],
      s3Throws: new Set(['sessions/s1/0.pcm']),
    });
    const svc = new RetentionService(deps.prisma, deps.audit, makeConfig(), deps.storage);
    const report = await svc.runDailyPurge();
    expect(report.purged).toBe(0);
    expect(report.s3Failures).toBe(1);
    expect(deps.dbDelete).not.toHaveBeenCalled();
  });

  it('counts DB failures (S3 already deleted)', async () => {
    const deps = makeDeps({
      audioRows: [{ id: 'c1', sessionId: 's1', s3Key: 'sessions/s1/0.pcm' }],
      dbThrows: new Set(['c1']),
    });
    const svc = new RetentionService(deps.prisma, deps.audit, makeConfig(), deps.storage);
    const report = await svc.runDailyPurge();
    expect(report.purged).toBe(0);
    expect(report.dbFailures).toBe(1);
  });

  it('dry-run reports counts without touching storage or DB', async () => {
    const deps = makeDeps({
      audioRows: [
        { id: 'c1', sessionId: 's1', s3Key: 'sessions/s1/0.pcm' },
        { id: 'c2', sessionId: 's1', s3Key: 'sessions/s1/1.pcm' },
      ],
    });
    const svc = new RetentionService(
      deps.prisma,
      deps.audit,
      makeConfig({ RETENTION_DRY_RUN: true }),
      deps.storage,
    );
    const report = await svc.runDailyPurge();
    expect(report.scanned).toBe(2);
    expect(report.purged).toBe(0);
    expect(report.dryRun).toBe(true);
    expect(deps.dbDelete).not.toHaveBeenCalled();
    // S3 objects still present
    expect(deps.storage.snapshot().size).toBe(2);
  });

  it('uses cutoff = now - retentionDays', async () => {
    const deps = makeDeps({});
    const svc = new RetentionService(
      deps.prisma,
      deps.audit,
      makeConfig({ AUDIO_RETENTION_DAYS: 7 }),
      deps.storage,
    );
    const now = new Date('2026-06-30T00:00:00Z');
    const report = await svc.runDailyPurge(now);
    expect(report.cutoff).toBe('2026-06-23T00:00:00.000Z');
    expect(deps.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ uploadedAt: { lt: new Date('2026-06-23T00:00:00Z') } }),
      }),
    );
  });
});
