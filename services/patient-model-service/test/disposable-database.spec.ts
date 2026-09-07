import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertDisposableIntegrationDatabase } from '../../test-support/disposable-database';

const LOCAL = 'postgresql://test:synthetic-password@localhost:5432/cureocity_mind_test';
const enabled = (extra: Record<string, string | undefined> = {}) => ({
  RUN_INTEGRATION_TESTS: '1',
  DATABASE_URL: LOCAL,
  ...extra,
});

describe('disposable integration database guard (no DB connection)', () => {
  it('accepts the existing GitHub CI local test URL and returns the exact checked URL', () => {
    expect(assertDisposableIntegrationDatabase(enabled({ CI: 'true' }))).toBe(LOCAL);
  });
  it('accepts explicit loopback and harmless connection tuning', () => {
    const url =
      'postgresql://test:secret@127.0.0.1:5544/cureocity_mind_test?connection_limit=1&schema=public';
    expect(assertDisposableIntegrationDatabase(enabled({ DATABASE_URL: url }))).toBe(url);
  });
  it.each([undefined, '', 'true', '0'])('requires the exact opt-in flag %j', (value) => {
    expect(() =>
      assertDisposableIntegrationDatabase(enabled({ RUN_INTEGRATION_TESTS: value })),
    ).toThrow(/RUN_INTEGRATION_TESTS/);
  });
  it('rejects production mode even with local connection and integration opt-in', () => {
    expect(() => assertDisposableIntegrationDatabase(enabled({ NODE_ENV: 'production' }))).toThrow(
      /outside production/,
    );
  });
  it.each([
    undefined,
    '',
    'not a URL',
    'postgresql://test:secret@remote.example/cureocity_mind_test',
    'postgresql://test:secret@localhost.remote.example/cureocity_mind_test',
    'postgresql://localhost@remote.example/cureocity_mind_test',
    'postgresql://test:secret@localhost/cureocity_mind',
    'postgresql://test:secret@localhost/cureocity_mind_test_other',
    'postgresql://test:secret@localhost/cureocity_mind_test/extra',
    'postgresql://test:secret@localhost/%63ureocity_mind_test',
    'https://localhost/cureocity_mind_test',
    'file:///cureocity_mind_test',
    `${LOCAL}#ignored-fragment`,
    `${LOCAL}?host=remote.example`,
    `${LOCAL}?%68ost=remote.example`,
    `${LOCAL}?dbname=production`,
    `${LOCAL}?options=host%3Dremote.example`,
  ])('rejects ambiguous or non-disposable target %j', (url) => {
    expect(() => assertDisposableIntegrationDatabase(enabled({ DATABASE_URL: url }))).toThrow();
  });
  it.each([
    'DATABASE_RUNTIME_URL',
    'POSTGRES_PRISMA_URL',
    'POSTGRES_URL',
    'DATABASE_URL_UNPOOLED',
    'POSTGRES_URL_NON_POOLING',
  ])('rejects unexpected remote alias %s even when DATABASE_URL is local', (name) => {
    const secretUrl = 'postgresql://owner:do-not-log-this@remote.example/production';
    expect(() => assertDisposableIntegrationDatabase(enabled({ [name]: secretUrl }))).toThrow(name);
    try {
      assertDisposableIntegrationDatabase(enabled({ [name]: secretUrl }));
    } catch (error) {
      expect(String(error)).not.toContain('do-not-log-this');
      expect(String(error)).not.toContain('remote.example');
    }
  });
  it('permits explicitly disposable aliases but not blank configured aliases', () => {
    expect(
      assertDisposableIntegrationDatabase(
        enabled({ DATABASE_RUNTIME_URL: LOCAL, POSTGRES_PRISMA_URL: LOCAL }),
      ),
    ).toBe(LOCAL);
    expect(() => assertDisposableIntegrationDatabase(enabled({ POSTGRES_URL: '' }))).toThrow(
      'POSTGRES_URL',
    );
  });
  it.each([
    'patient-model-service/test/integration/patient-model.e2e.spec.ts',
    'scribe-service/test/integration/scribe-e2e.spec.ts',
  ])('protects destructive setup and pins actual Prisma clients in %s', (path) => {
    // Vitest/Nx run this project with services/patient-model-service as cwd.
    const source = readFileSync(`../${path}`, 'utf8');
    const setup = source.slice(
      source.indexOf('beforeAll(async () => {'),
      source.indexOf('afterAll(async () => {'),
    );
    expect(setup.indexOf('assertDisposableIntegrationDatabase()')).toBeGreaterThanOrEqual(0);
    expect(setup.indexOf('assertDisposableIntegrationDatabase()')).toBeLessThan(
      setup.indexOf('new PrismaClient('),
    );
    expect(setup).toContain('new PrismaService({ datasources: { db: { url: base } } })');
    const destructive = source.slice(source.indexOf('beforeEach(async () => {'));
    expect(destructive.indexOf('assertDisposableIntegrationDatabase()')).toBeGreaterThanOrEqual(0);
    expect(destructive.indexOf('assertDisposableIntegrationDatabase()')).toBeLessThan(
      destructive.indexOf('.deleteMany('),
    );
  });
});
