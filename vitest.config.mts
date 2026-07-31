import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

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
      'tests/api-resources/**',
      'tests/backwards-compat-resource-exports.test.ts',
      'tests/index.test.ts',
      'tests/stringifyQuery.test.ts',
      'tests/live/**',
    ],
    fileParallelism: false,
    maxWorkers: 1,
    coverage: {
      provider: 'custom',
      customProviderModule: './scripts/vitest-coverage-provider.mjs',
      reportsDirectory: 'coverage/unit',
      reporter: ['json'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/_vendor/**',
        'src/auth/types.ts',
        'src/internal/builtin-types.ts',
        'src/internal/qs/types.ts',
        'src/internal/shim-types.ts',
        'src/internal/types.ts',
        'src/lib/jsonschema.ts',
        'src/lib/responses/EventTypes.ts',
      ],
    },
  },
});
