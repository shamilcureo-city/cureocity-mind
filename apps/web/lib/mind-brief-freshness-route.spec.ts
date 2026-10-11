import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreSessionBriefV1Schema } from '@cureocity/contracts';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  client: vi.fn(),
  session: vi.fn(),
  brief: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  load: vi.fn(),
  audit: vi.fn(),
  pass: vi.fn(),
  callLog: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.auth,
}));
vi.mock('./prisma', () => ({
  prisma: {
    client: { findUnique: mocks.client },
    session: { findFirst: mocks.session },
    preSessionBrief: { findFirst: mocks.brief, create: mocks.create, update: mocks.update },
    exerciseAssignment: { findMany: async () => [] },
    sessionAgreement: { findMany: async () => [] },
    caseFormulation: { findFirst: async () => null },
    clientDiagnosis: { findMany: async () => [] },
    geminiCallLog: { create: mocks.callLog },
  },
}));
vi.mock('./capabilities', () => ({
  getEffectiveCapabilities: async () => ({
    capabilities: new Set([
      'CLINICAL_ANALYSIS',
      'THERAPY_WORKFLOWS',
      'MEASUREMENT_BASED_CARE',
      'SAFETY_PLANNING',
    ]),
  }),
}));
vi.mock('./journey', () => ({
  JourneyError: class extends Error {},
  computeClientJourney: async () => ({
    stage: 'ACTIVE_TREATMENT',
    activePlan: null,
    instrumentChanges: [],
    nextBestAction: null,
  }),
}));
vi.mock('./crisis-flags', () => ({ fetchOpenCrises: async () => [] }));
vi.mock('./active-session-agreements', () => ({
  loadActiveSessionAgreements: async () => ({ agreements: [], total: 0, nextCursor: null }),
}));
vi.mock('./audit', () => ({ writeAudit: mocks.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('./clinical-mappers', () => ({
  toPreSessionBrief: (row: { body: unknown }) => ({
    ...row,
    body: PreSessionBriefV1Schema.parse(row.body),
  }),
}));
vi.mock('./llm', () => ({ modelRouter: () => ({ pass5: mocks.pass }) }));
vi.mock('@cureocity/observability/metrics', () => ({
  recordGeminiCall: vi.fn(),
  recordCostInr: vi.fn(),
}));
vi.mock('./pre-session-brief-context', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pre-session-brief-context')>()),
  loadPreSessionBriefContext: mocks.load,
}));
import { GET, POST } from '../app/api/v1/clients/[id]/pre-session-brief/route';
import { GET as prepare } from '../app/api/v1/clients/[id]/prepare/route';
import { withBriefContext } from './pre-session-brief-context';
import { regulatedPolicyForRequest } from './regulated-route-capabilities';
const body = PreSessionBriefV1Schema.parse({
  version: 'V1',
  contextLine: 'Saved context',
  lastSessionRecap: '',
  todaysFocus: 'Review together',
  openingLine: 'Where should we begin?',
  homeworkStatus: null,
});
const fingerprint = 'a'.repeat(64);
const row = {
  id: 'brief-1',
  lastSessionId: 'session-1',
  body: withBriefContext(body, fingerprint),
  createdAt: new Date('2026-10-11T10:00:00Z'),
};
const context = { params: Promise.resolve({ id: 'client-1' }) };
const request = (method: 'GET' | 'POST', refresh = false) =>
  new Request(
    `https://mind.test/api/v1/clients/client-1/pre-session-brief${refresh ? '?refresh=1' : ''}`,
    { method },
  ) as never;
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } },
  });
  mocks.client.mockResolvedValue({
    psychologistId: 'psy-1',
    preferredLanguage: 'en',
    deletedAt: null,
    carriedQuestions: [],
  });
  mocks.session.mockResolvedValue({ id: 'session-1' });
  mocks.brief.mockResolvedValue(row);
  mocks.load.mockResolvedValue({
    lastSessionId: 'session-1',
    fingerprint,
    input: { clientId: 'client-1', language: 'en', openCrises: [] },
    homeworkStatus: null,
  });
  mocks.create.mockResolvedValue({ id: 'new-brief' });
  mocks.update.mockImplementation(async ({ data }) => ({ ...row, ...data, id: 'new-brief' }));
  mocks.pass.mockResolvedValue({
    output: { preSessionBrief: body },
    callLog: {
      pass: 'PASS_5_PRE_SESSION_BRIEF',
      status: 'SUCCESS',
      model: 'test',
      region: 'test',
      promptVersion: 'test',
      latencyMs: 1,
      inputTokens: 1,
      outputTokens: 1,
      costInr: 0,
    },
  });
});
describe('preparation freshness and explicit generation', () => {
  it('GET never invokes AI, including refresh=1 and cache misses', async () => {
    expect((await GET(request('GET', true), context)).status).toBe(200);
    mocks.brief.mockResolvedValue(null);
    expect((await GET(request('GET', true), context)).status).toBe(404);
    expect(mocks.pass).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it('read-only GET identifies saved guidance as stale when the context changed', async () => {
    mocks.load.mockResolvedValue({ lastSessionId: 'session-1', fingerprint: 'b'.repeat(64) });
    expect(await (await GET(request('GET'), context)).json()).toMatchObject({
      source: 'cache',
      stale: true,
    });
  });
  it('explicit POST regenerates an old/legacy cache, then persists its context fingerprint', async () => {
    mocks.brief.mockResolvedValue({ ...row, body });
    const response = await POST(request('POST'), context);
    expect(await response.json()).toMatchObject({ source: 'fresh', stale: false });
    expect(mocks.pass).toHaveBeenCalledOnce();
    expect(mocks.update.mock.calls[0]![0].data.body._mindBriefContext.fingerprint).toBe(
      fingerprint,
    );
  });
  it('reports concurrent changes while AI was generating as stale', async () => {
    mocks.load
      .mockResolvedValueOnce({
        lastSessionId: 'session-1',
        fingerprint,
        input: { openCrises: [] },
        homeworkStatus: null,
      })
      .mockResolvedValue({ lastSessionId: 'session-1', fingerprint: 'b'.repeat(64) });
    expect(await (await POST(request('POST', true), context)).json()).toMatchObject({
      source: 'fresh',
      stale: true,
    });
  });
  it.each([false, true])(
    'Prepare reports the same clinical-context staleness (%s) without AI',
    async (changed) => {
      if (changed)
        mocks.load.mockResolvedValue({ lastSessionId: 'session-1', fingerprint: 'b'.repeat(64) });
      expect(await (await prepare(request('GET'), context)).json()).toMatchObject({
        briefIsStale: changed,
      });
      expect(mocks.pass).not.toHaveBeenCalled();
      expect(mocks.create).not.toHaveBeenCalled();
    },
  );
  it('Prepare preserves historical text but marks it stale if freshness cannot be verified', async () => {
    mocks.load.mockRejectedValue(new Error('read unavailable'));
    expect(await (await prepare(request('GET'), context)).json()).toMatchObject({
      briefIsStale: true,
      cachedBrief: body,
    });
  });
  it('guards saved reads and explicit generation with clinical analysis authority', () => {
    expect(
      regulatedPolicyForRequest('/api/v1/clients/client-1/pre-session-brief', 'POST'),
    ).toMatchObject({
      methods: ['GET', 'POST'],
      requirements: ['CLINICAL_ANALYSIS'],
      boundary: 'write',
    });
    expect(
      regulatedPolicyForRequest('/api/v1/clients/client-1/pre-session-brief', 'GET'),
    ).toMatchObject({ requirements: ['CLINICAL_ANALYSIS'] });
  });
});
