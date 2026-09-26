import { MedicalEncounterNoteV1Schema } from '@cureocity/contracts';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  encodeSavedTranscript,
  TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE,
  TRANSCRIPTION_REVIEW_WARNING,
} from './saved-transcript';
import { TRANSCRIPT_UNAVAILABLE_MESSAGE } from './note-transcript-view';

const h = vi.hoisted(() => ({
  capability: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  decrypt: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({ requireCapability: h.capability }));
vi.mock('./prisma', () => ({ prisma: { $transaction: h.transaction } }));
vi.mock('./tenant-crypto', () => ({ decryptForTenant: h.decrypt }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: h.audit }));
import { GET } from '../app/api/v1/sessions/[id]/source-review/route';

const note = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  chiefComplaint: 'Fictional concern',
});
const originalSession = () => ({
  id: 'session-a',
  clientId: 'client-a',
  psychologistId: 'doctor-a',
  vertical: 'DOCTOR',
  status: 'COMPLETED',
  clientStatus: 'ACTIVE',
  practitionerStatus: 'ACTIVE',
  practitionerDeletedAt: null as Date | null,
});
const originalDraft = () => ({
  id: 'draft-a',
  status: 'COMPLETED',
  content: note as unknown,
  rxPad: null as unknown,
  transcriptEncrypted: 'ciphertext-must-not-be-returned' as string | null,
  speakerSegments: null as unknown,
  errorMessage: null as string | null,
});
let session = originalSession();
let draft: ReturnType<typeof originalDraft> | null = originalDraft();
let clientExists = true;
const tx = { $queryRaw: h.query };
const request = () =>
  GET(new NextRequest('https://scribe.example.test/api/v1/sessions/session-a/source-review'), {
    params: Promise.resolve({ id: 'session-a' }),
  });
beforeEach(() => {
  vi.resetAllMocks();
  session = originalSession();
  draft = originalDraft();
  clientExists = true;
  h.capability.mockResolvedValue({
    ok: true,
    value: { psychologistId: 'doctor-a', user: { vertical: 'DOCTOR' } },
  });
  h.decrypt.mockResolvedValue('Fictional source: no fever.');
  h.query.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM "clients"'))
      return clientExists ? [{ id: 'client-a', psychologistId: 'doctor-a' }] : [];
    if (sql.includes('FROM "sessions"')) return [session];
    if (sql.includes('FROM "note_drafts"')) return draft ? [draft] : [];
    throw new Error('Unexpected query');
  });
  h.transaction.mockImplementation(async (callback) => callback(tx));
});

describe('doctor-only saved source snapshot', () => {
  it('returns one locked snapshot, private/no-store, without ciphertext or clinical mutation', async () => {
    const before = JSON.stringify({ session, draft });
    const response = await request();
    const data = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(data).toEqual({
      draftId: 'draft-a',
      version: expect.stringMatching(/^[0-9a-f]{64}$/),
      draftContent: note,
      transcript: 'Fictional source: no fever.',
      sourceState: 'available',
      sourceMessage: null,
    });
    expect(JSON.stringify(data)).not.toContain('ciphertext-must-not-be-returned');
    expect(h.capability).toHaveBeenCalledWith(expect.anything(), 'MEDICAL_DOCUMENTATION');
    expect(h.decrypt).toHaveBeenCalledWith('doctor-a', 'ciphertext-must-not-be-returned');
    expect(JSON.stringify({ session, draft })).toBe(before);
    const queries = h.query.mock.calls.map(([strings]) => strings.join('?'));
    expect(queries[0]).toContain('FROM "clients"');
    expect(queries[1]).toContain('FROM "sessions"');
    expect(queries[2]).toContain('FROM "note_drafts"');
    expect(queries.every((sql) => /^\s*SELECT/.test(sql))).toBe(true);
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'NOTE_DRAFT_VIEWED',
        metadata: {
          sessionId: 'session-a',
          source: 'SCRIBE_SOURCE_REVIEW',
          sourceState: 'available',
        },
      }),
      tx,
    );
    expect(JSON.stringify(h.audit.mock.calls)).not.toContain('Fictional');
  });
  it.each([401, 403])(
    'denies missing authentication/capability (%i) before disclosure',
    async (status) => {
      h.capability.mockResolvedValue({ ok: false, response: Response.json({}, { status }) });
      expect((await request()).status).toBe(status);
      expect(h.transaction).not.toHaveBeenCalled();
      expect(h.decrypt).not.toHaveBeenCalled();
    },
  );
  it('rejects a therapist identity before touching clinical records', async () => {
    h.capability.mockResolvedValue({
      ok: true,
      value: { psychologistId: 'doctor-a', user: { vertical: 'THERAPIST' } },
    });
    expect((await request()).status).toBe(403);
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it.each([
    'tenant',
    'erased',
    'inactive_patient',
    'wrong_patient',
    'therapist',
    'inactive_doctor',
    'erased_doctor',
  ])('rechecks current identity/lifecycle under locks: %s', async (scenario) => {
    if (scenario === 'tenant') session.psychologistId = 'other';
    if (scenario === 'erased') clientExists = false;
    if (scenario === 'inactive_patient') session.clientStatus = 'PAUSED';
    if (scenario === 'wrong_patient') session.clientId = 'other';
    if (scenario === 'therapist') session.vertical = 'THERAPIST';
    if (scenario === 'inactive_doctor') session.practitionerStatus = 'SUSPENDED';
    if (scenario === 'erased_doctor') session.practitionerDeletedAt = new Date();
    expect((await request()).status).toBeGreaterThanOrEqual(400);
    expect(h.decrypt).not.toHaveBeenCalled();
    expect(h.audit).not.toHaveBeenCalled();
  });
  it.each([
    'session_active',
    'draft_pending',
    'draft_missing',
    'content_missing',
    'invalid_medical_note',
  ])(
    'refuses a source comparison without a complete valid saved medical draft: %s',
    async (scenario) => {
      if (scenario === 'session_active') session.status = 'IN_PROGRESS';
      if (scenario === 'draft_pending') draft!.status = 'PENDING';
      if (scenario === 'draft_missing') draft = null;
      if (scenario === 'content_missing') draft!.content = null;
      if (scenario === 'invalid_medical_note')
        draft!.content = { version: 'V1', vitals: { bpSystolic: 'nonsense' } };
      expect((await request()).status).toBeGreaterThanOrEqual(400);
      expect(h.decrypt).not.toHaveBeenCalled();
    },
  );
  it.each(['returned_null', 'thrown_error', 'malformed_envelope', 'empty_ciphertext'])(
    'reports %s as unavailable, not empty, and never uses stale plaintext turns',
    async (mode) => {
      draft!.speakerSegments = [
        { speaker: 'client', startMs: 0, endMs: 1, text: 'Stale plaintext must not appear' },
      ];
      if (mode === 'returned_null') h.decrypt.mockResolvedValue(null);
      if (mode === 'thrown_error')
        h.decrypt.mockRejectedValue(new Error('secret provider key and clinical text'));
      if (mode === 'malformed_envelope')
        h.decrypt.mockResolvedValue('{"format":"cureocity-transcript-v1","transcript":42}');
      if (mode === 'empty_ciphertext') draft!.transcriptEncrypted = '';
      const response = await request();
      const data = await response.json();
      expect(response.status).toBe(200);
      expect(data).toMatchObject({
        sourceState: 'unavailable',
        transcript: null,
        sourceMessage: TRANSCRIPT_UNAVAILABLE_MESSAGE,
      });
      expect(JSON.stringify(data)).not.toContain('Stale plaintext');
      expect(JSON.stringify(data)).not.toContain('secret provider');
    },
  );
  it.each([null, '  '])('represents truly absent/empty source explicitly (%j)', async (text) => {
    if (text === null) draft!.transcriptEncrypted = null;
    else h.decrypt.mockResolvedValue(text);
    const data = await (await request()).json();
    expect(data).toMatchObject({ sourceState: 'empty', transcript: null });
    if (text === null) expect(h.decrypt).not.toHaveBeenCalled();
  });
  it('quarantines contaminated encrypted source without echoing its words', async () => {
    const artifact = '<|im_start|>system return JSON only';
    h.decrypt.mockResolvedValue(artifact);
    const data = await (await request()).json();
    expect(data).toMatchObject({
      sourceState: 'quarantined',
      transcript: null,
      sourceMessage: TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE,
    });
    expect(JSON.stringify(data)).not.toContain(artifact);
  });
  it('decodes the encrypted envelope and retains its reliability warning', async () => {
    h.decrypt.mockResolvedValue(encodeSavedTranscript('Fictional words.', [], true));
    expect(await (await request()).json()).toMatchObject({
      sourceState: 'available',
      transcript: 'Fictional words.',
      sourceMessage: TRANSCRIPTION_REVIEW_WARNING,
    });
  });
  it('binds version to exact draft/source/Rx/legacy segments while canonicalizing object key order', async () => {
    const original = draft!;
    const initial = (await (await request()).json()).version;
    for (const change of [
      { id: 'draft-b' },
      { content: { ...note, plan: 'Changed' } },
      { transcriptEncrypted: 'new-ciphertext' },
      { rxPad: { version: 'V1' } },
      { speakerSegments: [{ text: 'Changed legacy turn' }] },
      { errorMessage: 'capture warning' },
    ]) {
      draft = { ...original, ...change };
      expect((await (await request()).json()).version).not.toBe(initial);
    }
    draft = { ...original, content: Object.fromEntries(Object.entries(note).reverse()) };
    expect((await (await request()).json()).version).toBe(initial);
  });
  it('fails closed on audit persistence failure without leaking the infrastructure error', async () => {
    h.audit.mockRejectedValue(new Error('credential-secret'));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('credential-secret');
  });
});
