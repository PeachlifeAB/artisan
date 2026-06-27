import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import { UsageError } from "../utils/errors.mjs";
import { runAdd } from "./commands/add.mjs";
import { runInit } from "./commands/init.mjs";
import { runTest } from "./commands/test.mjs";

function parseNonNegativeInt(value, label) {
	if (!/^\d+$/.test(value)) {
		throw new UsageError(
			`--${label} must be a non-negative integer, got: ${value}`,
		);
	}
	return Number(value);
}

function parsePositiveInt(value, label) {
	const n = parseNonNegativeInt(value, label);
	if (n === 0) {
		throw new UsageError(
			`--${label} must be a positive integer (> 0), got: ${value}`,
		);
	}
	return n;
}

const DEFAULT_TESTS_DIR = "./tests/";
const OPT_DIR = "--dir <path>";
const OPT_DIR_DESC = "Target directory";
const OPT_FORCE_DESC = "Overwrite existing file";

function addScaffoldCommand(parent, name, description, configureFunction) {
	const command = parent
		.command(name)
		.description(description)
		.option(OPT_DIR, OPT_DIR_DESC, DEFAULT_TESTS_DIR)
		.option("--force", OPT_FORCE_DESC);
	if (configureFunction) configureFunction(command);
	command.action((options) => runAdd(name, options));
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const package_ = JSON.parse(
	readFileSync(join(__dirname, "../../package.json"), "utf8"),
);

export function createProgram() {
	const program = new Command();

	program
		.name("artisan")
		.description("Test CLI artifacts in isolated Linux sandboxes.")
		.version(package_.version);

	program
		.command("init")
		.description("Scaffold Artisan into the current project")
		.option("-d, --distros <list>", "Comma-separated Docker images")
		.option("--force", "Overwrite existing config/test files")
		.option("--no-install", "Skip dependency installation")
		.action((options) => runInit(options));

	program
		.command("test [files...]")
		.description("Run tests across configured distros")
		.option(
			"-t, --testName <pattern>",
			"Filter by test name (substring or regex)",
		)
		.option("-i, --invert", "Run tests that do NOT match the -t filter")
		.option("-d, --distros <list>", "Override the distro matrix")
		.option("-a, --artifact <path>", "Override the artifact path")
		.option("-w, --watch", "Re-run tests on file changes")
		.option("-r, --reporter <name>", "default, junit, json, tap")
		.option("--timeout <ms>", "Override per-test timeout (ms)", (v) =>
			parseNonNegativeInt(v, "timeout"),
		)
		.option("--no-color", "Disable ANSI color codes")
		.option("-q, --quiet", "Only output failures and summary")
		.option("-v, --verbose", "Print full Docker and Execa output")
		.option("--parallel", "Run distro matrix in parallel (default)")
		.option("-s, --serial", "Run distro matrix sequentially")
		.option("--retries <n>", "Retry failed tests up to N times", (v) =>
			parsePositiveInt(v, "retries"),
		)
		.option("-b, --bail", "Stop on first failure")
		.option("--bootstrap", "Bootstrap a fresh project without prompting")
		.option("--no-bootstrap", "Never bootstrap; exit with setup instructions")
		.option("--no-install", "Skip dependency install during bootstrap")
		.action((files, options) => runTest(files, options));

	const add = program.command("add").description("Scaffold tests and fixtures");

	addScaffoldCommand(add, "version", "Scaffold a CLI version test");
	addScaffoldCommand(add, "help", "Scaffold a CLI help test");
	addScaffoldCommand(add, "custom", "Scaffold a custom test", (command) => {
		command.requiredOption("-n, --name <name>", "Test name");
	});

	add
		.command("config <source>")
		.description(
			"Scaffold a committed config fixture from a local config directory",
		)
		.option(
			"-n, --name <name>",
			"Fixture directory name (default: basename of source)",
		)
		.option("--raw", "Copy without sanitizing secrets, caches, or temp files")
		.option("--force", "Overwrite existing fixture directory")
		.action((source, options) => runAdd("config", { ...options, source }));

	return program;
}
