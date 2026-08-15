import type { JestConfigWithTsJest } from 'ts-jest';
import generatedTestPatterns from './scripts/generated-test-patterns.json';

const config: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/scripts/jest-setup.ts'],
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
};

export default config;
