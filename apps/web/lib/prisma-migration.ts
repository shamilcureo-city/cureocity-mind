import { PrismaClient } from '@prisma/client';

const globalForMigrationPrisma = globalThis as unknown as {
  migrationPrisma?: PrismaClient;
};

export function resolveMigrationConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  const candidate =
    env['DATABASE_URL_UNPOOLED'] ?? env['POSTGRES_URL_NON_POOLING'] ?? env['DATABASE_URL'];
  if (!candidate) {
    throw new Error(
      'A direct migration-owner database URL is required for lawful signed-note erasure',
    );
  }

  const runtimeUrl = env['DATABASE_RUNTIME_URL'];
  if (runtimeUrl) {
    const migrationUsername = new URL(candidate).username;
    const runtimeUsername = new URL(runtimeUrl).username;
    if (migrationUsername === runtimeUsername) {
      throw new Error('Lawful signed-note erasure requires a distinct migration-owner role');
    }
  }
  return candidate;
}

function buildMigrationPrisma(): PrismaClient {
  return new PrismaClient({
    datasources: { db: { url: resolveMigrationConnectionString() } },
  });
}

/** Owner connection reserved for narrowly scoped migration-owned operations. */
export const migrationPrisma = globalForMigrationPrisma.migrationPrisma ?? buildMigrationPrisma();

if (process.env['NODE_ENV'] !== 'production') {
  globalForMigrationPrisma.migrationPrisma = migrationPrisma;
}
