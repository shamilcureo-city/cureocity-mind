import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { SessionUsageCommand, SessionUsageReceipt } from '@cureocity/contracts';
import { Prisma } from '@prisma/client';

const m = vi.hoisted(() => ({
  query: vi.fn(),
  session: vi.fn(),
  read: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  enabled: vi.fn(),
  storage: vi.fn(),
  transaction: vi.fn(),
  capabilities: vi.fn(),
  consent: vi.fn(),
}));
vi.mock('./prisma', () => ({ prisma: { $transaction: m.transaction } }));
vi.mock('./audit', () => ({ writeAudit: m.audit }));
vi.mock('./capabilities', () => ({ assertCurrentCapabilities: m.capabilities }));
vi.mock('./consent-gate', () => ({ assertValidScribeConsent: m.consent }));
vi.mock('./session-usage-feature', () => ({ isSessionUsageEnabled: m.enabled }));
vi.mock('./session-usage-storage', () => ({ hasSessionUsageConnectionStorage: m.storage }));
import { POST } from '../app/api/v1/internal/session-usage/route';
import { sessionUsageHash, validateStoredSessionUsage } from './session-usage-integrity';

const registration = {
  version: 1,
  domain: 'CUREOCITY_LIVE_USAGE_V1',
  type: 'REGISTER',
  connectionId: '4c9473af-716b-49ed-93aa-34496bcbdfca',
  sessionId: 's-1',
  psychologistId: 'p-1',
  vertical: 'THERAPIST',
  startedAt: '2026-09-13T09:00:00.000Z',
  backend: 'vertex',
} as const;
const receipt = (overrides: Partial<SessionUsageReceipt> = {}): SessionUsageReceipt => ({
  version: 1,
  domain: registration.domain,
  type: 'RECEIPT',
  connectionId: registration.connectionId,
  sessionId: 's-1',
  psychologistId: 'p-1',
  vertical: 'THERAPIST',
  sequence: 1,
  state: 'OPEN',
  endedAt: null,
  totals: {
    inputTokens: 100,
    outputTokens: 12,
    pass1Calls: 1,
    pass2Calls: 0,
    reasoningCalls: 0,
    unknownCalls: 0,
    costInr: '0.1200',
    transcriptionInr: '0.1200',
    notesInr: '0.0000',
    reasoningInr: '0.0000',
  },
  usageBasis: 'LOCAL_ESTIMATE',
  coverageReasons: ['UNREPORTED_PROVIDER_ATTEMPTS'],
  provenance: {
    models: ['gemini-fixture'],
    regions: ['test-region'],
    promptVersions: ['TEST_V1'],
    pricingVersion: null,
    configurationVersion: 'LIVE_USAGE_V1',
  },
  ...overrides,
});
type Row = Parameters<typeof validateStoredSessionUsage>[0] & { clientId: string };
let rows: Row[];
let session: {
  id: string;
  clientId: string;
  psychologistId: string;
  status: string;
  captureMode: string;
  mindDocumentationMode: string;
  psychologist: { vertical: string };
  consentSnapshot: null;
};
let erased: boolean;
let events: string[];
const request = (payload: unknown, auth: string | null = 'Bearer test-only-service-secret') =>
  new Request('https://example.test/api/v1/internal/session-usage', {
    method: 'POST',
    headers: auth === null ? {} : { authorization: auth },
    body: typeof payload === 'string' ? payload : JSON.stringify(payload),
  }) as never;
const send = (payload: unknown = registration) => POST(request(payload));
async function saved(payload: SessionUsageCommand = registration) {
  const response = await send(payload);
  expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  return response.json();
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('LIVE_GATEWAY_SECRET', 'test-only-service-secret');
  rows = [];
  erased = false;
  events = [];
  session = {
    id: 's-1',
    clientId: 'c-1',
    psychologistId: 'p-1',
    status: 'IN_PROGRESS',
    captureMode: 'LIVE',
    mindDocumentationMode: 'AI',
    psychologist: { vertical: 'THERAPIST' },
    consentSnapshot: null,
  };
  m.enabled.mockReturnValue(true);
  m.storage.mockResolvedValue(true);
  m.query.mockImplementation(async (parts: TemplateStringsArray) => {
    const client = parts.join('').includes('FOR UPDATE OF c');
    events.push(client ? 'client-lock' : 'session-lock');
    return client ? (erased ? [] : [{ id: 'c-1', psychologistId: 'p-1' }]) : [{ id: session.id }];
  });
  m.session.mockImplementation(async () => {
    events.push('session-read');
    return session;
  });
  m.read.mockImplementation(
    async ({ where }) => rows.find((row) => row.connectionId === where.connectionId) ?? null,
  );
  m.create.mockImplementation(async ({ data }) => {
    const row = {
      ...data,
      endedAt: null,
      state: 'OPEN',
      lastSequence: 0,
      lastReceipt: null,
      lastPayloadHash: null,
      costInr: null,
    };
    rows.push(row);
    return row;
  });
  m.update.mockImplementation(async ({ where, data }) => {
    const row = rows.find((item) => item.connectionId === where.connectionId)!;
    Object.assign(row, data, { costInr: new Prisma.Decimal(data.costInr) });
    return row;
  });
  let tail = Promise.resolve();
  m.transaction.mockImplementation(async (fn) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    const before = rows.map((row) => ({ ...row }));
    try {
      return await fn({
        $queryRaw: m.query,
        session: { findUnique: m.session },
        sessionUsageConnection: { findUnique: m.read, create: m.create, update: m.update },
      });
    } catch (error) {
      rows = before;
      throw error;
    } finally {
      release();
    }
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('durable service-only live usage receipts', () => {
  it('registers only after Client -> Session locks, current capabilities and consent; null is not zero', async () => {
    expect(await saved()).toMatchObject({
      status: 'REGISTERED',
      latestSequence: 0,
      payloadHash: null,
    });
    expect(events).toEqual(['client-lock', 'session-lock', 'session-read']);
    expect(m.capabilities).toHaveBeenCalledWith('p-1', [
      'LIVE_ENCOUNTER',
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
    ]);
    expect(m.consent).toHaveBeenCalledWith(null, 'c-1', expect.anything());
    expect(rows[0].costInr).toBeNull();
    expect(validateStoredSessionUsage(rows[0])).toBeNull();
  });
  it.each([null, 'Bearer wrong', 'Basic test-only-service-secret'])(
    'rejects service authentication %s before DB',
    async (auth) => {
      const response = await POST(request(registration, auth));
      expect(response.status).toBe(401);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(m.transaction).not.toHaveBeenCalled();
    },
  );
  it('fails closed with no configured secret', async () => {
    vi.stubEnv('LIVE_GATEWAY_SECRET', '');
    expect((await send()).status).toBe(401);
  });
  it.each([
    '{',
    'x'.repeat(32_769),
    { ...registration, transcript: 'Do not store clinical text' },
    { ...registration, domain: 'OTHER' },
    { ...registration, connectionId: 'invalid' },
  ])('bounds and rejects invalid commands', async (payload) => {
    expect((await send(payload)).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it.each(['owner', 'client', 'vertical', 'erased'])(
    'rechecks %s before writes',
    async (change) => {
      if (change === 'owner') session.psychologistId = 'other';
      if (change === 'client') session.clientId = 'other';
      if (change === 'vertical') session.psychologist.vertical = 'DOCTOR';
      if (change === 'erased') erased = true;
      expect((await send()).status).toBe(404);
      expect(rows).toEqual([]);
    },
  );
  it.each(['flag', 'table', 'status', 'capture', 'manual', 'capability', 'consent'])(
    'blocks new registration when %s is unavailable',
    async (change) => {
      if (change === 'flag') m.enabled.mockReturnValue(false);
      if (change === 'table') m.storage.mockResolvedValue(false);
      if (change === 'status') session.status = 'COMPLETED';
      if (change === 'capture') session.captureMode = 'BATCH';
      if (change === 'manual') session.mindDocumentationMode = 'MANUAL';
      if (change === 'capability') m.capabilities.mockRejectedValue(new Error('denied'));
      if (change === 'consent') m.consent.mockRejectedValue(new Error('denied'));
      expect((await send()).status).toBeGreaterThanOrEqual(400);
      expect(rows).toEqual([]);
    },
  );
  it('does not enable doctor reporting in the first rollout', async () => {
    session.psychologist.vertical = 'DOCTOR';
    expect((await send({ ...registration, vertical: 'DOCTOR' })).status).toBe(503);
  });
  it('replays a registered identity after completion/flag-off but rejects reused identifiers', async () => {
    await saved();
    session.status = 'COMPLETED';
    m.enabled.mockReturnValue(false);
    expect(await saved()).toMatchObject({ status: 'REGISTERED' });
    expect(m.create).toHaveBeenCalledOnce();
    expect(m.audit).toHaveBeenCalledOnce();
    expect((await send({ ...registration, backend: 'mock' })).status).toBe(409);
    expect((await send({ ...registration, sessionId: 'other' })).status).toBe(404);
  });
  it('requires registration and exact immutable client/owner context even for late receipts', async () => {
    expect((await send(receipt())).status).toBe(404);
    await saved();
    rows[0].clientId = 'prior-client';
    expect((await send(receipt())).status).toBe(404);
  });
  it('serializes concurrent retries once, with exact payload hashes and no clinical audit content', async () => {
    await saved();
    const results = await Promise.all([saved(receipt()), saved(receipt())]);
    expect(results.map((item) => item.status)).toEqual(['ACCEPTED', 'DUPLICATE']);
    expect(results[0].payloadHash).toBe(sessionUsageHash(receipt()));
    expect(m.update).toHaveBeenCalledOnce();
    expect(JSON.stringify(m.audit.mock.calls)).not.toMatch(
      /gemini-fixture|test-region|test-only-service-secret|inputTokens/,
    );
  });
  it('rejects same-sequence different data, lower cumulative usage and cleared coverage gaps', async () => {
    await saved();
    await saved(receipt());
    expect(
      (await send(receipt({ provenance: { ...receipt().provenance, models: ['other'] } }))).status,
    ).toBe(409);
    expect(
      (await send(receipt({ sequence: 2, totals: { ...receipt().totals, inputTokens: 1 } })))
        .status,
    ).toBe(409);
    expect(
      (
        await send(
          receipt({
            sequence: 2,
            totals: { ...receipt().totals, costInr: '0.1000', transcriptionInr: '0.1000' },
          }),
        )
      ).status,
    ).toBe(409);
    expect((await send(receipt({ sequence: 2, coverageReasons: [] }))).status).toBe(409);
    expect(rows[0].lastSequence).toBe(1);
  });
  it('classifies older packets as stale without claiming old hash verification or mutation', async () => {
    await saved();
    await saved(receipt({ sequence: 3 }));
    expect(await saved(receipt())).toMatchObject({
      status: 'STALE',
      acceptedSequence: 1,
      latestSequence: 3,
      payloadHash: null,
    });
    expect(m.update).toHaveBeenCalledOnce();
  });
  it('accepts late incurred usage after completion and revoked authority, but not after erasure', async () => {
    await saved();
    session.status = 'COMPLETED';
    m.enabled.mockReturnValue(false);
    m.capabilities.mockRejectedValue(new Error('revoked'));
    m.consent.mockRejectedValue(new Error('withdrawn'));
    expect(await saved(receipt())).toMatchObject({ status: 'ACCEPTED' });
    erased = true;
    expect((await send(receipt({ sequence: 2 }))).status).toBe(404);
  });
  it('keeps interrupted receipts incomplete through late settlements and seals final receipts', async () => {
    await saved();
    const stopped = receipt({
      state: 'INCOMPLETE',
      endedAt: '2026-09-13T09:01:00.000Z',
      coverageReasons: ['UNREPORTED_PROVIDER_ATTEMPTS', 'INTERRUPTED'],
    });
    await saved(stopped);
    await saved({ ...stopped, sequence: 2 });
    expect((await send({ ...stopped, sequence: 3, state: 'FINAL_REPORTED' })).status).toBe(409);
    expect(
      (await send({ ...stopped, sequence: 3, endedAt: '2026-09-13T09:02:00.000Z' })).status,
    ).toBe(409);
    const second = { ...registration, connectionId: '90937bf5-4dc3-483b-989d-9428d61d6032' };
    await saved(second);
    const final = receipt({
      connectionId: second.connectionId,
      state: 'FINAL_REPORTED',
      endedAt: '2026-09-13T09:01:00.000Z',
    });
    await saved(final);
    expect(await saved(final)).toMatchObject({ status: 'DUPLICATE' });
    expect((await send({ ...final, sequence: 2 })).status).toBe(409);
  });
  it('rejects wrong backend basis and end times before the registered start', async () => {
    await saved();
    expect(
      (
        await send(
          receipt({
            usageBasis: 'MOCK_ZERO',
            totals: { ...receipt().totals, costInr: '0.0000', transcriptionInr: '0.0000' },
          }),
        )
      ).status,
    ).toBe(409);
    expect(
      (await send(receipt({ state: 'FINAL_REPORTED', endedAt: '2026-09-13T08:00:00.000Z' })))
        .status,
    ).toBe(409);
  });
  it('fails closed on corrupt stored receipts, including an apparently zero unreported row', async () => {
    await saved();
    rows[0].state = 'FINAL_REPORTED';
    expect((await send(receipt())).status).toBe(503);
    rows[0].state = 'OPEN';
    await saved(receipt());
    rows[0].lastPayloadHash = 'a'.repeat(64);
    expect((await send(receipt({ sequence: 2 }))).status).toBe(503);
  });
  it('rolls registration and updates back when the transactional audit fails without leaking errors', async () => {
    m.audit.mockRejectedValueOnce(new Error('private database details'));
    const response = await send();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('private database');
    expect(rows).toEqual([]);
    await saved();
    m.audit.mockRejectedValueOnce(new Error('unavailable'));
    expect((await send(receipt())).status).toBe(503);
    expect(rows[0].lastSequence).toBe(0);
  });
});
