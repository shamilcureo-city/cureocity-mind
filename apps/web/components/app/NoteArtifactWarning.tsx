import {
  NOTE_ARTIFACT_HIDDEN_MESSAGE,
  SIGNED_NOTE_ARTIFACT_HIDDEN_MESSAGE,
} from '../../lib/note-artifact';

/** Fail-closed presentation for a contaminated draft or historical signed
 * record. It deliberately renders none of the note body. */
export function NoteArtifactWarning({ signed }: { signed: boolean }) {
  return (
    <div
      role="alert"
      className="rounded-xl border border-[var(--color-warn-border)] bg-[var(--color-warn-bg)] p-5 text-sm text-[var(--color-warn)]"
    >
      <strong>Clinical note hidden</strong>
      <p className="mt-1 leading-relaxed">
        {signed ? SIGNED_NOTE_ARTIFACT_HIDDEN_MESSAGE : NOTE_ARTIFACT_HIDDEN_MESSAGE}
      </p>
    </div>
  );
}
