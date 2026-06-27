import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["**/*.artisan.test.mjs"],
		exclude: ["**/node_modules/**", "**/.review/**"],
		testTimeout: 300_000,
	},
});
