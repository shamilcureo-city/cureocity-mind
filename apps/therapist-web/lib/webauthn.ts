'use client';

/**
 * Minimal WebAuthn helpers for V1 platform-authenticator binding.
 *
 * Used by:
 *   - Consent capture (Sprint 7 PR 3): bind the consent payload hash
 *     into the challenge so the assertion proves "this therapist agreed
 *     to this exact wording"
 *   - Note sign-off (Sprint 7 PR 4): same pattern, bind the note hash
 *
 * NOT VERIFIED in this sandbox (no browser). The shape matches what
 * patient-model-service will accept in Sprint 7 PR 4 + Sprint 9 storage.
 *
 * Sprint 7 PR 4 wires this against a registration endpoint; for PR 3
 * we surface a "Confirm with biometric" button that calls
 * authenticateWithChallenge and stores the resulting payload.
 */

export interface WebAuthnAssertionResult {
  credentialId: string;
  authenticatorData: string; // base64url
  clientDataJSON: string; // base64url
  signature: string; // base64url
  /** Hex SHA-256 of the original challenge payload — useful for server-side replay verification. */
  challengeHashHex: string;
}

export async function sha256Hex(text: string): Promise<string> {
  const enc = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function base64UrlEncode(input: ArrayBuffer | Uint8Array): string {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const bin = Array.from(bytes, (b) => String.fromCharCode(b)).join('');
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface NavigatorWithCreds {
  credentials?: CredentialsContainer;
}

/**
 * Ask the platform authenticator to sign a challenge derived from
 * `payload`. The server later re-computes the hash and verifies the
 * signature against the user's registered credential.
 */
export async function authenticateWithChallenge(
  payload: string,
  options?: { rpId?: string; allowCredentialIds?: string[]; timeoutMs?: number },
): Promise<WebAuthnAssertionResult> {
  const nav = navigator as unknown as NavigatorWithCreds;
  if (!nav.credentials) throw new Error('WebAuthn not supported in this browser');

  const challengeHashHex = await sha256Hex(payload);
  const challenge = new Uint8Array(challengeHashHex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));

  const cred = (await nav.credentials.get({
    publicKey: {
      challenge,
      rpId: options?.rpId,
      timeout: options?.timeoutMs ?? 60_000,
      userVerification: 'required',
      allowCredentials: (options?.allowCredentialIds ?? []).map((id) => ({
        id: base64UrlDecode(id),
        type: 'public-key',
        transports: ['internal'],
      })),
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error('Authentication cancelled');

  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    credentialId: base64UrlEncode(cred.rawId),
    authenticatorData: base64UrlEncode(response.authenticatorData),
    clientDataJSON: base64UrlEncode(response.clientDataJSON),
    signature: base64UrlEncode(response.signature),
    challengeHashHex,
  };
}

function base64UrlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const buf = new ArrayBuffer(bin.length);
  const out = new Uint8Array(buf);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
