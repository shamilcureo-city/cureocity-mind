import { decryptForTenant } from '@/lib/tenant-crypto';

/**
 * Sprint 32 / 54 / S32 Phase 2 — Client PII read path (post plaintext drop).
 *
 * Client PII lives ONLY in the envelope-encrypted columns (`fullNameEncrypted`
 * / `contactPhoneEncrypted` / `contactEmailEncrypted`) — the legacy plaintext
 * columns were dropped once GCP Cloud KMS went live and every read moved here.
 * This module is the single READ path: it decrypts each column with the tenant
 * DEK. There is no plaintext fallback anymore — an absent/undecryptable
 * ciphertext is a data-integrity error, surfaced loudly and rendered as an
 * empty string (a visibly-broken value) rather than crashing the read.
 *
 * Writes (create / update / DSR-correction / demo / backfill) set the
 * `*Encrypted` columns via `encryptForTenant`.
 */

/** The subset of a Prisma `Client` row this resolver needs. */
export interface ClientPiiRow {
  /** Tenant whose DEK unwraps the ciphertext. */
  psychologistId: string;
  fullNameEncrypted: string | null;
  contactPhoneEncrypted: string | null;
  contactEmailEncrypted: string | null;
}

/** The decrypted, display-ready PII. */
export interface ResolvedClientPii {
  fullName: string;
  contactPhone: string;
  contactEmail: string | null;
}

/**
 * Decrypt one required encrypted PII column. Post plaintext-drop there is no
 * fallback: a null or undecryptable ciphertext is logged as a data-integrity
 * error and rendered as '' rather than throwing on a read. Exported for the
 * direct-read sites that resolve a single field (e.g. a relation's `fullName`).
 */
export async function decryptClientField(
  psychologistId: string,
  ciphertext: string | null,
): Promise<string> {
  if (ciphertext) {
    const decrypted = await decryptForTenant(psychologistId, ciphertext);
    if (decrypted !== null) return decrypted;
  }
  console.error(
    `[client-pii] no decryptable value for psy=${psychologistId} (ciphertext ${
      ciphertext ? 'undecryptable' : 'absent'
    })`,
  );
  return '';
}

/**
 * Resolve a single client row's PII by decrypting the three encrypted columns
 * (re-using the cached tenant DEK across the calls).
 */
export async function resolveClientPii(row: ClientPiiRow): Promise<ResolvedClientPii> {
  const [fullName, contactPhone] = await Promise.all([
    decryptClientField(row.psychologistId, row.fullNameEncrypted),
    decryptClientField(row.psychologistId, row.contactPhoneEncrypted),
  ]);
  // Email is nullable: no ciphertext → null.
  let contactEmail: string | null = null;
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
