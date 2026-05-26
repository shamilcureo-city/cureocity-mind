import { defineConfig } from 'vitest/config';
import swc from 'unplugin-swc';

const INTEGRATION_ENABLED = process.env['RUN_INTEGRATION_TESTS'] === '1';

export default defineConfig({
  /**
   * Use SWC instead of esbuild for TypeScript transformation. Required so
   * decorator metadata (emitDecoratorMetadata) is emitted — without it
   * NestJS DI cannot infer constructor parameter types and silently
   * injects `undefined` for type-based dependencies.
   */
  plugins: [
    swc.vite({
      module: { type: 'es6' },
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, decoratorMetadata: true },
        target: 'es2022',
      },
    }),
  ],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts', 'test/**/*.{spec,test}.ts'],
    /**
     * Integration tests live in test/ and require a real Postgres reachable
     * via DATABASE_URL. They are excluded from the default run because the
     * file's module-level imports boot the Nest container, which throws on
     * a missing env var even when `describe.skipIf` would skip the suites.
     * Opt in with RUN_INTEGRATION_TESTS=1.
     */
    exclude: INTEGRATION_ENABLED
      ? ['**/node_modules/**', '**/dist/**']
      : ['**/node_modules/**', '**/dist/**', 'test/integration/**'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.{spec,test}.ts', 'src/main.ts'],
    },
  },
});
