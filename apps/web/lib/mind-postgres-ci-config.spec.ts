import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { check, resolveConfig } from 'prettier';
import { describe, expect, it } from 'vitest';

const workflowPath = resolve(import.meta.dirname, '../../../.github/workflows/ci.yml');
const workflow = readFileSync(workflowPath, 'utf8');
const fixtureUrl = 'postgresql://cureocity:cureocity@127.0.0.1:55439/cureocity_mind_test';

// YAML syntax is checked with the existing workspace formatter below. These
// deliberately narrow assertions protect the reviewed CI commands, not YAML
// parsing in general. No Docker, database or shell command is executed here.
function step(name: string) {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  expect(start).toBeGreaterThan(-1);
  const following = workflow.indexOf('\n      - name:', start + 1);
  const jobEnd = workflow.indexOf('\n  # NEXT5', start + 1);
  return workflow.slice(
    start,
    Math.min(...[following, jobEnd, workflow.length].filter((n) => n >= 0)),
  );
}

function command(block: string) {
  const run = block.split('        run: |\n')[1];
  expect(run).toBeDefined();
  return run!.replace(/\\\n/g, ' ').trim().split(/\s+/);
}

describe('dedicated Mind PostgreSQL CI coverage', () => {
  it('is valid, formatted YAML', async () => {
    const config = await resolveConfig(workflowPath);
    await expect(check(workflow, { ...config, filepath: workflowPath })).resolves.toBe(true);
  });

  it('preserves the existing 5432 service and standard integration environment', () => {
    const job = workflow.slice(workflow.indexOf('\n  test:\n'), workflow.indexOf('\n  # NEXT5'));
    const beforeSteps = job.slice(0, job.indexOf('\n    steps:'));
    expect(beforeSteps).toContain('image: postgres:16-alpine');
    expect(beforeSteps).toContain('          - 5432:5432');
    expect(beforeSteps).toContain(
      'DATABASE_URL: postgresql://cureocity:cureocity@localhost:5432/cureocity_mind_test',
    );
    expect(beforeSteps).toContain("RUN_INTEGRATION_TESTS: '1'");
    expect(beforeSteps).not.toContain('RUN_MIND_POSTGRES_TESTS');
    expect(beforeSteps).not.toContain('MIND_TEST_DATABASE_URL');
    expect(step('Run all tests (unit + integration)')).toContain('run: pnpm test');
  });

  it('starts a separately named PostgreSQL16 fixture bound only to host loopback with a readiness deadline', () => {
    const block = step('Start isolated Mind PostgreSQL');
    expect(block).toContain('timeout-minutes: 1');
    expect(block).toContain('docker run --detach --name cureocity-mind-postgres-ci --network host');
    expect(block).toContain('--env POSTGRES_USER=cureocity --env POSTGRES_PASSWORD=cureocity');
    expect(block).toContain('--env POSTGRES_DB=cureocity_mind_test');
    expect(block).toContain('postgres:16-alpine postgres -p 55439 -c listen_addresses=127.0.0.1');
    expect(block).toContain('for attempt in {1..30}');
    expect(block).toContain(
      'docker exec cureocity-mind-postgres-ci pg_isready -h 127.0.0.1 -p 55439 -U cureocity -d cureocity_mind_test',
    );
    expect(block).toContain('exit 1');
    expect(block).not.toMatch(/--publish|55439:5432|listen_addresses=\*/);
  });

  it('migrates only the explicit disposable target before running the guarded suites', () => {
    const block = step('Migrate isolated Mind PostgreSQL');
    expect(block).toContain(`DATABASE_URL: ${fixtureUrl}`);
    expect(command(block)).toEqual(['pnpm', 'db:prepare-fresh-ci', 'pnpm', 'db:migrate:deploy']);
    expect(workflow.indexOf('name: Migrate isolated Mind PostgreSQL')).toBeGreaterThan(
      workflow.indexOf('name: Start isolated Mind PostgreSQL'),
    );
    expect(workflow.indexOf('name: Run Mind PostgreSQL persistence tests')).toBeGreaterThan(
      workflow.indexOf('name: Migrate isolated Mind PostgreSQL'),
    );
  });

  it('explicitly enables and executes exactly the three real suites serially rather than silently skipping', () => {
    const block = step('Run Mind PostgreSQL persistence tests');
    expect(block).toContain("RUN_MIND_POSTGRES_TESTS: '1'");
    expect(block).toContain(`MIND_TEST_DATABASE_URL: ${fixtureUrl}`);
    expect(block).toContain(`DATABASE_URL: ${fixtureUrl}`);
    expect(command(block)).toEqual([
      'pnpm',
      '--filter',
      '@cureocity/web',
      'exec',
      'vitest',
      'run',
      'lib/appointment-reminder-uniqueness-postgres.spec.ts',
      'lib/mind-consent-recovery-postgres.spec.ts',
      'lib/mind-counselling-postgres.spec.ts',
      '--maxWorkers=1',
    ]);
    expect(block).not.toContain('continue-on-error');
    expect(block).not.toContain('if:');
    const url = new URL(fixtureUrl);
    expect(url.hostname).toBe('127.0.0.1');
    expect(url.port).toBe('55439');
    expect(url.pathname).toBe('/cureocity_mind_test');
    expect(url.search).toBe('');
  });

  it('always cleans up only the exact named fixture container', () => {
    const block = step('Stop isolated Mind PostgreSQL');
    expect(block).toContain('if: ${{ always() }}');
    expect(command(block)).toEqual([
      'if',
      'docker',
      'container',
      'inspect',
      'cureocity-mind-postgres-ci',
      '>/dev/null',
      '2>&1;',
      'then',
      'docker',
      'rm',
      '--force',
      'cureocity-mind-postgres-ci',
      'fi',
    ]);
    expect(workflow.indexOf('name: Stop isolated Mind PostgreSQL')).toBeGreaterThan(
      workflow.indexOf('name: Run Mind PostgreSQL persistence tests'),
    );
  });
});
