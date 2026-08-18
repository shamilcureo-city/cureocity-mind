import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requirePsychologistId: vi.fn(),
  parseJson: vi.fn(),
  writeAudit: vi.fn(),
  sessionFindUnique: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  draftUpdate: vi.fn(),
  noteUpdate: vi.fn(),
  noteEditCreateMany: vi.fn(),
  noteSafeParse: vi.fn(),
}));

vi.mock('@cureocity/contracts', () => ({
  IntakeNoteV1Schema: { safeParse: mocks.noteSafeParse, parse: (value: unknown) => value },
  MedicalEncounterNoteV1Schema: {
    safeParse: mocks.noteSafeParse,
    parse: (value: unknown) => value,
  },
  TherapyNoteV1Schema: { safeParse: mocks.noteSafeParse, parse: (value: unknown) => value },
  ReviseNoteInputSchema: {},
}));
vi.mock('./auth-server', () => ({ requirePsychologistId: mocks.requirePsychologistId }));
vi.mock('./audit', () => ({
  auditMetadataFromRequest: () => ({ requestId: 'request-1' }),
  writeAudit: mocks.writeAudit,
}));
vi.mock('./note-edit-fields', () => ({
  SIGNABLE_FIELDS_BY_KIND: { TREATMENT: ['subjective'], INTAKE: [] },
  signableKindFor: () => 'TREATMENT',
}));
vi.mock('./validate', () => ({ parseJson: mocks.parseJson }));
vi.mock('./prisma', () => ({
  prisma: {
    session: { findUnique: mocks.sessionFindUnique },
    $transaction: mocks.transaction,
  },
}));

import { POST } from '../app/api/v1/sessions/[id]/note/edit/route';

const current = {
  version: 'V1',
  subjective: 'old private note',
  objective: 'objective',
  assessment: 'assessment',
  plan: 'plan',
};
const next = { ...current, subjective: 'new private note' };
const reason = 'private correction rationale';
const tx = {
  $queryRaw: mocks.queryRaw,
  noteDraft: { updateMany: mocks.draftUpdate },
  therapyNote: { update: mocks.noteUpdate },
  noteEdit: { createMany: mocks.noteEditCreateMany },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requirePsychologistId.mockResolvedValue({ ok: true, value: { psychologistId: 'psy-1' } });
  mocks.parseJson.mockResolvedValue({
    ok: true,
    value: { kind: 'TREATMENT', subjective: next.subjective, reason },
  });
  mocks.sessionFindUnique.mockResolvedValue({
    id: 'session-1',
    psychologistId: 'psy-1',
    kind: 'TREATMENT',
    therapyNote: { id: 'note-1', draftId: 'draft-1', locked: false, content: current },
  });
  mocks.noteSafeParse
    .mockReturnValueOnce({ success: true, data: current })
    .mockReturnValueOnce({ success: true, data: next });
  mocks.transaction.mockImplementation((callback) => callback(tx));
  mocks.draftUpdate.mockResolvedValue({ count: 1 });
  mocks.queryRaw.mockImplementation((strings: TemplateStringsArray) => {
    const sql = Array.from(strings).join('?');
    if (sql.includes('FROM "sessions"')) {
      return Promise.resolve([
        { id: 'session-1', psychologistId: 'psy-1', kind: 'TREATMENT', vertical: 'THERAPIST' },
      ]);
    }
    if (sql.includes('FROM "note_drafts"')) {
      return Promise.resolve([{ id: 'draft-1', status: 'COMPLETED', content: current }]);
    }
    if (sql.includes('FROM "therapy_notes"')) {
      return Promise.resolve([
        { id: 'note-1', draftId: 'draft-1', locked: false, content: current },
      ]);
    }
    return Promise.resolve([]);
  });
});

function request() {
  return new Request('https://example.test/api/v1/sessions/session-1/note/edit', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
}

describe('signed-note edit draft workflow', () => {
  it('writes revisions only to NoteDraft and leaves TherapyNote and signature history untouched', async () => {
    const response = await POST(request() as never, {
      params: Promise.resolve({ id: 'session-1' }),
    });

    expect(response.status).toBe(200);
    expect(mocks.draftUpdate).toHaveBeenCalledWith({
      where: { id: 'draft-1', status: 'COMPLETED' },
      data: { content: next, status: 'COMPLETED' },
    });
    expect(mocks.noteUpdate).not.toHaveBeenCalled();
    expect(mocks.noteEditCreateMany).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(
      expect.objectContaining({ sessionId: 'session-1', draftId: 'draft-1', content: next }),
    );
  });

  it('hashes revision rationale instead of writing note or rationale free text to audit metadata', async () => {
    await POST(request() as never, { params: Promise.resolve({ id: 'session-1' }) });

    const metadata = mocks.writeAudit.mock.calls[0]?.[0]?.metadata;
    expect(metadata).toEqual(
      expect.objectContaining({
        revisionReasonHashHex: createHash('sha256').update(reason).digest('hex'),
        fieldsChanged: ['subjective'],
      }),
    );
    const serialized = JSON.stringify(metadata);
    expect(serialized).not.toContain(reason);
    expect(serialized).not.toContain(current.subjective);
    expect(serialized).not.toContain(next.subjective);
  });
});
