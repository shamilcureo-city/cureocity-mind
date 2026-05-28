import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  type CipherGCM,
  type DecipherGCM,
} from 'node:crypto';
import type { IFieldEncryptor, UnwrappedDataKey } from '../types';

const IV_BYTES = 12; // 96 bits — NIST-recommended for GCM
const TAG_BYTES = 16;
const VERSION = 'v1';

/**
 * AesGcmFieldEncryptor — AES-256-GCM with a per-call random IV. Compatible
 * with pgcrypto's pgp_sym_encrypt AEAD output (same primitives, different
 * envelope) so a future on-DB encrypt path can be wired without re-keying.
 *
 * Output format:
 *   v1.<keyId>.<iv>.<ciphertext>.<tag>     (all base64url, no padding)
 */
export class AesGcmFieldEncryptor implements IFieldEncryptor {
  encrypt(plaintext: string, dek: UnwrappedDataKey): string {
    if (dek.key.length !== 32) throw new Error('DEK must be 32 bytes (AES-256)');
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', dek.key, iv) as CipherGCM;
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [VERSION, dek.keyId, toB64Url(iv), toB64Url(ct), toB64Url(tag)].join('.');
  }

  decrypt(ciphertext: string, dek: UnwrappedDataKey): string {
    const parts = ciphertext.split('.');
    if (parts.length !== 5) {
      throw new Error(`Invalid ciphertext envelope: expected 5 segments, got ${parts.length}`);
    }
    const [version, keyId, ivB64, ctB64, tagB64] = parts;
    if (version !== VERSION) {
      throw new Error(`Unsupported ciphertext version: ${version}`);
    }
    if (keyId !== dek.keyId) {
      throw new Error(`DEK mismatch: ciphertext keyId=${keyId} but DEK keyId=${dek.keyId}`);
    }
    const iv = fromB64Url(ivB64!);
    const ct = fromB64Url(ctB64!);
    const tag = fromB64Url(tagB64!);
    if (iv.length !== IV_BYTES) throw new Error('IV must be 12 bytes');
    if (tag.length !== TAG_BYTES) throw new Error('Auth tag must be 16 bytes');
    const decipher = createDecipheriv('aes-256-gcm', dek.key, iv) as DecipherGCM;
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return pt.toString('utf8');
  }
}

function toB64Url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64Url(s: string): Buffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}
