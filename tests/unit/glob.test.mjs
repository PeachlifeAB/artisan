import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { resolveTestFiles } from "../../src/utils/glob.mjs";
import { useSandbox } from "./helpers/sandbox.mjs";

const sandbox = useSandbox();

beforeEach(async () => {
	await mkdir(join(sandbox.directory, "tests"), { recursive: true });
	await writeFile(
		join(sandbox.directory, "tests", "version.artisan.test.mjs"),
		"",
	);
	await writeFile(
		join(sandbox.directory, "tests", "help.artisan.test.mjs"),
		"",
	);
	await writeFile(join(sandbox.directory, "tests", "ignore.test.js"), "");
});

test("resolves artisan test files matching glob", async () => {
	const files = await resolveTestFiles(
		"**/*.artisan.test.mjs",
		sandbox.directory,
	);
	expect(files).toHaveLength(2);
	expect(files.every((f) => f.endsWith(".artisan.test.mjs"))).toBe(true);
});

test("returns empty array when no files match", async () => {
	const files = await resolveTestFiles(
		"**/*.artisan.test.mjs",
		join(sandbox.directory, "nonexistent-dir-12345"),
	);
	expect(files).toEqual([]);
});
