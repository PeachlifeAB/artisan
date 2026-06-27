import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { UsageError } from "../utils/errors.mjs";
import { DEFAULT_DISTROS } from "./constants.mjs";

const DEFAULTS = {
	artifact: "",
	distros: DEFAULT_DISTROS,
	testMatch: "**/*.artisan.test.mjs",
	timeout: undefined,
	parallel: true,
	setup: {},
	reporter: "default",
	configs: [],
};

function validateConfigEntry(entry) {
	if (typeof entry === "string") {
		if (entry.trim() === "")
			throw new UsageError("configs entry must be a non-empty path");
		return;
	}
	if (typeof entry === "object" && entry !== null) {
		if (typeof entry.src !== "string" || entry.src.trim() === "") {
			throw new UsageError('configs object entry missing valid "src"');
		}
		if (typeof entry.dest !== "string" || entry.dest.trim() === "") {
			throw new UsageError('configs object entry missing valid "dest"');
		}
		return;
	}
	throw new UsageError(
		`configs entry must be a string or {src, dest} object, got: ${typeof entry}`,
	);
}

function validateConfigs(configs) {
	if (!Array.isArray(configs)) {
		throw new UsageError('"configs" in artisan.config.json must be an array');
	}
	for (const entry of configs) validateConfigEntry(entry);
}

function assertStringArray(value, label) {
	if (
		!Array.isArray(value) ||
		value.some((v) => typeof v !== "string" || v.trim() === "")
	) {
		throw new UsageError(`"${label}" must be an array of non-empty strings`);
	}
}

function validateSetup(setup) {
	if (typeof setup !== "object" || Array.isArray(setup) || setup === null) {
		throw new UsageError('"setup" must be an object of distro -> command[]');
	}
	for (const [key, cmds] of Object.entries(setup)) {
		assertStringArray(cmds, `setup["${key}"]`);
	}
}

function validateConfigShape(config) {
	if (config.artifact !== undefined && typeof config.artifact !== "string") {
		throw new UsageError('"artifact" must be a string');
	}
	if (config.distros !== undefined)
		assertStringArray(config.distros, "distros");
	if (
		config.timeout !== undefined &&
		(typeof config.timeout !== "number" || config.timeout < 0)
	) {
		throw new UsageError(
			'"timeout" must be a non-negative number (ms), 0 means no timeout',
		);
	}
	if (config.parallel !== undefined && typeof config.parallel !== "boolean") {
		throw new UsageError('"parallel" must be a boolean');
	}
	if (config.setup !== undefined) validateSetup(config.setup);
	if (config.reporter !== undefined && typeof config.reporter !== "string") {
		throw new UsageError('"reporter" must be a string');
	}
	if (config.testMatch !== undefined && typeof config.testMatch !== "string") {
		throw new UsageError('"testMatch" must be a string');
	}
}

export async function readJsonConfig(configPath, { optional = false } = {}) {
	try {
		const raw = await readFile(configPath, "utf8");
		try {
			const config = JSON.parse(raw);
			if (
				config === null ||
				Array.isArray(config) ||
				typeof config !== "object"
			) {
				throw new UsageError(
					`artisan.config.json must contain a JSON object at ${configPath}`,
				);
			}
			return config;
		} catch (error) {
			if (error instanceof UsageError) throw error;
			throw new UsageError(
				`artisan.config.json contains invalid JSON at ${configPath}`,
			);
		}
	} catch (error) {
		if (error instanceof UsageError) throw error;
		if (optional && error?.code === "ENOENT") return {};
		if (error?.code === "ENOENT") {
			throw new UsageError(
				"artisan.config.json not found — run `artisan init` first",
			);
		}
		throw error;
	}
}

export async function loadConfig(cwd = process.cwd()) {
	const configPath = join(cwd, "artisan.config.json");
	const fileConfig = await readJsonConfig(configPath, { optional: true });
	if (fileConfig.configs !== undefined) {
		validateConfigs(fileConfig.configs);
	}
	validateConfigShape(fileConfig);
	return { ...DEFAULTS, ...fileConfig };
}

export function mergeConfigWithFlags(config, flags) {
	const merged = { ...config };
	for (const [key, value] of Object.entries(flags)) {
		if (value !== undefined && value !== null) {
			merged[key] = value;
		}
	}
	return merged;
}
