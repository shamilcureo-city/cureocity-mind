import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { AesGcmFieldEncryptor, LocalDevKmsProvider } from '@cureocity/crypto';

// Actual AES-GCM/provider code with an in-memory database adapter. Verifies
// lock ordering, NOT PostgreSQL advisory-lock or migration semantics.
const h = vi.hoisted(() => ({
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  transaction: vi.fn(),
  lock: vi.fn(),
  audit: vi.fn(),
}));
vi.mock('@/lib/prisma', () => ({
  prisma: {
    psychologistTenantKey: { findFirst: h.findFirst, findMany: h.findMany },
    $transaction: h.transaction,
  },
}));
vi.mock('@/lib/audit', () => ({ writeAudit: h.audit }));
vi.mock('@/lib/gcp-kms-rest', () => ({ gcpKmsRestClient: () => ({}) }));
import {
  encryptForTenant,
  decryptForTenant,
  __resetTenantCryptoCacheForTests,
} from './tenant-crypto';

type Row = {
  id: string;
  psychologistId: string;
  kmsKeyId: string;
  wrappedKey: string;
  retiredAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
let rows: Row[];
const encryptor = new AesGcmFieldEncryptor();
const provider = () => new LocalDevKmsProvider({ devMasterSecret: 'fictional-test-secret' });

async function historicalRecord(id: string, text: string, tenant = 'psy-1', retired = false) {
  const { wrapped, plaintext } = await provider().generateDataKey();
  rows.push({
    id,
    psychologistId: tenant,
    kmsKeyId: wrapped.keyId,
    wrappedKey: wrapped.wrappedKey,
    retiredAt: retired ? new Date() : null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  return {
    legacy: encryptor.encrypt(text, plaintext),
    unique: encryptor.encrypt(text, { ...plaintext, keyId: `dek:${id}` }),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv('KMS_BACKEND', 'local-dev');
  vi.stubEnv('CRYPTO_DEV_MASTER_SECRET', 'fictional-test-secret');
  vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', 'true');
  rows = [];
  __resetTenantCryptoCacheForTests();
  h.findFirst.mockImplementation(
    async ({ where }) =>
      rows
        .filter(
          (row) =>
            row.psychologistId === where.psychologistId &&
            (!where.id || row.id === where.id) &&
            (where.retiredAt !== null || row.retiredAt === null),
        )
        .at(-1) ?? null,
  );
  h.findMany.mockImplementation(async ({ where }) =>
    rows
      .filter(
        (row) => row.psychologistId === where.psychologistId && row.kmsKeyId === where.kmsKeyId,
      )
      .slice()
      .reverse(),
  );
  h.create.mockImplementation(async ({ data }) => {
    const row = {
      ...data,
      id: `key-${rows.length + 1}`,
      retiredAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    rows.push(row);
    return row;
  });
  h.updateMany.mockImplementation(async ({ where, data }) => {
    for (const row of rows)
      if (row.psychologistId === where.psychologistId && row.retiredAt === null)
        row.retiredAt = data.retiredAt;
    return { count: 1 };
  });
  let tail = Promise.resolve();
  h.transaction.mockImplementation(async (work) => {
    const predecessor = tail;
    let release!: () => void;
    tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    let locked = false;
    const tx = {
      $executeRaw: async (...args: unknown[]) => {
        h.lock(...args);
        await predecessor;
        locked = true;
      },
      psychologistTenantKey: {
        findFirst: (...args: unknown[]) => {
          expect(locked).toBe(true);
          return h.findFirst(...args);
        },
        create: h.create,
        updateMany: h.updateMany,
      },
    };
    try {
      return await work(tx);
    } finally {
      release();
    }
  });
});
afterEach(() => {
  vi.unstubAllEnvs();
  __resetTenantCryptoCacheForTests();
});

describe('tenant-key identity and provisioning', () => {
  it('uses the unique database key id, not the reused KMS id, in new envelopes', async () => {
    const encrypted = await encryptForTenant('psy-1', 'fictional name');
    expect(encrypted.split('.')[1]).toBe('dek:key-1');
    expect(rows[0]?.kmsKeyId).toBe('local-dev-kms-v1');
    __resetTenantCryptoCacheForTests();
    expect(await decryptForTenant('psy-1', encrypted)).toBe('fictional name');
    expect(h.audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'ENCRYPTION_KEY_PROVISIONED' }),
      expect.objectContaining({ psychologistTenantKey: expect.anything() }),
    );
  });
  it('serializes cold instances before lookup and preserves both records after restart', async () => {
    const first = encryptForTenant('psy-1', 'fictional record A');
    // In-flight call retains its cache; request two gets a fresh server global.
    __resetTenantCryptoCacheForTests();
    const second = encryptForTenant('psy-1', 'fictional record B');
    const ciphertexts = await Promise.all([first, second]);
    expect(h.lock).toHaveBeenCalledTimes(2);
    expect(rows).toHaveLength(1);
    __resetTenantCryptoCacheForTests();
    expect(await Promise.all(ciphertexts.map((value) => decryptForTenant('psy-1', value)))).toEqual(
      ['fictional record A', 'fictional record B'],
    );
  });
  it('deduplicates concurrent encryption inside one instance', async () => {
    await Promise.all(
      Array.from({ length: 40 }, (_, n) => encryptForTenant('psy-1', `record-${n}`)),
    );
    expect(h.transaction).toHaveBeenCalledOnce();
    expect(rows).toHaveLength(1);
  });
  it('reads preserved legacy DEKs even when wrapping-key identifiers collide', async () => {
    const first = await historicalRecord('old-key', 'first record', 'psy-1', true);
    const second = await historicalRecord('new-key', 'second record');
    expect(await decryptForTenant('psy-1', first.legacy)).toBe('first record');
    expect(await decryptForTenant('psy-1', second.legacy)).toBe('second record');
    expect(await decryptForTenant('psy-1', first.unique)).toBe('first record');
    expect(rows).toHaveLength(2);
    expect(h.create).not.toHaveBeenCalled();
  });
  it('reuses a legacy active key but writes uniquely identified envelopes', async () => {
    await historicalRecord('existing-key', 'old record');
    const encrypted = await encryptForTenant('psy-1', 'new record');
    expect(encrypted.split('.')[1]).toBe('dek:existing-key');
    expect(h.create).not.toHaveBeenCalled();
  });
  it('never tries another tenant’s matching key id', async () => {
    const foreign = await historicalRecord('foreign-key', 'private', 'psy-2');
    expect(await decryptForTenant('psy-1', foreign.legacy)).toBeNull();
    expect(await decryptForTenant('psy-1', foreign.unique)).toBeNull();
  });
  it('caches historical candidate reads across 40 concurrent decrypts', async () => {
    const first = await historicalRecord('old-key', 'historical');
    expect(
      await Promise.all(Array.from({ length: 40 }, () => decryptForTenant('psy-1', first.legacy))),
    ).toEqual(Array(40).fill('historical'));
    expect(h.findMany).toHaveBeenCalledOnce();
  });
  it('refreshes legacy candidates when an old instance adds a key during deployment', async () => {
    const first = await historicalRecord('old-key', 'old');
    expect(await decryptForTenant('psy-1', first.legacy)).toBe('old');
    const newer = await historicalRecord('later-key', 'later');
    expect(await decryptForTenant('psy-1', newer.legacy)).toBe('later');
    expect(h.findMany).toHaveBeenCalledTimes(2);
  });
  it('skips unavailable historical candidates and rejects tampered ciphertext', async () => {
    const first = await historicalRecord('good-key', 'recoverable');
    await historicalRecord('damaged-key', 'other');
    rows[1]!.wrappedKey = 'invalid';
    expect(await decryptForTenant('psy-1', first.legacy)).toBe('recoverable');
    const parts = first.legacy.split('.');
    parts[3] = 'tampered';
    expect(await decryptForTenant('psy-1', parts.join('.'))).toBeNull();
  });
  it('retries after a failed lookup without poisoning the cache', async () => {
    const first = await historicalRecord('key-1', 'retry');
    h.findFirst.mockRejectedValueOnce(new Error('database unavailable'));
    expect(await decryptForTenant('psy-1', first.unique)).toBeNull();
    expect(await decryptForTenant('psy-1', first.unique)).toBe('retry');
  });
});

describe('reader-first encryption rollout', () => {
  it.each([undefined, 'false', 'TRUE'])(
    'keeps writes readable by an old reader with flag %s',
    async (flag) => {
      vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', flag);
      const encrypted = await encryptForTenant('psy-1', 'fictional rolling-release record');
      expect(encrypted.split('.')[1]).toBe('local-dev-kms-v1');
      // Reproduce the original single-wrapping-ID lookup/unwrap/decrypt path.
      const row = rows.find((candidate) => candidate.kmsKeyId === encrypted.split('.')[1])!;
      const originalReaderKey = await provider().unwrapDataKey({
        keyId: row.kmsKeyId,
        wrappedKey: row.wrappedKey,
      });
      expect(encryptor.decrypt(encrypted, originalReaderKey)).toBe(
        'fictional rolling-release record',
      );
      __resetTenantCryptoCacheForTests();
      expect(await decryptForTenant('psy-1', encrypted)).toBe('fictional rolling-release record');
    },
  );

  it('fails closed on legacy identity collisions including retired keys, preserving reads', async () => {
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', undefined);
    const historical = await historicalRecord('retired', 'old record', 'psy-1', true);
    const active = await historicalRecord('current', 'current record');
    await expect(encryptForTenant('psy-1', 'must not write')).rejects.toThrow(
      'key identity is ambiguous',
    );
    expect(await decryptForTenant('psy-1', historical.legacy)).toBe('old record');
    expect(await decryptForTenant('psy-1', active.legacy)).toBe('current record');
    expect(rows).toHaveLength(2);
    expect(h.create).not.toHaveBeenCalled();
    // Explicit enablement is the only way to start writing the unique format.
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', 'true');
    const encrypted = await encryptForTenant('psy-1', 'safe unique record');
    expect(encrypted.split('.')[1]).toBe('dek:current');
    expect(await decryptForTenant('psy-1', encrypted)).toBe('safe unique record');
  });

  it('rechecks collisions for every legacy-format write even with an active cached key', async () => {
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', 'false');
    await encryptForTenant('psy-1', 'before collision');
    await historicalRecord('unexpected-row', 'other record');
    await expect(encryptForTenant('psy-1', 'after collision')).rejects.toThrow(
      'key identity is ambiguous',
    );
    expect(h.findMany).toHaveBeenCalledTimes(2);
    expect(h.transaction).toHaveBeenCalledOnce();
  });

  it('does not treat another tenant sharing the wrapping key as an ambiguity', async () => {
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', 'false');
    await historicalRecord('foreign-row', 'foreign record', 'psy-2');
    const encrypted = await encryptForTenant('psy-1', 'owned record');
    expect(await decryptForTenant('psy-1', encrypted)).toBe('owned record');
  });

  it('always reads unique envelopes even when unique writes are disabled again', async () => {
    const encrypted = await encryptForTenant('psy-1', 'new-format history');
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', undefined);
    __resetTenantCryptoCacheForTests();
    expect(await decryptForTenant('psy-1', encrypted)).toBe('new-format history');
    expect((await encryptForTenant('psy-1', 'compatibility write')).split('.')[1]).toBe(
      'local-dev-kms-v1',
    );
  });
});
