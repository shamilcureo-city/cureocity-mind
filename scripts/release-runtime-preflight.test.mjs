import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertReleaseRuntime } from './release-runtime-preflight.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const guard = 'node scripts/release-runtime-preflight.mjs';
const smoke = 'node scripts/production-dependency-smoke.mjs';

test('accepts the tested Node 22 floor and later stable patches on the same major', () => {
  for (const version of ['v22.23.2', '22.23.2', 'v22.23.3', 'v22.24.0', 'v22.100.0']) {
    assert.doesNotThrow(() => assertReleaseRuntime(version), version);
  }
});

test('rejects older patches and untested majors', () => {
  for (const version of ['v22.23.0', 'v22.23.1', 'v22.22.99', 'v22.0.0', 'v20.99.0', 'v24.0.0']) {
    assert.throws(() => assertReleaseRuntime(version), /stable Node 22\.23\.2/, version);
  }
});

test('rejects prereleases and malformed versions rather than bypassing the release floor', () => {
  for (const version of [
    null,
    '',
    '22',
    'v22.23',
    'v22.23.2-rc.1',
    'v22.23.2+custom',
    'Node 22.23.2',
  ]) {
    assert.throws(() => assertReleaseRuntime(version), /stable Node 22\.23\.2/);
  }
});

test('CLI prints and validates its actual runtime, not an argument or environment override', () => {
  const result = spawnSync(
    process.execPath,
    [join(root, 'scripts/release-runtime-preflight.mjs'), 'v24.0.0'],
    { encoding: 'utf8', env: { ...process.env, NODE_VERSION: 'v24.0.0' } },
  );
  assert.ifError(result.error);
  assert.ok(result.stdout.includes(`Actual Node runtime: ${process.version}`));
  let accepted = true;
  try {
    assertReleaseRuntime(process.version);
  } catch {
    accepted = false;
  }
  assert.equal(result.status, accepted ? 0 : 1);
  assert.equal(result.stdout.includes('Runtime accepted.'), accepted);
  assert.equal(result.stderr.includes('Release requires stable Node 22.23.2'), !accepted);
});

test('web build fails fast on runtime and dependency smoke before any migration hook', () => {
  const config = JSON.parse(readFileSync(join(root, 'apps/web/vercel.json'), 'utf8'));
  assert.deepEqual(config.buildCommand.split(' && '), [
    'cd ../..',
    guard,
    'pnpm install --frozen-lockfile',
    smoke,
    'pnpm exec prisma generate',
    'bash scripts/vercel-db-setup.sh',
    'pnpm -r --filter "@cureocity/web..." build',
  ]);
});

test('gateway checks the actual inherited runtime and installed dependencies before building', () => {
  const docker = readFileSync(join(root, 'services/live-gateway/Dockerfile'), 'utf8');
  const instructions = docker
    .replace(/\\\r?\n\s*/g, ' ')
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .filter((line) => line && !line.startsWith('#'));
  assert.deepEqual(
    instructions.filter((line) => line.startsWith('FROM ')),
    ['FROM node:22-slim AS base', 'FROM base AS build', 'FROM build AS runtime'],
  );
  const copyIndex = instructions.indexOf('COPY . .');
  const installIndex = instructions.indexOf(
    `RUN ${guard} && pnpm install --frozen-lockfile && ${smoke}`,
  );
  const buildIndex = instructions.indexOf(
    'RUN pnpm --filter @cureocity/contracts --filter @cureocity/clinical --filter @cureocity/llm build',
  );
  assert.ok(copyIndex >= 0 && installIndex > copyIndex && buildIndex > installIndex);
  assert.ok(instructions.indexOf('FROM build AS runtime') > buildIndex);
});

test('existing CI dependency smoke runs the release guard and its regressions first', () => {
  const ci = readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8');
  const smokeStep = ci.match(
    /- name: Smoke production dependency entrypoints\n\s+run: \|\n([\s\S]*?)(?=\n\s+- name:)/,
  );
  assert.ok(smokeStep, 'The existing smoke step must remain enabled');
  assert.deepEqual(
    smokeStep[1]
      .trim()
      .split('\n')
      .map((line) => line.trim()),
    [
      guard,
      'node --test scripts/release-runtime-preflight.test.mjs',
      'pnpm smoke:prod-dependencies',
    ],
  );
});
