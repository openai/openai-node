import type { JestConfigWithTsJest } from 'ts-jest';

import baseConfig from './jest.config';

const config: JestConfigWithTsJest = {
  ...baseConfig,
  testMatch: ['<rootDir>/tests/live/**/*.live.test.ts'],
  testPathIgnorePatterns: [],
};

export default config;
