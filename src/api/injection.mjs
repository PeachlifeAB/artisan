export {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
} from "vitest";

import { test as vitestTest } from "vitest";
import { DEFAULT_XDG_CONFIG_HOME } from "../core/constants.mjs";
import { ContainerManager } from "../core/container-manager.mjs";

export function createTestContext(container) {
	return {
		async run(arguments_ = "", options = {}) {
			return container.exec(arguments_, options);
		},
		async copyFixture(localPath, containerPath) {
			return container.copyFile(localPath, containerPath);
		},
		async setup(commands, options = {}) {
			for (const command of commands) {
				const result = await container.shell(command, options);
				if (result.exitCode !== 0) {
					throw new Error(
						`setup cmd failed: ${command}\n${result.stderr || result.stdout}`,
					);
				}
			}
		},
	};
}

function createContainer(
	distro,
	artifact,
	setupCommands,
	configs,
	xdgConfigHome,
) {
	return new ContainerManager(distro, artifact, {
		setupCommands,
		configs,
		env: {
			HOME: "/root",
			XDG_CONFIG_HOME: xdgConfigHome,
		},
	});
}

// Build fixture-extended test from env vars (set by artisan test command).
function buildExtendedTest() {
	const distro = process.env.ARTISAN_DISTRO;
	const artifact = process.env.ARTISAN_ARTIFACT;
	if (!distro || !artifact) return vitestTest;

	const setupCommands = JSON.parse(process.env.ARTISAN_SETUP ?? "[]");
	const configs = JSON.parse(process.env.ARTISAN_CONFIGS ?? "[]");
	const xdgConfigHome =
		process.env.ARTISAN_XDG_CONFIG_HOME ?? DEFAULT_XDG_CONFIG_HOME;

	return vitestTest
		.extend("artisanContext", async ({ task: _task }, { onCleanup }) => {
			const container = createContainer(
				distro,
				artifact,
				setupCommands,
				configs,
				xdgConfigHome,
			);
			await container.start();
			onCleanup(() => container.stop());
			return createTestContext(container);
		})
		.extend("run", async ({ artisanContext }) =>
			artisanContext.run.bind(artisanContext),
		)
		.extend("copyFixture", async ({ artisanContext }) =>
			artisanContext.copyFixture.bind(artisanContext),
		)
		.extend("setup", async ({ artisanContext }) =>
			artisanContext.setup.bind(artisanContext),
		);
}

export const test = buildExtendedTest();
