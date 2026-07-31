import type { JestConfigWithTsJest } from 'ts-jest';
import generatedTestPatterns from './scripts/generated-test-patterns.json';

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
  coverageThreshold: {
    global: {
      // Keep source-line coverage near total while independently ratcheting complex paths.
      branches: 90,
      functions: 93,
      lines: 98,
      statements: 98,
    },
  },
  testMatch: generatedTestPatterns.map(
    (pattern) => `<rootDir>/${pattern}${pattern.endsWith('.test.ts') ? '' : '/**/*.test.ts'}`,
  ),
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
  testPathIgnorePatterns: ['scripts', '<rootDir>/tests/live/'],
  // prettierPath: require.resolve('prettier-2'),
};

export default config;
