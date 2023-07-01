/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    // '^.+\\.[tj]sx?$' to process js/ts with `ts-jest`
    // '^.+\\.m?[tj]sx?$' to process js/ts/mjs/mts with `ts-jest`
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        useESM: true,
        diagnostics: false,
      },
    ],
  },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/*.ts'],
  watchPathIgnorePatterns: ['<rootDir>/node_modules/'],
  verbose: false,
  testTimeout: 15000,
};
