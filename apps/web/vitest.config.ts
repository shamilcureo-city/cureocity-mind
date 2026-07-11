import { defineConfig } from 'vitest/config';

/**
 * apps/web unit tests — PURE lib logic only (gate, kind inference,
 * streaks). Anything touching prisma / Next runtime stays out of scope
 * here; those paths are covered by the mock-path e2e instead.
 */
export default defineConfig({
  test: {
    include: ['lib/**/*.spec.ts'],
    environment: 'node',
  },
});
