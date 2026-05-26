import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AffectService } from './affect.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditService } from '../audit/audit.service';

const PSY_ID = 'cpsyaaaaaaaaaaaaaaaaaaaaa';
const OTHER_PSY_ID = 'cpsybbbbbbbbbbbbbbbbbbbbb';
const CLIENT_ID = 'cclient11111111111111111x';

function makeConfig(overrides?: Record<string, unknown>): ConfigService {
  const v: Record<string, unknown> = {
    AFFECT_BASELINE_MIN_SESSIONS: 4,
    AFFECT_BASELINE_WINDOW_SESSIONS: 10,
    AFFECT_DEVIATION_SIGMA: 1.5,
    ...overrides,
  };
  return { get: (k: string) => v[k] } as ConfigService;
}

function makeDeps(opts: {
  client?: { id: string; psychologistId: string; deletedAt: Date | null } | null;
  sessions?: Array<{
    id: string;
    endedAt: Date | null;
    noteDraft: { affectFeatures: Array<{ valence: number; arousal: number }> | null } | null;
  }>;
}) {
  const client =
    opts.client === undefined
      ? { id: CLIENT_ID, psychologistId: PSY_ID, deletedAt: null }
      : opts.client;
  const clientFindUnique = vi.fn().mockResolvedValue(client);
  const sessionFindMany = vi.fn().mockResolvedValue(opts.sessions ?? []);
  const prisma = {
    client: { findUnique: clientFindUnique },
    session: { findMany: sessionFindMany },
  } as unknown as PrismaService;
  const audit = { log: vi.fn() } as unknown as AuditService;
  return { prisma, audit, clientFindUnique, sessionFindMany };
}

function feature(valence: number, arousal: number) {
  return { startMs: 0, endMs: 1000, valence, arousal };
}

function session(id: string, valence: number, arousal: number, daysAgo: number) {
  return {
    id,
    endedAt: new Date(Date.now() - daysAgo * 24 * 3600 * 1000),
    noteDraft: { affectFeatures: [feature(valence, arousal), feature(valence, arousal)] },
  };
}

describe('AffectService.getBaseline', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns INSUFFICIENT_DATA when fewer than minSessions exist', async () => {
    const deps = makeDeps({
      sessions: [session('s1', 0.5, 0.5, 1), session('s2', 0.4, 0.4, 2)],
    });
    const svc = new AffectService(deps.prisma, deps.audit, makeConfig());
    const baseline = await svc.getBaseline(PSY_ID, CLIENT_ID, {});
    expect(baseline.status).toBe('INSUFFICIENT_DATA');
    expect(baseline.sessionsUsed).toBe(2);
    expect(baseline.valence).toBeNull();
  });

  it('returns ESTABLISHED with mean + stddev when min sessions met', async () => {
    const deps = makeDeps({
      sessions: [
        session('s1', 0.1, 0.4, 1),
        session('s2', 0.2, 0.5, 2),
        session('s3', 0.3, 0.4, 3),
        session('s4', 0.0, 0.5, 4),
      ],
    });
    const svc = new AffectService(deps.prisma, deps.audit, makeConfig());
    const baseline = await svc.getBaseline(PSY_ID, CLIENT_ID, {});
    expect(baseline.status).toBe('ESTABLISHED');
    expect(baseline.sessionsUsed).toBe(4);
    expect(baseline.valence!.mean).toBeCloseTo(0.15, 5);
    expect(baseline.arousal!.mean).toBeCloseTo(0.45, 5);
    expect(baseline.valence!.stddev).toBeGreaterThan(0);
  });

  it('drops sessions with no affect features', async () => {
    const deps = makeDeps({
      sessions: [
        session('s1', 0.1, 0.5, 1),
        {
          id: 's_no_features',
          endedAt: new Date(),
          noteDraft: { affectFeatures: null },
        },
      ],
    });
    const svc = new AffectService(deps.prisma, deps.audit, makeConfig());
    const baseline = await svc.getBaseline(PSY_ID, CLIENT_ID, {});
    expect(baseline.sessionsUsed).toBe(1);
  });

  it('returns 404 for cross-tenant client', async () => {
    const deps = makeDeps({
      client: { id: CLIENT_ID, psychologistId: OTHER_PSY_ID, deletedAt: null },
    });
    const svc = new AffectService(deps.prisma, deps.audit, makeConfig());
    await expect(svc.getBaseline(PSY_ID, CLIENT_ID, {})).rejects.toBeInstanceOf(NotFoundException);
  });

  it('writes AFFECT_BASELINE_VIEWED audit', async () => {
    const deps = makeDeps({
      sessions: [
        session('s1', 0.1, 0.4, 1),
        session('s2', 0.2, 0.5, 2),
        session('s3', 0.3, 0.4, 3),
        session('s4', 0.0, 0.5, 4),
      ],
    });
    const svc = new AffectService(deps.prisma, deps.audit, makeConfig());
    await svc.getBaseline(PSY_ID, CLIENT_ID, {});
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AFFECT_BASELINE_VIEWED', targetId: CLIENT_ID }),
    );
  });
});

describe('AffectService.getTrend', () => {
  beforeEach(() => vi.clearAllMocks());

  it('flags sessions outside ±1.5σ as deviations with neutral messages', async () => {
    // 5 sessions at valence ~0; 1 outlier at valence 0.9 → ~ deviates
    const deps = makeDeps({
      sessions: [
        session('outlier', 0.9, 0.5, 1),
        session('s1', 0.0, 0.5, 2),
        session('s2', 0.05, 0.5, 3),
        session('s3', -0.05, 0.5, 4),
        session('s4', 0.0, 0.5, 5),
        session('s5', 0.0, 0.5, 6),
      ],
    });
    const svc = new AffectService(deps.prisma, deps.audit, makeConfig());
    const trend = await svc.getTrend(PSY_ID, CLIENT_ID, {});
    expect(trend.baseline.status).toBe('ESTABLISHED');
    expect(trend.points).toHaveLength(6);
    const valenceDeviations = trend.deviations.filter((d) => d.dimension === 'valence');
    expect(valenceDeviations.length).toBeGreaterThan(0);
    // Message must be neutral, no clinical interpretation
    for (const d of trend.deviations) {
      expect(d.message).toMatch(/valence|arousal/);
      expect(d.message).not.toMatch(/concerning|severe|crisis|mood disorder/i);
    }
    expect(deps.audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AFFECT_TREND_VIEWED' }),
    );
  });

  it('returns no deviations when baseline is INSUFFICIENT_DATA', async () => {
    const deps = makeDeps({
      sessions: [session('s1', 0.9, 0.9, 1)],
    });
    const svc = new AffectService(deps.prisma, deps.audit, makeConfig());
    const trend = await svc.getTrend(PSY_ID, CLIENT_ID, {});
    expect(trend.baseline.status).toBe('INSUFFICIENT_DATA');
    expect(trend.deviations).toEqual([]);
  });
});
