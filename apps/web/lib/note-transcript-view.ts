import type { SpeakerSegment } from '@cureocity/contracts';
import { TRANSCRIPTION_REVIEW_WARNING, type decodeSavedTranscript } from './saved-transcript';

export const TRANSCRIPT_UNAVAILABLE_MESSAGE =
  'The saved transcript could not be opened. Reload to retry. Do not rely on this note until its source can be reviewed.';

/** Shared presentation boundary for the initial page, polling API and source pane.
 * An unreadable encrypted source must not fall back to a stale plaintext copy. */
export function noteTranscriptView(
  row: {
    transcriptEncrypted: string | null;
    speakerSegments: unknown;
    errorMessage: string | null;
  },
  source: ReturnType<typeof decodeSavedTranscript> | null,
) {
  // Empty ciphertext is malformed, not an absent legacy transcript.
  const unavailable = typeof row.transcriptEncrypted === 'string' && !source;
  return {
    transcript: source?.transcript ?? null,
    speakerSegments: unavailable
      ? null
      : (source?.speakerSegments ?? (row.speakerSegments as SpeakerSegment[] | null) ?? null),
    errorMessage: unavailable
      ? TRANSCRIPT_UNAVAILABLE_MESSAGE
      : source?.transcriptionWarning
        ? TRANSCRIPTION_REVIEW_WARNING
        : row.errorMessage,
    transcriptionWarning: source?.transcriptionWarning ?? false,
  };
}
