import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  session: vi.fn(),
  current: vi.fn(),
  template: vi.fn(),
  reformat: vi.fn(),
  update: vi.fn(),
  sessionUpdate: vi.fn(),
  lock: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('./audit', () => ({ writeAudit: mocks.audit, auditMetadataFromRequest: () => ({}) }));
vi.mock('./phi-write-lock', () => ({
  lockActiveClientForSession: mocks.lock,
  ClientPhiWriteForbiddenError: class extends Error {},
}));
vi.mock('./reformat-note-template', () => ({ reformatNoteTemplate: mocks.reformat }));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.session },
    noteTemplate: { findFirst: mocks.template },
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        session: {
          findUnique: mocks.current,
          update: mocks.sessionUpdate,
        },
        noteDraft: { update: mocks.update },
      }),
  },
}));
import { POST } from '../app/api/v1/sessions/[id]/note-template/route';
const stamp = new Date('2026-10-08T00:00:00Z');
const content = { version: 'V1', subjective: 'Clinician correction' };
const session = () => ({
  id: 'session',
  psychologistId: 'owner',
  kind: 'TREATMENT',
  mindDocumentationMode: 'AI',
  noteTemplateId: null,
  therapyNote: null,
  noteEditRecovery: null,
  mindManualNoteDraft: null,
  noteDraft: { id: 'draft', status: 'COMPLETED', updatedAt: stamp, content },
});
function request(body: Record<string, unknown> = {}) {
  return new Request('https://mind.example/api/v1/sessions/session/note-template', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      templateId: 'template',
      expectedUpdatedAt: stamp.toISOString(),
      ...body,
    }),
  }) as never;
}
const ctx = { params: Promise.resolve({ id: 'session' }) };
beforeEach(() => {
  vi.resetAllMocks();
  const auth = { ok: true, value: { psychologistId: 'owner' } };
  mocks.auth.mockResolvedValue(auth);
  mocks.capability.mockResolvedValue(auth);
  mocks.session.mockResolvedValue(session());
  mocks.current.mockResolvedValue(session());
  mocks.template.mockResolvedValue({
    name: 'Fictional template',
    sections: [{ id: 'context', title: 'Context' }],
  });
  mocks.reformat.mockResolvedValue({
    ...content,
    templateSections: [{ title: 'Context', body: 'Current note' }],
  });
  mocks.update.mockResolvedValue({ updatedAt: stamp });
});
describe('Mind current-note template application', () => {
  it('reformats the saved current note and updates the template and audit under the client lock', async () => {
    const response = await POST(request(), ctx);
    expect(response.status).toBe(200);
    expect(mocks.reformat).toHaveBeenCalledWith(
      expect.objectContaining({ content, kind: 'TREATMENT' }),
    );
    expect(mocks.lock).toHaveBeenCalled();
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          content: expect.objectContaining({ subjective: 'Clinician correction' }),
        },
      }),
    );
    expect(mocks.sessionUpdate).toHaveBeenCalledWith({
      where: { id: 'session' },
      data: { noteTemplateId: 'template' },
    });
    expect(mocks.audit).toHaveBeenCalledWith(expect.anything(), expect.anything());
  });
  it.each([
    { therapyNote: { locked: true } },
    { noteEditRecovery: { encryptedFields: 'pending-clinician-edits' } },
    { mindManualNoteDraft: { encryptedFields: 'pending-manual-note' } },
    { mindDocumentationMode: 'MANUAL' },
    { noteDraft: { ...session().noteDraft, status: 'IN_PROGRESS' } },
  ])('does not run AI over a locked, manual, pending or incomplete note (%j)', async (change) => {
    mocks.session.mockResolvedValue({ ...session(), ...change });
    expect((await POST(request(), ctx)).status).toBe(409);
    expect(mocks.reformat).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('requires the revision the clinician actually saw before starting AI', async () => {
    expect((await POST(request({ expectedUpdatedAt: undefined }), ctx)).status).toBe(409);
    expect(mocks.reformat).not.toHaveBeenCalled();
  });
  it.each([
    { therapyNote: { locked: true } },
    { noteEditRecovery: { encryptedFields: 'new-pending-edits' } },
    { noteDraft: { ...session().noteDraft, updatedAt: new Date(stamp.getTime() + 1) } },
    { mindDocumentationMode: 'MANUAL' },
    { noteTemplateId: 'another-format' },
  ])('rechecks concurrent changes after AI and preserves the newer note (%j)', async (change) => {
    mocks.current.mockResolvedValue({ ...session(), ...change });
    expect((await POST(request(), ctx)).status).toBe(409);
    expect(mocks.reformat).toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
  });
  it('rejects another owner and missing templates before AI', async () => {
    mocks.session.mockResolvedValue({ ...session(), psychologistId: 'another-owner' });
    expect((await POST(request(), ctx)).status).toBe(404);
    mocks.session.mockResolvedValue(session());
    mocks.template.mockResolvedValue(null);
    expect((await POST(request(), ctx)).status).toBe(404);
    expect(mocks.reformat).not.toHaveBeenCalled();
  });
  it('keeps the note and its previous format if the provider fails', async () => {
    mocks.reformat.mockRejectedValue(new Error('Provider details must not escape'));
    const response = await POST(request(), ctx);
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('Provider details');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.sessionUpdate).not.toHaveBeenCalled();
  });
  it('clears the optional view through the same revision-checked operation', async () => {
    expect((await POST(request({ templateId: null }), ctx)).status).toBe(200);
    expect(mocks.reformat).toHaveBeenCalledWith(expect.objectContaining({ template: null }));
  });
  it('supports Mind review sessions using their treatment note shape', async () => {
    mocks.session.mockResolvedValue({ ...session(), kind: 'REVIEW' });
    mocks.current.mockResolvedValue({ ...session(), kind: 'REVIEW' });
    expect((await POST(request(), ctx)).status).toBe(200);
    expect(mocks.reformat).toHaveBeenCalledWith(expect.objectContaining({ kind: 'TREATMENT' }));
  });
  it('stores a future-note preference without claiming a completed note was reformatted', async () => {
    mocks.session.mockResolvedValue({ ...session(), noteDraft: null });
    mocks.current.mockResolvedValue({ ...session(), noteDraft: null });
    const response = await POST(request({ expectedUpdatedAt: undefined }), ctx);
    expect(response.status).toBe(200);
    expect((await response.json()).updatedAt).toBeNull();
    expect(mocks.reformat).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
});
