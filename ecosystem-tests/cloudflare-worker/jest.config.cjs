/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
	transform: {
		'^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.check.json', useESM: true }],
	},
	extensionsToTreatAsEsm: ['.ts'],
	testEnvironment: 'node',
	testMatch: ['<rootDir>/tests/*.js'],
	watchPathIgnorePatterns: ['<rootDir>/node_modules/'],
	verbose: false,
	testTimeout: 60000,
};
