import { UsageError } from "./errors.mjs";

export function validateSinglePathName(name, label) {
	if (
		!name ||
		name === "." ||
		name === ".." ||
		name.includes("/") ||
		name.includes("\\")
	) {
		throw new UsageError(`--name must be a single ${label}, not a path`);
	}
}
