import { randomBytes } from 'node:crypto';
import type { IKmsProvider, UnwrappedDataKey, WrappedDataKey } from '../types';

export interface GcpKmsTransport {
  encrypt(keyName: string, plaintextBase64: string): Promise<string>;
  decrypt(keyName: string, ciphertextBase64: string): Promise<string>;
}

/** Envelope-key provider backed by a Google Cloud KMS CryptoKey. */
export class GcpKmsProvider implements IKmsProvider {
  constructor(
    private readonly transport: GcpKmsTransport,
    private readonly keyName: string,
  ) {
    if (!/^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/.test(keyName)) {
      throw new Error('GCP_KMS_KEY_NAME must be a full Cloud KMS CryptoKey resource name');
    }
  }

  async generateDataKey(): Promise<{ wrapped: WrappedDataKey; plaintext: UnwrappedDataKey }> {
    const key = new Uint8Array(randomBytes(32));
    const wrappedKey = await this.transport.encrypt(
      this.keyName,
      Buffer.from(key).toString('base64'),
    );
    return {
      wrapped: { keyId: this.keyName, wrappedKey },
      plaintext: { keyId: this.keyName, key },
    };
  }

  async unwrapDataKey(wrapped: WrappedDataKey): Promise<UnwrappedDataKey> {
    if (wrapped.keyId !== this.keyName) {
      throw new Error(`Configured GCP KMS key does not match wrapped key ${wrapped.keyId}`);
    }
    const plaintext = await this.transport.decrypt(this.keyName, wrapped.wrappedKey);
    const key = new Uint8Array(Buffer.from(plaintext, 'base64'));
    if (key.length !== 32) throw new Error('GCP KMS returned an invalid data key length');
    return { keyId: wrapped.keyId, key };
  }
}
