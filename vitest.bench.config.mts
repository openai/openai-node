import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    maxWorkers: 1,
    benchmark: {
      include: ['tests/benchmarks/**/*.bench.ts'],
    },
  },
});
