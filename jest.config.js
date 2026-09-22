/** @type {import('jest').Config} */
module.exports = {
	preset: "ts-jest",
	testEnvironment: "node",
	setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.ts"],
	testPathIgnorePatterns: ["/node_modules/", "/dist/"],
};
