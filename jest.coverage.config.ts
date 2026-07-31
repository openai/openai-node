import type { JestConfigWithTsJest } from 'ts-jest';
import config from './jest.config';

const coverageConfig: JestConfigWithTsJest = {
  ...config,
  testMatch: ['<rootDir>/tests/**/*.test.ts'],
  transform: {
    '^.+\\.(t|j)sx?$': '<rootDir>/scripts/jest-coverage-transformer.cjs',
  },
  moduleNameMapper: {
    ...config.moduleNameMapper,
    '^vitest$': '<rootDir>/scripts/vitest-jest-compat.cjs',
  },
  coverageReporters: [...(config.coverageReporters ?? []), 'json'],
};

export default coverageConfig;
