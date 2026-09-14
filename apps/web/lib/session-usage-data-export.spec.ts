import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { canonicalSessionUsagePayload, SessionUsageReceiptSchema } from '@cureocity/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lock: vi.fn() }));
vi.mock('./phi-write-lock', () => ({ lockActiveClient: mocks.lock }));
import { loadSessionUsageDataExport } from './session-usage-data-export';

const now = new Date('2026-09-13T09:00:00.000Z');
const connectionId = '00000000-0000-4000-8000-000000000001';
const tx = { $queryRaw: vi.fn(), sessionUsageConnection: { findMany: vi.fn() } };
function row() {
  return {
    connectionId,
    sessionId: 'visit',
    psychologistId: 'owner',
    clientId: 'client',
    vertical: 'THERAPIST',
    backend: 'vertex',
    startedAt: now,
    registeredAt: now,
    updatedAt: now,
    endedAt: null as Date | null,
    state: 'OPEN',
    lastSequence: 0,
    lastPayloadHash: null as string | null,
    lastReceipt: null as unknown,
    costInr: null as Prisma.Decimal | null,
  };
}
function reported() {
  const receipt = SessionUsageReceiptSchema.parse({
    version: 1,
    domain: 'CUREOCITY_LIVE_USAGE_V1',
    type: 'RECEIPT',
    connectionId,
    sessionId: 'visit',
    psychologistId: 'owner',
    vertical: 'THERAPIST',
    sequence: 1,
    state: 'FINAL_REPORTED',
    endedAt: '2026-09-13T09:01:00.000Z',
    totals: {
      inputTokens: 1,
      outputTokens: 2,
      pass1Calls: 1,
      pass2Calls: 0,
      reasoningCalls: 0,
      unknownCalls: 0,
      costInr: '0.1000',
      transcriptionInr: '0.1000',
      notesInr: '0.0000',
      reasoningInr: '0.0000',
    },
    usageBasis: 'LOCAL_ESTIMATE',
    coverageReasons: ['UNREPORTED_PROVIDER_ATTEMPTS'],
    provenance: {
      models: ['model'],
      regions: [],
      promptVersions: [],
      pricingVersion: null,
      configurationVersion: null,
    },
  });
  return {
    ...row(),
    endedAt: new Date(receipt.endedAt!),
    state: receipt.state,
    lastSequence: 1,
    lastPayloadHash: createHash('sha256')
      .update(canonicalSessionUsagePayload(receipt))
      .digest('hex'),
    lastReceipt: receipt,
    costInr: new Prisma.Decimal(receipt.totals.costInr),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.lock.mockResolvedValue({ id: 'client' });
  tx.$queryRaw.mockResolvedValue([{ exists: true }]);
  tx.sessionUsageConnection.findMany.mockResolvedValue([]);
});
describe('sanitized session usage disclosure', () => {
  it('exports all registered rows without a reporting flag or clinical entitlement', async () => {
    tx.sessionUsageConnection.findMany.mockResolvedValue([row(), reported()]);
    const result = await loadSessionUsageDataExport(tx as never, 'client', 'owner');
    expect(result).toHaveLength(2);
    expect(result[0]?.totals).toBeNull();
    expect(result[1]?.totals?.costInr).toBe('0.1000');
    expect(result[1]?.provenance?.pricingVersion).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(
      /connectionId|lastPayloadHash|psychologistId|lastSequence|serviceSecret/,
    );
    expect(tx.sessionUsageConnection.findMany).toHaveBeenCalledWith({
      where: {
        clientId: 'client',
        psychologistId: 'owner',
        session: { clientId: 'client', psychologistId: 'owner' },
      },
      orderBy: [{ sessionId: 'asc' }, { registeredAt: 'asc' }, { connectionId: 'asc' }],
    });
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      tx.$queryRaw.mock.invocationCallOrder[0]!,
    );
  });
  it('distinguishes an explicit known zero from no receipt', async () => {
    const zero = reported();
    zero.lastReceipt = {
      ...zero.lastReceipt,
      totals: { ...zero.lastReceipt.totals, costInr: '0.0000', transcriptionInr: '0.0000' },
    };
    zero.costInr = new Prisma.Decimal(0);
    zero.lastPayloadHash = createHash('sha256')
      .update(canonicalSessionUsagePayload(zero.lastReceipt))
      .digest('hex');
    tx.sessionUsageConnection.findMany.mockResolvedValue([zero]);
    expect(
      (await loadSessionUsageDataExport(tx as never, 'client', 'owner'))[0]?.totals?.costInr,
    ).toBe('0.0000');
  });
  it('returns empty only for confirmed missing pre-migration table', async () => {
    tx.$queryRaw.mockResolvedValue([{ exists: false }]);
    await expect(loadSessionUsageDataExport(tx as never, 'client', 'owner')).resolves.toEqual([]);
    expect(tx.sessionUsageConnection.findMany).not.toHaveBeenCalled();
  });
  it('propagates erasure and present-table failures rather than reporting empty history', async () => {
    mocks.lock.mockRejectedValueOnce(new Error('erased'));
    await expect(loadSessionUsageDataExport(tx as never, 'client', 'owner')).rejects.toThrow(
      'erased',
    );
    expect(tx.$queryRaw).not.toHaveBeenCalled();
    tx.sessionUsageConnection.findMany.mockRejectedValueOnce(new Error('unavailable'));
    await expect(loadSessionUsageDataExport(tx as never, 'client', 'owner')).rejects.toThrow(
      'unavailable',
    );
  });
  it.each([
    { costInr: new Prisma.Decimal('0.2000') },
    { psychologistId: 'other' },
    { clientId: 'other' },
    { lastSequence: 2 },
    { lastPayloadHash: 'a'.repeat(64) },
    { backend: 'mock' },
    { lastReceipt: { unsafeText: 'never export' } },
  ])('fails closed for inconsistent or malformed persisted receipt %j', async (patch) => {
    tx.sessionUsageConnection.findMany.mockResolvedValue([{ ...reported(), ...patch }]);
    await expect(loadSessionUsageDataExport(tx as never, 'client', 'owner')).rejects.toThrow();
  });
  it('does not convert partially written receipt metadata into an empty registration', async () => {
    tx.sessionUsageConnection.findMany.mockResolvedValue([
      { ...row(), costInr: new Prisma.Decimal(0) },
    ]);
    await expect(loadSessionUsageDataExport(tx as never, 'client', 'owner')).rejects.toThrow(
      'Stored usage receipt is inconsistent',
    );
  });
});
