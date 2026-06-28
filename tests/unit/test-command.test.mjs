import { execa } from "execa";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { resolveArtifact } from "../../src/core/artifact-manager.mjs";
import { resolveConfigs } from "../../src/core/fixture-resolver.mjs";

vi.mock("execa", () => ({
	execa: vi.fn().mockResolvedValue({ exitCode: 0 }),
}));

const ARTIFACT = "/tmp/mycli";
const ALPINE = "alpine:latest";
const TEST_MATCH = "**/*.artisan.test.mjs";
const EXAMPLE_TEST = "tests/example.artisan.test.mjs";
const TEST_TIMEOUT_FLAG = "--testTimeout";

function makeDefaultConfig(overrides = {}) {
	return {
		artifact: "",
		artifacts: [],
		distros: [ALPINE],
		testMatch: TEST_MATCH,
		timeout: 30_000,
		parallel: true,
		setup: {},
		reporter: "default",
		configs: [],
		...overrides,
	};
}

vi.mock("../../src/core/config.mjs", () => ({
	loadConfig: vi.fn(),
	mergeConfigWithFlags: vi.fn((c, f) => ({ ...c, ...f })),
}));

vi.mock("../../src/core/artifact-manager.mjs", () => ({
	resolveArtifact: vi.fn(),
}));

vi.mock("../../src/core/fixture-resolver.mjs", () => ({
	resolveConfigs: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../src/utils/glob.mjs", () => ({
	resolveTestFiles: vi.fn().mockResolvedValue([]),
}));

import { runTest } from "../../src/cli/commands/test.mjs";
import { loadConfig } from "../../src/core/config.mjs";
import { resolveTestFiles } from "../../src/utils/glob.mjs";

afterEach(() => {
	vi.clearAllMocks();
});

beforeEach(() => {
	loadConfig.mockResolvedValue(makeDefaultConfig());
	resolveArtifact.mockResolvedValue(ARTIFACT);
	resolveTestFiles.mockResolvedValue([]);
});

function vitestCalls() {
	return execa.mock.calls.filter(([file]) => file !== "docker");
}

class ExitSignal {
	constructor(code) {
		this.code = code;
	}
}

async function runTestWithExitSpy(files, options) {
	const calls = [];
	const exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
		calls.push(code);
		throw new ExitSignal(code);
	});
	try {
		await runTest(files, options);
	} catch (error) {
		if (!(error instanceof ExitSignal)) throw error;
	} finally {
		exitSpy.mockRestore();
	}
	return calls;
}

async function runWithTestFile(options = {}) {
	resolveTestFiles.mockResolvedValueOnce([EXAMPLE_TEST]);
	await runTestWithExitSpy([], options);
	return vitestCalls()[0];
}

test("runTest resolves without error when no test files found", async () => {
	const exitCodes = await runTestWithExitSpy([], {});
	expect(exitCodes).toContain(0);
	expect(resolveArtifact).not.toHaveBeenCalled();
	expect(execa).not.toHaveBeenCalled();
});

test("runTest preflights Docker before running Vitest", async () => {
	resolveTestFiles.mockResolvedValueOnce([EXAMPLE_TEST]);
	await runTestWithExitSpy([], {});
	expect(execa.mock.calls[0][0]).toBe("docker");
	expect(execa.mock.calls[0][1]).toEqual(["info"]);
});

test("runTest resolves configs and forwards setup/config env to vitest", async () => {
	const resolved = [
		{ source: "/tmp/cfg", target: "/root/.config/mycli", isDir: true },
	];
	loadConfig.mockResolvedValueOnce(
		makeDefaultConfig({
			setup: { alpine: ["apk add curl"] },
			configs: ["./fixtures/cfg"],
		}),
	);
	resolveTestFiles.mockResolvedValueOnce([EXAMPLE_TEST]);
	resolveConfigs.mockResolvedValueOnce(resolved);
	await runTestWithExitSpy([], {});
	expect(resolveConfigs).toHaveBeenCalledWith(
		["./fixtures/cfg"],
		process.cwd(),
		"mycli",
	);
	const calls = vitestCalls();
	expect(calls).toHaveLength(1);
	const execaOptions = calls[0][2];
	expect(execaOptions.env.ARTISAN_SETUP).toBe(JSON.stringify(["apk add curl"]));
	expect(execaOptions.env.ARTISAN_CONFIGS).toBe(JSON.stringify(resolved));
	expect(execaOptions.env.ARTISAN_XDG_CONFIG_HOME).toBe("/root/.config");
});

test("runTest trims comma-separated distro values and drops blanks", async () => {
	resolveTestFiles.mockResolvedValueOnce([EXAMPLE_TEST]);
	await runTestWithExitSpy([], { distros: `${ALPINE}, debian:stable-slim, ` });
	const calls = vitestCalls();
	expect(calls).toHaveLength(2);
	expect(calls[0][2].env.ARTISAN_DISTRO).toBe(ALPINE);
	expect(calls[1][2].env.ARTISAN_DISTRO).toBe("debian:stable-slim");
});

test("runTest applies inverted test name pattern", async () => {
	resolveTestFiles.mockResolvedValueOnce([EXAMPLE_TEST]);
	await runTestWithExitSpy([], { testName: "smoke", invert: true });
	const [, vitestArguments] = vitestCalls()[0];
	expect(vitestArguments).toContain("--testNamePattern");
	expect(vitestArguments).toContain("^(?!.*(?:smoke)).*$");
});

test("runTest passes explicit watch flag to Vitest watch mode", async () => {
	const [, vitestArguments] = await runWithTestFile({ watch: true });
	expect(vitestArguments[0]).toBe("--watch");
	expect(vitestArguments).toContain("--config");
});

test("runTest forwards config timeout as --testTimeout", async () => {
	const [, vitestArguments] = await runWithTestFile();
	expect(vitestArguments).toContain(TEST_TIMEOUT_FLAG);
	expect(vitestArguments[vitestArguments.indexOf(TEST_TIMEOUT_FLAG) + 1]).toBe(
		"30000",
	);
});

test("runTest skips --testTimeout when timeout is undefined", async () => {
	loadConfig.mockResolvedValueOnce(makeDefaultConfig({ timeout: undefined }));
	const [, vitestArguments] = await runWithTestFile();
	expect(vitestArguments).not.toContain(TEST_TIMEOUT_FLAG);
});

test("runTest passes MAX_SAFE_INTEGER when timeout is 0", async () => {
	loadConfig.mockResolvedValueOnce(makeDefaultConfig({ timeout: 0 }));
	const [, vitestArguments] = await runWithTestFile();
	expect(vitestArguments).toContain(TEST_TIMEOUT_FLAG);
	expect(vitestArguments[vitestArguments.indexOf(TEST_TIMEOUT_FLAG) + 1]).toBe(
		String(Number.MAX_SAFE_INTEGER),
	);
});

test("runTest does not overwrite a config reporter when --reporter is absent", async () => {
	loadConfig.mockResolvedValueOnce(makeDefaultConfig({ reporter: "junit" }));
	const [, vitestArguments] = await runWithTestFile();
	expect(vitestArguments).toContain("--reporter");
	expect(vitestArguments[vitestArguments.indexOf("--reporter") + 1]).toBe(
		"junit",
	);
});

test("passes --reporter=verbose when --verbose flag is set", async () => {
	const [, vitestArguments] = await runWithTestFile({ verbose: true });
	expect(vitestArguments).toContain("--reporter");
	expect(vitestArguments[vitestArguments.indexOf("--reporter") + 1]).toBe(
		"verbose",
	);
	expect(vitestArguments).not.toContain("--verbose");
});

test("does not pass --verbose to vitest", async () => {
	const [, vitestArguments] = await runWithTestFile({ verbose: true });
	expect(vitestArguments).not.toContain("--verbose");
});

test("runTest groups test files by artifacts entry and runs one vitest per group", async () => {
	const ARTIFACT_A = "/tmp/bina";
	const ARTIFACT_B = "/tmp/binb";
	// resolveTestFiles returns absolute paths (fast-glob absolute: true)
	const FILE_A = `${process.cwd()}/tests/a.artisan.test.mjs`;
	const FILE_B = `${process.cwd()}/tests/b.artisan.test.mjs`;
	loadConfig.mockResolvedValueOnce(
		makeDefaultConfig({
			artifacts: [
				{ testMatch: "tests/a.artisan.test.mjs", artifact: "./bin/a" },
				{ testMatch: "tests/b.artisan.test.mjs", artifact: "./bin/b" },
			],
		}),
	);
	resolveArtifact
		.mockResolvedValueOnce(ARTIFACT_A)
		.mockResolvedValueOnce(ARTIFACT_B);
	resolveTestFiles.mockResolvedValueOnce([FILE_A, FILE_B]);

	await runTestWithExitSpy([], {});

	const calls = vitestCalls();
	expect(calls).toHaveLength(2);
	expect(calls[0][2].env.ARTISAN_ARTIFACT).toBe(ARTIFACT_A);
	expect(calls[0][1]).toContain(FILE_A);
	expect(calls[1][2].env.ARTISAN_ARTIFACT).toBe(ARTIFACT_B);
	expect(calls[1][1]).toContain(FILE_B);
});

test("runTest throws UsageError when artifacts file has no matching entry and no fallback artifact", async () => {
	const FILE_A = `${process.cwd()}/tests/a.artisan.test.mjs`;
	loadConfig.mockResolvedValueOnce(
		makeDefaultConfig({
			artifacts: [
				{ testMatch: "tests/b.artisan.test.mjs", artifact: "./bin/b" },
			],
		}),
	);
	resolveTestFiles.mockResolvedValueOnce([FILE_A]);

	await expect(runTestWithExitSpy([], {})).rejects.toThrow("did not match any");
});

test("runTest falls back to top-level artifact when artifacts is empty", async () => {
	loadConfig.mockResolvedValueOnce(makeDefaultConfig({ artifact: ARTIFACT }));
	resolveArtifact.mockResolvedValueOnce(ARTIFACT);
	resolveTestFiles.mockResolvedValueOnce([EXAMPLE_TEST]);
	await runTestWithExitSpy([], {});
	const calls = vitestCalls();
	expect(calls).toHaveLength(1);
	expect(calls[0][2].env.ARTISAN_ARTIFACT).toBe(ARTIFACT);
});

test("runTest uses artifacts entry artifact over top-level --artifact flag when testMatch matches", async () => {
	const ARTIFACT_A = "/tmp/bina";
	loadConfig.mockResolvedValueOnce(
		makeDefaultConfig({
			artifact: "/tmp/wrong",
			artifacts: [
				{ testMatch: "tests/a.artisan.test.mjs", artifact: "./bin/a" },
			],
		}),
	);
	resolveArtifact.mockResolvedValueOnce(ARTIFACT_A);
	resolveTestFiles.mockResolvedValueOnce(["tests/a.artisan.test.mjs"]);

	await runTestWithExitSpy([], {});

	const calls = vitestCalls();
	expect(calls).toHaveLength(1);
	expect(calls[0][2].env.ARTISAN_ARTIFACT).toBe(ARTIFACT_A);
});
