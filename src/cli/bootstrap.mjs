import { readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { DEFAULT_DISTROS } from "../core/constants.mjs";
import { UsageError } from "../utils/errors.mjs";
import { fileExists } from "../utils/fs.mjs";
import {
	readTemplate,
	renderTemplate,
	resolveTemplatesDirectory,
} from "../utils/template.mjs";

// Packages a bootstrapped project must be able to resolve. Artisan re-exports
// vitest primitives and spawns the vitest CLI, so the consumer must own a single
// shared vitest instance (declared as a peer in package.json).
const ARTISAN_PACKAGE = "@peachlife/artisan";
const VITEST_PACKAGE = "vitest";
const VITEST_PEER_RANGE = "^4.0.0";

const TEMPLATES_DIR = resolveTemplatesDirectory(
	import.meta.url,
	"../../templates",
);

const __dirname = dirname(fileURLToPath(import.meta.url));
// The bootstrapping Artisan knows its own version; pin the consumer devDep to it.
const artisanVersion = JSON.parse(
	readFileSync(join(__dirname, "../../package.json"), "utf8"),
).version;

/**
 * Detect whether a project already has an Artisan config. A project counts as
 * bootstrapped once artisan.config.json exists.
 */
export async function detectBootstrapState(cwd = process.cwd()) {
	return { hasConfig: await fileExists(join(cwd, "artisan.config.json")) };
}

/**
 * Detect the package manager from lockfile presence.
 * Order: bun > pnpm > yarn > npm (npm is the default fallback).
 */
export async function detectPackageManager(cwd = process.cwd()) {
	if (await fileExists(join(cwd, "bun.lock"))) return "bun";
	if (await fileExists(join(cwd, "bun.lockb"))) return "bun";
	if (await fileExists(join(cwd, "pnpm-lock.yaml"))) return "pnpm";
	if (await fileExists(join(cwd, "yarn.lock"))) return "yarn";
	return "npm";
}

/**
 * Merge entries into a project's devDependencies, creating package.json if absent.
 * Fails fast on unparseable JSON instead of clobbering the user's manifest.
 */
export async function addDevelopmentDependencies(cwd, dependencies) {
	const packagePath = join(cwd, "package.json");
	let package_ = {};
	if (await fileExists(packagePath)) {
		const raw = await readFile(packagePath, "utf8");
		try {
			package_ = JSON.parse(raw);
		} catch {
			throw new UsageError(
				`Cannot parse ${packagePath}; fix its JSON before bootstrapping.`,
			);
		}
	}
	package_.devDependencies = { ...package_.devDependencies, ...dependencies };
	await writeFile(
		packagePath,
		`${JSON.stringify(package_, undefined, 2)}\n`,
		"utf8",
	);
}

/**
 * Run the package manager's install command in a directory.
 */
export async function runInstall({ cwd, packageManager }) {
	await execa(packageManager, ["install"], {
		cwd,
		stdio: "inherit",
		reject: true,
	});
}

export function parseDistros(distrosRaw) {
	if (typeof distrosRaw !== "string") {
		throw new UsageError("Distros must be a comma-separated string");
	}
	const distros = distrosRaw
		.split(",")
		.map((d) => d.trim())
		.filter(Boolean);
	if (distros.length === 0) {
		throw new UsageError("At least one distro is required");
	}
	return distros;
}

async function writeConfig({ cwd, distros, force }) {
	const configPath = join(cwd, "artisan.config.json");
	if (!force && (await fileExists(configPath))) {
		console.log(
			"Skipped artisan.config.json (already exists, use --force to overwrite)",
		);
		return;
	}
	const tmpl = await readTemplate(TEMPLATES_DIR, "config.json.tmpl");
	const distrosJson = distros.map((d) => JSON.stringify(d)).join(", ");
	const content = renderTemplate(tmpl, { DISTROS: distrosJson });
	await writeFile(configPath, content, "utf8");
	console.log("Created artisan.config.json");
}

async function writeStarterTest({ cwd, force }) {
	const testsDirectory = join(cwd, "tests/artisan");
	await mkdir(testsDirectory, { recursive: true });
	const testPath = join(testsDirectory, "cli-version.artisan.test.mjs");
	if (!force && (await fileExists(testPath))) {
		console.log(
			"Skipped tests/artisan/cli-version.artisan.test.mjs (already exists)",
		);
		return;
	}
	const tmpl = await readTemplate(TEMPLATES_DIR, "tests/version.test.mjs.tmpl");
	await writeFile(testPath, tmpl, "utf8");
	console.log("Created ./tests/artisan/cli-version.artisan.test.mjs");
}

async function installDependencies({ cwd, installer }) {
	await addDevelopmentDependencies(cwd, {
		[ARTISAN_PACKAGE]: `^${artisanVersion}`,
		[VITEST_PACKAGE]: VITEST_PEER_RANGE,
	});
	const packageManager = await detectPackageManager(cwd);
	console.log(`Installing dependencies with ${packageManager}...`);
	await installer({ cwd, packageManager });
	console.log(`Installed dependencies with ${packageManager}`);
}

/**
 * Scaffold Artisan into a project: config, starter test, and (optionally)
 * devDependency install. Shared by `init` and the first-run `test` gate.
 *
 * Defaults to NO install so the pure function is side-effect free; the CLI
 * layer opts into installing for the user-facing commands.
 */
export async function bootstrapProject({
	cwd = process.cwd(),
	distros = DEFAULT_DISTROS.join(","),
	force = false,
	install = false,
	installer = runInstall,
} = {}) {
	const distroList = parseDistros(distros);
	await writeConfig({ cwd, distros: distroList, force });
	await writeStarterTest({ cwd, force });
	if (install) {
		await installDependencies({ cwd, installer });
	}
}

/**
 * True when stdin is a TTY and no CI runner is detected.
 */
export function isInteractive() {
	return process.stdin.isTTY === true && !process.env.CI;
}

/**
 * Ask the user a yes/no bootstrap question. Defaults to yes on empty input.
 * input/output are injectable for tests.
 */
export async function promptBootstrap({
	input = process.stdin,
	output = process.stdout,
} = {}) {
	const rl = createInterface({ input, output, terminal: false });
	try {
		const answer = await rl.question("Bootstrap? [Y/n] ");
		const value = answer.trim().toLowerCase();
		return ["", "y", "yes"].includes(value);
	} finally {
		rl.close();
	}
}

/**
 * Resolve the three-state bootstrap decision from parsed CLI options.
 * Returns "always" | "never" | "ask".
 */
export function resolveBootstrapDecision(options) {
	if (options.bootstrap === true) return "always";
	if (options.bootstrap === false) return "never";
	return "ask";
}
