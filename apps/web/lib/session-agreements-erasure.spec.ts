import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  read: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./prisma', () => ({
  prisma: { session: { findFirst: mocks.session }, $transaction: mocks.transaction },
}));
import { GET, POST } from '../app/api/v1/sessions/[id]/agreements/route';

const params = { params: Promise.resolve({ id: 'session-1' }) };
const row = {
  id: 'agreement-1',
  sessionId: 'session-1',
  text: 'Practise grounding before next visit',
  speaker: 'THERAPIST',
  followUp: null,
  createdAt: new Date('2026-09-06T10:00:00.000Z'),
};
const client = { id: 'client-1', psychologistId: 'psy-1' };
const request = (method: 'GET' | 'POST') =>
  new Request('https://example.test/api/v1/sessions/session-1/agreements', {
    method,
    ...(method === 'POST'
      ? {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: row.text, speaker: row.speaker }),
        }
      : {}),
  });
const get = () => GET(request('GET') as never, params);
const post = () => POST(request('POST') as never, params);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  mocks.session.mockResolvedValue({ id: 'session-1', clientId: 'client-1' });
  mocks.queryRaw.mockResolvedValue([client]);
  mocks.read.mockResolvedValue([row]);
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue(row);
  mocks.audit.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      $queryRaw: mocks.queryRaw,
      sessionAgreement: { findMany: mocks.read, count: mocks.count, create: mocks.create },
    }),
  );
});

describe('session agreements terminal-client boundary', () => {
  it('returns the same 404 for another owner or a deleted client without entering a transaction', async () => {
    mocks.session.mockResolvedValue(null);
    expect((await get()).status).toBe(404);
    expect((await post()).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.session).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'session-1', psychologistId: 'psy-1', client: { is: { deletedAt: null } } },
      }),
    );
  });
  it('does not disclose agreements when erasure wins after the initial owner lookup', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: 'Session not found' });
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it('cannot recreate PHI when erasure wins after the initial owner lookup', async () => {
    mocks.queryRaw.mockResolvedValue([]);
    const response = await post();
    expect(response.status).toBe(404);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('uses the shared client lock before returning owned agreements', async () => {
    expect((await get()).status).toBe(200);
    const sql = Array.from(mocks.queryRaw.mock.calls[0]![0] as TemplateStringsArray).join('?');
    expect(sql).toContain('c."deletedAt" IS NULL');
    expect(sql).toContain('FOR UPDATE OF c');
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.read.mock.invocationCallOrder[0]!,
    );
  });
  it('keeps post-sign care decisions independent of AI and audits the write under the same lock', async () => {
    mocks.session.mockResolvedValue({
      id: 'session-1',
      clientId: 'client-1',
      therapyNote: { locked: true },
      clinicalReport: null,
    });
    expect((await post()).status).toBe(201);
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.count.mock.invocationCallOrder[0]!,
    );
    expect(mocks.count.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.create.mock.invocationCallOrder[0]!,
    );
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'AGREEMENT_RECORDED', targetId: row.id }),
      expect.objectContaining({ $queryRaw: mocks.queryRaw }),
    );
  });
  it('checks the eight-agreement quota under the lock and writes nothing when full', async () => {
    mocks.count.mockResolvedValue(8);
    expect((await post()).status).toBe(422);
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('allows only one of two concurrent attempts to claim the eighth agreement', async () => {
    let count = 7;
    let tail = Promise.resolve();
    mocks.transaction.mockImplementation(async (callback) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      const tx = {
        $queryRaw: vi.fn(async () => {
          await previous;
          return [client];
        }),
        sessionAgreement: {
          count: vi.fn(async () => count),
          create: vi.fn(async () => {
            count += 1;
            return row;
          }),
        },
      };
      try {
        return await callback(tx);
      } finally {
        release();
      }
    });
    const responses = await Promise.all([post(), post()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 422]);
    expect(count).toBe(8);
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
});
