import { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionUsageReceiptSchema } from '@cureocity/contracts';
const m = vi.hoisted(() => ({ calls: vi.fn(), connections: vi.fn(), storage: vi.fn() }));
vi.mock('./prisma', () => ({
  prisma: {
    geminiCallLog: { findMany: m.calls },
    sessionUsageConnection: { findMany: m.connections },
  },
}));
vi.mock('./session-usage-storage', () => ({ hasSessionUsageConnectionStorage: m.storage }));
import {
  groupRecordedUsage,
  LEGACY_LIVE_ROLLUP,
  loadRecordedUsage,
  recordedUsageEntries,
  summarizeSessionUsage,
  totalRecordedUsage,
  type UsageCallRow,
  type UsageConnectionRow,
} from './session-usage';
import { sessionUsageHash } from './session-usage-integrity';

const SESSION = 'fictional-visit';
const call = (costInr = '0.2700', patch: Partial<UsageCallRow> = {}): UsageCallRow => ({
  sessionId: SESSION,
  pass: 'PASS_11_REASONING',
  model: 'fictional',
  promptVersion: 'REAL_REASONING_V1',
  status: 'SUCCESS',
  costInr,
  inputTokens: 10,
  outputTokens: 5,
  ...patch,
});
function connection(
  amount = '1.0000',
  patch: Partial<UsageConnectionRow> = {},
): UsageConnectionRow {
  const receipt = SessionUsageReceiptSchema.parse({
    version: 1,
    domain: 'CUREOCITY_LIVE_USAGE_V1',
    type: 'RECEIPT',
    connectionId: '471ee206-60ec-4e7e-a130-a64ed866e4e5',
    sessionId: SESSION,
    psychologistId: 'fictional-owner',
    vertical: 'THERAPIST',
    sequence: 1,
    state: 'FINAL_REPORTED',
    endedAt: '2026-09-13T08:01:00.000Z',
    totals: {
      costInr: amount,
      transcriptionInr: amount,
      notesInr: '0.0000',
      reasoningInr: '0.0000',
      inputTokens: 1,
      outputTokens: 1,
      pass1Calls: 1,
      pass2Calls: 0,
      reasoningCalls: 0,
      unknownCalls: 0,
    },
    usageBasis: 'LOCAL_ESTIMATE',
    coverageReasons: ['UNREPORTED_PROVIDER_ATTEMPTS'],
    provenance: {
      models: ['fictional'],
      regions: ['fictional'],
      promptVersions: ['v1'],
      pricingVersion: null,
      configurationVersion: null,
    },
    ...(patch.connectionId ? { connectionId: patch.connectionId } : {}),
    ...(patch.vertical ? { vertical: patch.vertical } : {}),
  });
  return {
    connectionId: receipt.connectionId,
    sessionId: SESSION,
    psychologistId: receipt.psychologistId,
    vertical: receipt.vertical,
    backend: 'vertex',
    startedAt: new Date('2026-09-13T08:00:00.000Z'),
    endedAt: new Date(receipt.endedAt!),
    state: receipt.state,
    lastSequence: receipt.sequence,
    lastReceipt: receipt,
    lastPayloadHash: sessionUsageHash(receipt),
    costInr: new Prisma.Decimal(amount),
    ...patch,
  };
}
beforeEach(() => {
  vi.resetAllMocks();
  m.calls.mockResolvedValue([]);
  m.connections.mockResolvedValue([]);
  m.storage.mockResolvedValue(true);
});

describe('session usage source precedence', () => {
  it('counts two connection receipts once each plus a real web reasoning leaf', () => {
    const summary = summarizeSessionUsage(
      SESSION,
      [call()],
      [
        connection(),
        connection('1.0000', { connectionId: '82760a0c-5505-4c89-bcf0-9b22e4d4c93f' }),
      ],
    );
    expect(summary.recordedSubtotalInr).toBe('2.2700');
    expect(summary.connections.receipted).toBe(2);
    expect(summary.webCallRecords).toBe(1);
    expect(summary.coverage).toBe('PARTIAL');
    expect(summary.reconciliation).toBe('NOT_RECONCILED');
  });
  it.each([
    ['0.5000', '1.2700'],
    ['2.0000', '2.2700'],
  ])('uses lower bound for unresolved legacy %s overlap', (legacy, expected) => {
    const summary = summarizeSessionUsage(
      SESSION,
      [call(), call(legacy, { promptVersion: LEGACY_LIVE_ROLLUP })],
      [connection()],
    );
    expect(summary.recordedSubtotalInr).toBe(expected);
    expect(summary.lowerBound).toBe(true);
    expect(summary.legacyOverlap).toBe('UNPROVEN');
    expect(summary.legacySubtotalInr).toBe(legacy);
  });
  it('never adds latency telemetry or excludes every PASS_11 reasoning call', () => {
    const entries = recordedUsageEntries(
      [call(), call('0.5000', { promptVersion: LEGACY_LIVE_ROLLUP })],
      [],
    );
    expect(totalRecordedUsage(entries).toFixed(4)).toBe('0.7700');
    expect(entries.map((row) => row.pass)).toContain('PASS_11_REASONING');
  });
  it('includes failed/timeout positive costs but not circuit refusal, zero, negative or unrelated visit calls', () => {
    const summary = summarizeSessionUsage(
      SESSION,
      [
        call('1.0000', { status: 'ERROR' }),
        call('0.2500', { status: 'TIMEOUT' }),
        call('99.0000', { status: 'CIRCUIT_OPEN' }),
        call('0.0000'),
        call('-1.0000'),
        call('88.0000', { sessionId: 'other' }),
      ],
      [],
    );
    expect(summary.recordedSubtotalInr).toBe('1.2500');
    expect(summary.webCallRecords).toBe(2);
  });
  it('retains legacy-only partial coverage', () => {
    const summary = summarizeSessionUsage(
      SESSION,
      [call('2.2700', { promptVersion: LEGACY_LIVE_ROLLUP })],
      [],
      false,
    );
    expect(summary.recordedSubtotalInr).toBe('2.2700');
    expect(summary.coverageReasons).toContain('Connection tracking was not available');
  });
  it('distinguishes no receipt from explicitly reported zero', () => {
    const open = connection('0.0000', {
      lastSequence: 0,
      lastReceipt: null,
      lastPayloadHash: null,
      costInr: null,
      state: 'OPEN',
      endedAt: null,
    });
    const absent = summarizeSessionUsage(SESSION, [], [open]);
    expect(absent.recordedSubtotalInr).toBeNull();
    expect(absent.connections.open).toBe(1);
    const known = summarizeSessionUsage(SESSION, [], [connection('0.0000')]);
    expect(known.recordedSubtotalInr).toBe('0.0000');
    expect(known.coverage).toBe('PARTIAL');
  });
  it('rejects corrupt identity, amount, hash or no-receipt state instead of claiming zero', () => {
    for (const row of [
      connection('1.0000', { sessionId: 'other' }),
      connection('1.0000', { costInr: '9.0000' }),
      connection('1.0000', { lastPayloadHash: 'a'.repeat(64) }),
      connection('1.0000', {
        lastReceipt: null,
        lastSequence: 0,
        lastPayloadHash: null,
        costInr: null,
      }),
    ])
      expect(() => recordedUsageEntries([], [row])).toThrow();
  });
  it('keeps doctor/shared receipt semantics and separates live groups from pass/model leaves', () => {
    const entries = recordedUsageEntries([call()], [connection('1.0000', { vertical: 'DOCTOR' })]);
    expect(totalRecordedUsage(entries).toFixed(4)).toBe('1.2700');
    expect(groupRecordedUsage(entries, 'pass').map((row) => row.key)).toEqual([
      'LIVE_CONNECTIONS',
      'PASS_11_REASONING',
    ]);
    expect(
      groupRecordedUsage(entries, 'model').reduce((sum, row) => sum + (row.tokens ?? 0), 0),
    ).toBe(15);
  });
  it('keeps grouped amounts non-additive and unallocated live model tokens unknown', () => {
    const entries = recordedUsageEntries(
      [call(), call('0.5000', { promptVersion: LEGACY_LIVE_ROLLUP })],
      [connection()],
    );
    for (const by of ['pass', 'model', 'sessionId'] as const)
      expect(
        groupRecordedUsage(entries, by)
          .reduce((sum, row) => sum.plus(row.costInr), new Prisma.Decimal(0))
          .toFixed(4),
      ).toBe('1.2700');
    expect(
      groupRecordedUsage(entries, 'model').find((row) => row.key === 'Unreconciled live sources')
        ?.tokens,
    ).toBeNull();
  });
  it('refuses duplicate connection rows instead of counting a receipt twice', () => {
    expect(() => recordedUsageEntries([], [connection(), connection()])).toThrow(
      'Duplicate stored usage connection',
    );
  });
});

describe('canonical reader scope and fail-closed storage', () => {
  it('uses explicit ownership/window rules, not latest-visit attribution', async () => {
    const from = new Date('2026-09-01T00:00:00Z'),
      to = new Date('2026-10-01T00:00:00Z');
    await loadRecordedUsage({ psychologistId: 'owner', from, to });
    expect(m.calls.mock.calls[0][0].where).toMatchObject({
      createdAt: { gte: from, lt: to },
      status: { in: ['SUCCESS', 'ERROR', 'TIMEOUT'] },
      costInr: { gt: 0 },
      OR: [{ session: { psychologistId: 'owner' } }, { psychologistId: 'owner' }],
    });
    expect(m.connections.mock.calls[0][0].where).toEqual({
      psychologistId: 'owner',
      startedAt: { gte: from, lt: to },
    });
  });
  it('allows only catalog-confirmed missing table fallback', async () => {
    m.storage.mockResolvedValue(false);
    m.calls.mockResolvedValue([call()]);
    expect((await loadRecordedUsage({ sessionId: SESSION })).storageAvailable).toBe(false);
    expect(m.connections).not.toHaveBeenCalled();
    m.storage.mockRejectedValue(new Error('database unavailable'));
    await expect(loadRecordedUsage({ sessionId: SESSION })).rejects.toThrow('database unavailable');
  });
  it('does not ignore connection read failures when history exists', async () => {
    m.connections.mockRejectedValue(new Error('storage unavailable'));
    await expect(loadRecordedUsage({})).rejects.toThrow('storage unavailable');
  });
});
