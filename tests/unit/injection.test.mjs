import { afterEach, describe, expect, test, vi } from "vitest";
import { ContainerManager } from "../../src/core/container-manager.mjs";

vi.mock("../../src/core/container-manager.mjs");

const APK_CURL = "apk add curl";

const mockContainer = {
	exec: vi.fn().mockResolvedValue({
		stdout: "hello",
		stderr: "",
		exitCode: 0,
		timedOut: false,
	}),
	shell: vi.fn().mockResolvedValue({
		stdout: "",
		stderr: "",
		exitCode: 0,
		timedOut: false,
	}),
	copyFile: vi.fn().mockResolvedValue(),
};

function clearArtisanEnvironment() {
	delete process.env.ARTISAN_DISTRO;
	delete process.env.ARTISAN_ARTIFACT;
	delete process.env.ARTISAN_SETUP;
	delete process.env.ARTISAN_CONFIGS;
	delete process.env.ARTISAN_XDG_CONFIG_HOME;
}

function makeMockContainer() {
	return {
		start: vi.fn().mockResolvedValue(),
		stop: vi.fn().mockResolvedValue(),
		exec: vi.fn(),
		shell: vi.fn(),
		copyFile: vi.fn(),
	};
}

afterEach(() => {
	clearArtisanEnvironment();
	vi.resetModules();
	vi.clearAllMocks();
	vi.doUnmock("vitest");
});

async function importWithFakeVitest() {
	vi.resetModules();
	const fixtures = new Map();
	const fakeTest = {
		extend: vi.fn((name, fixture) => {
			fixtures.set(name, fixture);
			return fakeTest;
		}),
	};
	const passthrough = vi.fn();
	vi.doMock("vitest", () => ({
		afterAll: passthrough,
		afterEach: passthrough,
		beforeAll: passthrough,
		beforeEach: passthrough,
		describe: passthrough,
		expect,
		onTestFailed: passthrough,
		test: fakeTest,
	}));
	await import("../../src/api/injection.mjs");
	return { fakeTest, fixtures };
}

async function importCreateTestContext() {
	const { createTestContext } = await import("../../src/api/injection.mjs");
	return createTestContext(mockContainer);
}

describe("buildExtendedTest", () => {
	test("returns plain Vitest test when artisan env is absent", async () => {
		const { fakeTest } = await importWithFakeVitest();
		expect(fakeTest.extend).not.toHaveBeenCalled();
	});

	const DISTRO = "alpine:3.18";
	const ARTIFACT = "/dist/mytool";
	const XDG_TARGET = "/root/.config/tool";

	test("creates a fresh container for each test-scoped context", async () => {
		process.env.ARTISAN_DISTRO = DISTRO;
		process.env.ARTISAN_ARTIFACT = ARTIFACT;
		process.env.ARTISAN_SETUP = JSON.stringify([APK_CURL]);
		process.env.ARTISAN_CONFIGS = JSON.stringify([
			{ source: "/host/cfg", target: XDG_TARGET, isDir: false },
		]);
		process.env.ARTISAN_XDG_CONFIG_HOME = "/home/user/.config";
		const firstContainer = makeMockContainer();
		const secondContainer = makeMockContainer();
		vi.mocked(ContainerManager)
			.mockImplementationOnce(function MockContainer() {
				// eslint-disable-next-line unicorn/no-this-outside-of-class
				this.created = true;
				return firstContainer;
			})
			.mockImplementationOnce(function MockContainer() {
				// eslint-disable-next-line unicorn/no-this-outside-of-class
				this.created = true;
				return secondContainer;
			});

		const { fixtures } = await importWithFakeVitest();
		const onCleanup = vi.fn();
		const artisanContext = fixtures.get("artisanContext");

		const firstContext = await artisanContext({}, { onCleanup });
		const secondContext = await artisanContext({}, { onCleanup });

		expect(vi.mocked(ContainerManager)).toHaveBeenNthCalledWith(
			1,
			DISTRO,
			ARTIFACT,
			expect.objectContaining({
				setupCommands: [APK_CURL],
				configs: [{ source: "/host/cfg", target: XDG_TARGET, isDir: false }],
				env: { HOME: "/root", XDG_CONFIG_HOME: "/home/user/.config" },
			}),
		);
		expect(firstContainer.start).toHaveBeenCalledTimes(1);
		expect(secondContainer.start).toHaveBeenCalledTimes(1);
		expect(onCleanup).toHaveBeenCalledTimes(2);
		expect(firstContext).not.toBe(secondContext);
	});

	test("run/copyFixture/setup fixtures use the shared per-test context", async () => {
		process.env.ARTISAN_DISTRO = DISTRO;
		process.env.ARTISAN_ARTIFACT = ARTIFACT;
		const { fixtures } = await importWithFakeVitest();
		const artisanContext = {
			run: vi.fn(),
			copyFixture: vi.fn(),
			setup: vi.fn(),
		};

		const run = await fixtures.get("run")({ artisanContext });
		const copyFixture = await fixtures.get("copyFixture")({ artisanContext });
		const setup = await fixtures.get("setup")({ artisanContext });
		await run("--version");
		await copyFixture("./local", "/remote");
		await setup(["echo ok"]);

		expect(artisanContext.run).toHaveBeenCalledWith("--version");
		expect(artisanContext.copyFixture).toHaveBeenCalledWith(
			"./local",
			"/remote",
		);
		expect(artisanContext.setup).toHaveBeenCalledWith(["echo ok"]);
	});
});

describe("createTestContext", () => {
	test("run() delegates to container.exec", async () => {
		const context = await importCreateTestContext();
		const result = await context.run("--version");
		expect(mockContainer.exec).toHaveBeenCalledWith("--version", {});
		expect(result.stdout).toBe("hello");
	});

	test("run() passes options through", async () => {
		const context = await importCreateTestContext();
		await context.run("--verbose", { env: { DEBUG: "true" }, timeout: 5000 });
		expect(mockContainer.exec).toHaveBeenCalledWith("--verbose", {
			env: { DEBUG: "true" },
			timeout: 5000,
		});
	});

	test("copyFixture() delegates to container.copyFile", async () => {
		const context = await importCreateTestContext();
		await context.copyFixture("./fixtures/input.json", "/tmp/input.json");
		expect(mockContainer.copyFile).toHaveBeenCalledWith(
			"./fixtures/input.json",
			"/tmp/input.json",
		);
	});

	test("setup() calls shell for each command", async () => {
		const context = await importCreateTestContext();
		mockContainer.shell.mockClear();
		await context.setup([APK_CURL, "apk add wget"]);
		expect(mockContainer.shell).toHaveBeenCalledTimes(2);
		expect(mockContainer.shell).toHaveBeenNthCalledWith(1, APK_CURL, {});
		expect(mockContainer.shell).toHaveBeenNthCalledWith(2, "apk add wget", {});
	});

	test("setup() throws when shell cmd exits non-zero", async () => {
		const context = await importCreateTestContext();
		mockContainer.shell.mockResolvedValueOnce({
			stdout: "",
			stderr: "bad setup",
			exitCode: 2,
			timedOut: false,
		});
		await expect(context.setup(["badcmd"])).rejects.toThrow(
			"setup cmd failed: badcmd",
		);
	});

	test("onTestFailed handler dumps last run() output to console.error", async () => {
		const { createTestContext } = await import("../../src/api/injection.mjs");
		let capturedCallback;
		const fakeOnTestFailed = vi.fn((callback) => {
			capturedCallback = callback;
		});
		const localContainer = {
			exec: vi.fn().mockResolvedValue({
				stdout: "hello out",
				stderr: "oops err",
				exitCode: 1,
				timedOut: false,
			}),
			shell: vi.fn(),
			copyFile: vi.fn(),
		};
		const context = createTestContext(localContainer, {
			onTestFailed: fakeOnTestFailed,
		});
		expect(fakeOnTestFailed).toHaveBeenCalledTimes(1);
		expect(capturedCallback).toBeDefined();
		await context.run("--version");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		capturedCallback();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("artisan: last run() output"),
		);
		expect(errorSpy).toHaveBeenCalledWith("stdout:", "hello out");
		expect(errorSpy).toHaveBeenCalledWith("stderr:", "oops err");
		expect(errorSpy).toHaveBeenCalledWith("exitCode:", 1);
		errorSpy.mockRestore();
	});

	test("shell() delegates to container.shell without throwing on non-zero", async () => {
		const context = await importCreateTestContext();
		mockContainer.shell.mockResolvedValueOnce({
			stdout: "",
			stderr: "fail",
			exitCode: 1,
			timedOut: false,
		});
		const result = await context.shell("badcmd");
		expect(result.exitCode).toBe(1);
		expect(result.stderr).toBe("fail");
	});

	test("shell() returns stdout and stderr on success", async () => {
		const context = await importCreateTestContext();
		mockContainer.shell.mockResolvedValueOnce({
			stdout: "output text",
			stderr: "",
			exitCode: 0,
			timedOut: false,
		});
		const result = await context.shell("goodcmd");
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("output text");
	});

	test("onTestFailed handler dumps last shell() output when shell was last called", async () => {
		const { createTestContext } = await import("../../src/api/injection.mjs");
		let capturedCallback;
		const fakeOnTestFailed = vi.fn((callback) => {
			capturedCallback = callback;
		});
		const localContainer = {
			exec: vi.fn(),
			shell: vi.fn().mockResolvedValue({
				stdout: "shell out",
				stderr: "shell err",
				exitCode: 2,
				timedOut: false,
			}),
			copyFile: vi.fn(),
		};
		const context = createTestContext(localContainer, {
			onTestFailed: fakeOnTestFailed,
		});
		await context.shell("somecmd");
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
		capturedCallback();
		expect(errorSpy).toHaveBeenCalledWith(
			expect.stringContaining("artisan: last run() output"),
		);
		expect(errorSpy).toHaveBeenCalledWith("stdout:", "shell out");
		expect(errorSpy).toHaveBeenCalledWith("stderr:", "shell err");
		expect(errorSpy).toHaveBeenCalledWith("exitCode:", 2);
		errorSpy.mockRestore();
	});
});
