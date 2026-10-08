import assert from 'node:assert/strict';
import process from 'node:process';
import console from 'node:console';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { AesGcmFieldEncryptor, LocalDevKmsProvider } from '../packages/crypto/dist/index.js';

// Run against the pre-fix schema first with `seed`, apply the three migrations,
// provision the CI runtime role, then run `verify`. This is never a prod tool.
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ownerUrl =
  'postgresql://reception_test_owner:reception_ci_owner@127.0.0.1:55442/cureocity_mind_test';
const runtimeUrl =
  'postgresql://reception_test_runtime:reception_ci_runtime@127.0.0.1:55442/cureocity_mind_test';
const statePath = '/private/tmp/mind-audit-migration-fixtures-20261008.json';
if (process.env.RUN_MIND_AUDIT_REHEARSAL !== '1' || process.env.DATABASE_URL !== ownerUrl) {
  throw new Error('Explicit disposable localhost rehearsal opt-in required');
}
const db = new PrismaClient({ datasources: { db: { url: ownerUrl } } });
const proof =
  await db.$queryRaw`SELECT current_database() AS database, current_user AS role, host(inet_server_addr()) AS address, inet_server_port() AS port`;
assert.deepEqual(proof, [
  {
    database: 'cureocity_mind_test',
    role: 'reception_test_owner',
    address: '127.0.0.1',
    port: 55442,
  },
]);
const masterSecret = 'fictional-disposable-rehearsal-secret-not-for-production';
const tenantId = 'audit-rehearsal-duplicate';
const concurrentTenant = 'audit-rehearsal-concurrent';
const kms = new LocalDevKmsProvider({ devMasterSecret: masterSecret });
const aes = new AesGcmFieldEncryptor();

async function worker(input, uniqueWrites = false) {
  // Deliberately no inherited cloud credentials, database aliases, or secrets.
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'test',
    RUN_MIND_AUDIT_REHEARSAL: '1',
    DATABASE_URL: runtimeUrl,
    DATABASE_RUNTIME_URL: runtimeUrl,
    KMS_BACKEND: 'local-dev',
    CRYPTO_DEV_MASTER_SECRET: masterSecret,
    TENANT_CRYPTO_UNIQUE_KEY_WRITES: String(uniqueWrites),
  };
  return new Promise((resolveWorker, reject) => {
    const child = spawn(
      process.execPath,
      [
        'node_modules/tsx/dist/cli.mjs',
        '--tsconfig',
        'apps/web/tsconfig.json',
        'scripts/rehearse-mind-crypto-worker.ts',
      ],
      { cwd: repo, env, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let output = '',
      errors = '';
    child.stdout.on('data', (data) => {
      output += data;
    });
    child.stderr.on('data', (data) => {
      errors += data;
    });
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0
        ? resolveWorker(JSON.parse(output))
        : reject(new Error(`Crypto worker failed (${code}): ${errors}`)),
    );
    child.stdin.end(JSON.stringify(input));
  });
}

try {
  if (process.argv[2] === 'seed') {
    assert.equal(
      await db.psychologist.count({ where: { id: { startsWith: 'audit-rehearsal-' } } }),
      0,
    );
    for (const id of [tenantId, concurrentTenant]) {
      await db.psychologist.create({
        data: {
          id,
          firebaseUid: id,
          email: `${id}@test.invalid`,
          fullName: 'Fictional rehearsal practitioner',
          phone: id,
          rciNumber: id,
        },
        select: { id: true },
      });
    }
    const keys = [],
      values = [];
    for (const [suffix, createdAt, retiredAt] of [
      ['old', '2026-01-01T00:00:00Z', null],
      ['new-a', '2026-02-01T00:00:00Z', null],
      ['new-b', '2026-02-01T00:00:00Z', null],
      ['retired', '2025-12-01T00:00:00Z', '2026-01-01T00:00:00Z'],
    ]) {
      const generated = await kms.generateDataKey();
      const id = `audit-rehearsal-key-${suffix}`;
      await db.psychologistTenantKey.create({
        data: {
          id,
          psychologistId: tenantId,
          kmsKeyId: generated.wrapped.keyId,
          wrappedKey: generated.wrapped.wrappedKey,
          createdAt: new Date(createdAt),
          retiredAt: retiredAt && new Date(retiredAt),
        },
      });
      keys.push({ id, wrappedKey: generated.wrapped.wrappedKey });
      values.push({
        ciphertext: aes.encrypt(`fictional-${suffix}`, generated.plaintext),
        expected: `fictional-${suffix}`,
      });
    }
    await db.$executeRaw`INSERT INTO note_reviews (id, "sessionId", "therapyNoteId", "psychologistId", "reviewerName", "reviewedAt") VALUES ('audit-rehearsal-legacy-review', 'audit-fixture-session', 'audit-fixture-note', ${tenantId}, 'Fictional reviewer', CURRENT_TIMESTAMP)`;
    writeFileSync(statePath, JSON.stringify({ keys, values }));
    console.log(
      'Seeded 4 preserved-key fixtures (3 active, including timestamp tie) and legacy review on pre-fix schema.',
    );
  } else if (process.argv[2] === 'verify') {
    const state = JSON.parse(readFileSync(statePath, 'utf8'));
    async function assertMigrationState() {
      const keys = await db.psychologistTenantKey.findMany({ where: { psychologistId: tenantId } });
      assert.equal(keys.length, 4);
      for (const previous of state.keys)
        assert.equal(keys.find((key) => key.id === previous.id)?.wrappedKey, previous.wrappedKey);
      assert.deepEqual(
        keys.filter((key) => !key.retiredAt).map((key) => key.id),
        ['audit-rehearsal-key-new-b'],
      );
      const review = await db.noteReview.findUniqueOrThrow({
        where: { id: 'audit-rehearsal-legacy-review' },
      });
      assert.equal(review.reviewedSignatureHash, null);
      assert.equal(review.reviewedSignedAt, null);
      assert.equal(
        (await db.psychologist.findUniqueOrThrow({ where: { id: tenantId } }))
          .browserRecoveryKeyEncrypted,
        null,
      );
    }
    await assertMigrationState();
    for (const name of [
      '20261008000100_tenant_key_identity',
      '20261008000200_note_review_signature_binding',
      '20261008000300_browser_recovery_key',
    ]) {
      const result = spawnSync(
        'docker',
        [
          'exec',
          '-i',
          'mind-audit-reception-rehearsal-20261008',
          'psql',
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-h',
          '127.0.0.1',
          '-p',
          '55442',
          '-U',
          'reception_test_owner',
          '-d',
          'cureocity_mind_test',
        ],
        {
          input: readFileSync(resolve(repo, 'prisma/migrations', name, 'migration.sql')),
          encoding: 'utf8',
        },
      );
      assert.equal(result.status, 0, result.stderr);
    }
    await assertMigrationState();
    console.log(
      'PASS: all three migrations applied/replayed twice; wrapped keys and legacy review preserved; deterministic sole active key.',
    );
    await assert.rejects(
      db.psychologistTenantKey.create({
        data: { psychologistId: tenantId, kmsKeyId: 'fixture', wrappedKey: 'fixture' },
      }),
      (error) => error.code === 'P2002',
    );
    const baseReview = {
      sessionId: 'audit-fixture-session',
      therapyNoteId: 'audit-fixture-note',
      psychologistId: tenantId,
      reviewerName: 'Fictional reviewer',
      reviewedAt: new Date(),
    };
    for (const fields of [
      { reviewedSignatureHash: 'a'.repeat(64), reviewedSignedAt: null },
      { reviewedSignatureHash: null, reviewedSignedAt: new Date() },
      { reviewedSignatureHash: 'invalid', reviewedSignedAt: new Date() },
    ])
      await assert.rejects(db.noteReview.create({ data: { ...baseReview, ...fields } }));
    await db.noteReview.create({
      data: { ...baseReview, reviewedSignatureHash: 'a'.repeat(64), reviewedSignedAt: new Date() },
    });
    console.log(
      'PASS: duplicate active key refused; signature hash/timestamp pairs enforced; valid binding accepted.',
    );
    await worker({ mode: 'read', tenantId, values: state.values });
    await worker({ mode: 'blocked', tenantId });
    const unique = await worker({ mode: 'write', tenantId }, true);
    assert.match(unique.ciphertext, /^v1\.dek:/);
    await worker({
      mode: 'read',
      tenantId,
      values: [
        ...state.values,
        { ciphertext: unique.ciphertext, expected: 'fictional concurrent fixture' },
      ],
    });
    console.log(
      'PASS: all historical ciphertext decrypts after migration and process restart; ambiguous legacy writes fail closed; unique-format ciphertext survives restart.',
    );
    const results = await Promise.all(
      Array.from({ length: 6 }, () => worker({ mode: 'write', tenantId: concurrentTenant })),
    );
    assert.equal(
      await db.psychologistTenantKey.count({ where: { psychologistId: concurrentTenant } }),
      1,
    );
    assert.equal(
      await db.auditLog.count({
        where: { targetId: concurrentTenant, action: 'ENCRYPTION_KEY_PROVISIONED' },
      }),
      1,
    );
    await worker({
      mode: 'read',
      tenantId: concurrentTenant,
      values: results.map((result) => ({
        ciphertext: result.ciphertext,
        expected: 'fictional concurrent fixture',
      })),
    });
    console.log(
      'PASS: six independent processes provision exactly one key and one atomic audit; all six ciphertexts survive fresh-process decrypt.',
    );
  } else throw new Error('Expected seed or verify');
} finally {
  await db.$disconnect();
}
