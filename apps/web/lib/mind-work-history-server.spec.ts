import type { Prisma } from '@prisma/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MindCareRecordBodySchema, type MindSessionWork } from '@cureocity/contracts';

const m = vi.hoisted(() => ({
  auth: vi.fn(),
  query: vi.fn(),
  latest: vi.fn(),
  rows: vi.fn(),
  sessions: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: m.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: m.audit }));
vi.mock('./tenant-crypto', () => ({ decryptForTenant: m.decrypt }));
vi.mock('./prisma', () => ({ prisma: { $transaction: m.transaction } }));

import { loadMindWorkHistoryPage } from './mind-work-history-server';
import { GET } from '../app/api/v1/clients/[id]/session-work-history/route';

const baseBody = MindCareRecordBodySchema.parse({
  version: 'V1',
  agreement: {
    scope: 'Private counselling agreement not part of work history',
    confidentialityAndLimits: '',
    practicalArrangements: '',
    contactAndCrisisArrangements: '',
    clientPriorities: '',
    discussedOn: null,
    reviewOn: null,
  },
  clientVoice: {
    recordedOn: null,
    whatHelped: '',
    whatCouldChange: '',
    everydayChanges: '',
    clinicianReflection: '',
  },
  continuity: {
    stage: 'NOT_PLANNED',
    maintenancePlan: '',
    warningSignsAndResponse: '',
    endingOrReferralPlan: '',
    referralFollowThrough: '',
    reviewOn: null,
  },
});
const work = (
  sessionId = 'visit-1',
  workDone = 'Fictional clinician-authored work',
): MindSessionWork => ({
  sessionId,
  scheduledAt: '2026-09-10T09:00:00.000Z',
  disposition: 'USED',
  workDone,
  clientResponse: '',
});
type Row = {
  id: string;
  clientId: string;
  psychologistId: string;
  version: number;
  operationId: string;
  bodyEncrypted: string;
  createdAt: Date;
};
let records: Row[];
let plaintexts: Map<string, string | null>;
const tx = {
  $queryRaw: m.query,
  clientMindCareRecord: { findFirst: m.latest, findMany: m.rows },
  session: { findMany: m.sessions },
} as unknown as Prisma.TransactionClient;

function add(sessionWork?: MindSessionWork, changedOtherText?: string) {
  const version = records.length + 1;
  const body = {
    ...baseBody,
    ...(changedOtherText && { agreement: { ...baseBody.agreement, scope: changedOtherText } }),
    ...(sessionWork && { sessionWork }),
  };
  plaintexts.set(`encrypted-${version}`, JSON.stringify(body));
  records.push({
    id: `record-${version}`,
    clientId: 'client-1',
    psychologistId: 'psy-1',
    version,
    operationId: `private-operation-${version}`,
    bodyEncrypted: `encrypted-${version}`,
    createdAt: new Date(Date.UTC(2026, 8, 10, 10, version)),
  });
}
const read = (query = {}) => loadMindWorkHistoryPage(tx, 'client-1', 'psy-1', query);
const request = (query = '') =>
  new Request(`https://example.test/api/v1/clients/client-1/session-work-history${query}`) as never;
const route = (query = '') => GET(request(query), { params: Promise.resolve({ id: 'client-1' }) });

beforeEach(() => {
  vi.resetAllMocks();
  records = [];
  plaintexts = new Map();
  m.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  });
  m.query.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  m.latest.mockImplementation(async () =>
    records.length ? { version: Math.max(...records.map((row) => row.version)) } : null,
  );
  m.rows.mockImplementation(async ({ where, take }) =>
    records
      .filter(
        (row) =>
          row.version <= where.version.lte && (!where.version.lt || row.version < where.version.lt),
      )
      .sort((a, b) => b.version - a.version)
      .slice(0, take),
  );
  m.decrypt.mockImplementation(async (_owner, ciphertext) => plaintexts.get(ciphertext) ?? null);
  m.sessions.mockImplementation(async ({ where }) =>
    where.id.in.map((id: string) => ({
      id,
      clientId: 'client-1',
      psychologistId: 'psy-1',
    })),
  );
  m.transaction.mockImplementation(async (callback) => callback(tx));
});

describe('bounded encrypted session-work projection', () => {
  it('distinguishes no records from legacy records with no work', async () => {
    expect(await read()).toEqual({
      clientId: 'client-1',
      snapshotVersion: 0,
      beforeVersion: null,
      nextBeforeVersion: null,
      entries: [],
      hasMore: false,
    });
    add();
    expect(await read()).toMatchObject({ snapshotVersion: 1, entries: [], hasMore: false });
    expect(m.sessions).not.toHaveBeenCalled();
  });
  it('omits inherited copies and uses the actual work-changing version and save timestamp', async () => {
    add(work());
    add(work(), 'Updated unrelated care agreement');
    const page = await read();
    expect(page.entries).toEqual([
      { recordVersion: 1, savedAt: records[0]!.createdAt.toISOString(), work: work() },
    ]);
    expect(JSON.stringify(page)).not.toContain('Updated unrelated');
    expect(JSON.stringify(page)).not.toContain('Private counselling');
    expect(JSON.stringify(page)).not.toContain('operation');
    expect(JSON.stringify(page)).not.toContain('encrypted-');
  });
  it('retains genuine corrections and return-to-older-visit changes without claiming clinical completion', async () => {
    add(work());
    add({ ...work('visit-2'), disposition: 'NOT_USED' });
    add({ ...work('visit-1', 'Corrected wording for the first visit'), disposition: 'PAUSED' });
    const page = await read();
    expect(page.entries.map((entry) => entry.recordVersion)).toEqual([3, 2, 1]);
    expect(page.entries.map((entry) => entry.work.disposition)).toEqual([
      'PAUSED',
      'NOT_USED',
      'USED',
    ]);
    expect(page.entries.every((entry) => entry.work.clientResponse === '')).toBe(true);
    expect(m.sessions).toHaveBeenCalledWith({
      where: { id: { in: ['visit-1', 'visit-2'] }, clientId: 'client-1', psychologistId: 'psy-1' },
      select: { id: true, clientId: true, psychologistId: true },
    });
  });
  it('processes 25 raw versions plus predecessor and continues an empty change page', async () => {
    for (let index = 0; index < 30; index++) add(work(), `Other section revision ${index}`);
    const first = await read();
    expect(first).toMatchObject({
      snapshotVersion: 30,
      entries: [],
      nextBeforeVersion: 6,
      hasMore: true,
    });
    expect(m.rows).toHaveBeenCalledWith(expect.objectContaining({ take: 26 }));
    expect(m.decrypt).toHaveBeenCalledTimes(26);
    const last = await read({ snapshotVersion: 30, beforeVersion: 6 });
    expect(last.entries.map((entry) => entry.recordVersion)).toEqual([1]);
    expect(last).toMatchObject({ beforeVersion: 6, nextBeforeVersion: null, hasMore: false });
  });
  it('detects a real change exactly at the page boundary once, not on both pages', async () => {
    for (let index = 1; index <= 26; index++) add(work(index === 1 ? 'visit-1' : 'visit-2'));
    const first = await read();
    expect(first.entries.map((entry) => entry.recordVersion)).toEqual([2]);
    expect(first.nextBeforeVersion).toBe(2);
    const last = await read({ snapshotVersion: 26, beforeVersion: 2 });
    expect(last.entries.map((entry) => entry.recordVersion)).toEqual([1]);
  });
  it('pins continuation to the initial snapshot when newer records are appended', async () => {
    for (let index = 1; index <= 30; index++) add(work(`visit-${index}`));
    const first = await read();
    add(work('newer-visit'));
    const last = await read({
      snapshotVersion: first.snapshotVersion,
      beforeVersion: first.nextBeforeVersion!,
    });
    expect(first.entries.map((entry) => entry.recordVersion)).toEqual(
      Array.from({ length: 25 }, (_, index) => 30 - index),
    );
    expect(last.entries.map((entry) => entry.recordVersion)).toEqual([5, 4, 3, 2, 1]);
    expect(last.snapshotVersion).toBe(30);
    expect(JSON.stringify(last)).not.toContain('newer-visit');
  });
  it('accepts an exhausted cursor but rejects an unknown future snapshot', async () => {
    add(work());
    expect(await read({ snapshotVersion: 1, beforeVersion: 1 })).toMatchObject({
      entries: [],
      hasMore: false,
    });
    await expect(read({ snapshotVersion: 2, beforeVersion: 1 })).rejects.toThrow();
  });
  it('takes the lifecycle lock before queries and uses owner/client filters and metadata-only anchor', async () => {
    add(work());
    await read();
    expect(m.query.mock.invocationCallOrder[0]).toBeLessThan(m.latest.mock.invocationCallOrder[0]!);
    expect(m.latest).toHaveBeenCalledWith({
      where: { clientId: 'client-1', psychologistId: 'psy-1' },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    expect(m.rows).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { clientId: 'client-1', psychologistId: 'psy-1', version: { lte: 1 } },
      }),
    );
  });
  it.each(['missing predecessor', 'gap', 'out of order', 'wrong owner', 'wrong client'])(
    'fails closed for %s instead of manufacturing work or empty success',
    async (cause) => {
      for (let index = 1; index <= 27; index++) add(work(`visit-${index}`));
      const loaded = [...records].reverse().slice(0, 26);
      if (cause === 'missing predecessor') loaded.pop();
      if (cause === 'gap') loaded[25] = records[0]!;
      if (cause === 'out of order') [loaded[0], loaded[1]] = [loaded[1]!, loaded[0]!];
      if (cause === 'wrong owner') loaded[0] = { ...loaded[0]!, psychologistId: 'another-owner' };
      if (cause === 'wrong client') loaded[0] = { ...loaded[0]!, clientId: 'another-client' };
      m.rows.mockResolvedValueOnce(loaded);
      await expect(read()).rejects.toThrow();
      expect(m.decrypt).not.toHaveBeenCalled();
    },
  );
  it.each([null, '{invalid', JSON.stringify({ version: 'V1' })])(
    'refuses unreadable or malformed encrypted history %j',
    async (value) => {
      add(work());
      plaintexts.set('encrypted-1', value);
      await expect(read()).rejects.toThrow();
    },
  );
  it('validates even the unreadable predecessor before emitting a boundary change', async () => {
    for (let index = 1; index <= 26; index++) add(work());
    plaintexts.set('encrypted-1', null);
    await expect(read()).rejects.toThrow();
  });
  it.each(['missing', 'another owner', 'another client'])(
    'refuses an unconfirmable source visit: %s',
    async (cause) => {
      add(work());
      m.sessions.mockResolvedValue(
        cause === 'missing'
          ? []
          : [
              {
                id: 'visit-1',
                clientId: cause === 'another client' ? 'client-2' : 'client-1',
                psychologistId: cause === 'another owner' ? 'psy-2' : 'psy-1',
              },
            ],
      );
      await expect(read()).rejects.toThrow();
    },
  );
});

describe('session-work-history GET boundaries', () => {
  it('requires both capabilities, returns private data and audits only cursor metadata', async () => {
    add(work());
    const response = await route();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(m.auth.mock.calls.map((call) => call[1])).toEqual([
      'THERAPY_WORKFLOWS',
      'BEHAVIORAL_HEALTH_DOCUMENTATION',
    ]);
    expect(m.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'CLIENT_BRIEFING_VIEWED',
        metadata: {
          surface: 'mind-session-work-history',
          snapshotVersion: 1,
          beforeVersion: null,
          outcome: 'viewed',
        },
      }),
      tx,
    );
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('Fictional');
    expect(JSON.stringify(m.audit.mock.calls)).not.toContain('visit-1');
    expect(m.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 20_000 });
  });
  it.each(['THERAPY_WORKFLOWS', 'BEHAVIORAL_HEALTH_DOCUMENTATION'])(
    'does no data access without %s',
    async (missing) => {
      m.auth.mockImplementation(async (_req, capability) =>
        capability === missing
          ? { ok: false, response: new Response('Denied', { status: 403 }) }
          : { ok: true, value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } } },
      );
      const response = await route();
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(m.transaction).not.toHaveBeenCalled();
    },
  );
  it('does no data access for Scribe accounts', async () => {
    m.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'psy-1', user: { vertical: 'DOCTOR' } },
    });
    expect((await route()).status).toBe(404);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it.each([
    '?snapshotVersion=2',
    '?beforeVersion=2',
    '?snapshotVersion=1&beforeVersion=2',
    '?limit=100',
  ])('rejects invalid query %s before querying data', async (query) => {
    expect((await route(query)).status).toBe(400);
    expect(m.transaction).not.toHaveBeenCalled();
  });
  it.each([{ clients: [] }, { clients: [{ id: 'client-1', psychologistId: 'different-owner' }] }])(
    'refuses erased or foreign-owned clients',
    async ({ clients }) => {
      m.query.mockResolvedValue(clients);
      expect((await route()).status).toBe(404);
      expect(m.latest).not.toHaveBeenCalled();
      expect(m.audit).not.toHaveBeenCalled();
    },
  );
  it.each(['ciphertext', 'source', 'database', 'audit'])(
    'returns a generic private503 without history on %s failure',
    async (cause) => {
      add(work());
      if (cause === 'ciphertext') plaintexts.set('encrypted-1', null);
      if (cause === 'source') m.sessions.mockResolvedValue([]);
      if (cause === 'database') m.rows.mockRejectedValue(new Error('private database detail'));
      if (cause === 'audit') m.audit.mockRejectedValue(new Error('private audit detail'));
      const response = await route();
      expect(response.status).toBe(503);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual({
        error:
          'Saved work history could not be checked. It is not being treated as empty. Retry before relying on this history.',
      });
    },
  );
});
