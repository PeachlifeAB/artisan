import { mkdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, expect, test } from "vitest";
import { sanitizeConfigDirectory } from "../../src/core/sanitizer.mjs";
import { useSandbox } from "./helpers/sandbox.mjs";

const SCRUBBED_CONTENT = "SECRET=[REDACTED:API key param]";
const CONFIG_TOML = "config.toml";

const sandbox = useSandbox();

let sourceDirectory, destinationDirectory;

beforeEach(async () => {
	sourceDirectory = join(sandbox.directory, "src");
	destinationDirectory = join(sandbox.directory, "dest");
	await mkdir(sourceDirectory, { recursive: true });
	await mkdir(destinationDirectory, { recursive: true });
});

async function write(relativePath, content = "data") {
	const fullPath = join(sourceDirectory, relativePath);
	await mkdir(join(fullPath, ".."), { recursive: true });
	await writeFile(fullPath, content);
}

function sanitize(options) {
	return sanitizeConfigDirectory(
		sourceDirectory,
		destinationDirectory,
		options,
	);
}

test("copies safe files", async () => {
	await write(CONFIG_TOML);
	await write("themes/dark.toml");

	const { copied, scrubbed } = await sanitize();

	expect(copied).toContain(CONFIG_TOML);
	expect(copied).toContain("themes/dark.toml");
	expect(scrubbed).toHaveLength(0);
});

test("scrubs .env", async () => {
	await write(".env", SCRUBBED_CONTENT);
	await write(CONFIG_TOML);

	const { scrubbed, copied } = await sanitize();

	expect(scrubbed).toContain(".env");
	expect(copied).not.toContain(".env");
});

test("scrubs credentials file", async () => {
	await write("credentials", "token=[REDACTED:API key param]");
	const { scrubbed } = await sanitize();
	expect(scrubbed).toContain("credentials");
});

test("scrubs *.token files", async () => {
	await write("auth.token", "abc");
	const { scrubbed } = await sanitize();
	expect(scrubbed).toContain("auth.token");
});

test("scrubs id_ed25519 (id_ prefix)", async () => {
	await write("id_ed25519", "key");
	const { scrubbed } = await sanitize();
	expect(scrubbed).toContain("id_ed25519");
});

test("scrubs temp/ directory", async () => {
	await write("temp/file.txt");
	const { scrubbed } = await sanitize();
	expect(scrubbed).toContain("temp");
});

test("scrubs backup/ directory", async () => {
	await write("backup/old.toml");
	const { scrubbed } = await sanitize();
	expect(scrubbed).toContain("backup");
});

test("scrubs cache/ directory", async () => {
	await write("cache/data.bin");
	const { scrubbed } = await sanitize();
	expect(scrubbed).toContain("cache");
});

test("scrubs at any depth", async () => {
	await write("subdir/.env", SCRUBBED_CONTENT);
	await write("subdir/config.toml");

	const { scrubbed, copied } = await sanitize();

	expect(scrubbed).toContain("subdir/.env");
	expect(copied).toContain("subdir/config.toml");
});

test("scrubs safe-looking symlinks", async () => {
	await write("outside-secret", "TOKEN=secret");
	await symlink(
		join(sourceDirectory, "outside-secret"),
		join(sourceDirectory, CONFIG_TOML),
	);

	const { scrubbed, copied } = await sanitize();

	expect(scrubbed).toContain(CONFIG_TOML);
	expect(copied).not.toContain(CONFIG_TOML);
});

test("writes .sanitized manifest with scrubbed list", async () => {
	await write(".env");
	await write(CONFIG_TOML);

	const { manifestPath, scrubbed } = await sanitize();

	expect(manifestPath).toBe(`${destinationDirectory}.artisan-sanitized`);
	const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
	expect(manifest.scrubbed).toEqual(scrubbed);
	expect(manifest.scaffoldedFrom).toBe("src");
	expect(manifest.note).toBe("Re-scaffold with: artisan add config <source>");
	expect(JSON.stringify(manifest)).not.toContain(sourceDirectory);
});

test("--raw copies verbatim, no manifest", async () => {
	await write(".env", SCRUBBED_CONTENT);
	await write(CONFIG_TOML);

	const { raw, manifestPath } = await sanitize({ raw: true });

	expect(raw).toBe(true);
	expect(manifestPath).toBeUndefined();
	await expect(stat(join(destinationDirectory, ".env"))).resolves.toBeDefined();
});
