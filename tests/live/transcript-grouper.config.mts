import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // oxlint-disable-next-line unicorn/prefer-module -- Match the SDK's CommonJS TypeScript config; Vitest supplies this config directory.
    alias: { openai: path.resolve(__dirname, '../../src') },
  },
  test: {
    environment: 'node',
    include: ['tests/live/transcript-grouper.live.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
  },
});
