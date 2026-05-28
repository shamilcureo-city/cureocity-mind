import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts'],
    // The worklet processor file uses AudioWorkletGlobalScope APIs that
    // don't exist in node — keep it out of vitest entirely.
    exclude: ['**/node_modules/**', 'src/worklet/**'],
  },
});
