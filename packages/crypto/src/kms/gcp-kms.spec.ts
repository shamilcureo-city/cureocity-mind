import { describe, expect, it } from 'vitest';
import { GcpKmsProvider, type GcpKmsTransport } from './gcp-kms';

const keyName = 'projects/orbit/locations/asia-south1/keyRings/clinical/cryptoKeys/patient-data';

class MemoryTransport implements GcpKmsTransport {
  async encrypt(_keyName: string, plaintext: string): Promise<string> {
    return Buffer.from(`wrapped:${plaintext}`).toString('base64');
  }
  async decrypt(_keyName: string, ciphertext: string): Promise<string> {
    return Buffer.from(ciphertext, 'base64')
      .toString('utf8')
      .replace(/^wrapped:/, '');
  }
}

describe('GcpKmsProvider', () => {
  it('generates and unwraps a 256-bit data key', async () => {
    const provider = new GcpKmsProvider(new MemoryTransport(), keyName);
    const generated = await provider.generateDataKey();
    expect(generated.plaintext.key).toHaveLength(32);
    expect(generated.wrapped.keyId).toBe(keyName);
    await expect(provider.unwrapDataKey(generated.wrapped)).resolves.toEqual(generated.plaintext);
  });

  it('rejects malformed and mismatched key resources', async () => {
    expect(() => new GcpKmsProvider(new MemoryTransport(), 'not-a-key')).toThrow(
      /full Cloud KMS CryptoKey resource name/,
    );
    const provider = new GcpKmsProvider(new MemoryTransport(), keyName);
    await expect(
      provider.unwrapDataKey({ keyId: `${keyName}-other`, wrappedKey: 'x' }),
    ).rejects.toThrow(/does not match/);
  });
});
