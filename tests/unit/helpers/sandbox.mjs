import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach } from "vitest";

async function createSandbox() {
	const directory = join(
		tmpdir(),
		`artisan-test-${Date.now()}-${Math.random().toString(16).slice(2)}`,
	);
	await mkdir(directory, { recursive: true });
	return directory;
}

async function cleanSandbox(directory) {
	await rm(directory, { recursive: true, force: true });
}

export function useSandbox() {
	let directory;

	beforeEach(async () => {
		directory = await createSandbox();
	});

	afterEach(async () => {
		await cleanSandbox(directory);
	});

	return {
		get directory() {
			return directory;
		},
	};
}

export function useSandboxAsCwd() {
	const sandbox = useSandbox();
	let originalCwd;

	beforeEach(() => {
		originalCwd = process.cwd();
		process.chdir(sandbox.directory);
	});

	afterEach(() => {
		process.chdir(originalCwd);
	});

	return sandbox;
}
