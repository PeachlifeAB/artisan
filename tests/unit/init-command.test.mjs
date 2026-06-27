import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { runInit } from "../../src/cli/commands/init.mjs";
import { UsageError } from "../../src/utils/errors.mjs";
import { captureConsoleLog } from "./helpers/logs.mjs";
import { useSandboxAsCwd } from "./helpers/sandbox.mjs";

const ALPINE = "alpine:latest";
const CONFIG_JSON = "artisan.config.json";

const sandbox = useSandboxAsCwd();

async function readConfigJson() {
	return JSON.parse(
		await readFile(join(sandbox.directory, CONFIG_JSON), "utf8"),
	);
}

test("creates artisan.config.json with headless -y flag", async () => {
	await runInit({ yes: true, distros: ALPINE });
	const config = await readConfigJson();
	expect(config.distros).toContain(ALPINE);
});

test("trims init distros and drops blank entries", async () => {
	await runInit({
		yes: true,
		distros: "alpine:latest, debian:stable-slim, ",
	});
	const config = await readConfigJson();
	expect(config.distros).toEqual([ALPINE, "debian:stable-slim"]);
});

test("rejects blank init distros", async () => {
	await expect(runInit({ yes: true, distros: " , " })).rejects.toThrow(
		UsageError,
	);
});

test("rejects non-string init distros", async () => {
	await expect(runInit({ yes: true, distros: [ALPINE] })).rejects.toThrow(
		UsageError,
	);
});

test("creates starter test file", async () => {
	await runInit({ yes: true, distros: ALPINE });
	await expect(
		access(
			join(
				sandbox.directory,
				"tests",
				"artisan",
				"cli-version.artisan.test.mjs",
			),
		),
	).resolves.toBeUndefined();
});

test("outputs Created messages to stdout", async () => {
	const logs = await captureConsoleLog(() =>
		runInit({ yes: true, distros: ALPINE }),
	);
	expect(logs.some((l) => l.includes(CONFIG_JSON))).toBe(true);
	expect(logs.some((l) => l.includes("cli-version.artisan.test.mjs"))).toBe(
		true,
	);
});

test("does not overwrite existing files without --force", async () => {
	await runInit({ yes: true, distros: ALPINE });
	const first = await readFile(join(sandbox.directory, CONFIG_JSON), "utf8");
	await runInit({ yes: true, distros: "debian:stable-slim" });
	const second = await readFile(join(sandbox.directory, CONFIG_JSON), "utf8");
	expect(first).toBe(second);
});
