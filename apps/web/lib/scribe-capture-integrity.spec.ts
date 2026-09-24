import { describe, expect, it } from 'vitest';
import {
  clearScribeCaptureIntegrity,
  isScribeCaptureReviewedForNote,
  markScribeCaptureReviewed,
  preserveScribeCaptureIntegrity,
  scribeCaptureIntegrity,
  scribeCaptureReviewToken,
} from './scribe-capture-integrity';

const note = { version: 'V1', chiefComplaint: 'Fictional consultation' };
const draft = () => ({
  id: 'draft-1',
  status: 'COMPLETED',
  content: note,
  rxPad: null,
  transcriptEncrypted: 'opaque-encrypted-source',
  errorMessage: preserveScribeCaptureIntegrity(null, true, 'connection_lost'),
});

describe('Scribe capture integrity', () => {
  it('preserves incomplete capture across normal re-ingestion and recognizes malformed reasons conservatively', () => {
    const initial = draft();
    expect(preserveScribeCaptureIntegrity(initial.errorMessage, false)).toBe(initial.errorMessage);
    expect(preserveScribeCaptureIntegrity(initial.errorMessage, undefined)).toBe(
      initial.errorMessage,
    );
    expect(scribeCaptureIntegrity('SCRIBE_CAPTURE_INCOMPLETE_V1:unknown')).toEqual({
      incomplete: true,
      reason: null,
    });
    expect(scribeCaptureIntegrity(null)).toEqual({ incomplete: false, reason: null });
  });

  it('blocks an unreviewed note and permits only the exact corrected note after review', () => {
    const current = draft();
    const corrected = { ...note, chiefComplaint: 'Clinician completed the missing history' };
    expect(isScribeCaptureReviewedForNote(current, corrected)).toBe(false);
    const reviewed = { ...current, errorMessage: markScribeCaptureReviewed(current, corrected) };
    expect(scribeCaptureIntegrity(reviewed.errorMessage).incomplete).toBe(true);
    expect(isScribeCaptureReviewedForNote(reviewed, corrected)).toBe(true);
    expect(isScribeCaptureReviewedForNote(reviewed, note)).toBe(false);
  });

  it.each(['content', 'rxPad', 'transcriptEncrypted', 'status', 'id'] as const)(
    'invalidates an acknowledgement after the saved %s changes',
    (field) => {
      const current = draft();
      const reviewed = { ...current, errorMessage: markScribeCaptureReviewed(current, note) };
      const changed = { ...reviewed, [field]: 'changed' };
      expect(scribeCaptureReviewToken(changed)).not.toBe(scribeCaptureReviewToken(reviewed));
      expect(isScribeCaptureReviewedForNote(changed, note)).toBe(false);
    },
  );

  it('normal ingestion removes approval while keeping incomplete capture and unrelated warnings', () => {
    const current = { ...draft(), errorMessage: `Other warning\n${draft().errorMessage}` };
    const reviewed = markScribeCaptureReviewed(current, note);
    const errorMessage = preserveScribeCaptureIntegrity(reviewed, false);
    expect(errorMessage).toBe(current.errorMessage);
    expect(isScribeCaptureReviewedForNote({ ...current, errorMessage }, note)).toBe(false);
    expect(clearScribeCaptureIntegrity(reviewed)).toBe('Other warning');
  });

  it('hashes the explicit review fields consistently even when the sign query includes extra columns', () => {
    const current = draft();
    const withExtraFields = { ...current, speakerSegments: [] };
    expect(scribeCaptureReviewToken(withExtraFields)).toBe(scribeCaptureReviewToken(current));
  });
});
