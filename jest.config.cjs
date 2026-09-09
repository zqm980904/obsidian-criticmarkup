module.exports = {
	testEnvironment: 'jsdom',
	testMatch: ["**/tests/**/*.test.ts"],

	collectCoverage: false,

	transform: {
		// package.json is "type":"module"; ts-jest needs verbatimModuleSyntax off to compile tests
		'^.+\\.ts$': ['ts-jest', {
			tsconfig: { verbatimModuleSyntax: false },
		}],
		"^.+\\.(js|jsx)$": "esbuild-jest"
	},


	moduleDirectories: ["node_modules", "src", "tests"],
	moduleFileExtensions: ['js', 'ts'],
	// moduleNameMapper: {
	// 	"obsidian": "tests/__mocks__/obsidian_mock.ts",
	// },

	setupFilesAfterEnv: ["jest-expect-message"],
	noStackTrace: true,
};
