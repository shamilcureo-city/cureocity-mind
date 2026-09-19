import { containsTranscriptionArtifact } from '@cureocity/contracts';

export const NOTE_ARTIFACT_HIDDEN_MESSAGE =
  'This note contains invalid generated or system text, so its clinical content is hidden. Review and correct the editable draft before signing or sharing.';

export const SIGNED_NOTE_ARTIFACT_HIDDEN_MESSAGE =
  'This signed note contains invalid generated or system text, so its clinical content is hidden. The signed record has not been changed. Re-open it to record a reviewed correction before exporting or sharing.';

export const NOTE_ARTIFACT_COPY_TEXT =
  '[Clinical note hidden: invalid generated or system text requires clinician review.]';

/** One shared boundary for note display, copy/export and persistence checks.
 * JSON serialization is appropriate here because all signable note fields are
 * plain schema data; it also covers nested topics, evidence and safety text. */
export function noteContainsArtifact(note: unknown): boolean {
  try {
    return containsTranscriptionArtifact(JSON.stringify(note) ?? '');
  } catch {
    // A cyclic/non-serializable value cannot be a valid signable note. Treat it
    // as unsafe at presentation boundaries rather than leaking a partial view.
    return true;
  }
}
