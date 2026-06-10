import {
  AesGcmFieldEncryptor,
  LocalDevKmsProvider,
  type IFieldEncryptor,
  type IKmsProvider,
  type UnwrappedDataKey,
  type WrappedDataKey,
} from '@cureocity/crypto';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';

/**
 * Sprint 32 — per-tenant envelope encryption for the live request path.
 *
 * Ports services/continuity-service/encryption.service.ts to a module-
 * scoped singleton suitable for Next.js route handlers. Two layers:
 *
 *   - IKmsProvider wraps/unwraps a tenant DEK against a Customer
 *     Master Key. Production swaps to AwsKmsProvider once S32 Phase
 *     2 (asia-south1 procurement) lands; dev uses LocalDevKmsProvider
 *     keyed off CRYPTO_DEV_MASTER_SECRET.
 *   - AesGcmFieldEncryptor encrypts column values with the per-tenant
 *     DEK. Output is a single dot-separated string column for easy
 *     SELECT.
 *
 * Per-tenant DEKs live in PsychologistTenantKey rows (one active row
 * per psychologist; old rows kept for decrypt of rotated data). The
 * wrapped key is the only persisted form; the unwrapped DEK lives in
 * the in-process cache for 5 minutes max.
 *
 * Provisioning is lazy + auto: the first call for a psychologist that
 * has no active key triggers a `generateDataKey` + persist + audit.
 * That keeps the rollout invisible to therapists and means existing
 * dev fixtures don't need a seed migration.
 */

const CACHE_TTL_MS = 5 * 60 * 1000;

interface CachedKey {
  dek: UnwrappedDataKey;
  expiresAt: number;
}

interface TenantCrypto {
  kms: IKmsProvider;
  encryptor: IFieldEncryptor;
  cache: Map<string, CachedKey>;
  backend: 'local-dev' | 'aws-kms';
}

declare global {
  var __cureocityTenantCrypto: TenantCrypto | undefined;
}

function instance(): TenantCrypto {
  if (globalThis.__cureocityTenantCrypto) return globalThis.__cureocityTenantCrypto;
  const backend = (process.env['KMS_BACKEND'] ?? 'local-dev') as 'local-dev' | 'aws-kms';
  let kms: IKmsProvider;
  if (backend === 'aws-kms') {
    // AwsKmsProvider needs @aws-sdk/client-kms wired in apps/web. Track in
    // S32 Phase 2 — asia-south1 region procurement decides the deployment
    // story. Until then any non-local backend hard-fails at startup so we
    // never silently fall through to the dev KMS in prod.
    throw new Error(
      'KMS_BACKEND=aws-kms is not yet wired in apps/web — pending S32 Phase 2.',
    );
  } else {
    kms = new LocalDevKmsProvider();
  }
  const cached: TenantCrypto = {
    kms,
    encryptor: new AesGcmFieldEncryptor(),
    cache: new Map(),
    backend,
  };
  globalThis.__cureocityTenantCrypto = cached;
  return cached;
}

/** Encrypts `plaintext` for the given psychologist tenant. */
export async function encryptForTenant(
  psychologistId: string,
  plaintext: string,
): Promise<string> {
  const tc = instance();
  const dek = await getOrCreateDek(psychologistId);
  return tc.encryptor.encrypt(plaintext, dek);
}

/**
 * Decrypts ciphertext. The DEK is selected by the keyId embedded in
 * the envelope (not by psychologistId), so historical rows remain
 * readable after a key rotation.
 *
 * Returns null on any failure (malformed envelope, missing key row,
 * tag mismatch) — callers fall back to the plaintext column rather
 * than crashing a read path. The mismatch is logged so we notice.
 */
export async function decryptForTenant(
  psychologistId: string,
  ciphertext: string,
): Promise<string | null> {
  const tc = instance();
  try {
    const envelopeKeyId = ciphertext.split('.')[1];
    if (!envelopeKeyId) return null;
    const dek = await getDekByEnvelope(psychologistId, envelopeKeyId);
    if (!dek) return null;
    return tc.encryptor.decrypt(ciphertext, dek);
  } catch (e) {
    console.warn(
      `[tenant-crypto] decrypt failed for psy=${psychologistId}: ${(e as Error).message}`,
    );
    return null;
  }
}

/** Returns true when a write would succeed without I/O. Useful for hot reads. */
export function kmsBackend(): TenantCrypto['backend'] {
  return instance().backend;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function getOrCreateDek(psychologistId: string): Promise<UnwrappedDataKey> {
  const tc = instance();
  const cached = tc.cache.get(psychologistId);
  if (cached && cached.expiresAt > Date.now()) return cached.dek;

  const active = await prisma.psychologistTenantKey.findFirst({
    where: { psychologistId, retiredAt: null },
    orderBy: { createdAt: 'desc' },
  });

  const dek = active
    ? await tc.kms.unwrapDataKey({ keyId: active.kmsKeyId, wrappedKey: active.wrappedKey })
    : await provisionNewDek(psychologistId);

  tc.cache.set(psychologistId, { dek, expiresAt: Date.now() + CACHE_TTL_MS });
  return dek;
}

async function getDekByEnvelope(
  psychologistId: string,
  envelopeKeyId: string,
): Promise<UnwrappedDataKey | null> {
  const tc = instance();
  const cached = tc.cache.get(psychologistId);
  if (cached && cached.dek.keyId === envelopeKeyId && cached.expiresAt > Date.now()) {
    return cached.dek;
  }
  const row = await prisma.psychologistTenantKey.findFirst({
    where: { psychologistId, kmsKeyId: envelopeKeyId },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  return tc.kms.unwrapDataKey({ keyId: row.kmsKeyId, wrappedKey: row.wrappedKey });
}

async function provisionNewDek(psychologistId: string): Promise<UnwrappedDataKey> {
  const tc = instance();
  const { wrapped, plaintext } = await tc.kms.generateDataKey();
  await persistWrappedKey(psychologistId, wrapped);
  await writeAudit({
    actorType: 'SYSTEM',
    action: 'ENCRYPTION_KEY_PROVISIONED',
    targetType: 'Psychologist',
    targetId: psychologistId,
    metadata: { kmsKeyId: wrapped.keyId, backend: tc.backend },
  });
  console.info(
    `[tenant-crypto] provisioned DEK psy=${psychologistId} keyId=${wrapped.keyId} backend=${tc.backend}`,
  );
  return plaintext;
}

async function persistWrappedKey(
  psychologistId: string,
  wrapped: WrappedDataKey,
): Promise<void> {
  await prisma.psychologistTenantKey.create({
    data: {
      psychologistId,
      kmsKeyId: wrapped.keyId,
      wrappedKey: wrapped.wrappedKey,
    },
  });
}

/** Test hook — clears the in-process DEK cache. Production code never calls this. */
export function __resetTenantCryptoCacheForTests(): void {
  globalThis.__cureocityTenantCrypto = undefined;
}
