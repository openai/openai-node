/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
	transform: {
		'^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.check.json', useESM: true }],
	},
	extensionsToTreatAsEsm: ['.ts'],
	moduleNameMapper: {
		'^(\\.{1,2}/.*)\\.js$': '$1',
	},
	testEnvironment: 'node',
	testMatch: ['<rootDir>/tests/*.js'],
	watchPathIgnorePatterns: ['<rootDir>/node_modules/'],
	verbose: false,
	testTimeout: 60_000,
};
