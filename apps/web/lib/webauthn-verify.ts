import { verifyNoteSigningAssertion as verifyPure } from '@cureocity/crypto';
import type { AssertionVerifyInput, AssertionVerifyResult } from '@cureocity/crypto';

/**
 * Sprint 33 — apps/web wrapper over the pure WebAuthn assertion verifier
 * in @cureocity/crypto. The pure function (unit-tested in the package)
 * does all the crypto; this wrapper only resolves the env-driven
 * origin allowlist and logs the "no allowlist configured" case so the
 * skip is visible in prod logs.
 */

/**
 * Resolve the allowed-origins allowlist from env. Comma-separated
 * WEBAUTHN_ORIGINS wins; otherwise null (origin check skipped, rpIdHash
 * still enforced by the verifier).
 */
export function resolveAllowedOrigins(): string[] | null {
  const raw = process.env['WEBAUTHN_ORIGINS'];
  if (!raw) return null;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return list.length > 0 ? list : null;
}

export function verifyNoteSigningAssertion(input: AssertionVerifyInput): AssertionVerifyResult {
  if (input.allowedOrigins === null) {
    console.warn(
      '[webauthn-verify] WEBAUTHN_ORIGINS unset — skipping origin check (rpIdHash still enforced).',
    );
  }
  return verifyPure(input);
}

export type { AssertionVerifyInput, AssertionVerifyResult };
