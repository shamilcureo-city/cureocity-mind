import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression cover for the envelope-DEK cache.
 *
 * The bug: `getDekByEnvelope` only consulted the cache when the row's
 * envelope keyId matched the tenant's CURRENTLY ACTIVE key. The S32 Phase 2
 * cutover retires the pre-cutover local-dev DEK, so on a migrated tenant
 * every historical row missed — each decrypt paid a `psychologistTenantKey`
 * lookup plus a KMS unwrap (a REST round-trip to asia-south1 under
 * gcp-kms). Rendering a 40-client roster meant 40 KMS calls.
 *
 * These tests assert the two properties that fix it: cache by the
 * ENVELOPE's keyId (retired keys included), and single-flight so a
 * `Promise.all` over N rows collapses to ONE unwrap rather than N.
 */

const unwrapDataKey = vi.fn();
const findFirst = vi.fn();

vi.mock('@/lib/prisma', () => ({
  prisma: {
    psychologistTenantKey: {
      findFirst: (...args: unknown[]) => findFirst(...args),
    },
  },
}));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));
vi.mock('@/lib/gcp-kms-rest', () => ({ gcpKmsRestClient: () => ({}) }));

const RETIRED_KEY_ID = 'local-dev-kms-v1';
const DEK_BYTES = new Uint8Array(32).fill(7);

vi.mock('@cureocity/crypto', () => {
  class LocalDevKmsProvider {
    unwrapDataKey(...args: unknown[]) {
      return unwrapDataKey(...args);
    }
    generateDataKey() {
      throw new Error('not expected in these tests');
    }
  }
  return {
    LocalDevKmsProvider,
    GcpKmsProvider: LocalDevKmsProvider,
    AesGcmFieldEncryptor: class {
      // The envelope format the module parses is `v1.<keyId>.<iv>.<ct>` —
      // only field [1] (the keyId) matters here.
      decrypt(ciphertext: string) {
        return `plain:${ciphertext.split('.')[2]}`;
      }
      encrypt() {
        return 'unused';
      }
    },
  };
});

async function loadModule() {
  vi.resetModules();
  const mod = await import('./tenant-crypto');
  mod.__resetTenantCryptoCacheForTests();
  return mod;
}

function envelopeFor(rowId: string): string {
  return `v1.${RETIRED_KEY_ID}.${rowId}.ct`;
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env['KMS_BACKEND'] = 'local-dev';
  process.env['CRYPTO_DEV_MASTER_SECRET'] = 'test-secret';
  delete process.env['VERCEL_ENV'];

  findFirst.mockResolvedValue({
    id: 'key-row-1',
    kmsKeyId: RETIRED_KEY_ID,
    wrappedKey: 'wrapped',
    retiredAt: new Date(),
  });
  unwrapDataKey.mockResolvedValue({ keyId: RETIRED_KEY_ID, key: DEK_BYTES });
});

describe('tenant-crypto envelope DEK cache', () => {
  it('unwraps a retired key ONCE across sequential decrypts', async () => {
    const { decryptForTenant } = await loadModule();

    for (let i = 0; i < 5; i++) {
      const out = await decryptForTenant('psy-1', envelopeFor(`row${i}`));
      expect(out).toBe(`plain:row${i}`);
    }

    expect(unwrapDataKey).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('collapses a concurrent Promise.all over 40 rows to ONE unwrap', async () => {
    const { decryptForTenant } = await loadModule();

    // The roster-render shape: every row decrypts at once, so a plain
    // cache would still miss 40 times before the first resolves.
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, i) => decryptForTenant('psy-1', envelopeFor(`row${i}`))),
    );

    expect(results).toHaveLength(40);
    expect(results[39]).toBe('plain:row39');
    expect(unwrapDataKey).toHaveBeenCalledTimes(1);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('keeps tenants isolated — one unwrap each, never shared', async () => {
    const { decryptForTenant } = await loadModule();

    await decryptForTenant('psy-1', envelopeFor('a'));
    await decryptForTenant('psy-2', envelopeFor('b'));
    await decryptForTenant('psy-1', envelopeFor('c'));

    expect(unwrapDataKey).toHaveBeenCalledTimes(2);
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { psychologistId: 'psy-2', kmsKeyId: RETIRED_KEY_ID } }),
    );
  });

  it('caches per keyId, so a rotated tenant unwraps once per distinct key', async () => {
    const { decryptForTenant } = await loadModule();

    findFirst.mockImplementation((args: { where: { kmsKeyId: string } }) =>
      Promise.resolve({
        id: `row-${args.where.kmsKeyId}`,
        kmsKeyId: args.where.kmsKeyId,
        wrappedKey: 'wrapped',
        retiredAt: null,
      }),
    );
    unwrapDataKey.mockImplementation((args: { keyId: string }) =>
      Promise.resolve({ keyId: args.keyId, key: DEK_BYTES }),
    );

    await decryptForTenant('psy-1', `v1.${RETIRED_KEY_ID}.a.ct`);
    await decryptForTenant('psy-1', `v1.${RETIRED_KEY_ID}.b.ct`);
    await decryptForTenant('psy-1', 'v1.projects/p/new-key.c.ct');
    await decryptForTenant('psy-1', 'v1.projects/p/new-key.d.ct');

    expect(unwrapDataKey).toHaveBeenCalledTimes(2);
  });

  it('does not poison the cache when an unwrap fails', async () => {
    const { decryptForTenant } = await loadModule();

    unwrapDataKey.mockRejectedValueOnce(new Error('KMS unavailable'));
    expect(await decryptForTenant('psy-1', envelopeFor('a'))).toBeNull();

    // A later request must be free to retry rather than inherit the failure.
    expect(await decryptForTenant('psy-1', envelopeFor('b'))).toBe('plain:b');
    expect(unwrapDataKey).toHaveBeenCalledTimes(2);
  });

  it('returns null when the tenant has no row for the envelope key', async () => {
    const { decryptForTenant } = await loadModule();

    findFirst.mockResolvedValue(null);
    expect(await decryptForTenant('psy-1', envelopeFor('a'))).toBeNull();
    expect(unwrapDataKey).not.toHaveBeenCalled();
  });
});
