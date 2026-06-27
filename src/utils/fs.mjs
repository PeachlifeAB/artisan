import { access } from "node:fs/promises";

export async function fileExists(path) {
	try {
		await access(path);
		return true;
	} catch (error) {
		if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return false;
		throw error;
	}
}
