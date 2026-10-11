import {
  AesGcmFieldEncryptor,
  GcpKmsProvider,
  LocalDevKmsProvider,
  type IFieldEncryptor,
  type IKmsProvider,
  type UnwrappedDataKey,
} from '@cureocity/crypto';
import type { Prisma, PsychologistTenantKey } from '@prisma/client';
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
const DEK_ID_PREFIX = 'dek:';

interface CachedKey {
  dek: UnwrappedDataKey;
  expiresAt: number;
}

interface TenantDataKey {
  dek: UnwrappedDataKey;
  kmsKeyId: string;
}

interface CachedActiveKey extends TenantDataKey {
  expiresAt: number;
}

type KmsBackend = 'local-dev' | 'aws-kms' | 'gcp-kms';

interface TenantCrypto {
  /** Primary provider — used for generateDataKey (new DEKs). */
  kms: IKmsProvider;
  /**
   * S32 Phase 2 cutover fallback: a LocalDevKmsProvider kept alongside the GCP
   * primary so DEKs minted BEFORE the gcp-kms switch (keyId 'local-dev-kms-v1')
   * still unwrap. `getOrCreateDek` then retires such a key and re-provisions
   * under GCP, so new writes move to GCP while old ciphertext stays readable
   * via the retired row. null on a local-dev or aws deployment.
   */
  localDev: IKmsProvider | null;
  encryptor: IFieldEncryptor;
  /**
   * The tenant's CURRENT DEK, for encrypt. Keyed by psychologistId.
   */
  activeCache: Map<string, CachedActiveKey>;
  /**
   * Every unwrapped DEK by the keyId embedded in the envelope, keyed
   * `psychologistId::kmsKeyId` — so a RETIRED key caches too.
   *
   * This used to be one entry per psychologist, matched on the active
   * key's id. Every row written under a retired key therefore missed the
   * cache and paid a `psychologistTenantKey` lookup + a KMS unwrap (a REST
   * round-trip to asia-south1 under gcp-kms) on EVERY decrypt. The S32
   * Phase 2 cutover retires the pre-cutover local-dev DEK, so on a
   * migrated tenant that was every historical row: rendering a 40-client
   * roster meant 40 KMS calls.
   */
  keyCache: Map<string, CachedKey>;
  /**
   * Single-flight. A cache alone doesn't help a `Promise.all` over N rows:
   * all N miss before the first resolves and fire N concurrent unwraps.
   * Callers awaiting the same key share one in-progress promise instead.
   */
  inflight: Map<string, Promise<unknown>>;
  legacyRows: Map<string, { rows: PsychologistTenantKey[]; expiresAt: number }>;
  backend: KmsBackend;
}

/** Cache key for a specific DEK of a specific tenant. */
function dekCacheKey(psychologistId: string, keyId: string): string {
  return `${psychologistId}::${keyId}`;
}

/**
 * Record an unwrapped DEK by its unique envelope keyId, never its wrapping ID.
 */
function rememberDek(tc: TenantCrypto, psychologistId: string, dek: UnwrappedDataKey): void {
  const entry: CachedKey = { dek, expiresAt: Date.now() + CACHE_TTL_MS };
  tc.keyCache.set(dekCacheKey(psychologistId, dek.keyId), entry);
}

/**
 * Run `work` once per key even when called concurrently — later callers
 * join the in-progress promise. The entry is always cleared, so a failed
 * unwrap doesn't poison the next attempt.
 */
function singleFlight<T>(tc: TenantCrypto, key: string, work: () => Promise<T>): Promise<T> {
  const pending = tc.inflight.get(key);
  if (pending) return pending as Promise<T>;
  const run = work().finally(() => {
    tc.inflight.delete(key);
  });
  tc.inflight.set(key, run);
  return run;
}

/**
 * Route an unwrap to the provider that can service the DEK's keyId. GCP DEKs
 * carry a `projects/…` resource name; anything else is a pre-cutover local-dev
 * DEK. When there's no fallback (local-dev / aws deployments) the primary
 * handles everything.
 */
function providerFor(tc: TenantCrypto, keyId: string): IKmsProvider {
  if (tc.localDev && !keyId.startsWith('projects/')) return tc.localDev;
  return tc.kms;
}

declare global {
  var __cureocityTenantCrypto: TenantCrypto | undefined;
}

function instance(): TenantCrypto {
  if (globalThis.__cureocityTenantCrypto) return globalThis.__cureocityTenantCrypto;
  const backend = (process.env['KMS_BACKEND'] ?? 'local-dev') as KmsBackend;
  let kms: IKmsProvider;
  let localDev: IKmsProvider | null = null;
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
    // Cutover fallback: unwrap any DEK minted under local-dev before this
    // switch. Uses the same CRYPTO_DEV_MASTER_SECRET that wrapped it; absent
    // that secret there can be no such row, so the fallback stays off.
    if (process.env['CRYPTO_DEV_MASTER_SECRET']) localDev = new LocalDevKmsProvider();
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
    localDev,
    encryptor: new AesGcmFieldEncryptor(),
    activeCache: new Map(),
    keyCache: new Map(),
    inflight: new Map(),
    legacyRows: new Map(),
    backend,
  };
  globalThis.__cureocityTenantCrypto = cached;
  return cached;
}

/** Encrypts `plaintext` for the given psychologist tenant. */
export async function encryptForTenant(psychologistId: string, plaintext: string): Promise<string> {
  const tc = instance();
  const selected = await getOrCreateDek(psychologistId);
  if (process.env['TENANT_CRYPTO_UNIQUE_KEY_WRITES'] === 'true') {
    return tc.encryptor.encrypt(plaintext, selected.dek);
  }

  // Reader-first rolling rollout: old services cannot read a `dek:` envelope.
  // Until every reader is upgraded, emit the old format only when its key ID
  // is unambiguous. Include retired rows: an old reader can choose one of them.
  // Never use the historical-read cache here; a new colliding row must block
  // the very next write, even when the active plaintext DEK is still cached.
  const matches = await prisma.psychologistTenantKey.findMany({
    where: { psychologistId, kmsKeyId: selected.kmsKeyId },
    select: { id: true },
  });
  if (matches.length !== 1 || `${DEK_ID_PREFIX}${matches[0]!.id}` !== selected.dek.keyId) {
    throw new Error(
      'Tenant encryption writes paused: reader-compatible key identity is ambiguous.',
    );
  }
  return tc.encryptor.encrypt(plaintext, { ...selected.dek, keyId: selected.kmsKeyId });
}

/**
 * New envelopes identify a unique tenant-key row. Legacy envelopes identify
 * only the wrapping KMS key, which may match multiple historical DEKs. Try
 * each preserved tenant-owned candidate and authenticate with AES-GCM; never
 * guess the newest key or discard a historical key. No plaintext fallback.
 */
export async function decryptForTenant(
  psychologistId: string,
  ciphertext: string,
): Promise<string | null> {
  const tc = instance();
  try {
    const envelopeKeyId = ciphertext.split('.')[1];
    if (!envelopeKeyId) return null;
    if (envelopeKeyId.startsWith(DEK_ID_PREFIX)) {
      const dek = await getDekByEnvelope(psychologistId, envelopeKeyId);
      return dek ? tc.encryptor.decrypt(ciphertext, dek) : null;
    }
    const legacyCacheKey = dekCacheKey(psychologistId, envelopeKeyId);
    const wasCached = tc.legacyRows.has(legacyCacheKey);
    // Refresh once after a cached miss: a rolling deployment may still have
    // an old writer provisioning a legacy-format key in another instance.
    for (let attempt = 0; attempt < (wasCached ? 2 : 1); attempt += 1) {
      const rows = await getLegacyRows(tc, psychologistId, envelopeKeyId);
      for (const row of rows) {
        try {
          const dek = await unwrapRow(tc, psychologistId, row);
          return await tc.encryptor.decrypt(ciphertext, { ...dek, keyId: envelopeKeyId });
        } catch {
          // An auth-tag mismatch or one unavailable wrapping key must not
          // prevent another historical candidate from recovering the record.
        }
      }
      tc.legacyRows.delete(legacyCacheKey);
    }
    return null;
  } catch {
    console.warn('[tenant-crypto] encrypted value could not be decrypted');
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

async function getOrCreateDek(psychologistId: string): Promise<TenantDataKey> {
  const tc = instance();
  const cached = tc.activeCache.get(psychologistId);
  if (cached && cached.expiresAt > Date.now()) return cached;

  // Single-flight on the tenant: encrypting three PII fields of one client
  // concurrently used to race three provisions for a tenant with no key yet.
  const dek = await singleFlight(tc, `active::${psychologistId}`, async () => {
    const fresh = tc.activeCache.get(psychologistId);
    if (fresh && fresh.expiresAt > Date.now()) return fresh;

    // Process-local single-flight is only an optimization. The database lock
    // protects first-use and cutover provisioning across serverless instances.
    const selected = await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`tenant-dek:${psychologistId}`}))`;
        const active = await tx.psychologistTenantKey.findFirst({
          where: { psychologistId, retiredAt: null },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
        if (active && !(tc.backend === 'gcp-kms' && !active.kmsKeyId.startsWith('projects/'))) {
          return { row: active, plaintext: null };
        }
        if (active) {
          await tx.psychologistTenantKey.updateMany({
            where: { psychologistId, retiredAt: null },
            data: { retiredAt: new Date() },
          });
        }
        return provisionNewDek(tc, tx, psychologistId);
      },
      { timeout: 20_000 },
    );
    const resolved = selected.plaintext
      ? { ...selected.plaintext, keyId: `${DEK_ID_PREFIX}${selected.row.id}` }
      : await unwrapRow(tc, psychologistId, selected.row);

    rememberDek(tc, psychologistId, resolved);
    const active = { dek: resolved, kmsKeyId: selected.row.kmsKeyId };
    tc.activeCache.set(psychologistId, { ...active, expiresAt: Date.now() + CACHE_TTL_MS });
    return active;
  });
  return dek;
}

async function getDekByEnvelope(
  psychologistId: string,
  envelopeKeyId: string,
): Promise<UnwrappedDataKey | null> {
  const tc = instance();
  const key = dekCacheKey(psychologistId, envelopeKeyId);
  const cached = tc.keyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.dek;

  return singleFlight(tc, key, async () => {
    const fresh = tc.keyCache.get(key);
    if (fresh && fresh.expiresAt > Date.now()) return fresh.dek;

    const row = await prisma.psychologistTenantKey.findFirst({
      where: { psychologistId, id: envelopeKeyId.slice(DEK_ID_PREFIX.length) },
    });
    if (!row) return null;
    return unwrapRow(tc, psychologistId, row);
  });
}

async function unwrapRow(
  tc: TenantCrypto,
  psychologistId: string,
  row: PsychologistTenantKey,
): Promise<UnwrappedDataKey> {
  const envelopeKeyId = `${DEK_ID_PREFIX}${row.id}`;
  const key = dekCacheKey(psychologistId, envelopeKeyId);
  const cached = tc.keyCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.dek;
  // Separate from the envelope lookup flight to avoid self-awaiting a promise.
  return singleFlight(tc, `unwrap::${key}`, async () => {
    const unwrapped = await providerFor(tc, row.kmsKeyId).unwrapDataKey({
      keyId: row.kmsKeyId,
      wrappedKey: row.wrappedKey,
    });
    const dek = { ...unwrapped, keyId: envelopeKeyId };
    rememberDek(tc, psychologistId, dek);
    return dek;
  });
}

async function getLegacyRows(
  tc: TenantCrypto,
  psychologistId: string,
  kmsKeyId: string,
): Promise<PsychologistTenantKey[]> {
  const key = dekCacheKey(psychologistId, kmsKeyId);
  const cached = tc.legacyRows.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.rows;
  return singleFlight(tc, `legacy::${key}`, async () => {
    const rows = await prisma.psychologistTenantKey.findMany({
      where: { psychologistId, kmsKeyId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    if (rows.length) tc.legacyRows.set(key, { rows, expiresAt: Date.now() + CACHE_TTL_MS });
    return rows;
  });
}

async function provisionNewDek(
  tc: TenantCrypto,
  tx: Prisma.TransactionClient,
  psychologistId: string,
) {
  const { wrapped, plaintext } = await tc.kms.generateDataKey();
  const row = await tx.psychologistTenantKey.create({
    data: { psychologistId, kmsKeyId: wrapped.keyId, wrappedKey: wrapped.wrappedKey },
  });
  await writeAudit(
    {
      actorType: 'SYSTEM',
      action: 'ENCRYPTION_KEY_PROVISIONED',
      targetType: 'Psychologist',
      targetId: psychologistId,
      metadata: { kmsKeyId: wrapped.keyId, backend: tc.backend },
    },
    tx,
  );
  return { row, plaintext };
}

/** Test hook — clears the in-process DEK cache. Production code never calls this. */
export function __resetTenantCryptoCacheForTests(): void {
  globalThis.__cureocityTenantCrypto = undefined;
}
