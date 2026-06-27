import fg from "fast-glob";

export async function resolveTestFiles(pattern, cwd) {
	return fg(pattern, { cwd, absolute: true });
}
