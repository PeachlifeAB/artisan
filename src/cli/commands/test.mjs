import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { resolveArtifact } from "../../core/artifact-manager.mjs";
import { loadConfig, mergeConfigWithFlags } from "../../core/config.mjs";
import { DEFAULT_XDG_CONFIG_HOME } from "../../core/constants.mjs";
import { resolveConfigs } from "../../core/fixture-resolver.mjs";
import { DockerError, UsageError } from "../../utils/errors.mjs";
import { resolveTestFiles } from "../../utils/glob.mjs";
import {
	bootstrapProject,
	detectBootstrapState,
	isInteractive,
	parseDistros,
	promptBootstrap,
	resolveBootstrapDecision,
} from "../bootstrap.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const artisanVitestConfig = join(
	__dirname,
	"../../../templates/vitest-artisan.config.mjs",
);

function resolveTimeout(timeout) {
	if (timeout === 0) return String(Number.MAX_SAFE_INTEGER);
	if (timeout) return String(timeout);
}

async function ensureDockerAvailable() {
	try {
		const result = await execa("docker", ["info"], {
			stdio: "pipe",
			reject: false,
		});
		if (result.exitCode === 0) return;
		throw new DockerError(
			`Docker is not running. Start Docker and retry.\n${result.stderr || result.stdout}`,
		);
	} catch (error) {
		if (error instanceof DockerError) throw error;
		if (error instanceof Error && error.code === "ENOENT") {
			throw new DockerError(
				"Docker is not installed.\nInstall it from https://docs.docker.com/engine/install/ and retry.",
			);
		}
		const message =
			error instanceof Error ? error.message : String(error ?? "unknown error");
		throw new DockerError(`Docker is not available.\n${message}`);
	}
}

function buildVitestArguments({ options, merged, testFiles }) {
	const configArguments = ["--config", artisanVitestConfig];
	const vitestArguments = options.watch
		? ["--watch", ...configArguments, ...testFiles]
		: ["run", ...configArguments, ...testFiles];
	let testNamePattern;
	if (options.testName) {
		testNamePattern = options.invert
			? `^(?!.*(?:${options.testName})).*$`
			: options.testName;
	}
	const flagRules = [
		{
			flag: "--reporter",
			value: merged.reporter === "default" ? undefined : merged.reporter,
		},
		{
			flag: "--testTimeout",
			value: resolveTimeout(merged.timeout),
		},
		{ flag: "--testNamePattern", value: testNamePattern },
		{ flag: "--bail", value: options.bail, boolean: true },
		{
			flag: "--retry",
			value:
				options.retries === undefined ? undefined : String(options.retries),
		},
	];
	for (const { flag, value, boolean = false } of flagRules) {
		if (!value) continue;
		vitestArguments.push(flag);
		if (!boolean) vitestArguments.push(value);
	}
	if (options.verbose) vitestArguments.push("--reporter", "verbose");
	return vitestArguments;
}

function printBootstrapPlan() {
	console.log("No Artisan setup found.\n");
	console.log("Bootstrap this project now? This will:");
	console.log("  - add @peachlife/artisan and vitest to devDependencies");
	console.log("  - create artisan.config.json");
	console.log("  - create tests/artisan/cli-version.artisan.test.mjs");
	console.log("  - install dependencies\n");
}

function printSetupInstructions() {
	console.error("No Artisan setup found in this project.");
	console.error("");
	console.error("Get started with:");
	console.error("  npx @peachlife/artisan init");
	console.error("");
	console.error("Or bootstrap on the fly:");
	console.error("  npx @peachlife/artisan test --bootstrap");
}

/**
 * Handle a project with no artisan.config.json before `test` runs.
 *
 * Returns `{ exit: <code> }` to short-circuit, or `{ ran: true }` once the
 * project has been bootstrapped. prompt/interactive/bootstrap are injectable so
 * the full decision matrix is unit-testable without a TTY, network, or exit.
 */
export async function handleFreshProject({
	cwd,
	options,
	prompt = promptBootstrap,
	interactive = isInteractive,
	bootstrap = bootstrapProject,
}) {
	const decision = resolveBootstrapDecision(options);
	if (decision === "never" || (decision === "ask" && !interactive())) {
		printSetupInstructions();
		return { exit: 1 };
	}
	if (decision === "ask") {
		printBootstrapPlan();
	}
	const proceed = decision === "always" ? true : await prompt();
	if (!proceed) {
		console.log("\nCancelled.\n");
		printSetupInstructions();
		return { exit: 0 };
	}
	console.log("\nBootstrapping Artisan...");
	// CLI-only path: commander always supplies true/false for --install/--no-install,
	// so `options.install !== false` defaults to install=true for interactive users.
	await bootstrap({
		cwd,
		install: options.install !== false,
		installer: options.installer,
	});
	console.log("\nRunning tests...");
	return { ran: true };
}

export async function runTest(files, options) {
	const cwd = process.cwd();
	const { hasConfig } = await detectBootstrapState(cwd);
	if (!hasConfig) {
		const result = await handleFreshProject({ cwd, options });
		if (result.exit !== undefined) {
			// eslint-disable-next-line unicorn/no-process-exit
			process.exit(result.exit);
		}
	}

	const config = await loadConfig();
	const flags = {};
	if (options.artifact !== undefined) flags.artifact = options.artifact;
	if (options.distros !== undefined) {
		flags.distros = parseDistros(options.distros);
	}
	if (options.reporter !== undefined) flags.reporter = options.reporter;
	if (options.timeout !== undefined) flags.timeout = options.timeout;
	if (options.serial) flags.parallel = false;

	const merged = mergeConfigWithFlags(config, flags);
	const testFiles =
		files.length > 0
			? files
			: await resolveTestFiles(merged.testMatch, process.cwd());
	if (testFiles.length === 0) {
		console.log("No test files found matching:", merged.testMatch);
		// eslint-disable-next-line unicorn/no-process-exit
		process.exit(0);
	}

	const artifactPath = await resolveArtifact(merged.artifact);
	const distros = merged.distros;
	if (distros.length === 0) {
		throw new UsageError(
			'No distros configured. Set "distros" in artisan.config.json or pass --distros',
		);
	}

	await ensureDockerAvailable();
	const resolvedConfigs = await resolveConfigs(
		merged.configs ?? [],
		process.cwd(),
		basename(artifactPath),
	);

	let overallExitCode = 0;
	const runForDistro = async (distro) => {
		const setupCommands = merged.setup?.[distro.split(":", 1)[0]] ?? [];
		const vitestArguments = buildVitestArguments({
			options,
			merged,
			testFiles,
		});

		const result = await execa("vitest", vitestArguments, {
			preferLocal: true,
			localDir: join(__dirname, "../../.."),
			env: {
				...process.env,
				ARTISAN_DISTRO: distro,
				ARTISAN_ARTIFACT: artifactPath,
				ARTISAN_SETUP: JSON.stringify(setupCommands),
				ARTISAN_CONFIGS: JSON.stringify(resolvedConfigs),
				ARTISAN_XDG_CONFIG_HOME: DEFAULT_XDG_CONFIG_HOME,
				...(options.noColor && { NO_COLOR: "1" }),
			},
			stdio: options.quiet ? "pipe" : "inherit",
			reject: false,
		});
		if (result.exitCode !== 0) overallExitCode = 1;
	};

	if (merged.parallel) {
		// eslint-disable-next-line unicorn/no-array-callback-reference
		await Promise.all(distros.map(runForDistro));
	} else {
		for (const distro of distros) {
			await runForDistro(distro);
		}
	}
	// eslint-disable-next-line unicorn/no-process-exit
	process.exit(overallExitCode);
}
