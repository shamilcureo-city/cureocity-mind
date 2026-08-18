import { describe, expect, it } from 'vitest';
import { resolveConnectionString } from './prisma';

describe('database runtime role connection policy', () => {
  it('fails closed in production without DATABASE_RUNTIME_URL', () => {
    expect(() =>
      resolveConnectionString({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://owner:secret@db.example/app',
        DATABASE_URL_UNPOOLED: 'postgresql://owner:secret@db.example/app',
      }),
    ).toThrow('DATABASE_RUNTIME_URL');
  });

  it('uses only DATABASE_RUNTIME_URL for production application queries', () => {
    expect(
      resolveConnectionString({
        NODE_ENV: 'production',
        DATABASE_RUNTIME_URL: 'postgresql://runtime:secret@db-pooler.example/app',
        DATABASE_URL: 'postgresql://owner:secret@db.example/app',
      }),
    ).toContain('runtime:secret@db-pooler.example');
  });

  it('rejects a verifiably identical runtime and migration owner role', () => {
    expect(() =>
      resolveConnectionString({
        NODE_ENV: 'production',
        DATABASE_RUNTIME_URL: 'postgresql://owner:runtime-secret@db-pooler.example/app',
        DATABASE_URL_UNPOOLED: 'postgresql://owner:owner-secret@db.example/app',
      }),
    ).toThrow('must not use the migration-owner role');
  });

  it('preserves local development fallbacks', () => {
    expect(
      resolveConnectionString({
        NODE_ENV: 'development',
        DATABASE_URL: 'postgresql://local:local@localhost/app',
      }),
    ).toContain('local:local@localhost');
  });

  it('preserves Vercel preview fallbacks even though Next sets NODE_ENV=production', () => {
    expect(
      resolveConnectionString({
        NODE_ENV: 'production',
        VERCEL_ENV: 'preview',
        DATABASE_URL: 'postgresql://preview:***@preview.example/app',
      }),
    ).toContain('preview.example');
  });
});
