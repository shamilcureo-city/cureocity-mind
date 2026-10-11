import { readFileSync } from 'node:fs';
import { PrismaClient } from '@prisma/client';
import { decryptForTenant, encryptForTenant } from '../apps/web/lib/tenant-crypto';

const url = new URL(process.env['DATABASE_URL'] ?? '');
if (
  process.env['RUN_MIND_AUDIT_REHEARSAL'] !== '1' ||
  process.env['NODE_ENV'] !== 'test' ||
  process.env['KMS_BACKEND'] !== 'local-dev' ||
  process.env['CRYPTO_DEV_MASTER_SECRET'] !==
    'fictional-disposable-rehearsal-secret-not-for-production' ||
  url.protocol !== 'postgresql:' ||
  url.hostname !== '127.0.0.1' ||
  url.port !== '55442' ||
  url.pathname !== '/cureocity_mind_test' ||
  url.username !== 'reception_test_runtime' ||
  url.search ||
  url.hash ||
  process.env['DATABASE_RUNTIME_URL'] !== url.toString()
)
  throw new Error('Refusing non-isolated crypto rehearsal');

const db = new PrismaClient({ datasources: { db: { url: url.toString() } } });
globalThis.__cureocityPrisma = db;
const input = JSON.parse(readFileSync(0, 'utf8')) as {
  mode: 'write' | 'read' | 'blocked';
  tenantId: string;
  values?: Array<{ ciphertext: string; expected: string }>;
};
if (!input.tenantId.startsWith('audit-rehearsal-')) throw new Error('Unexpected fixture identity');
async function main() {
  try {
    if (input.mode === 'read') {
      for (const value of input.values ?? []) {
        if ((await decryptForTenant(input.tenantId, value.ciphertext)) !== value.expected) {
          throw new Error('Ciphertext did not survive process restart');
        }
      }
      process.stdout.write(JSON.stringify({ read: input.values?.length ?? 0 }));
    } else if (input.mode === 'blocked') {
      let refused = false;
      try {
        await encryptForTenant(input.tenantId, 'fictional blocked write');
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('identity is ambiguous'))
          throw error;
        refused = true;
      }
      if (!refused) throw new Error('Ambiguous legacy writer did not fail closed');
      process.stdout.write(JSON.stringify({ blocked: true }));
    } else if (input.mode === 'write') {
      const ciphertext = await encryptForTenant(input.tenantId, 'fictional concurrent fixture');
      process.stdout.write(JSON.stringify({ ciphertext }));
    } else throw new Error('Unknown crypto rehearsal operation');
  } finally {
    await db.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
