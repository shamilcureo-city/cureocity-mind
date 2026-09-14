import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TherapyNoteV1Schema } from '@cureocity/contracts';

const h = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  draft: vi.fn(),
  note: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
  generate: vi.fn(),
  lock: vi.fn(),
  input: vi.fn(),
  tx: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: h.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: h.audit }));
vi.mock('./validate', () => ({ parseJson: h.input }));
vi.mock('./phi-write-lock', () => ({ lockActiveClientForSession: h.lock }));
vi.mock('./llm', () => ({ ensureGcpCreds: () => undefined, resolveThinkingBudget: () => 0 }));
vi.mock('@google/genai', () => ({
  GoogleGenAI: class {
    models = { generateContent: h.generate };
  },
  HarmBlockThreshold: { OFF: 'OFF' },
  HarmCategory: {},
}));
vi.mock('./prisma', () => ({ prisma: { session: { findUnique: h.session }, $transaction: h.tx } }));
import { POST } from '../app/api/v1/sessions/[id]/note/modify/route';
const version = '2026-09-14T10:00:00.000Z';
const note = TherapyNoteV1Schema.parse({
  version: 'V1',
  modality: 'SUPPORTIVE',
  subjective: 'Fictional account',
  objective: 'Fictional observation',
  assessment: 'Further information needed',
  plan: 'Review the agreed focus at the next visit',
  riskFlags: { severity: 'medium', indicators: ['Fictional'] },
  summary: 'Old derived summary',
});
const run = () =>
  POST(new Request('http://local.test', { method: 'POST' }) as never, {
    params: Promise.resolve({ id: 'session-1' }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('LLM_BACKEND', 'vertex');
  vi.stubEnv('VERTEX_PROJECT_ID', 'fictional-project');
  h.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  h.input.mockResolvedValue({
    ok: true,
    value: { instruction: 'Make concise', mode: 'PREVIEW', expectedUpdatedAt: version },
  });
  h.session.mockResolvedValue({
    psychologistId: 'psy-1',
    kind: 'TREATMENT',
    noteDraft: { id: 'draft-1', content: note, status: 'COMPLETED', updatedAt: new Date(version) },
    therapyNote: null,
  });
  h.draft.mockResolvedValue({ status: 'COMPLETED', updatedAt: new Date(version) });
  h.note.mockResolvedValue(null);
  h.tx.mockImplementation((fn) =>
    fn({
      noteDraft: { findUnique: h.draft, update: h.update },
      therapyNote: { findUnique: h.note },
    }),
  );
  h.generate.mockResolvedValue({
    text: JSON.stringify({
      ...note,
      plan: 'Review agreed focus next visit',
      riskFlags: { severity: 'none', indicators: [] },
    }),
  });
});
afterEach(() => vi.unstubAllEnvs());

describe('Mind preview route does not change the saved note', () => {
  it('returns only a version-bound canonical preview without a draft or clinical audit write', async () => {
    const response = await run();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({
      applied: false,
      baseUpdatedAt: version,
      note: { plan: 'Review agreed focus next visit', riskFlags: note.riskFlags },
    });
    expect(body.note).not.toHaveProperty('summary');
    expect(h.lock).toHaveBeenCalledOnce();
    expect(h.update).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
  it('refuses a stale client version before asking a model', async () => {
    h.input.mockResolvedValue({
      ok: true,
      value: {
        instruction: 'Make concise',
        mode: 'PREVIEW',
        expectedUpdatedAt: '2026-09-13T10:00:00.000Z',
      },
    });
    expect((await run()).status).toBe(409);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it('refuses a draft changed or signed while the suggestion was generated', async () => {
    h.draft.mockResolvedValue({
      status: 'COMPLETED',
      updatedAt: new Date('2026-09-14T10:01:00.000Z'),
    });
    expect((await run()).status).toBe(409);
    h.draft.mockResolvedValue({ status: 'COMPLETED', updatedAt: new Date(version) });
    h.note.mockResolvedValue({ locked: true });
    expect((await run()).status).toBe(409);
    expect(h.update).not.toHaveBeenCalled();
  });
  it('preserves ownership and active-client locking', async () => {
    h.session.mockResolvedValue({ psychologistId: 'someone-else' });
    expect((await run()).status).toBe(404);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it('does not return malformed model text to the browser', async () => {
    h.generate.mockResolvedValue({ text: 'fictional private unexpected response' });
    const response = await run();
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('fictional private');
    expect(h.update).not.toHaveBeenCalled();
  });
  it.each(['null', '[]', '{"plan":null}', '{"plan":""}'])(
    'rejects malformed model shape %s without writes',
    async (text) => {
      h.generate.mockResolvedValue({ text });
      expect((await run()).status).toBe(502);
      expect(h.update).not.toHaveBeenCalled();
    },
  );
  it('preserves existing direct apply callers', async () => {
    h.input.mockResolvedValue({ ok: true, value: { instruction: 'Make concise', mode: 'APPLY' } });
    h.update.mockResolvedValue({ updatedAt: new Date(version) });
    expect((await run()).status).toBe(200);
    expect(h.update).toHaveBeenCalledOnce();
    expect(h.audit).toHaveBeenCalledOnce();
  });
});
