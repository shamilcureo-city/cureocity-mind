import { describe, it, expect, vi } from 'vitest';
import { HealthController } from './health.controller';
import type { PrismaService } from '../prisma/prisma.service';

function makePrismaStub(opts: { dbUp: boolean }): PrismaService {
  return {
    $queryRaw: opts.dbUp
      ? vi.fn().mockResolvedValue([{ '?column?': 1 }])
      : vi.fn().mockRejectedValue(new Error('connection refused')),
  } as unknown as PrismaService;
}

describe('HealthController', () => {
  it('returns ok when the database responds', async () => {
    const controller = new HealthController(makePrismaStub({ dbUp: true }));
    const result = await controller.check();
    expect(result.status).toBe('ok');
    expect(result.checks.db).toBe('up');
    expect(result.service).toBe('pdf-generator-service');
  });

  it('returns degraded when the database is unreachable', async () => {
    const controller = new HealthController(makePrismaStub({ dbUp: false }));
    const result = await controller.check();
    expect(result.status).toBe('degraded');
    expect(result.checks.db).toBe('down');
  });
});
