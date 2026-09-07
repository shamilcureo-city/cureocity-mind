import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  duplicate: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  audit: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./prisma', () => ({
  prisma: { session: { findFirst: mocks.session }, $transaction: mocks.transaction },
}));
import { POST } from '../app/api/v1/sessions/[id]/agreements/route';

type Row = {
  id: string;
  sessionId: string;
  clientId: string;
  psychologistId: string;
  text: string;
  speaker: 'THERAPIST' | 'CLIENT';
  followUp: 'DONE' | 'PARTLY' | 'NOT_YET' | null;
  createdAt: Date;
};
const client = { id: 'fictional-client', psychologistId: 'fictional-owner' };
const original: Row = {
  id: 'receipt-1',
  sessionId: 'fictional-session',
  clientId: client.id,
  psychologistId: client.psychologistId,
  text: 'Fictional agreed next step',
  speaker: 'THERAPIST',
  followUp: null,
  createdAt: new Date('2026-09-06T10:00:00.000Z'),
};
let rows: Row[];
const post = (body: unknown = { text: original.text, speaker: original.speaker }) =>
  POST(
    new Request('https://example.test/api/v1/sessions/fictional-session/agreements', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }) as never,
    { params: Promise.resolve({ id: original.sessionId }) },
  );

beforeEach(() => {
  vi.resetAllMocks();
  rows = [];
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: client.psychologistId } });
  mocks.session.mockResolvedValue({ id: original.sessionId, clientId: client.id });
  mocks.lock.mockResolvedValue([client]);
  mocks.duplicate.mockImplementation(
    async ({ where }: { where: Partial<Row> }) =>
      rows.find((row) =>
        Object.entries(where).every(([key, value]) => row[key as keyof Row] === value),
      ) ?? null,
  );
  mocks.count.mockImplementation(
    async ({ where }: { where: { sessionId: string } }) =>
      rows.filter((row) => row.sessionId === where.sessionId).length,
  );
  mocks.create.mockImplementation(async ({ data }: { data: Partial<Row> }) => {
    const row = { ...original, ...data, id: 'receipt-' + (rows.length + 1) };
    rows.push(row);
    return row;
  });
  // Model the real shared active-client lock: work after the SQL lock waits
  // for the prior transaction, so concurrent requests see its committed row.
  let tail = Promise.resolve();
  mocks.transaction.mockImplementation(async (callback) => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      return await callback({
        $queryRaw: async () => {
          await previous;
          return mocks.lock();
        },
        sessionAgreement: { findFirst: mocks.duplicate, count: mocks.count, create: mocks.create },
      });
    } finally {
      release();
    }
  });
});

describe('agreement creation retry receipts', () => {
  it('returns the original receipt after a lost response without another row, audit or quota check', async () => {
    const first = await post();
    const retry = await post();
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(await first.json());
    expect(rows).toHaveLength(1);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.count).toHaveBeenCalledOnce();
    expect(mocks.lock.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.duplicate.mock.invocationCallOrder[0]!,
    );
  });

  it('deduplicates two concurrent saves even when the first fills the eighth slot', async () => {
    rows = Array.from({ length: 7 }, (_, index) => ({
      ...original,
      id: 'seed-' + index,
      text: 'Other fictional step ' + index,
    }));
    const replies = await Promise.all([post(), post()]);
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 201]);
    expect(await replies[0]!.json()).toEqual(await replies[1]!.json());
    expect(rows).toHaveLength(8);
    expect(mocks.create).toHaveBeenCalledOnce();
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.count).toHaveBeenCalledOnce();
  });

  it('still rejects a different ninth agreement', async () => {
    rows = Array.from({ length: 8 }, (_, index) => ({
      ...original,
      id: 'seed-' + index,
      text: 'Other fictional step ' + index,
    }));
    expect((await post()).status).toBe(422);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each([
    { speaker: 'CLIENT' as const },
    { text: original.text + ' tomorrow' },
    { followUp: 'DONE' as const },
    { sessionId: 'another-session' },
    { clientId: 'another-client' },
    { psychologistId: 'another-owner' },
  ])('does not reuse a different agreement or tenant receipt: %j', async (difference) => {
    rows = [{ ...original, ...difference }];
    expect((await post()).status).toBe(201);
    expect(rows).toHaveLength(2);
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(mocks.duplicate).toHaveBeenCalledWith({
      where: {
        sessionId: original.sessionId,
        clientId: client.id,
        psychologistId: client.psychologistId,
        text: original.text,
        speaker: original.speaker,
        followUp: null,
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  });

  it('compares the existing schema output without adding whitespace or case normalization', async () => {
    rows = [{ ...original }];
    expect(
      (await post({ text: ' ' + original.text + ' ', speaker: original.speaker })).status,
    ).toBe(201);
    expect(rows[1]!.text).toBe(' ' + original.text + ' ');
    // Creation does not accept followUp; unknown fields are stripped by its schema.
    expect(
      (await post({ text: original.text, speaker: original.speaker, followUp: 'DONE' })).status,
    ).toBe(200);
  });

  it('does not return an existing receipt if erasure wins before the lock', async () => {
    rows = [{ ...original }];
    mocks.lock.mockResolvedValue([]);
    expect((await post()).status).toBe(404);
    expect(mocks.duplicate).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('keeps auth rejection and tenant ownership checks before duplicate reads', async () => {
    rows = [{ ...original }];
    mocks.auth.mockResolvedValueOnce({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await post()).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    mocks.session.mockResolvedValue(null);
    expect((await post()).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.duplicate).not.toHaveBeenCalled();
  });
});
