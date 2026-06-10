import { z } from 'zod';
import { CuidSchema, IsoDateTimeSchema } from './common';

/**
 * Sprint 18 — WebAuthn credential management.
 *
 * Therapist registers one or more platform-authenticator credentials
 * (Touch ID, Windows Hello, Android biometric, security key). Once a
 * credential is on file, signing a therapy note REQUIRES the
 * assertion; passwordless replay-resistant signing.
 *
 * Verification ladder (all live as of Sprint 33):
 *   - V1.0: hash-bound challenge — `assertion.challengeHashHex` must
 *     equal sha256(payload).
 *   - V1.1: credential-id lookup — assertion must reference a
 *     credentialId registered + non-revoked for this psychologist.
 *   - V1.2: full signature verification against the stored public key
 *     (SPKI DER), challenge↔payload binding, rpIdHash check, and
 *     signCount monotonicity (clone detection). Implemented in
 *     apps/web/lib/webauthn-verify.ts; enforced by the sign route.
 */

export const Base64UrlSchema = z
  .string()
  .min(1)
  .regex(/^[A-Za-z0-9_-]+$/, 'must be base64url (no padding)');

export const WebAuthnTransportSchema = z.enum(['usb', 'nfc', 'ble', 'internal', 'hybrid']);
export type WebAuthnTransport = z.infer<typeof WebAuthnTransportSchema>;

// ============================================================================
// Stored credential DTO
// ============================================================================

export const WebAuthnCredentialSchema = z.object({
  id: CuidSchema,
  psychologistId: CuidSchema,
  /** WebAuthn credentialId (base64url of `cred.rawId`). Unique across users. */
  credentialId: Base64UrlSchema,
  /** COSE public key bytes, base64url. */
  publicKey: Base64UrlSchema,
  signCount: z.number().int().nonnegative(),
  transports: z.array(WebAuthnTransportSchema).default([]),
  /** User-friendly device label ("MacBook Touch ID"). */
  label: z.string().min(1).max(80).nullable(),
  lastUsedAt: IsoDateTimeSchema.nullable(),
  revokedAt: IsoDateTimeSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
});
export type WebAuthnCredential = z.infer<typeof WebAuthnCredentialSchema>;

// ============================================================================
// POST /api/v1/psychologists/me/webauthn-credentials/begin-registration
//
// Server generates a fresh challenge, persists it transiently (V1 ships
// stateless: the server signs the challenge into a short-lived token
// the client echoes back). Returns the WebAuthn `PublicKeyCredentialCreationOptions`
// the browser passes to `navigator.credentials.create`.
// ============================================================================

export const BeginRegistrationInputSchema = z
  .object({
    label: z.string().min(1).max(80).optional(),
  })
  .optional()
  .default({});
export type BeginRegistrationInput = z.infer<typeof BeginRegistrationInputSchema>;

export const BeginRegistrationResponseSchema = z.object({
  challenge: Base64UrlSchema,
  /** Short-lived signed token the client echoes back to /finish. */
  ticket: z.string().min(1),
  /** Relying-party ID (effective domain). */
  rpId: z.string().min(1),
  rpName: z.string().min(1),
  user: z.object({
    id: Base64UrlSchema,
    name: z.string(),
    displayName: z.string(),
  }),
  excludeCredentialIds: z.array(Base64UrlSchema).default([]),
  /** Anti-replay window in seconds. */
  timeoutSec: z.number().int().positive().max(600),
});
export type BeginRegistrationResponse = z.infer<typeof BeginRegistrationResponseSchema>;

// ============================================================================
// POST /api/v1/psychologists/me/webauthn-credentials/finish-registration
//
// Body carries the ticket from /begin + the browser-produced attestation
// fields. Server verifies the ticket signature + matches the challenge,
// then persists the credential.
// ============================================================================

export const FinishRegistrationInputSchema = z.object({
  ticket: z.string().min(1),
  label: z.string().min(1).max(80).optional(),
  credentialId: Base64UrlSchema,
  publicKey: Base64UrlSchema,
  /** Base64url of `response.clientDataJSON` from the browser. */
  clientDataJSON: Base64UrlSchema,
  /** Base64url of `response.attestationObject`. Stored for forensic replay. */
  attestationObject: Base64UrlSchema,
  transports: z.array(WebAuthnTransportSchema).default([]),
});
export type FinishRegistrationInput = z.infer<typeof FinishRegistrationInputSchema>;

export const FinishRegistrationResponseSchema = z.object({
  credential: WebAuthnCredentialSchema,
});
export type FinishRegistrationResponse = z.infer<typeof FinishRegistrationResponseSchema>;

// ============================================================================
// GET /api/v1/psychologists/me/webauthn-credentials
// ============================================================================

export const ListWebAuthnCredentialsResponseSchema = z.object({
  items: z.array(WebAuthnCredentialSchema),
});
export type ListWebAuthnCredentialsResponse = z.infer<typeof ListWebAuthnCredentialsResponseSchema>;
