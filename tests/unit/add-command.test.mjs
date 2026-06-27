import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, test } from "vitest";
import { runAdd } from "../../src/cli/commands/add.mjs";
import { runAddConfig } from "../../src/cli/commands/add-config.mjs";
import { UsageError } from "../../src/utils/errors.mjs";
import { captureConsoleLog } from "./helpers/logs.mjs";
import { useSandboxAsCwd } from "./helpers/sandbox.mjs";

const TESTS_DIR = "./tests/";
const CONFIG_TOML = "config.toml";
const MYAPP_CONFIG = "myapp-config";
const MYAPP_FIXTURE = `./fixtures/${MYAPP_CONFIG}`;

const sandbox = useSandboxAsCwd();

test("artisan add version creates tests/cli-version.artisan.test.mjs", async () => {
	await runAdd("version", { dir: TESTS_DIR });
	await expect(
		access(join(sandbox.directory, "tests", "cli-version.artisan.test.mjs")),
	).resolves.toBeUndefined();
});

test("artisan add help creates tests/cli-help.artisan.test.mjs", async () => {
	await runAdd("help", { dir: TESTS_DIR });
	await expect(
		access(join(sandbox.directory, "tests", "cli-help.artisan.test.mjs")),
	).resolves.toBeUndefined();
});

test("artisan add custom --name json-formatting creates named file", async () => {
	await runAdd("custom", { dir: TESTS_DIR, name: "json-formatting" });
	await expect(
		access(
			join(sandbox.directory, "tests", "json-formatting.artisan.test.mjs"),
		),
	).resolves.toBeUndefined();
});

test("artisan add custom rejects path traversal names", async () => {
	await expect(
		runAdd("custom", { dir: TESTS_DIR, name: "../outside" }),
	).rejects.toThrow(UsageError);
	await expect(
		access(join(sandbox.directory, "outside.artisan.test.mjs")),
	).rejects.toThrow();
});

test("throws UsageError for unknown type", async () => {
	await expect(runAdd("unknown", {})).rejects.toThrow(UsageError);
});

describe("artisan add config", () => {
	const ARTISAN_CONFIG = "artisan.config.json";
	let configDirectory;

	async function readArtisanConfig() {
		return JSON.parse(
			await readFile(join(sandbox.directory, ARTISAN_CONFIG), "utf8"),
		);
	}

	beforeEach(async () => {
		configDirectory = join(sandbox.directory, MYAPP_CONFIG);
		await mkdir(configDirectory, { recursive: true });
		await writeFile(join(configDirectory, CONFIG_TOML), "[app]");
		await writeFile(
			join(sandbox.directory, ARTISAN_CONFIG),
			JSON.stringify({ configs: [] }, undefined, 2),
		);
	});

	test("creates fixtures/<name>/ from src dir", async () => {
		await runAddConfig({ source: configDirectory, _cwd: sandbox.directory });
		await expect(
			access(join(sandbox.directory, "fixtures", MYAPP_CONFIG, CONFIG_TOML)),
		).resolves.toBeUndefined();
	});

	test("--name overrides fixture dir name", async () => {
		await runAddConfig({
			source: configDirectory,
			name: "custom-name",
			_cwd: sandbox.directory,
		});
		await expect(
			access(join(sandbox.directory, "fixtures", "custom-name", CONFIG_TOML)),
		).resolves.toBeUndefined();
	});

	test("appends ./fixtures/<name> to artisan.config.json configs", async () => {
		await runAddConfig({ source: configDirectory, _cwd: sandbox.directory });
		const config = await readArtisanConfig();
		expect(config.configs).toContain(MYAPP_FIXTURE);
	});

	test("deduplicates configs entry on re-run", async () => {
		await runAddConfig({ source: configDirectory, _cwd: sandbox.directory });
		await runAddConfig({
			source: configDirectory,
			force: true,
			_cwd: sandbox.directory,
		});
		const config = await readArtisanConfig();
		expect(
			config.configs.filter((entry) => entry === MYAPP_FIXTURE),
		).toHaveLength(1);
	});

	test("--raw skips sanitization", async () => {
		const rawEnvironment = "SECRET=[REDACTED:API key param]";
		await writeFile(join(configDirectory, ".env"), rawEnvironment);
		await runAddConfig({
			source: configDirectory,
			raw: true,
			_cwd: sandbox.directory,
		});
		expect(
			await readFile(
				join(sandbox.directory, "fixtures", MYAPP_CONFIG, ".env"),
				"utf8",
			),
		).toBe(rawEnvironment);
	});

	test("skips existing fixture without --force", async () => {
		await runAddConfig({ source: configDirectory, _cwd: sandbox.directory });
		const logs = await captureConsoleLog(() =>
			runAddConfig({ source: configDirectory, _cwd: sandbox.directory }),
		);
		expect(logs.some((line) => line.includes("Skipped"))).toBe(true);
	});

	test("throws UsageError when src missing", async () => {
		await expect(runAddConfig({ _cwd: sandbox.directory })).rejects.toThrow(
			UsageError,
		);
	});

	test("throws UsageError without creating fixtures when artisan.config.json missing", async () => {
		const emptyDirectory = join(sandbox.directory, "empty");
		await mkdir(emptyDirectory, { recursive: true });
		await expect(
			runAddConfig({ source: configDirectory, _cwd: emptyDirectory }),
		).rejects.toThrow(UsageError);
		await expect(
			access(join(emptyDirectory, "fixtures", MYAPP_CONFIG)),
		).rejects.toThrow();
	});

	test("throws UsageError without creating fixture when src is missing", async () => {
		await expect(
			runAddConfig({ source: "./missing", _cwd: sandbox.directory }),
		).rejects.toThrow(UsageError);
		await expect(
			access(join(sandbox.directory, "fixtures", "missing")),
		).rejects.toThrow();
	});

	test("rejects --name path traversal without writing outside fixtures", async () => {
		await expect(
			runAddConfig({
				source: configDirectory,
				name: "../outside",
				_cwd: sandbox.directory,
			}),
		).rejects.toThrow(UsageError);
		await expect(access(join(sandbox.directory, "outside"))).rejects.toThrow();
	});
});
