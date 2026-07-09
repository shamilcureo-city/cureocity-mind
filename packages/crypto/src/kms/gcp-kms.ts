import { randomBytes } from 'node:crypto';
import type { IKmsProvider, UnwrappedDataKey, WrappedDataKey } from '../types';

/**
 * GcpKmsProvider — production KMS using Google Cloud KMS Encrypt + Decrypt.
 *
 * Unlike AWS KMS, Cloud KMS has NO GenerateDataKey primitive, so the envelope
 * is assembled here: a 32-byte DEK is minted locally with a CSPRNG and then
 * wrapped by a single Cloud KMS `Encrypt` against the customer master key.
 * `unwrapDataKey` is a plain `Decrypt` — Cloud KMS auto-selects the key
 * version for a symmetric key, so the stored `keyId` is the versionless
 * cryptoKey resource name.
 *
 * The KMS client is injected (structurally typed) so this package never pulls
 * `@google-cloud/kms` into its type surface and tests run without the SDK or
 * the network. apps/web adapts the real KeyManagementServiceClient — whose
 * encrypt/decrypt resolve to `[response, ...]` tuples — down to this shape.
 */
export interface GcpKmsClient {
  encrypt(req: {
    name: string;
    plaintext: Buffer;
  }): Promise<{ ciphertext?: Uint8Array | string | null }>;
  decrypt(req: {
    name: string;
    ciphertext: Buffer;
  }): Promise<{ plaintext?: Uint8Array | string | null }>;
}

const DEK_BYTES = 32; // AES-256

/** Cloud KMS returns Buffers in Node, or base64 strings under some transports. */
function toBuffer(v: Uint8Array | string | null | undefined, what: string): Buffer {
  if (v == null || (typeof v !== 'string' && v.length === 0)) {
    throw new Error(`GCP KMS ${what} returned empty`);
  }
  return typeof v === 'string' ? Buffer.from(v, 'base64') : Buffer.from(v);
}

export class GcpKmsProvider implements IKmsProvider {
  constructor(
    private readonly client: GcpKmsClient,
    /**
     * Full cryptoKey resource name (versionless):
     * projects/P/locations/asia-south1/keyRings/R/cryptoKeys/K
     */
    private readonly keyName: string,
  ) {}

  async generateDataKey(): Promise<{ wrapped: WrappedDataKey; plaintext: UnwrappedDataKey }> {
    const dek = randomBytes(DEK_BYTES);
    const res = await this.client.encrypt({ name: this.keyName, plaintext: dek });
    const ciphertext = toBuffer(res.ciphertext, 'Encrypt ciphertext');
    return {
      wrapped: { keyId: this.keyName, wrappedKey: ciphertext.toString('base64') },
      plaintext: { keyId: this.keyName, key: new Uint8Array(dek) },
    };
  }

  async unwrapDataKey(wrapped: WrappedDataKey): Promise<UnwrappedDataKey> {
    // Decrypt against the key that wrapped it (honours a rotated GCP_KMS_KEY_NAME
    // — old rows keep their original cryptoKey resource in `keyId`).
    const res = await this.client.decrypt({
      name: wrapped.keyId,
      ciphertext: Buffer.from(wrapped.wrappedKey, 'base64'),
    });
    const dek = toBuffer(res.plaintext, 'Decrypt plaintext');
    return { keyId: wrapped.keyId, key: new Uint8Array(dek) };
  }
}
