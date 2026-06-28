import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { loadConfig, mergeConfigWithFlags } from "../../src/core/config.mjs";
import { UsageError } from "../../src/utils/errors.mjs";
import { useSandbox } from "./helpers/sandbox.mjs";

const CONFIG_PATH = "artisan.config.json";
const TEST_MATCH = "**/*.artisan.test.mjs";
const ALPINE = "alpine:3";
const DEBIAN = "debian:bookworm-slim";
const FIXTURES_CFG = "./fixtures/cfg";

const sandbox = useSandbox();

async function writeConfig(payload) {
	await writeFile(
		join(sandbox.directory, CONFIG_PATH),
		JSON.stringify(payload),
	);
}

async function expectConfigError(payload, message) {
	await writeConfig(payload);
	await expect(loadConfig(sandbox.directory)).rejects.toThrow(
		message ?? UsageError,
	);
}

describe("loadConfig", () => {
	test("returns zero-config defaults when no config file exists", async () => {
		await writeFile(
			join(sandbox.directory, "package.json"),
			JSON.stringify({ name: "test" }),
		);
		const config = await loadConfig(sandbox.directory);
		expect(config.artifact).toBe("");
		expect(config.testMatch).toBe(TEST_MATCH);
		expect(config.timeout).toBeUndefined();
		expect(config.parallel).toBe(true);
		expect(config.reporter).toBe("default");
		expect(config.distros).toEqual([ALPINE, DEBIAN]);
		expect(config.setup).toEqual({});
	});

	test("reads and merges artisan.config.json", async () => {
		await writeConfig({
			artifact: "./dist/mycli",
			distros: [ALPINE],
			timeout: 5000,
		});
		const config = await loadConfig(sandbox.directory);
		expect(config.artifact).toBe("./dist/mycli");
		expect(config.distros).toEqual([ALPINE]);
		expect(config.timeout).toBe(5000);
		expect(config.parallel).toBe(true);
	});

	test("throws UsageError for invalid JSON", async () => {
		await writeFile(join(sandbox.directory, CONFIG_PATH), "not json");
		await expect(loadConfig(sandbox.directory)).rejects.toThrow(UsageError);
	});

	test("rejects non-object config payloads", async () => {
		for (const payload of ["[]", "42", "null"]) {
			await writeFile(join(sandbox.directory, CONFIG_PATH), payload);
			await expect(loadConfig(sandbox.directory)).rejects.toThrow(UsageError);
		}
	});

	test("rethrows non-missing config read errors", async () => {
		await mkdir(join(sandbox.directory, CONFIG_PATH), { recursive: true });
		await expect(loadConfig(sandbox.directory)).rejects.toThrow();
	});
});

describe("mergeConfigWithFlags", () => {
	const baseConfig = {
		artifact: "./old",
		distros: [ALPINE],
		timeout: 30_000,
		parallel: true,
		setup: {},
		testMatch: TEST_MATCH,
		reporter: "default",
	};

	test("flags override config values", () => {
		const merged = mergeConfigWithFlags(baseConfig, {
			artifact: "./new",
			distros: [DEBIAN],
		});
		expect(merged.artifact).toBe("./new");
		expect(merged.distros).toEqual([DEBIAN]);
		expect(merged.timeout).toBe(30_000);
	});

	test("undefined flags do not override", () => {
		const config = { ...baseConfig, artifact: "./cli" };
		const merged = mergeConfigWithFlags(config, { artifact: undefined });
		expect(merged.artifact).toBe("./cli");
	});
});

describe("configs schema", () => {
	test("defaults configs to []", async () => {
		await writeFile(
			join(sandbox.directory, "package.json"),
			JSON.stringify({ name: "test" }),
		);
		const config = await loadConfig(sandbox.directory);
		expect(config.configs).toEqual([]);
	});

	test("accepts valid string entry", async () => {
		await writeConfig({
			artifact: "./cli",
			distros: [],
			configs: [FIXTURES_CFG],
		});
		const config = await loadConfig(sandbox.directory);
		expect(config.configs).toEqual([FIXTURES_CFG]);
	});

	test("accepts valid object entry", async () => {
		await writeConfig({ configs: [{ src: FIXTURES_CFG, dest: "/etc/app" }] });
		const config = await loadConfig(sandbox.directory);
		expect(config.configs[0]).toEqual({ src: FIXTURES_CFG, dest: "/etc/app" });
	});

	test("rejects configs not an array", () =>
		expectConfigError({ configs: FIXTURES_CFG }));

	test("rejects object entry missing src", () =>
		expectConfigError({ configs: [{ dest: "/etc/app" }] }));

	test("rejects object entry missing dest", () =>
		expectConfigError({ configs: [{ src: FIXTURES_CFG }] }));

	test("rejects blank string config entry", () =>
		expectConfigError({ configs: [""] }));

	test("rejects non-string object fields", () =>
		expectConfigError({ configs: [{ src: 42, dest: "/etc/app" }] }));

	test("rejects blank object dest", () =>
		expectConfigError({ configs: [{ src: FIXTURES_CFG, dest: " " }] }));

	test("rejects entry that is not string or object", () =>
		expectConfigError({ configs: [42] }));
});

describe("artifact path validation", () => {
	test("rejects absolute artifact path", () =>
		expectConfigError({ artifact: "/usr/local/bin/mycli" }, "repo-relative"));

	test("rejects home-relative artifact path", () =>
		expectConfigError({ artifact: "~/bin/mycli" }, "repo-relative"));

	test("accepts relative artifact path", async () => {
		await writeConfig({ artifact: "./bin/mycli" });
		await expect(loadConfig(sandbox.directory)).resolves.toMatchObject({
			artifact: "./bin/mycli",
		});
	});

	test("accepts bare relative artifact path", async () => {
		await writeConfig({ artifact: "bin/mycli" });
		await expect(loadConfig(sandbox.directory)).resolves.toMatchObject({
			artifact: "bin/mycli",
		});
	});

	test("throws when no config and no package.json in cwd", async () => {
		const emptyDirectory = join(sandbox.directory, "empty-subdir");
		await mkdir(emptyDirectory);
		await expect(loadConfig(emptyDirectory)).rejects.toThrow("project root");
	});
});

describe("artifacts schema", () => {
	test("defaults artifacts to []", async () => {
		await writeFile(
			join(sandbox.directory, "package.json"),
			JSON.stringify({ name: "test" }),
		);
		const config = await loadConfig(sandbox.directory);
		expect(config.artifacts).toEqual([]);
	});

	test("accepts valid artifacts array", async () => {
		await writeConfig({
			artifacts: [
				{ testMatch: "tests/a.test.mjs", artifact: "./bin/a" },
				{ testMatch: "tests/b.test.mjs", artifact: "./bin/b" },
			],
		});
		const config = await loadConfig(sandbox.directory);
		expect(config.artifacts).toHaveLength(2);
		expect(config.artifacts[0]).toEqual({
			testMatch: "tests/a.test.mjs",
			artifact: "./bin/a",
		});
	});

	test("rejects artifacts not an array", () =>
		expectConfigError({ artifacts: "./bin/a" }, "artifacts"));

	test("rejects artifacts entry missing testMatch", () =>
		expectConfigError({ artifacts: [{ artifact: "./bin/a" }] }, "testMatch"));

	test("rejects artifacts entry missing artifact", () =>
		expectConfigError(
			{ artifacts: [{ testMatch: "tests/a.test.mjs" }] },
			"artifact",
		));

	test("rejects artifacts entry with blank testMatch", () =>
		expectConfigError(
			{ artifacts: [{ testMatch: "", artifact: "./bin/a" }] },
			"testMatch",
		));

	test("rejects artifacts entry with blank artifact", () =>
		expectConfigError(
			{ artifacts: [{ testMatch: "tests/a.test.mjs", artifact: "" }] },
			"artifact",
		));

	test("rejects artifacts entry with absolute artifact path", () =>
		expectConfigError(
			{
				artifacts: [
					{ testMatch: "tests/a.test.mjs", artifact: "/usr/local/bin/a" },
				],
			},
			"repo-relative",
		));

	test("rejects artifacts entry that is not an object", () =>
		expectConfigError({ artifacts: ["./bin/a"] }, "artifacts"));
});

describe("field validation", () => {
	test("rejects non-array distros", () =>
		expectConfigError({ distros: "alpine" }, "distros"));

	test("accepts zero timeout (no cap)", async () => {
		await writeConfig({ timeout: 0 });
		const config = await loadConfig(sandbox.directory);
		expect(config.timeout).toBe(0);
	});

	test("rejects negative timeout", () =>
		expectConfigError({ timeout: -1 }, "timeout"));

	test("rejects non-number timeout", () =>
		expectConfigError({ timeout: "fast" }, "timeout"));

	test("rejects non-boolean parallel", () =>
		expectConfigError({ parallel: "yes" }, "parallel"));

	test("rejects malformed setup", () =>
		expectConfigError({ setup: [] }, "setup"));
});
