import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  query: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  audit: vi.fn(),
  lock: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('./audit', () => ({ writeAudit: mocks.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('./phi-write-lock', () => ({
  lockActiveClientForSession: mocks.lock,
  ClientPhiWriteForbiddenError: class extends Error {},
}));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.session },
    noteReview: { findMany: mocks.list },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({ $queryRaw: mocks.query, noteReview: { create: mocks.create } }),
  },
}));
import { GET, POST } from '../app/api/v1/sessions/[id]/note/review/route';
const signature = 'a'.repeat(64),
  timestamp = new Date('2026-10-08T00:00:00Z');
const ctx = { params: Promise.resolve({ id: 'session' }) };
function request(body: Record<string, unknown> = {}) {
  return new Request('https://mind.example/api/v1/sessions/session/note/review', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      reviewerName: 'Fictional supervisor',
      reviewedSignatureHash: signature,
      ...body,
    }),
  }) as never;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'owner' } });
  mocks.session.mockResolvedValue({ psychologistId: 'owner', therapyNote: { id: 'note' } });
  mocks.query.mockResolvedValue([
    {
      id: 'note',
      locked: true,
      signPayload: 'signed-payload',
      signChallengeHashHex: signature,
      signedAt: timestamp,
    },
  ]);
  mocks.create.mockImplementation(async ({ data }) => ({
    id: 'review',
    ...data,
    createdAt: timestamp,
  }));
});
describe('supervision review version binding', () => {
  it('binds the review to the locked signed revision and audits atomically', async () => {
    const res = await POST(request(), ctx);
    expect(res.status).toBe(201);
    expect((await res.json()).review.reviewedSignatureHash).toBe(signature);
    expect(mocks.lock).toHaveBeenCalled();
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        reviewedSignatureHash: signature,
        reviewedSignedAt: timestamp,
        therapyNoteId: 'note',
      }),
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything());
  });
  it.each([
    { locked: false, signPayload: null, signChallengeHashHex: signature },
    { locked: true, signPayload: 'new', signChallengeHashHex: 'b'.repeat(64) },
  ])('rejects reopened or subsequently re-signed versions', async (note) => {
    mocks.query.mockResolvedValue([{ id: 'note', signedAt: timestamp, ...note }]);
    expect((await POST(request(), ctx)).status).toBe(409);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('rejects requests from an old editor without a displayed signature', async () => {
    expect((await POST(request({ reviewedSignatureHash: undefined }), ctx)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('does not leak or review another owner session', async () => {
    mocks.session.mockResolvedValue({ psychologistId: 'another' });
    expect((await POST(request(), ctx)).status).toBe(404);
    expect(mocks.query).not.toHaveBeenCalled();
  });
  it('keeps unbound legacy reviews historical without inventing a signature', async () => {
    mocks.list.mockResolvedValue([
      {
        id: 'legacy',
        reviewerName: 'Fictional supervisor',
        reviewerNote: null,
        reviewedAt: timestamp,
        createdAt: timestamp,
        reviewedSignatureHash: null,
        reviewedSignedAt: null,
      },
    ]);
    const res = await GET(request(), ctx);
    expect((await res.json()).reviews[0].reviewedSignatureHash).toBeNull();
  });
});
