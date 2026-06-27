import { realpath, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";
import { join as joinPosix } from "node:path/posix";
import { UsageError } from "../utils/errors.mjs";

/**
 * @typedef {{ source: string; target: string; isDir: boolean }} ResolvedConfig
 */

function validateEntrySource(source_, destination) {
	if (source_.startsWith("~")) {
		throw new UsageError(
			`fixture src "${source_}" must not start with "~" — scaffold it with: artisan add config ${source_}`,
		);
	}
	if (isAbsolute(source_)) {
		throw new UsageError(
			`fixture src "${source_}" must be repo-relative, not absolute — copy it into ./fixtures/ first`,
		);
	}
	if (destination !== undefined && !isAbsolute(destination)) {
		throw new UsageError(
			`dest "${destination}" must be an absolute container path`,
		);
	}
}

async function resolveEntrySource(source_, source, repoRoot) {
	try {
		const real = await realpath(source);
		const relativeToRoot = relative(repoRoot, real);
		if (relativeToRoot.startsWith("..") || isAbsolute(relativeToRoot)) {
			throw new UsageError(
				`fixture "${source_}" escapes the project root — copy it into ./fixtures/ first`,
			);
		}
		const st = await stat(real);
		return { real, st };
	} catch (error) {
		if (error instanceof UsageError) throw error;
		if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
			throw new UsageError(
				`fixture "${source_}" not found at ${source} — scaffold it with: artisan add config ${source_}`,
			);
		}
		throw error;
	}
}

async function resolveEntry(entry, cwd, repoRoot, defaultDestinationDirectory) {
	const source_ = typeof entry === "string" ? entry : entry.src;
	const destination = typeof entry === "string" ? undefined : entry.dest;

	validateEntrySource(source_, destination);

	const source = resolve(cwd, source_);
	const { real, st } = await resolveEntrySource(source_, source, repoRoot);

	let target;
	if (destination) {
		target = destination;
	} else if (st.isDirectory()) {
		target = defaultDestinationDirectory;
	} else {
		target = joinPosix(defaultDestinationDirectory, basename(source_));
	}

	return { source: real, target, isDir: st.isDirectory() };
}

/**
 * Validate and resolve config entries to absolute source/target pairs.
 *
 * @param {Array<string|{src: string, dest: string}>} configs
 * @param {string} cwd - project root (absolute)
 * @param {string} artifactName - name used as XDG sub-directory
 * @param {string} [xdgBase='/root/.config'] - base for XDG config dir
 * @returns {Promise<ResolvedConfig[]>}
 */
export async function resolveConfigs(
	configs,
	cwd,
	artifactName,
	xdgBase = "/root/.config",
) {
	const defaultDestinationDirectory = joinPosix(xdgBase, artifactName);
	const repoRoot = await realpath(cwd);
	const resolved = [];

	for (const entry of configs) {
		resolved.push(
			await resolveEntry(entry, cwd, repoRoot, defaultDestinationDirectory),
		);
	}

	return resolved;
}
