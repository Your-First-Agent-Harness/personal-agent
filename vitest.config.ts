import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    maxWorkers: 1,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/cli/main.ts'],
      reporter: ['text', 'html'],
      thresholds: { statements: 80, lines: 80, functions: 80, branches: 75 },
    },
  },
});
