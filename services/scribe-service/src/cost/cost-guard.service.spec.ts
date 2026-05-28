import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';
import { CostCircuitOpenError, CostGuardService } from './cost-guard.service';
import type { PrismaService } from '../prisma/prisma.service';

function makeConfig(values: Record<string, unknown>): ConfigService {
  return { get: (k: string) => values[k] } as ConfigService;
}

function makePrisma(opts: { sessionSumInr?: number; monthlySumInr?: number }): PrismaService {
  const aggregate = vi.fn().mockImplementation(({ where }: { where: Record<string, unknown> }) => {
    const isMonthly = 'createdAt' in where;
    const sum = isMonthly ? (opts.monthlySumInr ?? 0) : (opts.sessionSumInr ?? 0);
    return Promise.resolve({ _sum: { costInr: new Prisma.Decimal(sum) } });
  });
  return {
    geminiCallLog: { aggregate },
  } as unknown as PrismaService;
}

describe('CostGuardService.checkBeforeCall', () => {
  beforeEach(() => vi.clearAllMocks());

  const config = makeConfig({
    COST_CAP_PER_SESSION_INR: 500,
    COST_CAP_PER_THERAPIST_MONTHLY_INR: 15_000,
  });

  it('passes when both projected totals are under their caps', async () => {
    const svc = new CostGuardService(makePrisma({ sessionSumInr: 3, monthlySumInr: 200 }), config);
    await expect(
      svc.checkBeforeCall({ sessionId: 's1', psychologistId: 'p1', estimatedCostInr: 2 }),
    ).resolves.toBeUndefined();
  });

  it('throws CostCircuitOpenError with scope=session when session cap would be exceeded', async () => {
    const svc = new CostGuardService(
      makePrisma({ sessionSumInr: 499, monthlySumInr: 100 }),
      config,
    );
    await expect(
      svc.checkBeforeCall({ sessionId: 's1', psychologistId: 'p1', estimatedCostInr: 5 }),
    ).rejects.toBeInstanceOf(CostCircuitOpenError);

    try {
      await svc.checkBeforeCall({ sessionId: 's1', psychologistId: 'p1', estimatedCostInr: 5 });
    } catch (e) {
      const err = e as CostCircuitOpenError;
      expect(err.meta.scope).toBe('session');
      expect(err.meta.capInr).toBe(500);
      expect(err.meta.projectedInr).toBeCloseTo(504);
    }
  });

  it('throws CostCircuitOpenError with scope=monthly when monthly cap would be exceeded', async () => {
    const svc = new CostGuardService(
      makePrisma({ sessionSumInr: 2, monthlySumInr: 14_999 }),
      config,
    );
    try {
      await svc.checkBeforeCall({ sessionId: 's1', psychologistId: 'p1', estimatedCostInr: 5 });
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(CostCircuitOpenError);
      expect((e as CostCircuitOpenError).meta.scope).toBe('monthly');
    }
  });

  it('uses configurable caps (override via env)', async () => {
    const tightConfig = makeConfig({
      COST_CAP_PER_SESSION_INR: 10,
      COST_CAP_PER_THERAPIST_MONTHLY_INR: 100,
    });
    const svc = new CostGuardService(
      makePrisma({ sessionSumInr: 8, monthlySumInr: 0 }),
      tightConfig,
    );
    await expect(
      svc.checkBeforeCall({ sessionId: 's1', psychologistId: 'p1', estimatedCostInr: 3 }),
    ).rejects.toBeInstanceOf(CostCircuitOpenError);
  });
});

describe('CostGuardService.getSessionTotalInr', () => {
  it('returns Decimal(0) when no calls have been made', async () => {
    const svc = new CostGuardService(makePrisma({ sessionSumInr: 0 }), makeConfig({}));
    const total = await svc.getSessionTotalInr('s1');
    expect(total.toNumber()).toBe(0);
  });

  it('returns the aggregated sum', async () => {
    const svc = new CostGuardService(makePrisma({ sessionSumInr: 12.34 }), makeConfig({}));
    const total = await svc.getSessionTotalInr('s1');
    expect(total.toNumber()).toBe(12.34);
  });
});
