import { decryptForTenant } from './tenant-crypto';
import { decodeSavedTranscript } from './saved-transcript';

/**
 * The single read path for a session transcript (S-hardening, 2026-08).
 *
 * DECRYPT-ONLY: the plaintext `NoteDraft.transcript` column was dropped after
 * the backfill's verified scrub reported zero rows remaining on production
 * (every surviving ciphertext round-trips under the live KMS — stale
 * local-dev ciphertext was re-keyed from plaintext before the drop, so
 * nothing here can be unreadable by construction). An undecryptable value now
 * means live KMS trouble: logged loudly, rendered as absent.
 */
export async function resolveNoteTranscript(
  psychologistId: string,
  row: { transcriptEncrypted: string | null },
): Promise<string | null> {
  return (await resolveNoteTranscriptData(psychologistId, row))?.transcript ?? null;
}

export async function resolveNoteTranscriptData(
  psychologistId: string,
  row: { transcriptEncrypted: string | null },
): Promise<ReturnType<typeof decodeSavedTranscript> | null> {
  if (!row.transcriptEncrypted) return null;
  const plaintext = await decryptForTenant(psychologistId, row.transcriptEncrypted);
  if (plaintext === null) {
    console.error(
      `[note-transcript] UNDECRYPTABLE transcript for psy=${psychologistId} — check KMS health/key`,
    );
  }
  if (plaintext === null) return null;
  try {
    return decodeSavedTranscript(plaintext);
  } catch {
    console.error('[note-transcript] Invalid encrypted transcript format');
    return null;
  }
}

/** Presence check — ciphertext is the only copy. */
export function hasTranscript(row: { transcriptEncrypted: string | null }): boolean {
  return Boolean(row.transcriptEncrypted);
}
