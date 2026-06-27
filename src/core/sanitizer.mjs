import { cp, mkdir, readdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

const SCRUB_PATTERNS = [
	/^\.env$/,
	/^\.env\..+$/,
	/^credentials?$/,
	/^creds$/,
	/\.token$/,
	/\.key$/,
	/\.pem$/,
	/^id_\w+$/,
	/\.pfx$/,
	/\.p12$/,
	/^temp$/,
	/^tmp$/,
	/^backups?$/,
	/^cache$/,
	/^\.cache$/,
];

function shouldScrub(name) {
	return SCRUB_PATTERNS.some((p) => p.test(name));
}

export async function sanitizeConfigDirectory(
	sourceDirectory,
	destinationDirectory,
	options = {},
) {
	const { raw = false } = options;
	const copied = [];
	const scrubbed = [];

	await mkdir(destinationDirectory, { recursive: true });

	if (raw) {
		await cp(sourceDirectory, destinationDirectory, { recursive: true });
		return { copied: [], scrubbed: [], manifestPath: undefined, raw: true };
	}

	await copyFiltered(sourceDirectory, destinationDirectory, "");

	const manifestPath = `${destinationDirectory}.artisan-sanitized`;
	await writeFile(
		manifestPath,
		JSON.stringify(
			{
				scaffoldedFrom: basename(sourceDirectory),
				scaffoldedAt: new Date().toISOString(),
				scrubbed,
				note: "Re-scaffold with: artisan add config <source>",
			},
			undefined,
			2,
		),
	);

	return { copied, scrubbed, manifestPath, raw: false };

	async function copyFiltered(source, destination, relativePath) {
		const entries = await readdir(source, { withFileTypes: true });
		entries.sort((a, b) => a.name.localeCompare(b.name));
		for (const entry of entries) {
			const childRelative = relativePath
				? `${relativePath}/${entry.name}`
				: entry.name;
			const sourcePath = join(source, entry.name);
			const destinationPath = join(destination, entry.name);
			if (shouldScrub(entry.name) || entry.isSymbolicLink()) {
				scrubbed.push(childRelative);
				continue;
			}
			if (entry.isDirectory()) {
				await mkdir(destinationPath, { recursive: true });
				await copyFiltered(sourcePath, destinationPath, childRelative);
			} else {
				await cp(sourcePath, destinationPath);
				copied.push(childRelative);
			}
		}
	}
}
