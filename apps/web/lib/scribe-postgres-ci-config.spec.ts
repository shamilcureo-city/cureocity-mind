import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

const workflowPath = resolve(import.meta.dirname, '../../../.github/workflows/ci.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const jobStart = workflow.indexOf('\n  scribe-postgres:\n');
const jobEnd = workflow.slice(jobStart + 1).search(/\n {2}[a-z][a-z-]*:\n/);
const job = workflow.slice(jobStart, jobEnd < 0 ? undefined : jobStart + 1 + jobEnd);
const ownerUrl =
  'postgresql://scribe_test_owner:scribe_ci_owner@127.0.0.1:55440/cureocity_scribe_test';
const runtimeUrl =
  'postgresql://scribe_test_runtime:scribe_ci_runtime@127.0.0.1:55440/cureocity_scribe_test';

// Static configuration regression tests only. Do not run a shell, database,
// container, migration, or runtime-grants script from this spec.
function step(name: string) {
  const start = job.indexOf(`      - name: ${name}\n`);
  expect(start).toBeGreaterThan(-1);
  const following = job.indexOf('\n      - name:', start + 1);
  return job.slice(start, following < 0 ? undefined : following);
}

function command(block: string) {
  const run = block.split('        run: |\n')[1];
  expect(run).toBeDefined();
  return run!.replace(/\\\n/g, ' ').trim().split(/\s+/);
}

describe('isolated Scribe PostgreSQL CI configuration', () => {
  it('is a formatted independent bounded job, with no production secrets or permissive failure', async () => {
    const config = await resolveConfig(workflowPath);
    await expect(check(workflow, { ...config, filepath: workflowPath })).resolves.toBe(true);
    expect(jobStart).toBeGreaterThan(-1);
    expect(job).toContain('runs-on: ubuntu-latest');
    expect(job).toContain('timeout-minutes: 15');
    expect(job).toContain('permissions:\n      contents: read');
    expect(job).not.toMatch(/secrets\.|vars\.|continue-on-error|DATABASE_URL_UNPOOLED/);
    const beforeSteps = job.slice(0, job.indexOf('\n    steps:'));
    expect(beforeSteps).not.toMatch(/DATABASE_URL|RUN_SCRIBE_POSTGRES_TESTS|RUN_INTEGRATION_TESTS/);
  });

  it('installs the pinned workspace tooling and builds generated dependencies without a database command', () => {
    expect(step('Enable pnpm')).toContain('version: 10.33.0');
    expect(step('Setup Node')).toContain("node-version: '22'");
    expect(step('Install dependencies')).toContain('run: pnpm install --frozen-lockfile');
    expect(step('Generate Prisma client')).toContain('run: pnpm db:generate');
    expect(step('Generate Prisma client')).toContain(`DATABASE_URL: ${ownerUrl}`);
    expect(step('Build Scribe persistence test dependencies')).toContain(
      'run: pnpm nx run-many -t build --projects=contracts,orbit-core,observability',
    );
    expect(job.indexOf('name: Build Scribe persistence test dependencies')).toBeLessThan(
      job.indexOf('name: Start isolated Scribe PostgreSQL'),
    );
  });

  it('binds a separate named PostgreSQL16 fixture only to loopback with a readiness deadline', () => {
    const block = step('Start isolated Scribe PostgreSQL');
    expect(block).toContain('timeout-minutes: 1');
    expect(block).toContain(
      'docker run --detach --name cureocity-scribe-postgres-ci --network host',
    );
    expect(block).toContain(
      '--env POSTGRES_USER=scribe_test_owner --env POSTGRES_PASSWORD=scribe_ci_owner',
    );
    expect(block).toContain('--env POSTGRES_DB=cureocity_scribe_test');
    expect(block).toContain('postgres:16-alpine postgres -p 55440 -c listen_addresses=127.0.0.1');
    expect(block).toContain('for attempt in {1..30}');
    expect(block).toContain(
      'docker exec cureocity-scribe-postgres-ci pg_isready -h 127.0.0.1 -p 55440 -U scribe_test_owner -d cureocity_scribe_test',
    );
    expect(block).toContain('sleep 1');
    expect(block).toContain('exit 1');
    expect(block).not.toMatch(/--publish|55440:5432|listen_addresses=\*|--volume|--mount/);
  });

  it('reconciles historical fresh ordering then applies every migration as the explicit test owner', () => {
    const block = step('Migrate isolated Scribe PostgreSQL as owner');
    expect(block).toContain('timeout-minutes: 3');
    expect(block).toContain("CI: 'true'");
    expect(block).toContain("RUN_INTEGRATION_TESTS: '1'");
    expect(block).toContain("RUN_SCRIBE_POSTGRES_TESTS: '1'");
    expect(block).toContain(`DATABASE_URL: ${ownerUrl}`);
    expect(command(block)).toEqual(['pnpm', 'db:prepare-fresh-ci', 'pnpm', 'db:migrate:deploy']);
    expect(block).not.toContain('scribe_test_runtime');
    expect(block).not.toMatch(/db:push|db:reset|migrate reset/);
  });

  it('creates a non-owner least-privilege role and uses the real runtime-grants path', () => {
    const block = step('Provision restricted Scribe test runtime role');
    expect(block).toContain('timeout-minutes: 1');
    expect(block).toContain(`DATABASE_URL: ${ownerUrl}`);
    expect(block).toContain('DATABASE_RUNTIME_ROLE: scribe_test_runtime');
    expect(block).toContain(`DATABASE_RUNTIME_URL: ${runtimeUrl}`);
    expect(block).toContain(
      'docker exec --env PGPASSWORD=scribe_ci_owner cureocity-scribe-postgres-ci psql -X -v ON_ERROR_STOP=1',
    );
    expect(block).toContain('-h 127.0.0.1 -p 55440 -U scribe_test_owner -d cureocity_scribe_test');
    expect(block).toContain(
      "CREATE ROLE scribe_test_runtime LOGIN PASSWORD 'scribe_ci_runtime' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS;",
    );
    expect(block).toContain(
      'GRANT CONNECT ON DATABASE cureocity_scribe_test TO scribe_test_runtime;',
    );
    expect(block).toContain('node scripts/configure-runtime-db-role.mjs');
    expect(block).not.toMatch(
      /GRANT scribe_test_owner|OWNER TO scribe_test_runtime|SET ROLE|DISABLE TRIGGER|session_replication_role/,
    );
    expect(job.indexOf('name: Provision restricted Scribe test runtime role')).toBeGreaterThan(
      job.indexOf('name: Migrate isolated Scribe PostgreSQL as owner'),
    );
  });

  it('explicitly enables only the guarded Scribe persistence suite with runtime-only credentials', () => {
    const block = step('Run Scribe PostgreSQL persistence tests as runtime role');
    expect(block).toContain('timeout-minutes: 5');
    expect(block).toContain("RUN_SCRIBE_POSTGRES_TESTS: '1'");
    for (const key of ['DATABASE_URL', 'DATABASE_RUNTIME_URL', 'SCRIBE_TEST_DATABASE_URL']) {
      expect(block).toContain(`${key}: ${runtimeUrl}`);
    }
    expect(block).toContain('DATABASE_RUNTIME_ROLE: scribe_test_runtime');
    expect(command(block)).toEqual([
      'pnpm',
      '--filter',
      '@cureocity/web',
      'exec',
      'vitest',
      'run',
      'lib/scribe-workspace-postgres.spec.ts',
      '--maxWorkers=1',
    ]);
    expect(block).not.toMatch(
      /scribe_test_owner|scribe_ci_owner|continue-on-error|if:|RUN_MIND_POSTGRES_TESTS/,
    );
    expect(
      job.indexOf('name: Run Scribe PostgreSQL persistence tests as runtime role'),
    ).toBeGreaterThan(job.indexOf('name: Provision restricted Scribe test runtime role'));
    const url = new URL(runtimeUrl);
    expect(url.username).toBe('scribe_test_runtime');
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('55440');
    expect(url.pathname).toBe('/cureocity_scribe_test');
    expect(url.search).toBe('');
    expect(url.hash).toBe('');
  });

  it('always tears down only the named fixture and its anonymous volume', () => {
    const block = step('Stop isolated Scribe PostgreSQL');
    expect(block).toContain('if: ${{ always() }}');
    expect(block).toContain('timeout-minutes: 1');
    expect(command(block)).toEqual([
      'if',
      'docker',
      'container',
      'inspect',
      'cureocity-scribe-postgres-ci',
      '>/dev/null',
      '2>&1;',
      'then',
      'docker',
      'rm',
      '--force',
      '--volumes',
      'cureocity-scribe-postgres-ci',
      'fi',
    ]);
    expect(job.indexOf('name: Stop isolated Scribe PostgreSQL')).toBeGreaterThan(
      job.indexOf('name: Run Scribe PostgreSQL persistence tests as runtime role'),
    );
    expect(block).not.toMatch(/prune|cureocity-mind-postgres-ci/);
  });
});
