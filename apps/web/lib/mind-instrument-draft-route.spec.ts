import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  query: vi.fn(),
  client: vi.fn(),
  draft: vi.fn(),
  transaction: vi.fn(),
  mutate: vi.fn(),
  state: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('./audit', () => ({ writeAudit: mocks.audit }));
vi.mock('./mind-instrument-draft-server', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./mind-instrument-draft-server')>()),
  mutateInstrumentDraft: mocks.mutate,
  instrumentDraftState: mocks.state,
}));
vi.mock('./tenant-crypto', () => ({ encryptForTenant: vi.fn(), decryptForTenant: vi.fn() }));
import { GET, POST } from '../app/api/v1/clients/[id]/instruments/[instrumentKey]/draft/route';

const tx = {
  $queryRaw: mocks.query,
  client: { findFirst: mocks.client },
  mindInstrumentDraft: { findUnique: mocks.draft },
};
const ctx = { params: Promise.resolve({ id: 'fictional-client', instrumentKey: 'PHQ9' }) };
const body = {
  operation: 'SAVE',
  mutationId: '00000000-0000-4000-8000-000000000001',
  expectedRevision: 0,
  responses: { phq9_1: 1 },
};
function request(method = 'POST', payload: unknown = body) {
  return new NextRequest(
    'https://mind.example.test/api/v1/clients/fictional-client/instruments/PHQ9/draft',
    {
      method,
      ...(method === 'POST'
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
        : {}),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'fictional-therapist', user: { vertical: 'THERAPIST' } },
  });
  mocks.capability.mockImplementation(async (_req, _cap, auth) => auth);
  mocks.transaction.mockImplementation(async (work) => work(tx));
  mocks.query.mockResolvedValue([
    { id: 'fictional-client', psychologistId: 'fictional-therapist' },
  ]);
  mocks.client.mockResolvedValue({ id: 'fictional-client' });
  mocks.draft.mockResolvedValue(null);
  mocks.mutate.mockResolvedValue({
    instrumentKey: 'PHQ9',
    revision: 1,
    status: 'ACTIVE',
    responses: { phq9_1: 1 },
  });
  mocks.state.mockResolvedValue({
    instrumentKey: 'PHQ9',
    revision: 0,
    status: 'ACTIVE',
    responses: {},
  });
  mocks.audit.mockResolvedValue(undefined);
});

describe('Mind draft route authorization and persistence boundaries', () => {
  it.each(['GET', 'POST'])(
    '%s requires authentication before any client lookup',
    async (method) => {
      mocks.auth.mockResolvedValue({ ok: false, response: new Response(null, { status: 401 }) });
      const result = await (method === 'GET' ? GET : POST)(request(method), ctx);
      expect(result.status).toBe(401);
      expect(mocks.transaction).not.toHaveBeenCalled();
    },
  );

  it.each(['MEASUREMENT_BASED_CARE', 'BEHAVIORAL_HEALTH_DOCUMENTATION'])(
    'refuses missing %s before draft access',
    async (cap) => {
      mocks.capability.mockImplementation(async (_req, requested, auth) =>
        requested === cap ? { ok: false, response: new Response(null, { status: 403 }) } : auth,
      );
      expect((await POST(request(), ctx)).status).toBe(403);
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.mutate).not.toHaveBeenCalled();
    },
  );

  it('keeps the Scribe doctor path out even if a capability mock grants both requirements', async () => {
    mocks.auth.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'doctor', user: { vertical: 'DOCTOR' } },
    });
    expect((await POST(request(), ctx)).status).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it.each([{ rows: [] }, { rows: [{ id: 'fictional-client', psychologistId: 'another-tenant' }] }])(
    'fails closed when the locked client is erased or belongs to another tenant',
    async ({ rows }) => {
      mocks.query.mockResolvedValue(rows);
      expect((await POST(request(), ctx)).status).toBe(404);
      expect(mocks.client).not.toHaveBeenCalled();
      expect(mocks.mutate).not.toHaveBeenCalled();
    },
  );

  it('rechecks active Mind client after obtaining the shared erasure lock', async () => {
    mocks.client.mockResolvedValue(null);
    expect((await POST(request(), ctx)).status).toBe(404);
    expect(mocks.client).toHaveBeenCalledWith({
      where: {
        id: 'fictional-client',
        psychologistId: 'fictional-therapist',
        deletedAt: null,
        status: 'ACTIVE',
        psychologist: { vertical: 'THERAPIST' },
      },
      select: { id: true },
    });
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('calls the mutation inside the same client-lock transaction and returns private no-store', async () => {
    const response = await POST(request(), ctx);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(mocks.mutate).toHaveBeenCalledWith(
      tx,
      {
        clientId: 'fictional-client',
        psychologistId: 'fictional-therapist',
        instrumentKey: 'PHQ9',
      },
      body,
    );
    expect(mocks.query.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.mutate.mock.invocationCallOrder[0]!,
    );
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), { timeout: 15_000 });
  });

  it('GET returns a saved state without creating or scoring anything', async () => {
    mocks.draft.mockResolvedValue({ psychologistId: 'fictional-therapist', revision: 3 });
    expect((await GET(request('GET'), ctx)).status).toBe(200);
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(mocks.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'MIND_INSTRUMENT_DRAFT_VIEWED',
        metadata: { clientId: 'fictional-client', instrumentKey: 'PHQ9', revision: 3 },
      }),
      tx,
    );
  });

  it('GET never decrypts a mismatched-tenant draft', async () => {
    mocks.draft.mockResolvedValue({ psychologistId: 'another-tenant', revision: 3 });
    expect((await GET(request('GET'), ctx)).status).toBe(404);
    expect(mocks.state).not.toHaveBeenCalled();
  });

  it('rejects a score or uncurated instrument before opening a transaction', async () => {
    expect((await POST(request('POST', { ...body, score: 0 }), ctx)).status).toBe(400);
    expect(
      (
        await POST(request(), {
          params: Promise.resolve({ id: 'fictional-client', instrumentKey: 'CUSTOM_SCALE' }),
        })
      ).status,
    ).toBe(404);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
