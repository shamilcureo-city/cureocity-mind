import type { SpeakerSegment } from '@cureocity/contracts';
import {
  savedTranscriptContainsArtifact,
  TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE,
  TRANSCRIPTION_REVIEW_WARNING,
  type decodeSavedTranscript,
} from './saved-transcript';

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
  const speakerSegments = unavailable
    ? null
    : (source?.speakerSegments ?? (row.speakerSegments as SpeakerSegment[] | null) ?? null);
  // Never partially redact an authoritative clinical source. Quarantine the
  // whole presentation while leaving its encrypted bytes untouched for
  // recovery/audit and for the signing boundary's explicit rejection.
  const artifactHidden = savedTranscriptContainsArtifact({
    transcript: source?.transcript ?? '',
    speakerSegments,
  });
  return {
    transcript: artifactHidden ? null : (source?.transcript ?? null),
    speakerSegments: artifactHidden ? null : speakerSegments,
    errorMessage: unavailable
      ? TRANSCRIPT_UNAVAILABLE_MESSAGE
      : artifactHidden
        ? TRANSCRIPTION_ARTIFACT_HIDDEN_MESSAGE
        : source?.transcriptionWarning
          ? TRANSCRIPTION_REVIEW_WARNING
          : row.errorMessage,
    transcriptionWarning: artifactHidden || (source?.transcriptionWarning ?? false),
  };
}
