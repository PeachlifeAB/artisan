import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function expandUserPath(path, cwd = process.cwd()) {
	if (path === "~") return homedir();
	if (path.startsWith("~/")) return join(homedir(), path.slice(2));
	if (isAbsolute(path)) return path;
	return resolve(cwd, path);
}
