import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';
import generatedTestPatterns from './scripts/generated-test-patterns.json';

export default defineConfig({
  resolve: {
    alias: [
      { find: /^openai$/, replacement: resolve(__dirname, 'src/index.ts') },
      { find: /^openai\/(.*)$/, replacement: resolve(__dirname, 'src/$1') },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
    exclude: [
      ...generatedTestPatterns.map((pattern) => (pattern.endsWith('.test.ts') ? pattern : `${pattern}/**`)),
      'tests/live/**',
    ],
    fileParallelism: true,
    maxWorkers: 4,
  },
});
