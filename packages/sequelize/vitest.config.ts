import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Point to TypeScript source so tests run without a build step.
      '@huni/core': path.resolve('../core/src/index.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Tests run serially to avoid SQLite file conflicts.
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
  },
});
