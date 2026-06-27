import {
	access,
	constants,
	readdir,
	readFile,
	realpath,
	stat,
} from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { UsageError } from "../utils/errors.mjs";

const COMMON_ARTIFACT_DIRS = ["dist", "bin"];

async function isExecutableFile(path) {
	try {
		const stats = await stat(path);
		if (!stats.isFile()) return false;
		await access(path, constants.X_OK);
		return true;
	} catch (error) {
		if (
			error?.code === "ENOENT" ||
			error?.code === "ENOTDIR" ||
			error?.code === "EACCES"
		) {
			return false;
		}
		throw error;
	}
}

async function packageBinCandidates(cwd) {
	try {
		const raw = await readFile(join(cwd, "package.json"), "utf8");
		const package_ = JSON.parse(raw);
		if (typeof package_.bin === "string") return [resolve(cwd, package_.bin)];
		if (
			package_.bin &&
			typeof package_.bin === "object" &&
			!Array.isArray(package_.bin)
		) {
			return Object.values(package_.bin)
				.filter((value) => typeof value === "string" && value.trim() !== "")
				.map((value) => resolve(cwd, value));
		}
		return [];
	} catch (error) {
		if (error?.code === "ENOENT") return [];
		if (error instanceof SyntaxError) {
			throw new UsageError(
				`package.json contains invalid JSON at ${join(cwd, "package.json")}`,
			);
		}
		throw error;
	}
}

async function directoryArtifactCandidates(cwd) {
	const candidates = [];
	for (const directoryName of COMMON_ARTIFACT_DIRS) {
		const directory = join(cwd, directoryName);
		let entries;
		try {
			entries = await readdir(directory, { withFileTypes: true });
		} catch (error) {
			if (error?.code === "ENOENT" || error?.code === "ENOTDIR") continue;
			throw error;
		}
		for (const entry of entries) {
			if (entry.isFile()) candidates.push(join(directory, entry.name));
		}
	}
	return candidates;
}

async function discoverArtifact(cwd) {
	const candidates = [
		...(await packageBinCandidates(cwd)),
		...(await directoryArtifactCandidates(cwd)),
	];
	const unique = [...new Set(candidates)];
	const realCwd = await realpath(cwd);
	const executable = [];
	for (const candidate of unique) {
		try {
			const realCandidate = await realpath(candidate);
			const relativePath = relative(realCwd, realCandidate);
			if (relativePath.startsWith("..") || isAbsolute(relativePath)) continue;
		} catch {
			continue;
		}
		if (await isExecutableFile(candidate)) executable.push(candidate);
	}
	if (executable.length === 1) return executable[0];
	if (executable.length > 1) {
		throw new UsageError(
			`Multiple executables found in dist/ and bin/ — cannot choose automatically:\n  ${executable.join("\n  ")}\n\nSet "artifact" in artisan.config.json or pass --artifact to pick one.`,
		);
	}
	throw new UsageError(
		"No executable found in dist/ or bin/. Build your project first, then run artisan again.\nOr pass --artifact to point directly to your binary.",
	);
}

export async function resolveArtifact(artifactPath, cwd = process.cwd()) {
	if (
		artifactPath === undefined ||
		artifactPath === null ||
		artifactPath.trim?.() === ""
	) {
		return discoverArtifact(cwd);
	}
	if (typeof artifactPath !== "string") {
		throw new UsageError("Artifact path must be a string");
	}
	const abs = isAbsolute(artifactPath)
		? artifactPath
		: resolve(cwd, artifactPath);
	try {
		await access(abs, constants.F_OK);
	} catch (error) {
		if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
			throw new UsageError(`Artifact not found: ${abs}`);
		}
		throw new UsageError(`Cannot access artifact at ${abs}: ${error.message}`);
	}
	const stats = await stat(abs);
	if (!stats.isFile()) {
		throw new UsageError(`Artifact is not a file: ${abs}`);
	}
	try {
		await access(abs, constants.X_OK);
	} catch {
		throw new UsageError(`Artifact is not executable: ${abs}`);
	}
	return abs;
}
