import type { NoteEditField, SignedNoteContent } from '@cureocity/contracts';
import { canonicalJson } from './sign-note-payload';

/**
 * NoteEdit stores text. Narrative fields are already text; structured medical
 * fields use stable JSON so the client and signer compare identical bytes.
 */
export function noteEditValue(note: SignedNoteContent, field: NoteEditField): string {
  const value = (note as unknown as Record<string, unknown>)[field];
  return typeof value === 'string' ? value : canonicalJson(value);
}
