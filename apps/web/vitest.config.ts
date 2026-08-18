import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

/**
 * apps/web unit tests — PURE lib logic only (gate, kind inference,
 * streaks). Anything touching prisma / Next runtime stays out of scope
 * here; those paths are covered by the mock-path e2e instead.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('.', import.meta.url)) },
  },
  test: {
    include: ['lib/**/*.spec.ts'],
    environment: 'node',
  },
});
