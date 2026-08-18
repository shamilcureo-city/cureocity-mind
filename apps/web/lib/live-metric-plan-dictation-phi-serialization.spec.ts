import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { ClientPhiWriteForbiddenError, withActiveSessionPhiWrite } from './phi-write-lock';

const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('live metric PHI serialization', () => {
  it('waits for gateway metric work, then lets erasure prevent the complete atomic persistence group', async () => {
    const gateway = deferred<{ metricId: string }>();
    const write = vi.fn();
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: queryRaw,
        session: { findUnique: vi.fn() },
      }),
    );

    const persistence = (async () => {
      const summary = await gateway.promise;
      return withActiveSessionPhiWrite(
        { $transaction: transaction } as never,
        'session-1',
        'psy-1',
        (tx) => write(tx, summary),
      );
    })();

    expect(transaction).not.toHaveBeenCalled();
    gateway.resolve({ metricId: 'metric-1' });

    await expect(persistence).rejects.toBeInstanceOf(ClientPhiWriteForbiddenError);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('keeps the metric, Gemini rollup, and audit in one locked transaction', () => {
    const route = source('app/api/v1/sessions/[id]/live-metric/route.ts');

    expect(route).toContain('LIVE_METRIC_PHI_WRITE_GROUP');
    expect(route).toContain('withActiveSessionPhiWrite');
    expect(route).not.toMatch(/prisma\.(liveConsultMetric|geminiCallLog)\.create/);
    expect(route).toMatch(/writeAudit\([\s\S]*?,\s*tx,?\s*\)/);
  });

  it('accepts only finalized sessions and persists each session spend once', () => {
    const route = source('app/api/v1/sessions/[id]/live-metric/route.ts');
    const doctor = source('components/app/DoctorLiveEncounter.tsx');
    const schema = source('../../prisma/schema.prisma');
    const migration = source(
      '../../prisma/migrations/20260919000000_live_metric_idempotency/migration.sql',
    );

    expect(route).toContain("{ allowedStatuses: ['COMPLETED'] }");
    expect(route).toContain('liveConsultMetric.upsert');
    expect(route).toContain('liveConsultMetric.findUnique');
    expect(doctor).toMatch(
      /await fetch\(`\/api\/v1\/sessions\/\$\{sessionId\}\/live-note`[\s\S]*await persistMeter/,
    );
    expect(doctor).not.toMatch(/event\.state === 'done'[\s\S]{0,300}persistMeter/);
    expect(schema).toMatch(/model LiveConsultMetric[\s\S]*?sessionId\s+String\s+@unique/);
    expect(migration).toContain('ROW_NUMBER() OVER');
    expect(migration).toContain('CREATE UNIQUE INDEX');
    expect(migration).toContain('LIVE_CONSULT_ROLLUP_V1');
  });
});

describe('plan dictation PHI serialization', () => {
  it('waits for the model call, then lets erasure prevent delayed call-log persistence', async () => {
    const model = deferred<{ transcript: string }>();
    const write = vi.fn();
    const queryRaw = vi.fn().mockResolvedValue([]);
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) =>
      callback({
        $queryRaw: queryRaw,
        session: { findUnique: vi.fn() },
      }),
    );

    const generation = (async () => {
      const output = await model.promise;
      return withActiveSessionPhiWrite(
        { $transaction: transaction } as never,
        'session-1',
        'psy-1',
        (tx) => write(tx, output),
      );
    })();

    expect(transaction).not.toHaveBeenCalled();
    model.resolve({ transcript: 'increase medicine' });

    await expect(generation).rejects.toBeInstanceOf(ClientPhiWriteForbiddenError);
    expect(queryRaw).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
  });

  it('locks every session-linked call log and keeps the proposal audit atomic', () => {
    const helper = source('lib/plan-dictation.ts');

    expect(helper).toContain('PLAN_DICTATION_ASR_CALL_LOG');
    expect(helper).toContain('PLAN_DICTATION_PROPOSAL_WRITE_GROUP');
    expect(helper).toContain('PLAN_DICTATION_FAILURE_CALL_LOG');
    expect(helper).toContain('withActiveSessionPhiWrite');
    expect(helper).not.toMatch(/prisma\.geminiCallLog\.create/);
    expect(helper).toMatch(/writeAudit\([\s\S]*?,\s*tx,?\s*\)/);
  });
});
