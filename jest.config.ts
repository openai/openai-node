import type { JestConfigWithTsJest } from 'ts-jest';

const generatedTestPatterns = [
  '<rootDir>/tests/api-resources/**/*.test.ts',
  '<rootDir>/tests/backwards-compat-resource-exports.test.ts',
  '<rootDir>/tests/index.test.ts',
  '<rootDir>/tests/stringifyQuery.test.ts',
];

const testSuite = process.env['OPENAI_TEST_SUITE'] ?? 'all';
const partialCoverage = process.env['OPENAI_COVERAGE_PARTIAL'] === '1';

if (!['all', 'generated', 'unit'].includes(testSuite)) {
  throw new Error(`Unknown OPENAI_TEST_SUITE: ${testSuite}. Expected all, generated, or unit.`);
}

const config: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  collectCoverageFrom: [
    '<rootDir>/src/**/*.ts',
    '!<rootDir>/src/**/*.d.ts',
    '!<rootDir>/src/_vendor/**',
    // V8 counts type-only TypeScript modules as uncovered executable files.
    '!<rootDir>/src/auth/types.ts',
    '!<rootDir>/src/internal/builtin-types.ts',
    '!<rootDir>/src/internal/qs/types.ts',
    '!<rootDir>/src/internal/shim-types.ts',
    '!<rootDir>/src/internal/types.ts',
    '!<rootDir>/src/lib/jsonschema.ts',
    '!<rootDir>/src/lib/responses/EventTypes.ts',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageProvider: 'v8',
  coverageReporters: ['text-summary', 'json-summary', 'lcov'],
  coverageThreshold:
    partialCoverage ?
      { global: {} }
    : {
        global: {
          // Keep source-line coverage near total while independently ratcheting complex paths.
          branches: 90,
          functions: 93,
          lines: 98,
          statements: 98,
        },
      },
  testMatch: testSuite === 'generated' ? generatedTestPatterns : ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': ['@swc/jest', { sourceMaps: 'inline' }],
  },
  moduleNameMapper: {
    '^openai$': '<rootDir>/src/index.ts',
    '^openai/(.*)$': '<rootDir>/src/$1',
  },
  modulePathIgnorePatterns: [
    '<rootDir>/ecosystem-tests/',
    '<rootDir>/dist/',
    '<rootDir>/deno/',
    '<rootDir>/deno_tests/',
    '<rootDir>/packages/',
  ],
  testPathIgnorePatterns: [
    'scripts',
    '<rootDir>/tests/live/',
    ...(testSuite === 'unit' ?
      [
        '<rootDir>/tests/api-resources/',
        '<rootDir>/tests/backwards-compat-resource-exports\\.test\\.ts$',
        '<rootDir>/tests/index\\.test\\.ts$',
        '<rootDir>/tests/stringifyQuery\\.test\\.ts$',
      ]
    : []),
  ],
  // prettierPath: require.resolve('prettier-2'),
};

export default config;
