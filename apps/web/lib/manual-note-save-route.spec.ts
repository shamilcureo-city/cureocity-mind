import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TherapyNoteV1Schema } from '@cureocity/contracts';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  session: vi.fn(),
  current: vi.fn(),
  signed: vi.fn(),
  update: vi.fn(),
  transaction: vi.fn(),
  audit: vi.fn(),
  lock: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.auth }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
vi.mock('./mappers', () => ({ toNoteDraft: vi.fn() }));
vi.mock('./note-transcript', () => ({ resolveNoteTranscript: vi.fn() }));
vi.mock('./phi-write-lock', () => ({ lockActiveClientForSession: mocks.lock }));
vi.mock('./prisma', () => ({
  prisma: { session: { findUnique: mocks.session }, $transaction: mocks.transaction },
}));
import { PUT } from '../app/api/v1/sessions/[id]/note-draft/route';

const version = '2026-09-06T10:00:00.000Z';
const note = TherapyNoteV1Schema.parse({
  version: 'V1',
  modality: 'CBT',
  subjective: 'Original account',
  objective: 'Observation',
  assessment: 'Clinical review',
  plan: 'Review next visit',
  summary: 'Stale summary',
  riskFlags: { severity: 'high', indicators: ['Retain reviewed indicator'] },
  linkedEvidence: [{ startMs: 0, endMs: 1000, quote: 'Original account' }],
  phaseHints: [{ phase: 'Practice', confidence: 0.8 }],
  modalitySpecific: { observation: 'Retain this clinical observation' },
});
const submission = { ...note };
delete submission.summary;
const send = (
  content: unknown = {
    ...submission,
    subjective: 'Corrected account',
    modality: 'EMDR',
    riskFlags: { severity: 'none', indicators: [] },
    modalitySpecific: {},
  },
  expectedUpdatedAt = version,
) =>
  PUT(
    new Request('https://example.test/api/v1/sessions/session-1/note-draft', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ note: content, expectedUpdatedAt }),
    }) as never,
    { params: Promise.resolve({ id: 'session-1' }) },
  );

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  mocks.session.mockResolvedValue({
    psychologistId: 'psy-1',
    kind: 'TREATMENT',
    noteDraft: { id: 'draft-1', content: note, status: 'COMPLETED' },
    therapyNote: null,
  });
  mocks.current.mockResolvedValue({ status: 'COMPLETED', updatedAt: new Date(version) });
  mocks.signed.mockResolvedValue(null);
  mocks.update.mockResolvedValue({ updatedAt: new Date('2026-09-06T10:01:00.000Z') });
  mocks.transaction.mockImplementation(async (callback) =>
    callback({
      noteDraft: { findUnique: mocks.current, update: mocks.update },
      therapyNote: { findUnique: mocks.signed },
    }),
  );
});

describe('manual note save revision and safety boundary', () => {
  it('saves corrected canonical text, drops stale evidence and preserves stored safety metadata', async () => {
    const response = await send();
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.note.subjective).toBe('Corrected account');
    expect(result.note.summary).toBeUndefined();
    expect(result.note.linkedEvidence).toEqual([]);
    expect(result.note.phaseHints).toEqual([]);
    expect(result.note.riskFlags).toEqual(note.riskFlags);
    expect(result.note.modality).toBe('CBT');
    expect(result.note.modalitySpecific).toEqual(note.modalitySpecific);
    expect(result.updatedAt).toBe('2026-09-06T10:01:00.000Z');
    expect(mocks.audit).toHaveBeenCalledOnce();
  });
  it('refuses a stale editor without overwriting another clinician correction', async () => {
    expect((await send(submission, '2026-09-06T09:00:00.000Z')).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });
  it('rechecks signature inside the transaction instead of relying on the page state', async () => {
    mocks.signed.mockResolvedValue({ locked: true });
    expect((await send()).status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it('rejects an old summary-only editor without silently dropping its changes', async () => {
    expect((await send({ ...note, summary: 'Only visible edit' })).status).toBe(409);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
