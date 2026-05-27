import { describe, it, expect } from 'vitest';
import { LocalDevKmsProvider } from './local-dev-kms';

describe('LocalDevKmsProvider', () => {
  it('generates a 32-byte DEK and round-trips wrap/unwrap', async () => {
    const kms = new LocalDevKmsProvider({ devMasterSecret: 'unit-test' });
    const { wrapped, plaintext } = await kms.generateDataKey();
    expect(plaintext.key.length).toBe(32);
    expect(wrapped.keyId).toBe('local-dev-kms-v1');

    const unwrapped = await kms.unwrapDataKey(wrapped);
    expect(unwrapped.key.length).toBe(32);
    expect(Buffer.from(unwrapped.key).equals(Buffer.from(plaintext.key))).toBe(true);
  });

  it('produces different DEKs on each call (no reuse)', async () => {
    const kms = new LocalDevKmsProvider({ devMasterSecret: 'unit-test' });
    const a = await kms.generateDataKey();
    const b = await kms.generateDataKey();
    expect(Buffer.from(a.plaintext.key).equals(Buffer.from(b.plaintext.key))).toBe(false);
    expect(a.wrapped.wrappedKey).not.toBe(b.wrapped.wrappedKey);
  });

  it('rejects unwrapping with a different master secret (HMAC mismatch)', async () => {
    const a = new LocalDevKmsProvider({ devMasterSecret: 'secret-a' });
    const b = new LocalDevKmsProvider({ devMasterSecret: 'secret-b' });
    const { wrapped } = await a.generateDataKey();
    await expect(b.unwrapDataKey(wrapped)).rejects.toThrow(/MAC mismatch/);
  });

  it('rejects unwrapping a key from a different provider keyId', async () => {
    const a = new LocalDevKmsProvider({ devMasterSecret: 'unit-test', keyId: 'a' });
    const b = new LocalDevKmsProvider({ devMasterSecret: 'unit-test', keyId: 'b' });
    const { wrapped } = await a.generateDataKey();
    await expect(b.unwrapDataKey(wrapped)).rejects.toThrow(/different provider/);
  });

  it('detects tampering of the ciphertext blob', async () => {
    const kms = new LocalDevKmsProvider({ devMasterSecret: 'unit-test' });
    const { wrapped } = await kms.generateDataKey();
    const raw = Buffer.from(wrapped.wrappedKey, 'base64');
    const flipped = Buffer.from(raw);
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    const tampered = { ...wrapped, wrappedKey: flipped.toString('base64') };
    await expect(kms.unwrapDataKey(tampered)).rejects.toThrow(/MAC mismatch/);
  });
});
