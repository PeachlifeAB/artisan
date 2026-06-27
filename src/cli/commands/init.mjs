import { bootstrapProject } from "../bootstrap.mjs";

/**
 * Scaffold Artisan into the current project.
 *
 * CLI (`artisan init`) installs dependencies by default; `--no-install` skips.
 * Programmatic callers default to NO install so the function is side-effect
 * free (unit tests stay network-free).
 */
export async function runInit(options = {}) {
	await bootstrapProject({
		cwd: process.cwd(),
		distros: options.distros,
		force: options.force ?? false,
		install: options.install === true,
		installer: options.installer,
	});
}
