import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  capability: vi.fn(),
  clientFind: vi.fn(),
  diagnosisFind: vi.fn(),
  planFind: vi.fn(),
  sessionFind: vi.fn(),
  cacheFind: vi.fn(),
  upsert: vi.fn(),
  callLog: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  audit: vi.fn(),
  pass4: vi.fn(),
  router: vi.fn(),
}));

vi.mock('@/lib/auth-server', () => ({
  requirePsychologistId: mocks.authenticate,
  requireCapability: mocks.capability,
}));
vi.mock('@/lib/audit', () => ({ writeAudit: mocks.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    client: { findUnique: mocks.clientFind },
    clientDiagnosis: { findFirst: mocks.diagnosisFind },
    treatmentPlan: { findFirst: mocks.planFind },
    session: { findFirst: mocks.sessionFind },
    therapyScript: { findUnique: mocks.cacheFind },
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/llm', () => ({ modelRouter: mocks.router }));
vi.mock('@/lib/clinical-mappers', () => ({ toTherapyScript: (row: unknown) => row }));
vi.mock('@cureocity/observability/metrics', () => ({
  recordCostInr: vi.fn(),
  recordGeminiCall: vi.fn(),
}));

import { GET, POST } from '../app/api/v1/clients/[id]/therapy-scripts/route';
import { regulatedPolicyForRequest } from './regulated-route-capabilities';

const client = {
  id: 'client-1',
  psychologistId: 'psy-1',
  deletedAt: null,
  preferredLanguage: 'en',
  spokenLanguages: ['ml', 'en'],
  presentingConcerns: 'Synthetic concern',
};
const auth = { ok: true, value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } } };
const cached = {
  id: 'script-1',
  psychologistId: 'psy-1',
  therapyName: 'Grounding',
  language: 'en',
  body: { openingScript: 'Synthetic guide' },
};
const generated = {
  output: {
    therapyScript: { version: 'V1', therapyName: 'Grounding', openingScript: 'Synthetic guide' },
  },
  callLog: {
    pass: 'PASS_4_THERAPY_SCRIPT',
    model: 'synthetic',
    region: 'test',
    promptVersion: 'test',
    inputTokens: 1,
    outputTokens: 1,
    costInr: 0,
    latencyMs: 1,
    status: 'SUCCESS',
  },
};
let committedScript: unknown;
let committedAudit: unknown[];
let tx: {
  $queryRaw: typeof mocks.queryRaw;
  therapyScript: { upsert: typeof mocks.upsert };
  geminiCallLog: { create: typeof mocks.callLog };
};

beforeEach(() => {
  vi.resetAllMocks();
  committedScript = null;
  committedAudit = [];
  mocks.authenticate.mockResolvedValue(auth);
  mocks.capability.mockResolvedValue(auth);
  mocks.clientFind.mockResolvedValue(client);
  mocks.diagnosisFind.mockResolvedValue(null);
  mocks.planFind.mockResolvedValue(null);
  mocks.sessionFind.mockResolvedValue(null);
  mocks.cacheFind.mockResolvedValue(null);
  mocks.queryRaw.mockResolvedValue([{ id: 'client-1', psychologistId: 'psy-1' }]);
  mocks.router.mockReturnValue({ pass4: mocks.pass4 });
  mocks.pass4.mockResolvedValue(generated);
  mocks.upsert.mockImplementation(async ({ create }) => {
    committedScript = { ...create, id: 'script-generated' };
    return committedScript;
  });
  mocks.audit.mockImplementation(async (entry) => {
    committedAudit.push(entry);
  });
  tx = {
    $queryRaw: mocks.queryRaw,
    therapyScript: { upsert: mocks.upsert },
    geminiCallLog: { create: mocks.callLog },
  };
  mocks.transaction.mockImplementation(async (callback) => {
    const before = { script: committedScript, audits: [...committedAudit] };
    try {
      return await callback(tx);
    } catch (error) {
      committedScript = before.script;
      committedAudit = before.audits;
      throw error;
    }
  });
});

function request(method: 'GET' | 'POST', query = 'therapy=Grounding') {
  const handler = method === 'GET' ? GET : POST;
  return handler(
    new Request(`https://mind.example/api/v1/clients/client-1/therapy-scripts?${query}`, {
      method,
    }) as NextRequest,
    { params: Promise.resolve({ id: 'client-1' }) },
  );
}

function expectNoGeneration() {
  expect(mocks.router).not.toHaveBeenCalled();
  expect(mocks.pass4).not.toHaveBeenCalled();
  expect(mocks.transaction).not.toHaveBeenCalled();
  expect(mocks.callLog).not.toHaveBeenCalled();
  expect(mocks.upsert).not.toHaveBeenCalled();
}

describe.each(['GET', 'POST'] as const)('therapy script %s authorization', (method) => {
  it('requires authentication before looking up a client', async () => {
    mocks.authenticate.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 401 }),
    });
    expect((await request(method)).status).toBe(401);
    expect(mocks.clientFind).not.toHaveBeenCalled();
    expectNoGeneration();
  });

  it('rejects a doctor even if their capability fixture grants workflow access', async () => {
    mocks.authenticate.mockResolvedValue({
      ...auth,
      value: { ...auth.value, user: { vertical: 'DOCTOR' } },
    });
    expect((await request(method)).status).toBe(404);
    expect(mocks.capability).not.toHaveBeenCalled();
    expect(mocks.clientFind).not.toHaveBeenCalled();
    expectNoGeneration();
  });

  it('requires current THERAPY_WORKFLOWS before reading clinical context', async () => {
    mocks.capability.mockResolvedValue({
      ok: false,
      response: new Response(null, { status: 403 }),
    });
    expect((await request(method)).status).toBe(403);
    expect(mocks.capability).toHaveBeenCalledWith(expect.anything(), 'THERAPY_WORKFLOWS', auth);
    expect(mocks.clientFind).not.toHaveBeenCalled();
    expectNoGeneration();
  });

  it.each([
    ['missing', null],
    ['another owner', { ...client, psychologistId: 'another-practitioner' }],
    ['archived/erased', { ...client, deletedAt: new Date('2026-09-05T10:00:00Z') }],
  ] as const)(
    'rejects %s clients before grounding, cache access or generation',
    async (_label, row) => {
      mocks.clientFind.mockResolvedValue(row);
      expect((await request(method)).status).toBe(404);
      expect(mocks.diagnosisFind).not.toHaveBeenCalled();
      expect(mocks.cacheFind).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
      expectNoGeneration();
    },
  );

  it('validates the same generation query before reading the client', async () => {
    expect((await request(method, 'language=invalid')).status).toBe(400);
    expect(mocks.clientFind).not.toHaveBeenCalled();
    expectNoGeneration();
  });
});

describe('safe therapy-script GET', () => {
  it.each(['therapy=Grounding', 'therapy=Grounding&refresh=1'])(
    'returns only a cached script for %s',
    async (query) => {
      mocks.cacheFind.mockResolvedValue(cached);
      const response = await request('GET', query);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toEqual({ script: cached, source: 'cache' });
      expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ action: 'THERAPY_SCRIPT_VIEWED' }),
      );
      expectNoGeneration();
    },
  );

  it('returns a private, explicit cache-miss 404 without generating content', async () => {
    const response = await request('GET', 'therapy=Grounding&refresh=1');
    expect(response.status).toBe(404);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(await response.json()).toMatchObject({ code: 'THERAPY_SCRIPT_NOT_CACHED' });
    expect(mocks.audit).not.toHaveBeenCalled();
    expectNoGeneration();
  });

  it('does not disclose an existing cache row belonging to a different practitioner', async () => {
    mocks.cacheFind.mockResolvedValue({ ...cached, psychologistId: 'another-practitioner' });
    expect((await request('GET')).status).toBe(404);
    expect(mocks.audit).not.toHaveBeenCalled();
    expectNoGeneration();
  });
});

describe('explicit therapy-script POST', () => {
  it('reuses a current cached script without another model call', async () => {
    mocks.cacheFind.mockResolvedValue(cached);
    expect(await (await request('POST')).json()).toEqual({ script: cached, source: 'cache' });
    expectNoGeneration();
  });

  it.each(['therapy=Grounding', 'therapy=Grounding&refresh=1'])(
    'generates with existing language/grounding and atomically persists for %s',
    async (query) => {
      if (query.includes('refresh')) mocks.cacheFind.mockResolvedValue(cached);
      const response = await request('POST', query);
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
      expect(await response.json()).toMatchObject({
        script: { id: 'script-generated' },
        source: 'fresh',
      });
      expect(mocks.pass4).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          therapyName: 'Grounding',
          language: 'en',
          spokenLanguage: 'ml',
          presentingConcerns: 'Synthetic concern',
        }),
      );
      expect(mocks.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ psychologistId: 'psy-1' }),
          create: expect.objectContaining({ clientId: 'client-1', psychologistId: 'psy-1' }),
        }),
      );
      expect(mocks.audit).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ action: 'THERAPY_SCRIPT_GENERATED' }),
        tx,
      );
      expect(mocks.capability).toHaveBeenCalledTimes(3);
      expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.upsert.mock.invocationCallOrder[0]!,
      );
    },
  );

  it('does not invoke AI if workflow access is revoked after context loading', async () => {
    mocks.capability
      .mockResolvedValueOnce(auth)
      .mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await request('POST')).status).toBe(403);
    expectNoGeneration();
  });

  it('does not persist or audit generated content after a capability revocation', async () => {
    mocks.capability
      .mockResolvedValueOnce(auth)
      .mockResolvedValueOnce(auth)
      .mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) });
    expect((await request('POST')).status).toBe(403);
    expect(mocks.pass4).toHaveBeenCalledOnce();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('does not hold the client lock during AI and refuses the write if erasure wins', async () => {
    let finish!: () => void;
    mocks.pass4.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(generated);
        }),
    );
    const pending = request('POST');
    await vi.waitFor(() => expect(mocks.pass4).toHaveBeenCalledOnce());
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.queryRaw.mockResolvedValue([]);
    finish();
    expect((await pending).status).toBe(404);
    expect(mocks.callLog).not.toHaveBeenCalled();
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('does not persist anything when the model fails', async () => {
    mocks.pass4.mockRejectedValue(new Error('model unavailable'));
    await expect(request('POST')).rejects.toThrow('model unavailable');
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it('rolls the generated script back when its audit cannot commit', async () => {
    mocks.audit.mockRejectedValue(new Error('audit unavailable'));
    await expect(request('POST')).rejects.toThrow('audit unavailable');
    expect(committedScript).toBeNull();
    expect(committedAudit).toEqual([]);
  });

  it('registers both handlers in the central capability inventory', () => {
    for (const method of ['GET', 'POST'] as const) {
      expect(
        regulatedPolicyForRequest('/api/v1/clients/client-1/therapy-scripts', method),
      ).toMatchObject({ methods: ['GET', 'POST'] });
    }
  });
});
