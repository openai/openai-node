/** @type {import('ts-jest/dist/types').InitialOptionsTsJest} */
module.exports = {
	transform: {},
	testEnvironment: 'node',
	testMatch: ['<rootDir>/tests/*.js'],
	watchPathIgnorePatterns: ['<rootDir>/node_modules/'],
	verbose: false,
};
