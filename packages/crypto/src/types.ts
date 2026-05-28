/**
 * Envelope encryption ports — Sprint 9 PR 3, gap G10.
 *
 * Two layers:
 *   IKmsProvider          wraps + unwraps a tenant DEK against a Customer
 *                         Master Key. Real implementation hits AWS KMS;
 *                         dev uses a derived key.
 *   IFieldEncryptor       encrypts / decrypts column-level values with a
 *                         per-tenant DEK. Implementation is AES-256-GCM
 *                         (matches pgcrypto's pgp_sym_* AEAD profile so a
 *                         future on-DB encrypt is interchangeable).
 *
 * Per-tenant DEKs live in PsychologistTenantKey rows (one active row per
 * psychologist, plus a rotation history). The wrapped key is stored
 * server-side; only the unwrapped DEK ever touches plaintext, and only
 * inside the encrypting service's process.
 *
 * Ciphertext encoding (single string column for easy SELECT):
 *   v1.<key-id>.<iv-base64url>.<ciphertext-base64url>.<tag-base64url>
 * The 'v1' prefix lets us migrate to AES-256-OCB or post-quantum schemes
 * without ambiguity later.
 */

export interface WrappedDataKey {
  /** Identifier for the wrap operation — for AWS KMS, the CMK key id. */
  keyId: string;
  /** Wrapped DEK bytes, base64. */
  wrappedKey: string;
}

export interface UnwrappedDataKey {
  keyId: string;
  /** 32 raw bytes — AES-256 secret. */
  key: Uint8Array;
}

/**
 * KMS port. Implementations:
 *   AwsKmsProvider          — wraps via aws-sdk's KMS#Encrypt
 *   LocalDevKmsProvider     — HKDF-derived "master key" for non-prod. Logs
 *                             a loud warning on construction.
 */
export interface IKmsProvider {
  /** Generates a 32-byte DEK, returns both unwrapped + wrapped (envelope). */
  generateDataKey(): Promise<{ wrapped: WrappedDataKey; plaintext: UnwrappedDataKey }>;
  /** Unwraps a previously-generated WrappedDataKey. */
  unwrapDataKey(wrapped: WrappedDataKey): Promise<UnwrappedDataKey>;
}

export interface IFieldEncryptor {
  /** Encrypts `plaintext` with the given DEK + returns the encoded ciphertext. */
  encrypt(plaintext: string, dek: UnwrappedDataKey): string;
  /** Decrypts ciphertext encoded by `encrypt`. */
  decrypt(ciphertext: string, dek: UnwrappedDataKey): string;
}
