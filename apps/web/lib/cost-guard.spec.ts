import { Prisma, type GeminiCallStatus } from '@prisma/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ aggregate: vi.fn(), storage: vi.fn(), connections: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: {
    geminiCallLog: { findMany: mocks.aggregate },
    sessionUsageConnection: { findMany: mocks.connections },
  },
}));
vi.mock('./session-usage-storage', () => ({ hasSessionUsageConnectionStorage: mocks.storage }));

import {
  checkCostCircuit,
  checkMonthlyCostCircuit,
  getSessionTotalInr,
  getTherapistMonthlyTotalInr,
} from './cost-guard';
import { SessionUsageReceiptSchema } from '@cureocity/contracts';
import { sessionUsageHash } from './session-usage-integrity';

type RecordedCall = {
  status: GeminiCallStatus;
  cost: number;
  sessionId: string | null;
  owner: string;
  createdAt: Date;
};
// These are arbitrary test values, not model prices or account billing evidence.
const call = (
  status: GeminiCallStatus,
  cost: number,
  patch: Partial<RecordedCall> = {},
): RecordedCall => ({
  status,
  cost,
  sessionId: 'fictional-session',
  owner: 'fictional-owner',
  createdAt: new Date('2026-09-10T00:00:00Z'),
  ...patch,
});
function recordedCalls(rows: RecordedCall[]) {
  mocks.aggregate.mockImplementation(
    async ({ where }: { where: Prisma.GeminiCallLogWhereInput }) => {
      const statuses = (where.status as { in: GeminiCallStatus[] }).in;
      const boundary = where.createdAt as { gte: Date; lt: Date } | undefined;
      const tenant = (where.OR as { psychologistId?: string }[] | undefined)?.find(
        (scope) => scope.psychologistId,
      )?.psychologistId;
      const included = rows.filter(
        (row) =>
          statuses.includes(row.status) &&
          row.cost > Number((where.costInr as { gt: number }).gt) &&
          (!where.sessionId || row.sessionId === where.sessionId) &&
          (!tenant || row.owner === tenant) &&
          (!boundary || (row.createdAt >= boundary.gte && row.createdAt < boundary.lt)),
      );
      return included.map((row) => ({
        ...row,
        costInr: new Prisma.Decimal(row.cost),
        pass: 'PASS_1_TRANSCRIBE',
        model: 'fictional-model',
        promptVersion: 'v1',
        inputTokens: 1,
        outputTokens: 1,
      }));
    },
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.storage.mockResolvedValue(false);
  mocks.connections.mockResolvedValue([]);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('recorded AI usage cost circuit (no provider calls)', () => {
  it.each(['THERAPIST', 'DOCTOR'])(
    'includes positive failed/timeout usage for %s without changing vertical scope',
    async () => {
      recordedCalls([
        call('SUCCESS', 1),
        call('ERROR', 0.25),
        call('TIMEOUT', 0.1),
        call('ERROR', 0),
        call('CIRCUIT_OPEN', 99),
        call('ERROR', -1),
        call('SUCCESS', 100, { sessionId: 'another-session' }),
      ]);
      expect((await getSessionTotalInr('fictional-session')).toString()).toBe('1.35');
      expect(mocks.aggregate).toHaveBeenCalledWith({
        where: {
          sessionId: 'fictional-session',
          status: { in: ['SUCCESS', 'ERROR', 'TIMEOUT'] },
          costInr: { gt: 0 },
        },
        select: {
          sessionId: true,
          pass: true,
          model: true,
          promptVersion: true,
          status: true,
          costInr: true,
          inputTokens: true,
          outputTokens: true,
        },
      });
    },
  );
  it('retains tenant/month boundaries and includes session-less attributed failures', async () => {
    recordedCalls([
      call('SUCCESS', 1),
      call('ERROR', 0.4, { sessionId: null }),
      call('TIMEOUT', 0.2),
      call('ERROR', 90, { owner: 'another-owner' }),
      call('ERROR', 90, { createdAt: new Date('2026-08-31T23:59:59Z') }),
      call('ERROR', 90, { createdAt: new Date('2026-10-01T00:00:00Z') }),
    ]);
    expect(
      (
        await getTherapistMonthlyTotalInr('fictional-owner', new Date('2026-09-13T00:00:00Z'))
      ).toString(),
    ).toBe('1.6');
    expect(mocks.aggregate.mock.calls[0][0].where.OR).toEqual([
      { session: { psychologistId: 'fictional-owner' } },
      { psychologistId: 'fictional-owner' },
    ]);
  });
  it('does not manufacture an amount when no cost was recorded', async () => {
    mocks.aggregate.mockResolvedValue([]);
    expect((await getSessionTotalInr('missing-session')).toString()).toBe('0');
    expect((await getTherapistMonthlyTotalInr('missing-owner')).toString()).toBe('0');
    // Zero is the known persisted sum, not a claim that every call was accounted for.
  });
  it('does not convert database unavailability into permission to spend', async () => {
    mocks.aggregate.mockRejectedValue(new Error('database unavailable'));
    await expect(
      checkCostCircuit({
        sessionId: 'fictional-session',
        psychologistId: 'fictional-owner',
        estimatedCostInr: 0,
      }),
    ).rejects.toThrow('database unavailable');
  });
  it('a recorded rejected response counts toward the existing configured session ceiling', async () => {
    vi.stubEnv('COST_CAP_PER_SESSION_INR', '1');
    vi.stubEnv('COST_CAP_PER_THERAPIST_MONTHLY_INR', '100');
    recordedCalls([call('ERROR', 0.9)]);
    await expect(
      checkCostCircuit({
        sessionId: 'fictional-session',
        psychologistId: 'fictional-owner',
        estimatedCostInr: 0.2,
      }),
    ).rejects.toMatchObject({
      meta: { scope: 'session', currentInr: 0.9, projectedInr: 1.1, capInr: 1 },
    });
    expect(mocks.aggregate.mock.calls[0][0].where.status.in).toContain('ERROR');
  });
  it('monthly-only guard uses the same recorded statuses and retains its configured ceiling', async () => {
    vi.stubEnv('COST_CAP_PER_THERAPIST_MONTHLY_INR', '1');
    recordedCalls([call('TIMEOUT', 0.9, { createdAt: new Date() })]);
    await expect(
      checkMonthlyCostCircuit({ psychologistId: 'fictional-owner', estimatedCostInr: 0.2 }),
    ).rejects.toMatchObject({ meta: { scope: 'monthly', capInr: 1 } });
    expect(mocks.aggregate.mock.calls[0][0].where.status.in).toContain('TIMEOUT');
  });
  it('existing success-only callers still proceed at (not over) the configured ceiling', async () => {
    vi.stubEnv('COST_CAP_PER_SESSION_INR', '1');
    vi.stubEnv('COST_CAP_PER_THERAPIST_MONTHLY_INR', '1');
    recordedCalls([call('SUCCESS', 0.8, { createdAt: new Date() })]);
    await expect(
      checkCostCircuit({
        sessionId: 'fictional-session',
        psychologistId: 'fictional-owner',
        estimatedCostInr: 0.2,
      }),
    ).resolves.toBeUndefined();
  });
  it.each([
    ['0.8000', 1],
    ['1.4000', 1.6],
  ])(
    'new receipts preserve the legacy %s baseline without adding overlapping copies',
    async (legacy, current) => {
      vi.stubEnv('COST_CAP_PER_SESSION_INR', '0.9');
      vi.stubEnv('COST_CAP_PER_THERAPIST_MONTHLY_INR', '100');
      mocks.storage.mockResolvedValue(true);
      const receipt = SessionUsageReceiptSchema.parse({
        version: 1,
        domain: 'CUREOCITY_LIVE_USAGE_V1',
        type: 'RECEIPT',
        connectionId: '471ee206-60ec-4e7e-a130-a64ed866e4e5',
        sessionId: 'fictional-session',
        psychologistId: 'fictional-owner',
        vertical: 'THERAPIST',
        sequence: 1,
        state: 'FINAL_REPORTED',
        endedAt: '2026-09-13T08:01:00.000Z',
        totals: {
          inputTokens: 1,
          outputTokens: 1,
          pass1Calls: 1,
          pass2Calls: 0,
          reasoningCalls: 0,
          unknownCalls: 0,
          costInr: '0.8000',
          transcriptionInr: '0.8000',
          notesInr: '0.0000',
          reasoningInr: '0.0000',
        },
        usageBasis: 'LOCAL_ESTIMATE',
        coverageReasons: [],
        provenance: {
          models: [],
          regions: [],
          promptVersions: [],
          pricingVersion: null,
          configurationVersion: null,
        },
      });
      mocks.connections.mockResolvedValue([
        {
          ...receipt,
          backend: 'vertex',
          startedAt: new Date('2026-09-13T08:00:00.000Z'),
          endedAt: new Date(receipt.endedAt!),
          lastSequence: 1,
          lastReceipt: receipt,
          lastPayloadHash: sessionUsageHash(receipt),
          costInr: '0.8000',
        },
      ]);
      mocks.aggregate.mockResolvedValue([
        {
          sessionId: 'fictional-session',
          status: 'SUCCESS',
          costInr: legacy,
          pass: 'PASS_11_REASONING',
          model: 'live-gateway:vertex',
          promptVersion: 'LIVE_CONSULT_ROLLUP_V1',
          inputTokens: 1,
          outputTokens: 1,
        },
        {
          sessionId: 'fictional-session',
          status: 'ERROR',
          costInr: '0.2000',
          pass: 'PASS_11_REASONING',
          model: 'fictional',
          promptVersion: 'actual-reasoning-v1',
          inputTokens: 1,
          outputTokens: 1,
        },
      ]);
      expect((await getSessionTotalInr('fictional-session')).toNumber()).toBe(current);
      await expect(
        checkCostCircuit({
          sessionId: 'fictional-session',
          psychologistId: 'fictional-owner',
          estimatedCostInr: 0,
        }),
      ).rejects.toMatchObject({ meta: { scope: 'session', currentInr: current, capInr: 0.9 } });
    },
  );
  it('fails closed when connection storage or stored receipt integrity cannot be verified', async () => {
    mocks.aggregate.mockResolvedValue([]);
    mocks.storage.mockRejectedValue(new Error('catalog unavailable'));
    await expect(getSessionTotalInr('fictional-session')).rejects.toThrow('catalog unavailable');
    mocks.storage.mockResolvedValue(true);
    mocks.connections.mockRejectedValue(new Error('receipts unavailable'));
    await expect(
      checkMonthlyCostCircuit({ psychologistId: 'fictional-owner', estimatedCostInr: 0 }),
    ).rejects.toThrow('receipts unavailable');
  });
});
