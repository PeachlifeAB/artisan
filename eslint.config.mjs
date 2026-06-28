import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import security from "eslint-plugin-security";
import sonarjs from "eslint-plugin-sonarjs";
import unicorn from "eslint-plugin-unicorn";

const nodeGlobals = {
	console: "readonly",
	process: "readonly",
	setTimeout: "readonly",
	clearTimeout: "readonly",
	setInterval: "readonly",
	clearInterval: "readonly",
	Buffer: "readonly",
	__dirname: "readonly",
	__filename: "readonly",
};

export default [
	js.configs.recommended,
	unicorn.configs.recommended,
	sonarjs.configs.recommended,
	security.configs.recommended,
	{
		files: [
			"src/**/*.mjs",
			"tests/**/*.mjs",
			"bin/**/*.mjs",
			"templates/**/*.mjs",
		],
		languageOptions: {
			ecmaVersion: "latest",
			sourceType: "module",
			parser: tsParser,
			parserOptions: {
				ecmaVersion: "latest",
				sourceType: "module",
			},
			globals: nodeGlobals,
		},
		plugins: { "@typescript-eslint": tsPlugin },
		rules: {
			"no-unused-vars": [
				"error",
				{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
			],
			"sonarjs/cognitive-complexity": ["error", 15],
			"sonarjs/no-duplicate-string": [
				"error",
				{
					threshold: 3,
					ignoreStrings: "artisan,container,distro,deb,alpine,arch",
				},
			],
			"unicorn/import-style": "off",
		},
	},
	{
		// All fs paths in src/ are constructed via join(cwd, ...) from trusted
		// internal sources, never user input — these rules produce 100% false
		// positives for this pattern and would hide real findings elsewhere.
		files: ["src/**/*.mjs", "bin/**/*.mjs", "templates/**/*.mjs"],
		rules: {
			"security/detect-non-literal-fs-filename": "off",
			"security/detect-object-injection": "off",
		},
	},
	{
		files: ["tests/**/*.mjs"],
		rules: {
			"sonarjs/cognitive-complexity": "off",
			"sonarjs/no-duplicate-string": "off",
			"sonarjs/pseudo-random": "off",
			"sonarjs/publicly-writable-directories": "off",
			"unicorn/consistent-function-scoping": "off",
			"unicorn/no-top-level-assignment-in-function": "off",
			"security/detect-child-process": "off",
			"security/detect-non-literal-fs-filename": "off",
			"security/detect-object-injection": "off",
			"no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
		},
	},
	{
		ignores: [
			"dist/**",
			"node_modules/**",
			"coverage/**",
			".jscpd-report/**",
			".review/**",
			".claude/**",
			"**/*.tmpl",
			"examples/**",
		],
	},
];
