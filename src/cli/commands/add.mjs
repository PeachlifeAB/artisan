import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { UsageError } from "../../utils/errors.mjs";
import { fileExists } from "../../utils/fs.mjs";
import {
	readTemplate,
	resolveTemplatesDirectory,
} from "../../utils/template.mjs";
import { validateSinglePathName } from "../../utils/validation.mjs";
import { runAddConfig } from "./add-config.mjs";

const TEMPLATES_DIR = resolveTemplatesDirectory(
	import.meta.url,
	"../../../templates/tests",
);

const TYPE_MAP = {
	version: {
		template: "version.test.mjs.tmpl",
		filename: "cli-version.artisan.test.mjs",
	},
	help: {
		template: "help.test.mjs.tmpl",
		filename: "cli-help.artisan.test.mjs",
	},
	custom: { template: "custom.test.mjs.tmpl", filename: undefined },
};

export async function runAdd(type, options) {
	if (type === "config") return runAddConfig(options);

	const spec = TYPE_MAP[type];
	if (!spec)
		throw new UsageError(
			`Unknown test type: ${type}. Valid types: version, help, custom, config`,
		);

	let filename = spec.filename;
	if (type === "custom") {
		if (!options.name)
			throw new UsageError("--name is required for custom type");
		validateSinglePathName(options.name, "test name");
		filename = `${options.name}.artisan.test.mjs`;
	}

	const targetDirectory = join(process.cwd(), options.dir ?? "./tests/");
	await mkdir(targetDirectory, { recursive: true });

	const outPath = join(targetDirectory, filename);
	if (!options.force && (await fileExists(outPath))) {
		console.log(
			`Skipped ${outPath} (already exists, use --force to overwrite)`,
		);
		return;
	}

	let content = await readTemplate(TEMPLATES_DIR, spec.template);
	if (type === "custom") {
		// eslint-disable-next-line unicorn/no-unsafe-string-replacement
		content = content.replaceAll("{{TEST_NAME}}", options.name ?? "my test");
	}
	await writeFile(outPath, content, "utf8");
	console.log(`Created ${outPath}`);
}
