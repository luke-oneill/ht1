const sharedConfig = require("./jest.config");

/** @type {import('jest').Config} */
module.exports = {
	...sharedConfig,
	testPathIgnorePatterns: [
		...sharedConfig.testPathIgnorePatterns,
		"\\.integration\\.test\\.ts$",
	],
};
