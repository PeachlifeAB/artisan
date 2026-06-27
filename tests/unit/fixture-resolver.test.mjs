import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test, vi } from "vitest";
import { resolveConfigs } from "../../src/core/fixture-resolver.mjs";
import { useSandbox } from "./helpers/sandbox.mjs";

const ARTIFACT_NAME = "myapp";
const SINGLE_TOML = "./fixtures/single.toml";

const sandbox = useSandbox();

beforeEach(async () => {
	await mkdir(join(sandbox.directory, "fixtures", "myapp-config"), {
		recursive: true,
	});
	await writeFile(
		join(sandbox.directory, "fixtures", "myapp-config", "config.toml"),
		"[app]\nkey=value",
	);
	await writeFile(
		join(sandbox.directory, "fixtures", "single.toml"),
		"key=value",
	);
});

test("string file entry → XDG file target", async () => {
	const result = await resolveConfigs(
		[SINGLE_TOML],
		sandbox.directory,
		ARTIFACT_NAME,
	);
	expect(result).toHaveLength(1);
	expect(result[0].source).toBe(
		await realpath(join(sandbox.directory, "fixtures", "single.toml")),
	);
	expect(result[0].target).toBe("/root/.config/myapp/single.toml");
	expect(result[0].isDir).toBe(false);
});

test("string dir entry → XDG dir target", async () => {
	const result = await resolveConfigs(
		["./fixtures/myapp-config"],
		sandbox.directory,
		ARTIFACT_NAME,
	);
	expect(result[0].target).toBe("/root/.config/myapp");
	expect(result[0].isDir).toBe(true);
});

test("object entry with absolute dest → dest verbatim", async () => {
	const result = await resolveConfigs(
		[{ src: SINGLE_TOML, dest: "/etc/myapp/special.toml" }],
		sandbox.directory,
		ARTIFACT_NAME,
	);
	expect(result[0].target).toBe("/etc/myapp/special.toml");
});

test("custom xdgBase", async () => {
	const result = await resolveConfigs(
		[SINGLE_TOML],
		sandbox.directory,
		ARTIFACT_NAME,
		"/home/user/.config",
	);
	expect(result[0].target).toBe("/home/user/.config/myapp/single.toml");
});

test("~ prefix → UsageError", async () => {
	const { UsageError } = await import("../../src/utils/errors.mjs");
	await expect(
		resolveConfigs(["~/config"], sandbox.directory, ARTIFACT_NAME),
	).rejects.toThrow(UsageError);
});

test("absolute host path → UsageError", async () => {
	const { UsageError } = await import("../../src/utils/errors.mjs");
	await expect(
		resolveConfigs(["/etc/passwd"], sandbox.directory, ARTIFACT_NAME),
	).rejects.toThrow(UsageError);
});

test("../ escaping repo root → UsageError", async () => {
	const { UsageError } = await import("../../src/utils/errors.mjs");
	await expect(
		resolveConfigs(["../../etc/passwd"], sandbox.directory, ARTIFACT_NAME),
	).rejects.toThrow(UsageError);
});

test("missing src → UsageError", async () => {
	const { UsageError } = await import("../../src/utils/errors.mjs");
	await expect(
		resolveConfigs(
			["./fixtures/nonexistent.toml"],
			sandbox.directory,
			ARTIFACT_NAME,
		),
	).rejects.toThrow(UsageError);
});

test("object with relative dest → UsageError", async () => {
	const { UsageError } = await import("../../src/utils/errors.mjs");
	await expect(
		resolveConfigs(
			[{ src: SINGLE_TOML, dest: "relative/path" }],
			sandbox.directory,
			ARTIFACT_NAME,
		),
	).rejects.toThrow(UsageError);
});

test("empty configs array → empty result", async () => {
	const result = await resolveConfigs([], sandbox.directory, ARTIFACT_NAME);
	expect(result).toEqual([]);
});

test("non-missing fs errors are preserved", async () => {
	vi.resetModules();
	vi.doMock("fs/promises", () => ({
		realpath: vi.fn(async (path) => path),
		stat: vi.fn(async () => {
			const error = new Error("permission denied");
			error.code = "EACCES";
			throw error;
		}),
	}));
	try {
		const { resolveConfigs: resolveWithMockedFs } = await import(
			"../../src/core/fixture-resolver.mjs"
		);
		await expect(
			resolveWithMockedFs([SINGLE_TOML], sandbox.directory, ARTIFACT_NAME),
		).rejects.toMatchObject({
			code: "EACCES",
		});
	} finally {
		vi.doUnmock("fs/promises");
		vi.resetModules();
	}
});
