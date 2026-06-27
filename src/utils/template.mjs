import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export function resolveTemplatesDirectory(importMetaUrl, relativePath) {
	return join(dirname(fileURLToPath(importMetaUrl)), relativePath);
}

export async function readTemplate(templatesDirectory, name) {
	return readFile(join(templatesDirectory, name), "utf8");
}

export function renderTemplate(tmpl, variables) {
	return tmpl.replaceAll(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? "");
}
