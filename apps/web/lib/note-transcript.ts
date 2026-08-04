import { decryptForTenant } from './tenant-crypto';

/**
 * The single read path for a session transcript (S-hardening, 2026-08).
 *
 * `NoteDraft.transcript` (plaintext) is being retired the same way the Client
 * PII columns were: every reader goes through this resolver, writers store
 * ciphertext-only when KMS is healthy, the backfill route scrubs plaintext
 * after VERIFYING the ciphertext decrypts, and the column drops once the
 * scrub reports zero rows remaining.
 *
 * Decrypt-first with a plaintext fallback — the fallback exists for rows the
 * scrub hasn't verified yet, and for the client-pii lesson: early ciphertext
 * may have been minted under the local-dev KMS key and be unopenable under
 * the GCP key. A transcript is the evidence behind a signed clinical note,
 * so unlike client PII this path never silently renders '' while a readable
 * copy exists.
 */
export async function resolveNoteTranscript(
  psychologistId: string,
  row: { transcript: string | null; transcriptEncrypted: string | null },
): Promise<string | null> {
  if (row.transcriptEncrypted) {
    const plaintext = await decryptForTenant(psychologistId, row.transcriptEncrypted);
    if (plaintext !== null) return plaintext;
    console.warn(
      `[note-transcript] ciphertext present but undecryptable for psy=${psychologistId} — falling back to the plaintext column`,
    );
  }
  return row.transcript;
}

/** Presence check that doesn't care which column holds the transcript. */
export function hasTranscript(row: {
  transcript: string | null;
  transcriptEncrypted: string | null;
}): boolean {
  return Boolean(row.transcript) || Boolean(row.transcriptEncrypted);
}
