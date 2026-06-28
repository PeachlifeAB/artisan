import { afterEach, describe, expect, test, vi } from "vitest";

function createMockContainer(overrides = {}) {
	return {
		exec: vi.fn().mockResolvedValue({ output: ["hello\n", ""], exitCode: 0 }),
		copyFilesToContainer: vi.fn().mockResolvedValue(),
		copyDirectoriesToContainer: vi.fn().mockResolvedValue(),
		stop: vi.fn().mockResolvedValue(),
		...overrides,
	};
}

function createMockBuilder(container = createMockContainer(), overrides = {}) {
	return {
		withBindMounts: vi.fn().mockReturnThis(),
		withCommand: vi.fn().mockReturnThis(),
		withEnvironment: vi.fn().mockReturnThis(),
		withWorkingDirectory: vi.fn().mockReturnThis(),
		withCopyFilesToContainer: vi.fn().mockReturnThis(),
		withCopyDirectoriesToContainer: vi.fn().mockReturnThis(),
		start: vi.fn().mockResolvedValue(container),
		...overrides,
	};
}

vi.mock("testcontainers", () => ({
	GenericContainer: vi.fn().mockImplementation(function GenericContainerMock() {
		return createMockBuilder();
	}),
}));

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GenericContainer } from "testcontainers";
import { ContainerManager } from "../../src/core/container-manager.mjs";

const DISTRO = "alpine:latest";
const ARTIFACT = "/tmp/mycli";

afterEach(() => {
	vi.clearAllMocks();
});

function mockNextContainer(container, builderOverrides = {}) {
	GenericContainer.mockImplementationOnce(function GenericContainerMock() {
		return createMockBuilder(container, builderOverrides);
	});
	return container;
}

async function startedManager(options = {}) {
	const cm = new ContainerManager(DISTRO, ARTIFACT, options);
	await cm.start();
	return cm;
}

function expectRunResultShape(result) {
	expect(result).toHaveProperty("stdout");
	expect(result).toHaveProperty("stderr");
	expect(result).toHaveProperty("exitCode");
	expect(result).toHaveProperty("timedOut");
}

function createHangingContainer() {
	let isStartupDone = false;
	return createMockContainer({
		exec: vi.fn(() => {
			// Let the first exec (mkdir -p /tmp/work from start()) succeed, then hang.
			if (!isStartupDone) {
				isStartupDone = true;
				return Promise.resolve({ output: ["", ""], exitCode: 0 });
			}
			return new Promise(() => {});
		}),
	});
}

function expectExecCalledWith(container, arguments_) {
	expect(container.exec).toHaveBeenCalledWith(arguments_, expect.any(Object));
}

function expectTimedOut(result, container) {
	expect(result).toMatchObject({ exitCode: 1, timedOut: true });
	expect(container.stop).toHaveBeenCalledTimes(1);
}

async function containerAndManager() {
	const container = createMockContainer();
	mockNextContainer(container);
	const cm = await startedManager();
	return { container, cm };
}

async function hangingContainerAndManager() {
	const container = createHangingContainer();
	mockNextContainer(container);
	const cm = await startedManager();
	return { container, cm };
}

describe("ContainerManager", () => {
	const MOUNT_TARGET = "/usr/local/bin/mycli";
	const XDG_CONFIG = "/root/.config/mycli";
	const CMD_WRITE_FILE = "write-file";
	const SPACED_PATH = "/tmp/file with spaces.txt";
	const HELLO_WORLD = "hello world";

	test("constructs with distro and artifact path", () => {
		const cm = new ContainerManager(DISTRO, ARTIFACT);
		expect(cm).toBeDefined();
	});

	test("start() returns without error (mocked)", async () => {
		const cm = new ContainerManager(DISTRO, ARTIFACT);
		await expect(cm.start()).resolves.toBeUndefined();
	});

	test("exec() returns RunResult shape", async () => {
		const cm = await startedManager();
		expectRunResultShape(await cm.exec("--version"));
	});

	test("exec() forwards cwd as Testcontainers workingDir", async () => {
		const { container, cm } = await containerAndManager();
		await cm.exec("init", { cwd: "/tmp/project" });

		expect(container.exec).toHaveBeenCalledWith(
			[MOUNT_TARGET, "init"],
			expect.objectContaining({ workingDir: "/tmp/project" }),
		);
	});

	test("exec() defaults cwd to /tmp/work", async () => {
		const { container, cm } = await containerAndManager();
		await cm.exec("--version");
		expect(container.exec).toHaveBeenCalledWith(
			[MOUNT_TARGET, "--version"],
			expect.objectContaining({ workingDir: "/tmp/work" }),
		);
	});

	test("exec() respects explicit cwd override", async () => {
		const { container, cm } = await containerAndManager();
		await cm.exec("--version", { cwd: "/usr/local/bin" });
		expect(container.exec).toHaveBeenCalledWith(
			[MOUNT_TARGET, "--version"],
			expect.objectContaining({ workingDir: "/usr/local/bin" }),
		);
	});

	test("start() runs mkdir -p /tmp/work before user setupCommands", async () => {
		const container = createMockContainer();
		mockNextContainer(container);
		const cm = new ContainerManager(DISTRO, ARTIFACT, {
			setupCommands: ["echo hello"],
		});
		await cm.start();
		expect(container.exec).toHaveBeenNthCalledWith(
			1,
			["sh", "-c", "mkdir -p /tmp/work"],
			expect.any(Object),
		);
		expect(container.exec).toHaveBeenNthCalledWith(
			2,
			["sh", "-c", "echo hello"],
			expect.any(Object),
		);
	});

	test("start() throws DockerError when workdir mkdir fails", async () => {
		const container = createMockContainer({
			exec: vi.fn().mockResolvedValue({
				output: ["", "mkdir: permission denied"],
				exitCode: 1,
			}),
		});
		mockNextContainer(container);
		const cm = new ContainerManager(DISTRO, ARTIFACT, {});
		await expect(cm.start()).rejects.toThrow(
			"failed to initialize default workdir",
		);
	});

	test("exec() preserves quoted arguments with spaces", async () => {
		const { container, cm } = await containerAndManager();
		await cm.exec(`${CMD_WRITE_FILE} "${SPACED_PATH}" "${HELLO_WORLD}"`);
		expectExecCalledWith(container, [
			MOUNT_TARGET,
			CMD_WRITE_FILE,
			SPACED_PATH,
			HELLO_WORLD,
		]);
	});

	test("shell() returns RunResult shape", async () => {
		const cm = await startedManager();
		expectRunResultShape(await cm.shell("echo hello"));
	});

	test("stop() resolves without error", async () => {
		const cm = await startedManager();
		await expect(cm.stop()).resolves.toBeUndefined();
	});

	test("accepts options object with setupCommands", () => {
		const cm = new ContainerManager(DISTRO, ARTIFACT, {
			setupCommands: ["echo hi"],
		});
		expect(cm).toBeDefined();
	});

	test("accepts options object with configs", () => {
		const cm = new ContainerManager(DISTRO, ARTIFACT, {
			configs: [{ source: "/tmp/cfg", target: XDG_CONFIG, isDir: true }],
		});
		expect(cm).toBeDefined();
	});

	test("accepts options object with env", () => {
		const cm = new ContainerManager(DISTRO, ARTIFACT, {
			env: { HOME: "/root", XDG_CONFIG_HOME: "/root/.config" },
		});
		expect(cm).toBeDefined();
	});

	test("start() calls withEnvironment with env option", async () => {
		const withEnvironmentSpy = vi.fn().mockReturnThis();
		mockNextContainer(createMockContainer(), {
			withEnvironment: withEnvironmentSpy,
		});
		const cm = new ContainerManager(DISTRO, ARTIFACT, {
			env: { MY_VAR: "hello" },
		});
		await cm.start();
		expect(withEnvironmentSpy).toHaveBeenCalledWith({ MY_VAR: "hello" });
	});

	test("start() calls withCopyFilesToContainer for file configs", async () => {
		const withFilesSpy = vi.fn().mockReturnThis();
		mockNextContainer(createMockContainer(), {
			withCopyFilesToContainer: withFilesSpy,
		});
		const cm = new ContainerManager(DISTRO, ARTIFACT, {
			configs: [
				{
					source: "/tmp/myfile.cfg",
					target: "/root/.config/myfile.cfg",
					isDir: false,
				},
			],
		});
		await cm.start();
		expect(withFilesSpy).toHaveBeenCalledWith([
			{ source: "/tmp/myfile.cfg", target: "/root/.config/myfile.cfg" },
		]);
	});

	test("start() calls withCopyDirectoriesToContainer for dir configs", async () => {
		const withDirectoriesSpy = vi.fn().mockReturnThis();
		mockNextContainer(createMockContainer(), {
			withCopyDirectoriesToContainer: withDirectoriesSpy,
		});
		const cm = new ContainerManager(DISTRO, ARTIFACT, {
			configs: [{ source: "/tmp/cfgdir", target: XDG_CONFIG, isDir: true }],
		});
		await cm.start();
		expect(withDirectoriesSpy).toHaveBeenCalledWith([
			{ source: "/tmp/cfgdir", target: XDG_CONFIG },
		]);
	});

	test("start() stops container if setup cmd fails", async () => {
		const container = createMockContainer({
			exec: vi
				.fn()
				// workdir init succeeds
				.mockResolvedValueOnce({ output: ["", ""], exitCode: 0 })
				// setup command fails
				.mockResolvedValueOnce({
					output: ["", "command not found"],
					exitCode: 127,
				}),
		});
		mockNextContainer(container);
		const cm = new ContainerManager(DISTRO, ARTIFACT, {
			setupCommands: ["badcmd"],
		});
		await expect(cm.start()).rejects.toThrow("setup cmd failed");
		expect(container.stop).toHaveBeenCalledTimes(1);
	});

	test("exec() clears timeout after a bounded successful command", async () => {
		const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
		try {
			const cm = await startedManager();
			await cm.exec("--version", { timeout: 1000 });
			expect(clearTimeoutSpy).toHaveBeenCalled();
		} finally {
			clearTimeoutSpy.mockRestore();
		}
	});

	test("exec() does not set a timer when timeout is 0 (no cap)", async () => {
		const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
		try {
			const cm = await startedManager();
			await cm.exec("--version");
			expect(setTimeoutSpy).not.toHaveBeenCalled();
		} finally {
			setTimeoutSpy.mockRestore();
		}
	});

	test("exec() stops the container after command timeout", async () => {
		const { container, cm } = await hangingContainerAndManager();
		expectTimedOut(await cm.exec("--hang", { timeout: 1 }), container);
	});

	test("start() can restart after timeout stops the container", async () => {
		const timedOutContainer = createHangingContainer();
		const restartedContainer = createMockContainer();
		mockNextContainer(timedOutContainer);
		GenericContainer.mockImplementationOnce(function RestartedContainerMock() {
			return createMockBuilder(restartedContainer);
		});
		const cm = await startedManager();
		await cm.exec("--hang", { timeout: 1 });

		await cm.start();

		expect(GenericContainer).toHaveBeenCalledTimes(2);
	});

	test("copyFile() routes directories to copyDirectoriesToContainer", async () => {
		const temporary = join(
			tmpdir(),
			`artisan-copy-dir-${Date.now()}-${Math.random().toString(16).slice(2)}`,
		);
		const fixtureDirectory = join(temporary, "fixture-dir");
		const container = createMockContainer();
		mockNextContainer(container);
		try {
			await mkdir(fixtureDirectory, { recursive: true });
			await writeFile(join(fixtureDirectory, "config.toml"), "[app]");
			const cm = await startedManager();
			await cm.copyFile(fixtureDirectory, XDG_CONFIG);
			expect(container.copyDirectoriesToContainer).toHaveBeenCalledWith([
				{ source: fixtureDirectory, target: XDG_CONFIG },
			]);
			expect(container.copyFilesToContainer).not.toHaveBeenCalled();
		} finally {
			await rm(temporary, { recursive: true, force: true });
		}
	});

	test("exec() accepts a pre-split array of args", async () => {
		const { container, cm } = await containerAndManager();
		await cm.exec([CMD_WRITE_FILE, SPACED_PATH, HELLO_WORLD]);
		expectExecCalledWith(container, [
			MOUNT_TARGET,
			CMD_WRITE_FILE,
			SPACED_PATH,
			HELLO_WORLD,
		]);
	});

	test("exec() preserves escapes and empty quoted args", async () => {
		const { container, cm } = await containerAndManager();
		await cm.exec(String.raw`msg "a b" "" "c\"d"`);
		expect(container.exec).toHaveBeenCalledWith(
			[MOUNT_TARGET, "msg", "a b", "", 'c"d'],
			expect.any(Object),
		);
	});

	test("exec() throws on unmatched single quote", async () => {
		const cm = await startedManager();
		await expect(cm.exec("arg 'unterminated")).rejects.toThrow(
			"unmatched single quote",
		);
	});

	test("exec() throws on unmatched double quote", async () => {
		const cm = await startedManager();
		await expect(cm.exec('arg "unterminated')).rejects.toThrow(
			"unmatched double quote",
		);
	});

	test("exec() throws on trailing backslash", async () => {
		const cm = await startedManager();
		await expect(cm.exec("arg\\")).rejects.toThrow("trailing backslash");
	});

	test("shell() stops the container after timeout", async () => {
		const { container, cm } = await hangingContainerAndManager();
		expectTimedOut(await cm.shell("sleep 999", { timeout: 1 }), container);
	});
});
