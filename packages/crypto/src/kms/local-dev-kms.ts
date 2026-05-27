import { createHmac, randomBytes, scryptSync } from 'node:crypto';
import type { IKmsProvider, UnwrappedDataKey, WrappedDataKey } from '../types';

/**
 * LocalDevKmsProvider — deterministic dev / test KMS.
 *
 * Derives a 32-byte "master key" from CRYPTO_DEV_MASTER_SECRET via scrypt,
 * then wraps DEKs by XOR-with-master-derived-stream (Encrypt-then-MAC with
 * HMAC-SHA-256 for integrity). This is NOT production-secure — for prod,
 * `AwsKmsProvider` is the only acceptable choice. A bootstrap warning is
 * logged once per process.
 *
 * Wrapped envelope:
 *   { keyId, wrappedKey: base64(iv || ciphertext || hmac) }
 *
 * IV is 16 random bytes, expanded via HKDF-Extract style derivation
 * because we want zero deps beyond Node's stdlib.
 */
const MASTER_KEY_SALT = Buffer.from('cureocity-mind-dev-master-salt-2026', 'utf8');

export class LocalDevKmsProvider implements IKmsProvider {
  private readonly masterKey: Buffer;
  readonly keyId: string;

  constructor(opts?: { devMasterSecret?: string; keyId?: string }) {
    const secret =
      opts?.devMasterSecret ??
      process.env['CRYPTO_DEV_MASTER_SECRET'] ??
      'dev-master-secret-do-not-use-in-prod';
    this.masterKey = scryptSync(secret, MASTER_KEY_SALT, 32);
    this.keyId = opts?.keyId ?? 'local-dev-kms-v1';
  }

  async generateDataKey(): Promise<{ wrapped: WrappedDataKey; plaintext: UnwrappedDataKey }> {
    const dek = new Uint8Array(randomBytes(32));
    const wrapped = this.wrap(dek);
    return {
      wrapped: { keyId: this.keyId, wrappedKey: wrapped },
      plaintext: { keyId: this.keyId, key: dek },
    };
  }

  async unwrapDataKey(wrapped: WrappedDataKey): Promise<UnwrappedDataKey> {
    if (wrapped.keyId !== this.keyId) {
      throw new Error(
        `LocalDevKmsProvider cannot unwrap a key wrapped by a different provider (key=${wrapped.keyId}, this=${this.keyId})`,
      );
    }
    const key = this.unwrap(wrapped.wrappedKey);
    return { keyId: this.keyId, key };
  }

  private wrap(dek: Uint8Array): string {
    const iv = randomBytes(16);
    const stream = this.deriveStream(iv, dek.length);
    const ct = new Uint8Array(dek.length);
    for (let i = 0; i < dek.length; i++) ct[i] = dek[i]! ^ stream[i]!;
    const mac = createHmac('sha256', this.masterKey).update(iv).update(ct).digest();
    return Buffer.concat([iv, ct, mac]).toString('base64');
  }

  private unwrap(blob: string): Uint8Array {
    const buf = Buffer.from(blob, 'base64');
    if (buf.length < 16 + 1 + 32) throw new Error('Wrapped key blob too short');
    const iv = buf.subarray(0, 16);
    const mac = buf.subarray(buf.length - 32);
    const ct = buf.subarray(16, buf.length - 32);
    const expected = createHmac('sha256', this.masterKey).update(iv).update(ct).digest();
    if (!constantTimeEq(mac, expected)) {
      throw new Error('Wrapped key MAC mismatch — refusing to unwrap');
    }
    const stream = this.deriveStream(iv, ct.length);
    const dek = new Uint8Array(ct.length);
    for (let i = 0; i < ct.length; i++) dek[i] = ct[i]! ^ stream[i]!;
    return dek;
  }

  private deriveStream(iv: Buffer, length: number): Buffer {
    // Counter-mode HMAC stream — simple PRG over (masterKey, iv, counter).
    const blocks: Buffer[] = [];
    let needed = length;
    let counter = 0;
    while (needed > 0) {
      const ctr = Buffer.alloc(4);
      ctr.writeUInt32BE(counter++, 0);
      const block = createHmac('sha256', this.masterKey).update(iv).update(ctr).digest();
      blocks.push(block);
      needed -= block.length;
    }
    return Buffer.concat(blocks).subarray(0, length);
  }
}

function constantTimeEq(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
