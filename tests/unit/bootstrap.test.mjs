import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { expect, test } from "vitest";
import {
	addDevelopmentDependencies,
	bootstrapProject,
	detectBootstrapState,
	detectPackageManager,
	isInteractive,
	promptBootstrap,
	resolveBootstrapDecision,
} from "../../src/cli/bootstrap.mjs";
import { handleFreshProject } from "../../src/cli/commands/test.mjs";
import { useSandboxAsCwd } from "./helpers/sandbox.mjs";

const sandbox = useSandboxAsCwd();
const CONFIG = "artisan.config.json";
const STARTER = join("tests", "artisan", "cli-version.artisan.test.mjs");

async function pathExists(path) {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

test("detectBootstrapState reports missing vs present config", async () => {
	const before = await detectBootstrapState(sandbox.directory);
	expect(before.hasConfig).toBe(false);
	await writeFile(join(sandbox.directory, CONFIG), "{}");
	const after = await detectBootstrapState(sandbox.directory);
	expect(after.hasConfig).toBe(true);
});

test("detectPackageManager defaults to npm with no lockfile", async () => {
	expect(await detectPackageManager(sandbox.directory)).toBe("npm");
});

test("detectPackageManager detects bun.lock (text format)", async () => {
	await writeFile(join(sandbox.directory, "bun.lock"), "");
	expect(await detectPackageManager(sandbox.directory)).toBe("bun");
});

test("detectPackageManager detects bun, pnpm, and yarn lockfiles", async () => {
	await writeFile(join(sandbox.directory, "bun.lockb"), "");
	expect(await detectPackageManager(sandbox.directory)).toBe("bun");
});

test("detectPackageManager prefers pnpm over yarn", async () => {
	await writeFile(join(sandbox.directory, "yarn.lock"), "");
	await writeFile(join(sandbox.directory, "pnpm-lock.yaml"), "");
	expect(await detectPackageManager(sandbox.directory)).toBe("pnpm");
});

test("addDevelopmentDependencies creates package.json with devDependencies", async () => {
	await addDevelopmentDependencies(sandbox.directory, { vitest: "^4.0.0" });
	const package_ = JSON.parse(
		await readFile(join(sandbox.directory, "package.json"), "utf8"),
	);
	expect(package_.devDependencies.vitest).toBe("^4.0.0");
});

test("addDevelopmentDependencies merges into and preserves existing manifest", async () => {
	await writeFile(
		join(sandbox.directory, "package.json"),
		JSON.stringify({ name: "consumer", devDependencies: { foo: "^1.0.0" } }),
	);
	await addDevelopmentDependencies(sandbox.directory, { vitest: "^4.0.0" });
	const package_ = JSON.parse(
		await readFile(join(sandbox.directory, "package.json"), "utf8"),
	);
	expect(package_.name).toBe("consumer");
	expect(package_.devDependencies).toEqual({ foo: "^1.0.0", vitest: "^4.0.0" });
});

test("bootstrapProject without install scaffolds only, no package.json", async () => {
	const installerCalls = [];
	await bootstrapProject({
		cwd: sandbox.directory,
		distros: "alpine:3",
		install: false,
		installer: async () => {
			installerCalls.push(1);
		},
	});
	expect(await pathExists(join(sandbox.directory, CONFIG))).toBe(true);
	expect(await pathExists(join(sandbox.directory, STARTER))).toBe(true);
	expect(installerCalls).toEqual([]);
	expect(await pathExists(join(sandbox.directory, "package.json"))).toBe(false);
});

test("bootstrapProject with install adds devDeps and invokes installer", async () => {
	const installerCalls = [];
	await bootstrapProject({
		cwd: sandbox.directory,
		distros: "alpine:3",
		install: true,
		installer: async (arguments_) => {
			installerCalls.push(arguments_);
		},
	});
	const package_ = JSON.parse(
		await readFile(join(sandbox.directory, "package.json"), "utf8"),
	);
	expect(package_.devDependencies["@peachlife/artisan"]).toMatch(/^\^/);
	expect(package_.devDependencies.vitest).toBe("^4.0.0");
	expect(installerCalls).toEqual([
		{ cwd: sandbox.directory, packageManager: "npm" },
	]);
});

test("bootstrapProject respects --force to overwrite config", async () => {
	await bootstrapProject({
		cwd: sandbox.directory,
		distros: "alpine:3",
		install: false,
	});
	const first = await readFile(join(sandbox.directory, CONFIG), "utf8");
	await bootstrapProject({
		cwd: sandbox.directory,
		distros: "debian:stable-slim",
		force: true,
		install: false,
	});
	const second = await readFile(join(sandbox.directory, CONFIG), "utf8");
	expect(second).toContain("debian:stable-slim");
	expect(first).not.toBe(second);
});

test("resolveBootstrapDecision maps the three option states", () => {
	expect(resolveBootstrapDecision({ bootstrap: true })).toBe("always");
	expect(resolveBootstrapDecision({ bootstrap: false })).toBe("never");
	expect(resolveBootstrapDecision({})).toBe("ask");
});

test("handleFreshProject --bootstrap bootstraps without prompting", async () => {
	let isPrompted = false;
	let bootArguments;
	const result = await handleFreshProject({
		cwd: sandbox.directory,
		options: { bootstrap: true },
		prompt: async () => {
			isPrompted = true;
			return true;
		},
		interactive: () => true,
		bootstrap: async (arguments_) => {
			bootArguments = arguments_;
		},
	});
	expect(isPrompted).toBe(false);
	expect(bootArguments).toMatchObject({
		cwd: sandbox.directory,
		install: true,
	});
	expect(result).toEqual({ ran: true });
});

test("handleFreshProject --no-bootstrap exits with instructions", async () => {
	const result = await handleFreshProject({
		cwd: sandbox.directory,
		options: { bootstrap: false },
		prompt: async () => true,
		interactive: () => true,
		bootstrap: async () => {
			throw new Error("should not bootstrap");
		},
	});
	expect(result).toEqual({ exit: 1 });
});

test("handleFreshProject ask + interactive + yes bootstraps", async () => {
	const result = await handleFreshProject({
		cwd: sandbox.directory,
		options: {},
		prompt: async () => true,
		interactive: () => true,
		bootstrap: async () => {},
	});
	expect(result).toEqual({ ran: true });
});

test("handleFreshProject ask + interactive + no cancels with exit 0", async () => {
	const result = await handleFreshProject({
		cwd: sandbox.directory,
		options: {},
		prompt: async () => false,
		interactive: () => true,
		bootstrap: async () => {
			throw new Error("should not bootstrap");
		},
	});
	expect(result).toEqual({ exit: 0 });
});

test("handleFreshProject ask + non-interactive exits with instructions", async () => {
	const result = await handleFreshProject({
		cwd: sandbox.directory,
		options: {},
		prompt: async () => {
			throw new Error("should not prompt");
		},
		interactive: () => false,
		bootstrap: async () => {
			throw new Error("should not bootstrap");
		},
	});
	expect(result).toEqual({ exit: 1 });
});

test("handleFreshProject forwards --no-install to bootstrap", async () => {
	let bootArguments;
	await handleFreshProject({
		cwd: sandbox.directory,
		options: { bootstrap: true, install: false },
		prompt: async () => true,
		interactive: () => true,
		bootstrap: async (arguments_) => {
			bootArguments = arguments_;
		},
	});
	expect(bootArguments).toEqual({
		cwd: sandbox.directory,
		install: false,
		installer: undefined,
	});
});

test("promptBootstrap defaults to yes on enter, honors y/n", async () => {
	async function answer(input) {
		const stream = new PassThrough();
		const promise = promptBootstrap({
			input: stream,
			output: new PassThrough(),
		});
		stream.end(input);
		return promise;
	}
	expect(await answer("\n")).toBe(true);
	expect(await answer("y\n")).toBe(true);
	expect(await answer("YES\n")).toBe(true);
	expect(await answer("n\n")).toBe(false);
	expect(await answer("no\n")).toBe(false);
	expect(await answer("N\n")).toBe(false);
	expect(await answer("garbage\n")).toBe(false);
});

test("isInteractive returns false in CI environments", () => {
	const originalCI = process.env.CI;
	const originalIsTTY = process.stdin.isTTY;
	try {
		process.env.CI = "true";
		Object.defineProperty(process.stdin, "isTTY", {
			value: true,
			configurable: true,
		});
		expect(isInteractive()).toBe(false);
	} finally {
		if (originalCI === undefined) {
			delete process.env.CI;
		} else {
			process.env.CI = originalCI;
		}
		Object.defineProperty(process.stdin, "isTTY", {
			value: originalIsTTY,
			configurable: true,
		});
	}
});
