#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Release-only policy: stay on the tested major and accept subsequent Node 22
// security patches. No dependencies or credentials are needed before install.
export function assertReleaseRuntime(version = process.version) {
  const match = typeof version === 'string' && /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const [major, minor, patch] = match ? match.slice(1).map(Number) : [];
  if (major !== 22 || minor < 23 || (minor === 23 && patch < 2)) {
    throw new Error('Release requires stable Node 22.23.2 or newer within major 22.');
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  console.log(`[release-runtime-preflight] Actual Node runtime: ${process.version}`);
  try {
    assertReleaseRuntime();
    console.log('[release-runtime-preflight] Runtime accepted.');
  } catch (error) {
    console.error(`[release-runtime-preflight] ${error.message}`);
    process.exitCode = 1;
  }
}
