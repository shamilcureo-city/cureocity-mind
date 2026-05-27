import { describe, it, expect } from 'vitest';
import { AesGcmFieldEncryptor } from './aes-gcm-encryptor';
import { LocalDevKmsProvider } from '../kms/local-dev-kms';

describe('AesGcmFieldEncryptor', () => {
  const kms = new LocalDevKmsProvider({ devMasterSecret: 'test-secret' });
  const enc = new AesGcmFieldEncryptor();

  it('round-trips arbitrary unicode strings', async () => {
    const { plaintext } = await kms.generateDataKey();
    const samples = [
      'Hello, World!',
      'Multi-line\nstring with\ttabs',
      'मुझे चिंता हो रही है', // Hindi
      'പുകവലിക്കുന്ന ശീലം', // Malayalam
      '',
      'x'.repeat(10_000),
    ];
    for (const s of samples) {
      const ct = enc.encrypt(s, plaintext);
      expect(ct).toMatch(/^v1\.local-dev-kms-v1\..+\..*\..+$/);
      expect(enc.decrypt(ct, plaintext)).toBe(s);
    }
  });

  it('produces a different ciphertext on every encrypt (random IV)', async () => {
    const { plaintext } = await kms.generateDataKey();
    const a = enc.encrypt('hello', plaintext);
    const b = enc.encrypt('hello', plaintext);
    expect(a).not.toBe(b);
    expect(enc.decrypt(a, plaintext)).toBe('hello');
    expect(enc.decrypt(b, plaintext)).toBe('hello');
  });

  it('rejects decrypt with a wrong key (AEAD tag mismatch)', async () => {
    const { plaintext: key1 } = await kms.generateDataKey();
    const { plaintext: key2 } = await kms.generateDataKey();
    const ct = enc.encrypt('secret', key1);
    expect(() => enc.decrypt(ct, { ...key2, keyId: key1.keyId })).toThrow();
  });

  it('rejects decrypt when keyId in envelope does not match supplied DEK', async () => {
    const { plaintext } = await kms.generateDataKey();
    const ct = enc.encrypt('s', plaintext);
    expect(() => enc.decrypt(ct, { ...plaintext, keyId: 'other-key' })).toThrow(/DEK mismatch/);
  });

  it('rejects ciphertext from a future version', async () => {
    const { plaintext } = await kms.generateDataKey();
    const bad = 'v9.local-dev-kms-v1.aaa.bbb.ccc';
    expect(() => enc.decrypt(bad, plaintext)).toThrow(/Unsupported.+version/);
  });

  it('rejects malformed envelope', async () => {
    const { plaintext } = await kms.generateDataKey();
    expect(() => enc.decrypt('not-a-real-envelope', plaintext)).toThrow(/Invalid ciphertext/);
  });

  it('rejects a DEK that is not 32 bytes', () => {
    const dek = { keyId: 'k', key: new Uint8Array(16) };
    expect(() => enc.encrypt('x', dek)).toThrow(/32 bytes/);
  });
});
