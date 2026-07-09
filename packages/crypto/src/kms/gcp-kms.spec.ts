import { describe, it, expect } from 'vitest';
import { GcpKmsProvider, type GcpKmsClient } from './gcp-kms';

const KEY = 'projects/p/locations/asia-south1/keyRings/r/cryptoKeys/k';

/**
 * A reversible in-memory stand-in for Cloud KMS: "wrap" prefixes a magic
 * header so the round-trip is verifiable and a foreign/tampered blob is
 * rejected — no SDK, no network. The real KeyManagementServiceClient is
 * adapted to this same shape in apps/web/lib/tenant-crypto.ts.
 */
const MAGIC = Buffer.from('KMSFAKE:');
function fakeClient(): GcpKmsClient {
  return {
    encrypt: async ({ plaintext }) => ({ ciphertext: Buffer.concat([MAGIC, plaintext]) }),
    decrypt: async ({ ciphertext }) => {
      const buf = Buffer.from(ciphertext);
      if (!buf.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('bad ciphertext');
      return { plaintext: buf.subarray(MAGIC.length) };
    },
  };
}

describe('GcpKmsProvider', () => {
  it('mints a 32-byte DEK and round-trips wrap/unwrap', async () => {
    const kms = new GcpKmsProvider(fakeClient(), KEY);
    const { wrapped, plaintext } = await kms.generateDataKey();
    expect(plaintext.key.length).toBe(32);
    expect(wrapped.keyId).toBe(KEY);
    expect(plaintext.keyId).toBe(KEY);

    const unwrapped = await kms.unwrapDataKey(wrapped);
    expect(unwrapped.key.length).toBe(32);
    expect(Buffer.from(unwrapped.key).equals(Buffer.from(plaintext.key))).toBe(true);
    expect(unwrapped.keyId).toBe(KEY);
  });

  it('produces a fresh DEK on every call (no reuse)', async () => {
    const kms = new GcpKmsProvider(fakeClient(), KEY);
    const a = await kms.generateDataKey();
    const b = await kms.generateDataKey();
    expect(Buffer.from(a.plaintext.key).equals(Buffer.from(b.plaintext.key))).toBe(false);
    expect(a.wrapped.wrappedKey).not.toBe(b.wrapped.wrappedKey);
  });

  it('accepts a base64-string ciphertext (alternate transport encoding)', async () => {
    const b64Client: GcpKmsClient = {
      encrypt: async ({ plaintext }) => ({
        ciphertext: Buffer.concat([MAGIC, plaintext]).toString('base64'),
      }),
      decrypt: async ({ ciphertext }) => {
        const buf = Buffer.from(ciphertext);
        return { plaintext: buf.subarray(MAGIC.length).toString('base64') };
      },
    };
    const kms = new GcpKmsProvider(b64Client, KEY);
    const { wrapped, plaintext } = await kms.generateDataKey();
    const unwrapped = await kms.unwrapDataKey(wrapped);
    expect(Buffer.from(unwrapped.key).equals(Buffer.from(plaintext.key))).toBe(true);
  });

  it('throws when Cloud KMS returns an empty ciphertext', async () => {
    const empty: GcpKmsClient = {
      encrypt: async () => ({ ciphertext: null }),
      decrypt: async () => ({ plaintext: null }),
    };
    const kms = new GcpKmsProvider(empty, KEY);
    await expect(kms.generateDataKey()).rejects.toThrow(/Encrypt ciphertext returned empty/);
  });
});
