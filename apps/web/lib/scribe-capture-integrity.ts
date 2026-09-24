import { createHash } from 'node:crypto';
import { canonicalJson } from './sign-note-payload';

export const SCRIBE_CAPTURE_REASONS = [
  'connection_lost',
  'finalization_failed',
  'audio_loss',
  'capture_interrupted',
] as const;
export type ScribeCaptureIncompleteReason = (typeof SCRIBE_CAPTURE_REASONS)[number];

const MARKER_PREFIX = 'SCRIBE_CAPTURE_INCOMPLETE_V1:';
const REVIEWED_PREFIX = 'SCRIBE_CAPTURE_REVIEWED_V1:';
export const SCRIBE_CAPTURE_REVIEW_REQUIRED =
  'The consultation capture is incomplete. Review and complete the captured note, then confirm the capture review before signing.';

/** A non-PHI marker survives navigation without changing the database schema. */
export function scribeCaptureIntegrity(errorMessage: string | null | undefined): {
  incomplete: boolean;
  reason: ScribeCaptureIncompleteReason | null;
} {
  const marker = errorMessage?.split('\n').find((line) => line.startsWith(MARKER_PREFIX));
  if (!marker) return { incomplete: false, reason: null };
  const reason = marker.slice(MARKER_PREFIX.length);
  return {
    incomplete: true,
    reason: SCRIBE_CAPTURE_REASONS.find((allowed) => allowed === reason) ?? null,
  };
}

/** A later successful/legacy ingestion must never clear an unresolved capture loss. */
export function preserveScribeCaptureIntegrity(
  previousError: string | null | undefined,
  incomplete: boolean | undefined,
  reason?: ScribeCaptureIncompleteReason,
): string | null {
  if (scribeCaptureIntegrity(previousError).incomplete) return stripReviewedMarker(previousError!);
  if (!incomplete && !reason) return previousError ?? null;
  return [previousError, `${MARKER_PREFIX}${reason ?? 'capture_interrupted'}`]
    .filter(Boolean)
    .join('\n');
}

/** Explicit reconciliation removes only this marker, preserving unrelated errors. */
export function clearScribeCaptureIntegrity(errorMessage: string | null): string | null {
  return (
    errorMessage
      ?.split('\n')
      .filter((line) => !line.startsWith(MARKER_PREFIX) && !line.startsWith(REVIEWED_PREFIX))
      .join('\n') || null
  );
}

export type ScribeCaptureReviewDraft = {
  id: string;
  status: string;
  content: unknown;
  rxPad: unknown;
  transcriptEncrypted: string | null;
  errorMessage: string | null;
};

/** Opaque review identity binds the acknowledgement to the exact saved source and draft. */
export function scribeCaptureReviewToken(draft: ScribeCaptureReviewDraft): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        id: draft.id,
        status: draft.status,
        content: draft.content,
        rxPad: draft.rxPad,
        transcriptEncrypted: draft.transcriptEncrypted,
        errorMessage: stripReviewedMarker(draft.errorMessage),
      }),
    )
    .digest('hex');
}

function stripReviewedMarker(errorMessage: string | null): string | null {
  return (
    errorMessage
      ?.split('\n')
      .filter((line) => !line.startsWith(REVIEWED_PREFIX))
      .join('\n') || null
  );
}

export function reviewedScribeNoteHash(note: unknown): string {
  return createHash('sha256').update(canonicalJson(note)).digest('hex');
}

/** Keep capture incomplete until a signature commits the exact reviewed corrected note. */
export function markScribeCaptureReviewed(draft: ScribeCaptureReviewDraft, note: unknown): string {
  return [
    stripReviewedMarker(draft.errorMessage),
    `${REVIEWED_PREFIX}${scribeCaptureReviewToken(draft)}:${reviewedScribeNoteHash(note)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

export function isScribeCaptureReviewedForNote(
  draft: ScribeCaptureReviewDraft,
  note: unknown,
): boolean {
  if (!scribeCaptureIntegrity(draft.errorMessage).incomplete) return true;
  const expected = `${REVIEWED_PREFIX}${scribeCaptureReviewToken(draft)}:${reviewedScribeNoteHash(note)}`;
  return draft.errorMessage?.split('\n').includes(expected) === true;
}
