import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  AesGcmFieldEncryptor,
  type IFieldEncryptor,
  type IKmsProvider,
  type UnwrappedDataKey,
  type WrappedDataKey,
} from '@cureocity/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { KMS_PROVIDER } from './encryption.module';

/**
 * EncryptionService — Sprint 9 PR 3, gap G10.
 *
 * Resolves a per-psychologist DEK on demand:
 *   1. Look up the active PsychologistTenantKey row.
 *   2. If none, generate one via the configured KMS and persist.
 *   3. Unwrap and cache in-process for ~5 minutes so high-throughput
 *      paths don't make a KMS call per write.
 *
 * Caching is intentional + tight: a 5-min TTL means even a leaked
 * process keeps usable DEKs only briefly, while keeping AWS KMS unit
 * costs tractable in production.
 */
const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedKey {
  dek: UnwrappedDataKey;
  expiresAt: number;
}

@Injectable()
export class EncryptionService {
  private readonly logger = new Logger(EncryptionService.name);
  private readonly encryptor: IFieldEncryptor = new AesGcmFieldEncryptor();
  private readonly cache = new Map<string, CachedKey>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(KMS_PROVIDER) private readonly kms: IKmsProvider,
  ) {}

  /** Encrypts `plaintext` for the given psychologist tenant. */
  async encryptForTenant(psychologistId: string, plaintext: string): Promise<string> {
    const dek = await this.getOrCreateDek(psychologistId);
    return this.encryptor.encrypt(plaintext, dek);
  }

  /**
   * Decrypts ciphertext. The DEK is selected by the keyId embedded in
   * the ciphertext envelope (not by psychologistId), so historical rows
   * remain readable after a key rotation.
   */
  async decrypt(psychologistId: string, ciphertext: string): Promise<string> {
    const envelopeKeyId = ciphertext.split('.')[1];
    if (!envelopeKeyId) {
      throw new Error('Cannot decrypt: ciphertext envelope is missing keyId');
    }
    const dek = await this.getDekByEnvelope(psychologistId, envelopeKeyId);
    return this.encryptor.decrypt(ciphertext, dek);
  }

  /** Rotates the active DEK for a tenant. Old rows remain decryptable. */
  async rotate(psychologistId: string): Promise<void> {
    await this.prisma.psychologistTenantKey.updateMany({
      where: { psychologistId, retiredAt: null },
      data: { retiredAt: new Date() },
    });
    await this.provisionNewDek(psychologistId);
    // Drop cache so subsequent encrypts pick up the new DEK.
    this.cache.delete(psychologistId);
  }

  // ---- internals ----------------------------------------------------------

  private async getOrCreateDek(psychologistId: string): Promise<UnwrappedDataKey> {
    const cached = this.cache.get(psychologistId);
    if (cached && cached.expiresAt > Date.now()) return cached.dek;

    const active = await this.prisma.psychologistTenantKey.findFirst({
      where: { psychologistId, retiredAt: null },
      orderBy: { createdAt: 'desc' },
    });

    const dek = active
      ? await this.kms.unwrapDataKey({ keyId: active.kmsKeyId, wrappedKey: active.wrappedKey })
      : await this.provisionNewDek(psychologistId);

    this.cache.set(psychologistId, { dek, expiresAt: Date.now() + CACHE_TTL_MS });
    return dek;
  }

  private async getDekByEnvelope(
    psychologistId: string,
    envelopeKeyId: string,
  ): Promise<UnwrappedDataKey> {
    // First check cache.
    const cached = this.cache.get(psychologistId);
    if (cached && cached.dek.keyId === envelopeKeyId && cached.expiresAt > Date.now()) {
      return cached.dek;
    }
    // Look up any row matching the envelope's KMS key id for this tenant.
    const row = await this.prisma.psychologistTenantKey.findFirst({
      where: { psychologistId, kmsKeyId: envelopeKeyId },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      throw new Error(
        `Cannot decrypt: no PsychologistTenantKey row matches envelope kmsKeyId=${envelopeKeyId} for psy=${psychologistId}`,
      );
    }
    return this.kms.unwrapDataKey({ keyId: row.kmsKeyId, wrappedKey: row.wrappedKey });
  }

  private async provisionNewDek(psychologistId: string): Promise<UnwrappedDataKey> {
    const { wrapped, plaintext } = await this.kms.generateDataKey();
    await this.persistWrappedKey(psychologistId, wrapped);
    this.logger.log(`Provisioned new DEK for psy=${psychologistId} kmsKeyId=${wrapped.keyId}`);
    return plaintext;
  }

  private async persistWrappedKey(psychologistId: string, wrapped: WrappedDataKey): Promise<void> {
    await this.prisma.psychologistTenantKey.create({
      data: {
        psychologistId,
        kmsKeyId: wrapped.keyId,
        wrappedKey: wrapped.wrappedKey,
      },
    });
  }
}
