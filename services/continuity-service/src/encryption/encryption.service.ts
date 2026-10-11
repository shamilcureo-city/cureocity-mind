import { Inject, Injectable } from '@nestjs/common';
import {
  AesGcmFieldEncryptor,
  type IFieldEncryptor,
  type IKmsProvider,
  type UnwrappedDataKey,
} from '@cureocity/crypto';
import type { Prisma, PsychologistTenantKey } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { KMS_PROVIDER } from './encryption.module';

const CACHE_TTL_MS = 5 * 60 * 1000;
const DEK_ID_PREFIX = 'dek:';

interface CachedKey {
  dek: UnwrappedDataKey;
  expiresAt: number;
}

/** Both-format reader and staged writer sharing the web's tenant-key table.
 * KMS IDs identify wrapping keys, never an individual data-encryption key.
 * Cache unwrapped keys by tenant + row ID; resolve the active row under the
 * shared database lock on each write so rotation cannot leave a stale writer.
 */
@Injectable()
export class EncryptionService {
  private readonly encryptor: IFieldEncryptor = new AesGcmFieldEncryptor();
  private readonly cache = new Map<string, CachedKey>();
  private readonly inflight = new Map<string, Promise<UnwrappedDataKey>>();

  constructor(
    private readonly prisma: PrismaService,
    @Inject(KMS_PROVIDER) private readonly kms: IKmsProvider,
    private readonly audit: AuditService,
  ) {}

  /** Default-off writer flag must only be enabled after all readers upgrade. */
  async encryptForTenant(psychologistId: string, plaintext: string): Promise<string> {
    return this.prisma.$transaction(
      async (tx) => {
        await this.lockTenant(tx, psychologistId);
        const active = await tx.psychologistTenantKey.findFirst({
          where: { psychologistId, retiredAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        const row = active ?? (await this.provisionNewDek(tx, psychologistId));
        await this.assertWritableIdentity(tx, psychologistId, row);
        const dek = await this.unwrapRow(psychologistId, row);
        return this.encryptor.encrypt(plaintext, {
          ...dek,
          keyId: this.uniqueWritesEnabled() ? dek.keyId : row.kmsKeyId,
        });
      },
      { timeout: 20_000 },
    );
  }

  /** Historical candidates are tenant-owned and authenticated, never guessed. */
  async decrypt(psychologistId: string, ciphertext: string): Promise<string> {
    const envelopeKeyId = ciphertext.split('.')[1];
    if (!envelopeKeyId) throw new Error('Cannot decrypt: ciphertext envelope is missing keyId');
    if (envelopeKeyId.startsWith(DEK_ID_PREFIX)) {
      const row = await this.prisma.psychologistTenantKey.findFirst({
        where: { psychologistId, id: envelopeKeyId.slice(DEK_ID_PREFIX.length) },
      });
      if (row) return this.encryptor.decrypt(ciphertext, await this.unwrapRow(psychologistId, row));
    } else {
      // Include retired rows and read a fresh candidate set so old writers
      // during rollout cannot leave this process with a stale key-id mapping.
      const rows = await this.prisma.psychologistTenantKey.findMany({
        where: { psychologistId, kmsKeyId: envelopeKeyId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      for (const row of rows) {
        try {
          const dek = await this.unwrapRow(psychologistId, row);
          return await this.encryptor.decrypt(ciphertext, { ...dek, keyId: envelopeKeyId });
        } catch {
          // Bad authentication or an unavailable old wrapping key must not
          // prevent another preserved key from recovering the same record.
        }
      }
    }
    throw new Error('Cannot decrypt: no tenant-owned key authenticated this ciphertext');
  }

  /** Rotation is atomic with provisioning and uses the same web advisory lock.
   * During the reader-first phase, a reused wrapping ID blocks rotation and
   * rolls it back completely; keeping retired keys must not break old readers.
   */
  async rotate(psychologistId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await this.lockTenant(tx, psychologistId);
        await tx.psychologistTenantKey.updateMany({
          where: { psychologistId, retiredAt: null },
          data: { retiredAt: new Date() },
        });
        const row = await this.provisionNewDek(tx, psychologistId);
        await this.assertWritableIdentity(tx, psychologistId, row);
      },
      { timeout: 20_000 },
    );
  }

  private uniqueWritesEnabled(): boolean {
    return process.env['TENANT_CRYPTO_UNIQUE_KEY_WRITES'] === 'true';
  }

  private async lockTenant(tx: Prisma.TransactionClient, psychologistId: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tenant-dek:${psychologistId}`}))`;
  }

  private async assertWritableIdentity(
    tx: Prisma.TransactionClient,
    psychologistId: string,
    row: PsychologistTenantKey,
  ): Promise<void> {
    if (this.uniqueWritesEnabled()) return;
    const matches = await tx.psychologistTenantKey.findMany({
      where: { psychologistId, kmsKeyId: row.kmsKeyId },
      select: { id: true },
    });
    if (matches.length !== 1 || matches[0].id !== row.id) {
      throw new Error(
        'Tenant encryption writes paused: reader-compatible key identity is ambiguous.',
      );
    }
  }

  private async unwrapRow(
    psychologistId: string,
    row: PsychologistTenantKey,
  ): Promise<UnwrappedDataKey> {
    const envelopeKeyId = `${DEK_ID_PREFIX}${row.id}`;
    const cacheKey = `${psychologistId}::${envelopeKeyId}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.dek;
    const pending = this.inflight.get(cacheKey);
    if (pending) return pending;
    const unwrap = (async () => {
      const unwrapped = await this.kms.unwrapDataKey({
        keyId: row.kmsKeyId,
        wrappedKey: row.wrappedKey,
      });
      const dek = { ...unwrapped, keyId: envelopeKeyId };
      this.cache.set(cacheKey, { dek, expiresAt: Date.now() + CACHE_TTL_MS });
      return dek;
    })().finally(() => this.inflight.delete(cacheKey));
    this.inflight.set(cacheKey, unwrap);
    return unwrap;
  }

  private async provisionNewDek(
    tx: Prisma.TransactionClient,
    psychologistId: string,
  ): Promise<PsychologistTenantKey> {
    const { wrapped } = await this.kms.generateDataKey();
    const row = await tx.psychologistTenantKey.create({
      data: {
        psychologistId,
        kmsKeyId: wrapped.keyId,
        wrappedKey: wrapped.wrappedKey,
      },
    });
    await this.audit.log(
      {
        actorType: 'SYSTEM',
        action: 'ENCRYPTION_KEY_PROVISIONED',
        targetType: 'Psychologist',
        targetId: psychologistId,
        metadata: { kmsKeyId: wrapped.keyId, source: 'continuity-service' },
      },
      tx,
    );
    return row;
  }
}
