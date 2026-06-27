import { chmod, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { resolveArtifact } from "../../src/core/artifact-manager.mjs";
import { UsageError } from "../../src/utils/errors.mjs";
import { useSandbox } from "./helpers/sandbox.mjs";

const SHEBANG = "#!/bin/sh\necho 1.0.0";

const sandbox = useSandbox();

async function makeExe(name = "mycli") {
	const bin = join(sandbox.directory, name);
	await writeFile(bin, SHEBANG);
	await chmod(bin, 0o755);
	return bin;
}

test("resolves absolute path to existing executable", async () => {
	const bin = await makeExe();
	const resolved = await resolveArtifact(bin, sandbox.directory);
	expect(resolved).toBe(bin);
});

test("resolves relative path relative to cwd", async () => {
	const bin = await makeExe();
	const resolved = await resolveArtifact("./mycli", sandbox.directory);
	expect(resolved).toBe(bin);
});

test("auto-discovers a package.json bin executable for zero-config tests", async () => {
	const bin = join(sandbox.directory, "cli.mjs");
	await writeFile(bin, "#!/usr/bin/env node\nconsole.log('1.0.0')");
	await chmod(bin, 0o755);
	await writeFile(
		join(sandbox.directory, "package.json"),
		JSON.stringify({ bin: { mycli: "./cli.mjs" } }),
	);
	expect(await resolveArtifact("", sandbox.directory)).toBe(bin);
});

test("auto-discovers one executable in dist", async () => {
	const distribution = join(sandbox.directory, "dist");
	const bin = join(distribution, "mycli");
	await mkdir(distribution);
	await writeFile(bin, SHEBANG);
	await chmod(bin, 0o755);
	expect(await resolveArtifact(undefined, sandbox.directory)).toBe(bin);
});

test("throws UsageError when zero-config artifact discovery finds no executable", async () => {
	await expect(resolveArtifact("", sandbox.directory)).rejects.toThrow(
		UsageError,
	);
});

test("throws UsageError when package.json is invalid during auto-discovery", async () => {
	await writeFile(join(sandbox.directory, "package.json"), "{");
	await expect(resolveArtifact("", sandbox.directory)).rejects.toThrow(
		"package.json contains invalid JSON",
	);
});

test("throws UsageError when zero-config artifact discovery is ambiguous", async () => {
	const distribution = join(sandbox.directory, "dist");
	await mkdir(distribution);
	const first = join(distribution, "first");
	const second = join(distribution, "second");
	await writeFile(first, "#!/bin/sh\necho first");
	await writeFile(second, "#!/bin/sh\necho second");
	await chmod(first, 0o755);
	await chmod(second, 0o755);
	await expect(resolveArtifact("", sandbox.directory)).rejects.toThrow(
		UsageError,
	);
});

test("throws UsageError when file does not exist", async () => {
	await expect(
		resolveArtifact("./nonexistent", sandbox.directory),
	).rejects.toThrow(UsageError);
});

test("throws UsageError when artifact path is a directory", async () => {
	await expect(resolveArtifact(".", sandbox.directory)).rejects.toThrow(
		UsageError,
	);
});

test("throws UsageError when file exists but is not executable", async () => {
	const bin = join(sandbox.directory, "notexec");
	await writeFile(bin, SHEBANG);
	await chmod(bin, 0o644);
	await expect(resolveArtifact(bin, sandbox.directory)).rejects.toThrow(
		UsageError,
	);
});
