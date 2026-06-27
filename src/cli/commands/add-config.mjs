import { rm, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { readJsonConfig } from "../../core/config.mjs";
import { sanitizeConfigDirectory } from "../../core/sanitizer.mjs";
import { UsageError } from "../../utils/errors.mjs";
import { fileExists } from "../../utils/fs.mjs";
import { expandUserPath } from "../../utils/path.mjs";
import { validateSinglePathName } from "../../utils/validation.mjs";

export async function runAddConfig(options = {}) {
	const cwd = options._cwd ?? process.cwd();
	const source = options.source;
	if (!source) {
		throw new UsageError(
			"Usage: artisan add config <source> [--name <name>] [--raw] [--force]",
		);
	}

	const configPath = join(cwd, "artisan.config.json");
	const config = await readConfig(configPath);
	const sourcePath = expandUserPath(source, cwd);
	await assertSourceDirectory(sourcePath, source);

	const name = options.name ?? basename(sourcePath);
	validateSinglePathName(name, "fixture directory name");
	const fixturePath = join(cwd, "fixtures", name);

	if (!options.force && (await fileExists(fixturePath))) {
		console.log(
			`Skipped ${fixturePath} (already exists, use --force to overwrite)`,
		);
		return;
	}

	await rm(fixturePath, { recursive: true, force: true });
	const result = await sanitizeConfigDirectory(sourcePath, fixturePath, {
		raw: options.raw ?? false,
	});
	await appendToConfigs(configPath, config, `./fixtures/${name}`);

	console.log(`Created ${fixturePath}`);
	if (result.raw) {
		console.log("  copied: all entries (raw)");
	} else {
		console.log(`  copied: ${result.copied.length} entries`);
	}
	if (result.scrubbed.length > 0) {
		const preview = result.scrubbed.slice(0, 10).join(", ");
		const suffix = result.scrubbed.length > 10 ? "…" : "";
		console.log(`  scrubbed (${result.scrubbed.length}): ${preview}${suffix}`);
	}
	if (result.manifestPath) console.log(`  manifest: ${result.manifestPath}`);
	if (result.raw)
		console.warn(
			`  ⚠️  --raw: secrets NOT scrubbed. Review ${fixturePath} before committing.`,
		);
}

async function assertSourceDirectory(sourcePath, displaySource) {
	let sourceStat;
	try {
		sourceStat = await stat(sourcePath);
	} catch {
		throw new UsageError(
			`config source "${displaySource}" not found at ${sourcePath}`,
		);
	}

	if (!sourceStat.isDirectory()) {
		throw new UsageError(
			`config source "${displaySource}" must be a directory`,
		);
	}
}

async function readConfig(configPath) {
	return readJsonConfig(configPath);
}

async function appendToConfigs(configPath, config, entry) {
	if (config.configs !== undefined && !Array.isArray(config.configs)) {
		throw new UsageError('"configs" in artisan.config.json must be an array');
	}
	config.configs ??= [];
	if (!config.configs.includes(entry)) config.configs.push(entry);
	await writeFile(
		configPath,
		`${JSON.stringify(config, undefined, 2)}\n`,
		"utf8",
	);
}
