import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AesGcmFieldEncryptor, LocalDevKmsProvider } from '@cureocity/crypto';
import type { Prisma, PsychologistTenantKey } from '@prisma/client';
import type { AuditService } from '../audit/audit.service';
import type { PrismaService } from '../prisma/prisma.service';
vi.mock('./encryption.module', () => ({ KMS_PROVIDER: Symbol('KMS_PROVIDER') }));
import { EncryptionService } from './encryption.service';

// Real AES-GCM/KMS provider with a transactional in-memory database adapter.
// The mutex models shared advisory-lock ordering, not real PostgreSQL behavior.
type Row = PsychologistTenantKey;
type Where = { psychologistId: string; id?: string; kmsKeyId?: string; retiredAt?: null };
const cipher = new AesGcmFieldEncryptor();
let rows: Row[];
let committedAudits: unknown[];
let sequence: number;
let db: PrismaService;
let provider: LocalDevKmsProvider;
let audit: AuditService;
let service: EncryptionService;
const lockCalls = vi.fn();
const auditLog = vi.fn();

function matching(source: Row[], where: Where) {
  return source
    .filter(
      (row) =>
        row.psychologistId === where.psychologistId &&
        (!where.id || row.id === where.id) &&
        (!where.kmsKeyId || row.kmsKeyId === where.kmsKeyId) &&
        (where.retiredAt !== null || row.retiredAt === null),
    )
    .slice()
    .reverse();
}

async function historical(text: string, tenant = 'owner', retired = false) {
  const { wrapped, plaintext } = await provider.generateDataKey();
  const row: Row = {
    id: `key-${++sequence}`,
    psychologistId: tenant,
    kmsKeyId: wrapped.keyId,
    wrappedKey: wrapped.wrappedKey,
    createdAt: new Date(),
    updatedAt: new Date(),
    retiredAt: retired ? new Date() : null,
  };
  rows.push(row);
  return {
    row,
    legacy: cipher.encrypt(text, plaintext),
    unique: cipher.encrypt(text, { ...plaintext, keyId: `dek:${row.id}` }),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  vi.resetAllMocks();
  vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', undefined);
  rows = [];
  committedAudits = [];
  sequence = 0;
  provider = new LocalDevKmsProvider({ devMasterSecret: 'fictional-test-secret' });
  let tail = Promise.resolve();
  db = {
    psychologistTenantKey: {
      findFirst: async ({ where }: { where: Where }) => matching(rows, where)[0] ?? null,
      findMany: async ({ where }: { where: Where }) => matching(rows, where),
    },
    $transaction: async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const predecessor = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => {
        release = resolve;
      });
      let locked = false;
      let workingRows: Row[] = [];
      const pendingAudits: unknown[] = [];
      const tx = {
        $executeRaw: async (...args: unknown[]) => {
          lockCalls(...args);
          await predecessor;
          locked = true;
          workingRows = rows.map((row) => ({ ...row }));
          return 1;
        },
        psychologistTenantKey: {
          findFirst: async ({ where }: { where: Where }) => {
            expect(locked).toBe(true);
            return matching(workingRows, where)[0] ?? null;
          },
          findMany: async ({ where }: { where: Where }) => {
            expect(locked).toBe(true);
            return matching(workingRows, where);
          },
          updateMany: async ({ where, data }: { where: Where; data: { retiredAt: Date } }) => {
            expect(locked).toBe(true);
            let count = 0;
            for (const row of workingRows)
              if (matching([row], where).length) {
                row.retiredAt = data.retiredAt;
                count += 1;
              }
            return { count };
          },
          create: async ({
            data,
          }: {
            data: Pick<Row, 'psychologistId' | 'kmsKeyId' | 'wrappedKey'>;
          }) => {
            expect(locked).toBe(true);
            expect(
              workingRows.some(
                (row) => row.psychologistId === data.psychologistId && !row.retiredAt,
              ),
            ).toBe(false);
            const row: Row = {
              ...data,
              id: `key-${++sequence}`,
              retiredAt: null,
              createdAt: new Date(),
              updatedAt: new Date(),
            };
            workingRows.push(row);
            return row;
          },
        },
        auditLog: {
          create: async (input: unknown) => {
            pendingAudits.push(input);
          },
        },
      };
      try {
        const result = await work(tx as unknown as Prisma.TransactionClient);
        rows = workingRows;
        committedAudits.push(...pendingAudits);
        return result;
      } finally {
        release();
      }
    },
  } as unknown as PrismaService;
  auditLog.mockImplementation(
    async (input: unknown, tx: { auditLog: { create: (input: unknown) => Promise<void> } }) => {
      await tx.auditLog.create(input);
    },
  );
  audit = { log: auditLog } as unknown as AuditService;
  service = new EncryptionService(db, provider, audit);
});
afterEach(() => {
  vi.unstubAllEnvs();
});

describe('continuity tenant-key compatibility', () => {
  it.each([undefined, 'false', 'TRUE'])(
    'keeps legacy reader compatibility with flag %s',
    async (flag) => {
      vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', flag);
      const encrypted = await service.encryptForTenant('owner', 'fictional journal');
      expect(encrypted.split('.')[1]).toBe(provider.keyId);
      const row = rows[0];
      const originalReaderKey = await provider.unwrapDataKey({
        keyId: row.kmsKeyId,
        wrappedKey: row.wrappedKey,
      });
      expect(cipher.decrypt(encrypted, originalReaderKey)).toBe('fictional journal');
      expect(await new EncryptionService(db, provider, audit).decrypt('owner', encrypted)).toBe(
        'fictional journal',
      );
    },
  );

  it('writes unique row IDs only with explicit enablement and reads them with the flag off', async () => {
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', 'true');
    const encrypted = await service.encryptForTenant('owner', 'unique journal');
    expect(encrypted.split('.')[1]).toBe('dek:key-1');
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', undefined);
    expect(await new EncryptionService(db, provider, audit).decrypt('owner', encrypted)).toBe(
      'unique journal',
    );
  });

  it('authenticates all preserved legacy candidates rather than choosing the newest', async () => {
    const first = await historical('old journal', 'owner', true);
    const second = await historical('new journal');
    expect(await service.decrypt('owner', first.legacy)).toBe('old journal');
    expect(await service.decrypt('owner', second.legacy)).toBe('new journal');
    // Same unique-envelope convention as the web, without calling its writer.
    expect(await service.decrypt('owner', first.unique)).toBe('old journal');
    expect(rows).toHaveLength(2);
  });

  it('fails closed for ambiguous off-mode writes and blocked rotation preserves the old active key', async () => {
    const original = await service.encryptForTenant('owner', 'old journal');
    const before = rows.map((row) => ({ ...row }));
    await expect(service.rotate('owner')).rejects.toThrow('key identity is ambiguous');
    expect(rows).toEqual(before);
    expect(committedAudits).toHaveLength(1);
    expect(await service.decrypt('owner', original)).toBe('old journal');
    expect(await service.encryptForTenant('owner', 'still writable')).toContain(
      `v1.${provider.keyId}.`,
    );
    await historical('colliding journal', 'owner', true);
    await expect(service.encryptForTenant('owner', 'must not write')).rejects.toThrow(
      'key identity is ambiguous',
    );
  });

  it('does not use another tenant’s key for either envelope format', async () => {
    const foreign = await historical('private journal', 'other');
    await service.decrypt('other', foreign.unique); // prime cache as authorized owner
    await expect(service.decrypt('owner', foreign.unique)).rejects.toThrow('no tenant-owned key');
    await expect(service.decrypt('owner', foreign.legacy)).rejects.toThrow('no tenant-owned key');
    const owned = await service.encryptForTenant('owner', 'own journal');
    expect(await service.decrypt('owner', owned)).toBe('own journal');
  });

  it('skips damaged historical keys, rejects tampering, and retries transient unwrap failures', async () => {
    const good = await historical('recoverable', 'owner', true);
    const bad = await historical('bad');
    bad.row.wrappedKey = 'invalid';
    expect(await service.decrypt('owner', good.legacy)).toBe('recoverable');
    const fresh = new EncryptionService(db, provider, audit);
    vi.spyOn(provider, 'unwrapDataKey').mockRejectedValueOnce(new Error('temporary KMS error'));
    await expect(fresh.decrypt('owner', good.unique)).rejects.toThrow('temporary KMS error');
    expect(await fresh.decrypt('owner', good.unique)).toBe('recoverable');
    const parts = good.legacy.split('.');
    parts[3] = 'tampered';
    await expect(service.decrypt('owner', parts.join('.'))).rejects.toThrow('no tenant-owned key');
  });

  it('single-flights concurrent unwraps by unique tenant-owned row identity', async () => {
    const record = await historical('same record');
    const unwrap = vi.spyOn(provider, 'unwrapDataKey');
    expect(
      await Promise.all(Array.from({ length: 30 }, () => service.decrypt('owner', record.unique))),
    ).toEqual(Array(30).fill('same record'));
    expect(unwrap).toHaveBeenCalledOnce();
  });
});

describe('continuity transaction boundaries', () => {
  it('serializes cold instances using the same advisory key as the web before provisioning', async () => {
    const second = new EncryptionService(db, provider, audit);
    const values = await Promise.all([
      service.encryptForTenant('owner', 'journal A'),
      second.encryptForTenant('owner', 'journal B'),
    ]);
    expect(rows).toHaveLength(1);
    expect(committedAudits).toHaveLength(1);
    expect(lockCalls).toHaveBeenCalledTimes(2);
    for (const [query, lockKey] of lockCalls.mock.calls) {
      expect((query as string[]).join('')).toContain('pg_advisory_xact_lock(hashtext(');
      expect(lockKey).toBe('tenant-dek:owner');
    }
    const restarted = new EncryptionService(db, provider, audit);
    expect(await Promise.all(values.map((value) => restarted.decrypt('owner', value)))).toEqual([
      'journal A',
      'journal B',
    ]);
  });

  it('serializes rotation with independent instance writes and preserves historical records', async () => {
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', 'true');
    const old = await service.encryptForTenant('owner', 'old');
    const second = new EncryptionService(db, provider, audit);
    const [, current] = await Promise.all([
      service.rotate('owner'),
      second.encryptForTenant('owner', 'current'),
    ]);
    expect(current.split('.')[1]).toBe('dek:key-2');
    expect(rows.filter((row) => row.retiredAt === null)).toHaveLength(1);
    expect(rows).toHaveLength(2);
    expect(committedAudits).toHaveLength(2);
    expect(await service.decrypt('owner', old)).toBe('old');
    expect(await service.decrypt('owner', current)).toBe('current');
    expect((await service.encryptForTenant('owner', 'same instance')).split('.')[1]).toBe(
      'dek:key-2',
    );
  });

  it.each(['KMS', 'audit'])('rolls back rotation completely on %s failure', async (failure) => {
    vi.stubEnv('TENANT_CRYPTO_UNIQUE_KEY_WRITES', 'true');
    const old = await service.encryptForTenant('owner', 'old');
    const before = rows.map((row) => ({ ...row }));
    if (failure === 'KMS')
      vi.spyOn(provider, 'generateDataKey').mockRejectedValueOnce(new Error('failed'));
    else auditLog.mockRejectedValueOnce(new Error('failed'));
    await expect(service.rotate('owner')).rejects.toThrow('failed');
    expect(rows).toEqual(before);
    expect(committedAudits).toHaveLength(1);
    expect(await service.decrypt('owner', old)).toBe('old');
  });
});
