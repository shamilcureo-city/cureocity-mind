import { afterEach, describe, expect, it, vi } from 'vitest';

const OWNER_KEYS = ['DATABASE_URL_UNPOOLED', 'POSTGRES_URL_NON_POOLING', 'DATABASE_URL'] as const;

describe('migration owner client initialization', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('can be imported during build without any database URL', async () => {
    for (const key of OWNER_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('DATABASE_RUNTIME_URL', '');
    vi.resetModules();

    const module = await import('./prisma-migration');

    expect(module.getMigrationPrisma).toBeTypeOf('function');
  });

  it('fails closed only when the privileged client is requested', async () => {
    for (const key of OWNER_KEYS) vi.stubEnv(key, '');
    vi.stubEnv('DATABASE_RUNTIME_URL', '');
    vi.resetModules();
    const module = await import('./prisma-migration');

    expect(() => module.getMigrationPrisma()).toThrow(
      'A direct migration-owner database URL is required for lawful signed-note erasure',
    );
  });
});
