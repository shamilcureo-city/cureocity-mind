import { createHash, createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

/**
 * WebAuthn assertion signature verification — the "V1.2 COSE step"
 * tracked since Sprint 18, implemented in Sprint 33.
 *
 * Lives in @cureocity/crypto (alongside the envelope encryptor) because
 * it is pure Node-crypto with no web-framework or DB dependency, and so
 * it can be unit-tested with the rest of the crypto primitives. The
 * apps/web wrapper (lib/webauthn-verify.ts) adds env-driven origin
 * resolution and feeds in the stored credential row.
 *
 * Why this matters: before Sprint 33 the sign route checked only that an
 * assertion was present and that its `credentialId` matched a registered
 * credential. `credentialId` is not secret (it's returned by the
 * credential-list endpoint), so a forged assertion carrying a known
 * credentialId + the correct challenge hash would have passed. This
 * verifies the signature itself against the registered public key and
 * binds it to the exact note payload.
 *
 * Key format: the browser registers `AuthenticatorAttestationResponse
 * .getPublicKey()`, which is SPKI DER (not raw COSE/CBOR), so
 * `createPublicKey({ format: 'der', type: 'spki' })` imports EC
 * (P-256/384/521), RSA, and Ed25519 keys directly — no CBOR decoder.
 *
 * Verification chain (WebAuthn §7.2, subset for a registered credential):
 *   1. clientDataJSON.type === "webauthn.get"
 *   2. clientDataJSON.challenge === sha256(payload)            ← binding
 *   3. clientDataJSON.origin ∈ allowedOrigins (when provided)
 *   4. authenticatorData.rpIdHash === sha256(rpId)
 *   5. user-present + user-verified flags set
 *   6. signature verifies over (authenticatorData ‖ sha256(clientDataJSON))
 *   7. signCount strictly increasing unless authenticator reports 0
 */

const FLAG_UP = 0x01; // user present
const FLAG_UV = 0x04; // user verified

export interface AssertionVerifyInput {
  /** Stored credential.publicKey — base64url of SPKI DER. */
  publicKeySpkiB64Url: string;
  /** assertion.authenticatorData — base64url. */
  authenticatorDataB64Url: string;
  /** assertion.clientDataJSON — base64url. */
  clientDataJsonB64Url: string;
  /** assertion.signature — base64url. */
  signatureB64Url: string;
  /** sha256(payload) as 64 hex chars — the value the challenge must encode. */
  expectedChallengeHashHex: string;
  /** Effective relying-party id (WEBAUTHN_RP_ID or request hostname). */
  expectedRpId: string;
  /** Allowed clientData.origin values, or null to skip the origin check. */
  allowedOrigins: string[] | null;
  /** signCount currently persisted for this credential. */
  storedSignCount: number;
}

export type AssertionVerifyResult =
  | { ok: true; newSignCount: number }
  | { ok: false; reason: string };

interface ParsedClientData {
  type?: unknown;
  challenge?: unknown;
  origin?: unknown;
}

/**
 * Verify a note-signing WebAuthn assertion. Pure + synchronous (Node
 * crypto verify is sync) — returns a discriminated result rather than
 * throwing, so the caller can map failures to a 401 with a reason. When
 * `allowedOrigins` is null the origin check is skipped (rpIdHash still
 * binds the assertion to the domain); the caller decides whether to warn.
 */
export function verifyNoteSigningAssertion(input: AssertionVerifyInput): AssertionVerifyResult {
  let authData: Buffer;
  let clientDataBytes: Buffer;
  let signature: Buffer;
  let key: KeyObject;
  try {
    authData = Buffer.from(input.authenticatorDataB64Url, 'base64url');
    clientDataBytes = Buffer.from(input.clientDataJsonB64Url, 'base64url');
    signature = Buffer.from(input.signatureB64Url, 'base64url');
    key = createPublicKey({
      key: Buffer.from(input.publicKeySpkiB64Url, 'base64url'),
      format: 'der',
      type: 'spki',
    });
  } catch (e) {
    return { ok: false, reason: `malformed assertion material: ${(e as Error).message}` };
  }

  // --- 1-3: clientDataJSON --------------------------------------------------
  let clientData: ParsedClientData;
  try {
    clientData = JSON.parse(clientDataBytes.toString('utf8')) as ParsedClientData;
  } catch {
    return { ok: false, reason: 'clientDataJSON is not valid JSON' };
  }
  if (clientData.type !== 'webauthn.get') {
    return {
      ok: false,
      reason: `clientData.type is "${String(clientData.type)}", expected "webauthn.get"`,
    };
  }
  if (typeof clientData.challenge !== 'string') {
    return { ok: false, reason: 'clientData.challenge missing' };
  }
  // The challenge bytes are the raw sha256(payload) digest; the browser
  // base64url-encodes them into clientData.challenge. Compare by bytes so
  // padding/encoding quirks don't cause a false mismatch.
  const gotChallenge = Buffer.from(clientData.challenge, 'base64url');
  const wantChallenge = Buffer.from(input.expectedChallengeHashHex, 'hex');
  if (wantChallenge.length === 0 || !gotChallenge.equals(wantChallenge)) {
    return { ok: false, reason: 'clientData.challenge does not match the note payload hash' };
  }
  if (input.allowedOrigins !== null) {
    if (
      typeof clientData.origin !== 'string' ||
      !input.allowedOrigins.includes(clientData.origin)
    ) {
      return {
        ok: false,
        reason: `clientData.origin "${String(clientData.origin)}" not in allowed origins`,
      };
    }
  }

  // --- 4-5: authenticatorData ----------------------------------------------
  if (authData.length < 37) {
    return { ok: false, reason: `authenticatorData too short (${authData.length} bytes)` };
  }
  const rpIdHash = authData.subarray(0, 32);
  const expectedRpIdHash = createHash('sha256').update(input.expectedRpId, 'utf8').digest();
  if (!rpIdHash.equals(expectedRpIdHash)) {
    return { ok: false, reason: 'authenticatorData.rpIdHash does not match the expected RP ID' };
  }
  const flags = authData[32]!;
  if ((flags & FLAG_UP) === 0) {
    return { ok: false, reason: 'user-present flag not set' };
  }
  if ((flags & FLAG_UV) === 0) {
    return {
      ok: false,
      reason: 'user-verified flag not set (userVerification was required at registration)',
    };
  }
  const authSignCount = authData.readUInt32BE(33);

  // --- 6: signature ---------------------------------------------------------
  // WebAuthn signs authenticatorData ‖ SHA-256(clientDataJSON).
  const signedData = Buffer.concat([
    authData,
    createHash('sha256').update(clientDataBytes).digest(),
  ]);
  let sigOk: boolean;
  try {
    sigOk = verifyForKey(key, signedData, signature);
  } catch (e) {
    return { ok: false, reason: `signature verification error: ${(e as Error).message}` };
  }
  if (!sigOk) {
    return { ok: false, reason: 'assertion signature did not verify against the registered key' };
  }

  // --- 7: signCount monotonicity (clone detection) -------------------------
  // Many platform authenticators (notably Apple Touch ID) always report 0.
  // Per spec: if both are 0 the authenticator doesn't implement a counter —
  // accept. Otherwise the new count must strictly exceed the stored one.
  if (!(authSignCount === 0 && input.storedSignCount === 0)) {
    if (authSignCount <= input.storedSignCount) {
      return {
        ok: false,
        reason: `signCount did not increase (stored=${input.storedSignCount}, asserted=${authSignCount}) — possible cloned authenticator`,
      };
    }
  }

  return { ok: true, newSignCount: authSignCount };
}

/**
 * Dispatch signature verification by key type. ECDSA assertions are
 * DER-encoded (WebAuthn requirement), so `dsaEncoding: 'der'`. The hash
 * tracks the curve (ES256/384/512). RSA is RS256 (PKCS#1 v1.5 + SHA-256).
 * Ed25519 verifies the raw message (no pre-hash).
 */
function verifyForKey(key: KeyObject, signedData: Buffer, signature: Buffer): boolean {
  const type = key.asymmetricKeyType;
  if (type === 'ed25519') {
    return cryptoVerify(null, signedData, key, signature);
  }
  if (type === 'rsa' || type === 'rsa-pss') {
    return cryptoVerify('sha256', signedData, key, signature);
  }
  if (type === 'ec') {
    const curve = key.asymmetricKeyDetails?.namedCurve;
    const hash = curve === 'secp384r1' ? 'sha384' : curve === 'secp521r1' ? 'sha512' : 'sha256';
    return cryptoVerify(hash, signedData, { key, dsaEncoding: 'der' }, signature);
  }
  throw new Error(`unsupported key type: ${String(type)}`);
}
