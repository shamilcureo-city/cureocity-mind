import { describe, it, expect } from 'vitest';
import { createHash, generateKeyPairSync, sign as cryptoSign, type KeyObject } from 'node:crypto';
import { verifyNoteSigningAssertion, type AssertionVerifyInput } from './webauthn-assertion';

const RP_ID = 'app.cureocity.mind';
const ORIGIN = 'https://app.cureocity.mind';
const FLAG_UP = 0x01;
const FLAG_UV = 0x04;

function buildAuthData(opts: { rpId?: string; flags?: number; signCount?: number }): Buffer {
  const rpIdHash = createHash('sha256')
    .update(opts.rpId ?? RP_ID, 'utf8')
    .digest();
  const flags = Buffer.from([opts.flags ?? FLAG_UP | FLAG_UV]);
  const sc = Buffer.alloc(4);
  sc.writeUInt32BE(opts.signCount ?? 0, 0);
  return Buffer.concat([rpIdHash, flags, sc]);
}

function buildClientData(opts: { challenge: Buffer; origin?: string; type?: string }): Buffer {
  return Buffer.from(
    JSON.stringify({
      type: opts.type ?? 'webauthn.get',
      challenge: opts.challenge.toString('base64url'),
      origin: opts.origin ?? ORIGIN,
      crossOrigin: false,
    }),
    'utf8',
  );
}

function signedDataFor(authData: Buffer, clientData: Buffer): Buffer {
  return Buffer.concat([authData, createHash('sha256').update(clientData).digest()]);
}

/** Sign for the given key type the way a WebAuthn authenticator would. */
function signAssertion(
  type: 'ec' | 'rsa' | 'ed25519',
  privateKey: KeyObject,
  authData: Buffer,
  clientData: Buffer,
): Buffer {
  const signed = signedDataFor(authData, clientData);
  if (type === 'ed25519') return cryptoSign(null, signed, privateKey);
  if (type === 'rsa') return cryptoSign('sha256', signed, privateKey);
  return cryptoSign('sha256', signed, { key: privateKey, dsaEncoding: 'der' });
}

function makeKey(type: 'ec' | 'rsa' | 'ed25519'): {
  publicKeySpkiB64Url: string;
  privateKey: KeyObject;
} {
  const pair =
    type === 'ec'
      ? generateKeyPairSync('ec', { namedCurve: 'prime256v1' })
      : type === 'rsa'
        ? generateKeyPairSync('rsa', { modulusLength: 2048 })
        : generateKeyPairSync('ed25519');
  return {
    publicKeySpkiB64Url: (
      pair.publicKey.export({ format: 'der', type: 'spki' }) as Buffer
    ).toString('base64url'),
    privateKey: pair.privateKey,
  };
}

/** Build a complete, valid assertion input for a fresh key of the given type. */
function makeValidInput(
  type: 'ec' | 'rsa' | 'ed25519',
  overrides: Partial<{
    authData: Buffer;
    clientData: Buffer;
    storedSignCount: number;
    allowedOrigins: string[] | null;
    expectedRpId: string;
    tamperSignature: boolean;
  }> = {},
): AssertionVerifyInput {
  const { publicKeySpkiB64Url, privateKey } = makeKey(type);
  const payload = 'the-exact-note-json-the-therapist-signed';
  const challengeHashHex = createHash('sha256').update(payload, 'utf8').digest('hex');
  const challenge = Buffer.from(challengeHashHex, 'hex');

  const authData = overrides.authData ?? buildAuthData({});
  const clientData = overrides.clientData ?? buildClientData({ challenge });
  let signature = signAssertion(type, privateKey, authData, clientData);
  if (overrides.tamperSignature) {
    signature = Buffer.from(signature);
    signature[signature.length - 1] ^= 0xff;
  }

  return {
    publicKeySpkiB64Url,
    authenticatorDataB64Url: authData.toString('base64url'),
    clientDataJsonB64Url: clientData.toString('base64url'),
    signatureB64Url: signature.toString('base64url'),
    expectedChallengeHashHex: challengeHashHex,
    expectedRpId: overrides.expectedRpId ?? RP_ID,
    allowedOrigins: overrides.allowedOrigins === undefined ? [ORIGIN] : overrides.allowedOrigins,
    storedSignCount: overrides.storedSignCount ?? 0,
  };
}

describe('verifyNoteSigningAssertion', () => {
  describe('valid assertions', () => {
    it('accepts a valid ES256 (EC P-256) assertion', () => {
      const res = verifyNoteSigningAssertion(makeValidInput('ec'));
      expect(res).toEqual({ ok: true, newSignCount: 0 });
    });

    it('accepts a valid RS256 (RSA-2048) assertion', () => {
      const res = verifyNoteSigningAssertion(makeValidInput('rsa'));
      expect(res.ok).toBe(true);
    });

    it('accepts a valid Ed25519 assertion', () => {
      const res = verifyNoteSigningAssertion(makeValidInput('ed25519'));
      expect(res.ok).toBe(true);
    });

    it('skips origin check when allowedOrigins is null (rpIdHash still binds)', () => {
      const res = verifyNoteSigningAssertion(
        makeValidInput('ec', { allowedOrigins: null, clientData: undefined }),
      );
      expect(res.ok).toBe(true);
    });

    it('accepts and returns the incremented counter when authenticator reports one', () => {
      const challenge = Buffer.from(
        createHash('sha256').update('the-exact-note-json-the-therapist-signed').digest('hex'),
        'hex',
      );
      const authData = buildAuthData({ signCount: 42 });
      const clientData = buildClientData({ challenge });
      const input = makeValidInput('ec', { authData, clientData, storedSignCount: 41 });
      const res = verifyNoteSigningAssertion(input);
      expect(res).toEqual({ ok: true, newSignCount: 42 });
    });
  });

  describe('signature / key failures', () => {
    it('rejects a tampered signature', () => {
      const res = verifyNoteSigningAssertion(makeValidInput('ec', { tamperSignature: true }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/signature did not verify/);
    });

    it('rejects an assertion signed by a different key', () => {
      const good = makeValidInput('ec');
      const other = makeKey('ec');
      const res = verifyNoteSigningAssertion({
        ...good,
        publicKeySpkiB64Url: other.publicKeySpkiB64Url,
      });
      expect(res.ok).toBe(false);
    });

    it('rejects a malformed public key', () => {
      const res = verifyNoteSigningAssertion({
        ...makeValidInput('ec'),
        publicKeySpkiB64Url: 'not-a-real-key',
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/malformed assertion material/);
    });
  });

  describe('challenge binding', () => {
    it('rejects when the challenge does not match the payload hash', () => {
      const wrongChallenge = createHash('sha256').update('a-different-note').digest();
      const clientData = buildClientData({ challenge: wrongChallenge });
      // Re-sign so only the challenge differs, not the signature validity.
      const res = verifyNoteSigningAssertion(makeValidInput('ec', { clientData }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/challenge does not match/);
    });

    it('rejects when clientData.type is not webauthn.get', () => {
      const challenge = Buffer.from(
        createHash('sha256').update('the-exact-note-json-the-therapist-signed').digest('hex'),
        'hex',
      );
      const clientData = buildClientData({ challenge, type: 'webauthn.create' });
      const res = verifyNoteSigningAssertion(makeValidInput('ec', { clientData }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/expected "webauthn.get"/);
    });
  });

  describe('origin + rpId binding', () => {
    it('rejects an origin not in the allowlist', () => {
      const challenge = Buffer.from(
        createHash('sha256').update('the-exact-note-json-the-therapist-signed').digest('hex'),
        'hex',
      );
      const clientData = buildClientData({ challenge, origin: 'https://evil.example' });
      const res = verifyNoteSigningAssertion(makeValidInput('ec', { clientData }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/not in allowed origins/);
    });

    it('rejects when rpIdHash does not match the expected RP ID', () => {
      const res = verifyNoteSigningAssertion(
        makeValidInput('ec', { expectedRpId: 'attacker.example' }),
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/rpIdHash does not match/);
    });
  });

  describe('authenticator flags', () => {
    it('rejects when the user-present flag is clear', () => {
      const challenge = Buffer.from(
        createHash('sha256').update('the-exact-note-json-the-therapist-signed').digest('hex'),
        'hex',
      );
      const authData = buildAuthData({ flags: FLAG_UV }); // UV but not UP
      const clientData = buildClientData({ challenge });
      const res = verifyNoteSigningAssertion(makeValidInput('ec', { authData, clientData }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/user-present/);
    });

    it('rejects when the user-verified flag is clear', () => {
      const challenge = Buffer.from(
        createHash('sha256').update('the-exact-note-json-the-therapist-signed').digest('hex'),
        'hex',
      );
      const authData = buildAuthData({ flags: FLAG_UP }); // UP but not UV
      const clientData = buildClientData({ challenge });
      const res = verifyNoteSigningAssertion(makeValidInput('ec', { authData, clientData }));
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/user-verified/);
    });

    it('rejects authenticatorData that is too short', () => {
      const input = makeValidInput('ec');
      const res = verifyNoteSigningAssertion({
        ...input,
        authenticatorDataB64Url: Buffer.alloc(10).toString('base64url'),
      });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/too short/);
    });
  });

  describe('signCount / clone detection', () => {
    it('rejects a rolled-back counter (stored=10, asserted=10)', () => {
      const challenge = Buffer.from(
        createHash('sha256').update('the-exact-note-json-the-therapist-signed').digest('hex'),
        'hex',
      );
      const authData = buildAuthData({ signCount: 10 });
      const clientData = buildClientData({ challenge });
      const input = makeValidInput('ec', { authData, clientData, storedSignCount: 10 });
      const res = verifyNoteSigningAssertion(input);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/cloned authenticator/);
    });

    it('rejects a counter that goes backwards (stored=10, asserted=5)', () => {
      const challenge = Buffer.from(
        createHash('sha256').update('the-exact-note-json-the-therapist-signed').digest('hex'),
        'hex',
      );
      const authData = buildAuthData({ signCount: 5 });
      const clientData = buildClientData({ challenge });
      const input = makeValidInput('ec', { authData, clientData, storedSignCount: 10 });
      const res = verifyNoteSigningAssertion(input);
      expect(res.ok).toBe(false);
    });

    it('accepts the all-zero counter case (Touch ID style)', () => {
      const res = verifyNoteSigningAssertion(makeValidInput('ec', { storedSignCount: 0 }));
      expect(res).toEqual({ ok: true, newSignCount: 0 });
    });
  });
});
