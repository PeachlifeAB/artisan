import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { join as joinPosix } from "node:path/posix";
import { GenericContainer } from "testcontainers";
import { DockerError } from "../utils/errors.mjs";
import { BINARY_MOUNT_DIR } from "./constants.mjs";

const NO_CAP = 0;
const SH_C = ["sh", "-c"];
const ERR_NOT_STARTED = "Container not started";
// eslint-disable-next-line sonarjs/publicly-writable-directories
const DEFAULT_WORKDIR = "/tmp/work";

function parseChar(state, char) {
	if (state.isEscaped) {
		state.current += char;
		state.isEscaped = false;
		return;
	}
	if (char === "\\" && !state.isInSingle) {
		state.isEscaped = true;
		return;
	}
	if (char === "'" && !state.isInDouble) {
		state.isInSingle = !state.isInSingle;
		state.isInToken = true;
		return;
	}
	if (char === '"' && !state.isInSingle) {
		state.isInDouble = !state.isInDouble;
		state.isInToken = true;
		return;
	}
	if (/\s/.test(char) && !state.isInSingle && !state.isInDouble) {
		if (state.isInToken) {
			state.parsed.push(state.current);
			state.current = "";
			state.isInToken = false;
		}
		return;
	}
	state.current += char;
	state.isInToken = true;
}

function splitArguments(arguments_) {
	const state = {
		parsed: [],
		current: "",
		isInToken: false,
		isInSingle: false,
		isInDouble: false,
		isEscaped: false,
	};
	for (const char of arguments_) parseChar(state, char);
	if (state.isEscaped)
		throw new Error("Malformed args string: trailing backslash");
	if (state.isInSingle)
		throw new Error("Malformed args string: unmatched single quote");
	if (state.isInDouble)
		throw new Error("Malformed args string: unmatched double quote");
	if (state.isInToken) state.parsed.push(state.current);
	return state.parsed;
}

function splitExecOutput(output) {
	if (Array.isArray(output)) return [output[0] ?? "", output[1] ?? ""];
	if (typeof output === "string") return [output, ""];
	return ["", ""];
}

function errorMessage(error) {
	return error instanceof Error
		? error.message
		: String(error ?? "unknown error");
}

export class ContainerManager {
	#distro;
	#artifactPath;
	#setupCommands;
	#configs;
	#env;
	#container = undefined;

	constructor(distro, artifactPath, options = {}) {
		this.#distro = distro;
		this.#artifactPath = artifactPath;
		this.#setupCommands = options.setupCommands ?? [];
		this.#configs = options.configs ?? [];
		this.#env = options.env ?? {};
	}

	get #mountTarget() {
		return joinPosix(BINARY_MOUNT_DIR, basename(this.#artifactPath));
	}

	/**
	 * Shared exec with optional timeout. timeout <= 0 means no cap (the
	 * per-test timeout is the authoritative safety net). When a timeout fires,
	 * the container is stopped and a timedOut result is returned.
	 */
	async #execBounded(command, execOptions, timeout, label = "exec") {
		let isTimedOut = false;
		let timeoutId;
		const execPromise = this.#container
			.exec(command, execOptions)
			// eslint-disable-next-line unicorn/prefer-await
			.catch((error) => {
				if (isTimedOut) return { output: ["", ""], exitCode: 1 };
				throw error;
			});
		const timeoutPromise =
			timeout > 0
				? new Promise((resolve) => {
						timeoutId = setTimeout(() => {
							isTimedOut = true;
							resolve({ timedOut: true });
						}, timeout);
					})
				: undefined;
		try {
			const result = timeoutPromise
				? await Promise.race([execPromise, timeoutPromise])
				: await execPromise;
			if (timeoutId) clearTimeout(timeoutId);
			if (result?.timedOut) {
				await this.stop();
				return {
					stdout: "",
					stderr: "Command timed out",
					exitCode: 1,
					timedOut: true,
				};
			}
			const [stdout, stderr] = splitExecOutput(result.output);
			return {
				stdout,
				stderr,
				exitCode: result.exitCode ?? 0,
				timedOut: false,
			};
		} catch (error) {
			if (timeoutId) clearTimeout(timeoutId);
			throw new DockerError(`${label} failed: ${errorMessage(error)}`);
		}
	}

	async start() {
		if (this.#container) return;
		try {
			let builder = new GenericContainer(this.#distro)
				.withCommand([...SH_C, "tail -f /dev/null"])
				.withBindMounts([
					{
						source: this.#artifactPath,
						target: this.#mountTarget,
						mode: "ro",
					},
				])
				.withEnvironment(this.#env);

			const files = this.#configs.filter((c) => !c.isDir);
			const directories = this.#configs.filter((c) => c.isDir);
			if (files.length > 0) {
				builder = builder.withCopyFilesToContainer(
					files.map((c) => ({ source: c.source, target: c.target })),
				);
			}
			if (directories.length > 0) {
				builder = builder.withCopyDirectoriesToContainer(
					directories.map((c) => ({ source: c.source, target: c.target })),
				);
			}

			this.#container = await builder.start();

			const workdirResult = await this.#execBounded(
				[...SH_C, `mkdir -p ${DEFAULT_WORKDIR}`],
				{},
				NO_CAP,
			);
			if (workdirResult.exitCode !== 0) {
				throw new DockerError(
					`failed to initialize default workdir ${DEFAULT_WORKDIR}\n${workdirResult.stderr || workdirResult.stdout}`,
				);
			}

			for (const command of this.#setupCommands) {
				const result = await this.#execBounded([...SH_C, command], {}, NO_CAP);
				if (result.exitCode !== 0) {
					throw new DockerError(
						`setup cmd failed for ${this.#distro}: ${command}\n${result.stderr || result.stdout}`,
					);
				}
			}
		} catch (error) {
			if (this.#container) {
				try {
					await this.#container.stop();
					// eslint-disable-next-line no-empty
				} catch {}
				this.#container = undefined;
			}
			if (error instanceof DockerError) throw error;
			throw new DockerError(
				`Failed to start container for ${this.#distro}: ${errorMessage(error)}`,
			);
		}
	}

	async exec(arguments_, options = {}) {
		if (!this.#container) throw new DockerError(ERR_NOT_STARTED);
		const {
			env: environment = {},
			timeout = NO_CAP,
			cwd = DEFAULT_WORKDIR,
		} = options;
		const command = [
			this.#mountTarget,
			...(Array.isArray(arguments_) ? arguments_ : splitArguments(arguments_)),
		];
		return this.#execBounded(
			command,
			{ env: environment, workingDir: cwd },
			timeout,
			"exec",
		);
	}

	async shell(command, options = {}) {
		if (!this.#container) throw new DockerError(ERR_NOT_STARTED);
		const { timeout = NO_CAP } = options;
		return this.#execBounded([...SH_C, command], {}, timeout, "shell");
	}

	async copyFile(localPath, containerPath) {
		if (!this.#container) throw new DockerError(ERR_NOT_STARTED);
		const st = await stat(localPath);
		const entry = { source: localPath, target: containerPath };
		if (st.isDirectory()) {
			await this.#container.copyDirectoriesToContainer([entry]);
		} else {
			await this.#container.copyFilesToContainer([entry]);
		}
	}

	async stop() {
		if (!this.#container) return;
		await this.#container.stop();
		this.#container = undefined;
	}
}
