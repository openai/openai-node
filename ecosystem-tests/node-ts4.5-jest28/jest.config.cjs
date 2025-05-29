/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/*.ts'],
  watchPathIgnorePatterns: ['<rootDir>/node_modules/'],
  verbose: false,
  testTimeout: 60000,
};
