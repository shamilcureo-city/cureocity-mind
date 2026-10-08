import { MedicalEncounterNoteV1Schema, TherapyNoteV1Schema } from '@cureocity/contracts';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isScribeCaptureReviewedForNote,
  preserveScribeCaptureIntegrity,
  scribeCaptureIntegrity,
  scribeCaptureReviewToken,
} from './scribe-capture-integrity';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  capability: vi.fn(),
  query: vi.fn(),
  transaction: vi.fn(),
  update: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('./auth-server', () => ({
  requirePsychologistId: mocks.auth,
  requireCapability: mocks.capability,
}));
vi.mock('./prisma', () => ({ prisma: { $transaction: mocks.transaction } }));
vi.mock('./audit', () => ({ auditMetadataFromRequest: () => ({}), writeAudit: mocks.audit }));
import { GET, POST } from '../app/api/v1/sessions/[id]/capture-review/route';

const note = MedicalEncounterNoteV1Schema.parse({
  version: 'V1',
  chiefComplaint: 'Fictional patient statement',
});
const initialDraft = () => ({
  id: 'draft-1',
  status: 'COMPLETED',
  content: note,
  rxPad: null,
  transcriptEncrypted: 'opaque-encrypted-source',
  errorMessage: preserveScribeCaptureIntegrity(null, true, 'audio_loss'),
});
let draft = initialDraft();
let session = { id: 'session-1', psychologistId: 'psy-1', vertical: 'DOCTOR', status: 'COMPLETED' };
let signed = false;
let clientExists = true;
const context = { params: Promise.resolve({ id: 'session-1' }) };
function post(
  body: unknown = {
    resolution: 'reviewed_and_completed',
    reviewedDraftId: draft.id,
    reviewToken: scribeCaptureReviewToken(draft),
    reviewedNote: note,
  },
) {
  return POST(
    new NextRequest('https://example.test/api/v1/sessions/session-1/capture-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    context,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  draft = initialDraft();
  session = { id: 'session-1', psychologistId: 'psy-1', vertical: 'DOCTOR', status: 'COMPLETED' };
  signed = false;
  clientExists = true;
  const auth = { ok: true, value: { psychologistId: 'psy-1', user: {} } };
  mocks.auth.mockResolvedValue(auth);
  mocks.capability.mockResolvedValue(auth);
  mocks.query.mockImplementation(async (strings: TemplateStringsArray) => {
    const sql = strings.join('?');
    if (sql.includes('FROM "clients"'))
      return clientExists ? [{ id: 'client-1', psychologistId: 'psy-1' }] : [];
    if (sql.includes('FROM "sessions"')) return [session];
    if (sql.includes('FROM "note_drafts"')) return [draft];
    if (sql.includes('FROM "therapy_notes"')) return signed ? [{ id: 'note-1' }] : [];
    throw new Error('Unexpected query');
  });
  mocks.update.mockImplementation(async ({ data }) => {
    draft = { ...draft, ...data };
    return draft;
  });
  mocks.transaction.mockImplementation((work) =>
    work({ $queryRaw: mocks.query, noteDraft: { update: mocks.update } }),
  );
});

describe('Scribe capture review route', () => {
  it('returns an opaque identity without clinical text and keeps the common lock order', async () => {
    const response = await GET(new NextRequest('https://example.test/capture-review'), context);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    const data = await response.json();
    expect(data).toEqual({
      incomplete: true,
      reason: 'audio_loss',
      draftId: 'draft-1',
      draftUpdatedAt: null,
      reviewed: false,
      reviewToken: scribeCaptureReviewToken(draft),
    });
    expect(JSON.stringify(data)).not.toContain(note.chiefComplaint);
    const queries = mocks.query.mock.calls.map(([strings]) => strings.join('?'));
    expect(queries[0]).toContain('FROM "clients"');
    expect(queries[1]).toContain('FROM "sessions"');
    expect(queries[2]).toContain('FROM "note_drafts"');
    expect(queries[3]).toContain('FROM "therapy_notes"');
    expect(mocks.update).not.toHaveBeenCalled();
  });

  it('allows a therapist to reconcile a treatment capture against the current saved note', async () => {
    session.vertical = 'THERAPIST';
    const auth = { ok: true, value: { psychologistId: 'psy-1', user: { vertical: 'THERAPIST' } } };
    mocks.auth.mockResolvedValue(auth);
    const therapy = TherapyNoteV1Schema.parse({
      version: 'V1',
      modality: 'CBT',
      subjective: 'Fictional statement',
      objective: 'Fictional observations',
      assessment: 'Clinician reviewed',
      plan: 'Review next visit',
      riskFlags: { severity: 'none', indicators: [], details: '' },
    });
    const response = await post({
      resolution: 'reviewed_and_completed',
      reviewedDraftId: draft.id,
      reviewToken: scribeCaptureReviewToken(draft),
      reviewedNote: therapy,
    });
    expect(response.status).toBe(200);
    expect(mocks.capability.mock.calls[0]?.[1]).toBe('BEHAVIORAL_HEALTH_DOCUMENTATION');
    expect(isScribeCaptureReviewedForNote(draft, therapy)).toBe(true);
  });

  it('records a review bound to the submitted corrected note but leaves capture incomplete until sign', async () => {
    const corrected = { ...note, assessment: 'Clinician completed the review' };
    const response = await post({
      resolution: 'reviewed_and_completed',
      reviewedDraftId: draft.id,
      reviewToken: scribeCaptureReviewToken(draft),
      reviewedNote: corrected,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ incomplete: true, reviewed: true });
    expect(scribeCaptureIntegrity(draft.errorMessage).incomplete).toBe(true);
    expect(isScribeCaptureReviewedForNote(draft, corrected)).toBe(true);
    expect(isScribeCaptureReviewedForNote(draft, note)).toBe(false);
    expect(mocks.audit).toHaveBeenCalledOnce();
    expect(JSON.stringify(mocks.audit.mock.calls)).not.toContain(corrected.assessment);
  });

  it('rejects a stale draft/source identity without changing the marker', async () => {
    const reviewToken = scribeCaptureReviewToken(draft);
    draft.transcriptEncrypted = 'new-source';
    expect(
      (
        await post({
          resolution: 'reviewed_and_completed',
          reviewedDraftId: draft.id,
          reviewToken,
          reviewedNote: note,
        })
      ).status,
    ).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
  });

  it.each(['signed', 'active', 'other_tenant', 'therapist', 'erased'])(
    'refuses review for %s encounters before mutation',
    async (scenario) => {
      if (scenario === 'signed') signed = true;
      if (scenario === 'active') session.status = 'IN_PROGRESS';
      if (scenario === 'other_tenant') session.psychologistId = 'other';
      if (scenario === 'therapist') session.vertical = 'THERAPIST';
      if (scenario === 'erased') clientExists = false;
      expect((await post()).status).toBeGreaterThanOrEqual(400);
      expect(mocks.update).not.toHaveBeenCalled();
      expect(mocks.audit).not.toHaveBeenCalled();
    },
  );

  it('requires the reviewed note and medical documentation authority', async () => {
    expect(
      (
        await post({
          resolution: 'reviewed_and_completed',
          reviewedDraftId: draft.id,
          reviewToken: scribeCaptureReviewToken(draft),
        })
      ).status,
    ).toBe(400);
    mocks.capability.mockResolvedValue({ ok: false, response: Response.json({}, { status: 403 }) });
    expect((await post()).status).toBe(403);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
