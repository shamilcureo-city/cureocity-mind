import { decryptForTenant } from '@/lib/tenant-crypto';

/**
 * Sprint 32 / 54 — Client PII **read cutover**.
 *
 * Every Client PII column is dual-written: a legacy plaintext column
 * (`fullName` / `contactPhone` / `contactEmail`) plus an envelope-encrypted
 * twin (`*Encrypted`). The write paths (create / update / DSR-correction /
 * the admin backfill) keep both in sync.
 *
 * This module is the single READ path: it resolves the *effective* value by
 * preferring the encrypted column (decrypt it with the tenant DEK) and
 * falling back to the plaintext column when
 *   - the encrypted twin is absent (a row written before the dual-write
 *     landed and not yet backfilled), or
 *   - decryption fails (malformed envelope / missing key row — `decryptForTenant`
 *     returns null and logs).
 *
 * The fallback is what makes the cutover safe to ship before every prod row is
 * backfilled: un-backfilled rows transparently keep reading plaintext. Once
 * the backfill is complete and every read goes through here, the plaintext
 * columns can be dropped (the remaining pilot-blocking step).
 */

/** The subset of a Prisma `Client` row this resolver needs. */
export interface ClientPiiRow {
  /** Tenant whose DEK unwraps the ciphertext. */
  psychologistId: string;
  fullName: string;
  fullNameEncrypted: string | null;
  contactPhone: string;
  contactPhoneEncrypted: string | null;
  contactEmail: string | null;
  contactEmailEncrypted: string | null;
}

/** The decrypted, display-ready PII. */
export interface ResolvedClientPii {
  fullName: string;
  contactPhone: string;
  contactEmail: string | null;
}

/**
 * Decrypt one encrypted PII column, falling back to the plaintext value when
 * the ciphertext is absent (un-backfilled row) or fails to decrypt. Exported
 * for the direct-read sites that select a single field (e.g. a relation's
 * `fullName`) rather than a whole Client row.
 */
export async function decryptClientField(
  psychologistId: string,
  ciphertext: string | null,
  plaintext: string,
): Promise<string> {
  if (ciphertext) {
    const decrypted = await decryptForTenant(psychologistId, ciphertext);
    if (decrypted !== null) return decrypted;
  }
  return plaintext;
}

/**
 * Resolve a single client row's PII. Decrypts the three encrypted columns
 * (re-using the cached tenant DEK across the three calls), each with a
 * plaintext fallback.
 */
export async function resolveClientPii(row: ClientPiiRow): Promise<ResolvedClientPii> {
  const [fullName, contactPhone] = await Promise.all([
    decryptClientField(row.psychologistId, row.fullNameEncrypted, row.fullName),
    decryptClientField(row.psychologistId, row.contactPhoneEncrypted, row.contactPhone),
  ]);
  // Email is nullable: a null plaintext + null ciphertext stays null.
  let contactEmail = row.contactEmail;
  if (row.contactEmailEncrypted) {
    const decrypted = await decryptForTenant(row.psychologistId, row.contactEmailEncrypted);
    if (decrypted !== null) contactEmail = decrypted;
  }
  return { fullName, contactPhone, contactEmail };
}

/**
 * Resolve PII for a list of client rows. Rows for the same tenant share the
 * cached DEK, so a therapist's own roster decrypts with a single KMS unwrap.
 */
export async function resolveClientPiiMany<T extends ClientPiiRow>(
  rows: readonly T[],
): Promise<ResolvedClientPii[]> {
  return Promise.all(rows.map((row) => resolveClientPii(row)));
}
