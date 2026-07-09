import {
  AesGcmFieldEncryptor,
  GcpKmsProvider,
  LocalDevKmsProvider,
  type IFieldEncryptor,
  type IKmsProvider,
  type UnwrappedDataKey,
  type WrappedDataKey,
} from '@cureocity/crypto';
import { prisma } from '@/lib/prisma';
import { writeAudit } from '@/lib/audit';
import { gcpKmsRestClient } from '@/lib/gcp-kms-rest';

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

type KmsBackend = 'local-dev' | 'aws-kms' | 'gcp-kms';

interface TenantCrypto {
  kms: IKmsProvider;
  encryptor: IFieldEncryptor;
  cache: Map<string, CachedKey>;
  backend: KmsBackend;
}

declare global {
  var __cureocityTenantCrypto: TenantCrypto | undefined;
}

function instance(): TenantCrypto {
  if (globalThis.__cureocityTenantCrypto) return globalThis.__cureocityTenantCrypto;
  const backend = (process.env['KMS_BACKEND'] ?? 'local-dev') as KmsBackend;
  let kms: IKmsProvider;
  if (backend === 'gcp-kms') {
    // S32 Phase 2 — production KMS is Google Cloud KMS (asia-south1), reusing
    // the Vertex service account (GOOGLE_APPLICATION_CREDENTIALS_JSON) over the
    // REST API (no gRPC SDK — bundles cleanly on Vercel). GCP_KMS_KEY_NAME is
    // the versionless cryptoKey resource name.
    const keyName = process.env['GCP_KMS_KEY_NAME'];
    if (!keyName) {
      throw new Error(
        'KMS_BACKEND=gcp-kms requires GCP_KMS_KEY_NAME — the cryptoKey resource name ' +
          '(projects/P/locations/asia-south1/keyRings/R/cryptoKeys/K).',
      );
    }
    kms = new GcpKmsProvider(gcpKmsRestClient(), keyName);
  } else if (backend === 'aws-kms') {
    // Not wired: S32 Phase 2 chose GCP Cloud KMS (one cloud + region as Vertex,
    // reuses the existing SA). AwsKmsProvider stays in @cureocity/crypto for
    // portability, but apps/web hard-fails rather than silently falling through
    // to the dev KMS.
    throw new Error(
      'KMS_BACKEND=aws-kms is not wired in apps/web — use gcp-kms (S32 Phase 2 chose GCP Cloud KMS).',
    );
  } else {
    // CRYPTO-1 — the local-dev KMS falls back to a PUBLIC hardcoded secret
    // when CRYPTO_DEV_MASTER_SECRET is unset. On a production deployment that
    // makes every "encrypted" PII column trivially decryptable from the
    // source tree. Fail closed: refuse to boot the crypto layer until a real
    // secret is set (or aws-kms is wired). That secret MUST be backed up +
    // documented in a secrets manager — losing it is unrecoverable key loss
    // for every encrypted column.
    if (process.env['VERCEL_ENV'] === 'production' && !process.env['CRYPTO_DEV_MASTER_SECRET']) {
      throw new Error(
        'CRYPTO-1: a production deployment must set CRYPTO_DEV_MASTER_SECRET ' +
          '(or wire KMS_BACKEND=aws-kms). Refusing to derive tenant keys from ' +
          'the hardcoded dev master secret.',
      );
    }
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
export async function encryptForTenant(psychologistId: string, plaintext: string): Promise<string> {
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

async function persistWrappedKey(psychologistId: string, wrapped: WrappedDataKey): Promise<void> {
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
