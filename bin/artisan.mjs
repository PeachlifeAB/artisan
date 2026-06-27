#!/usr/bin/env node
import { createProgram } from "../src/cli/parser.mjs";
import { ArtisanError } from "../src/utils/errors.mjs";

const program = createProgram();

try {
	await program.parseAsync(process.argv);
} catch (error) {
	if (error instanceof ArtisanError) {
		console.error(`artisan: ${error.message}`);
		process.exit(error.exitCode);
	}
	const message =
		error instanceof Error ? error.message : String(error ?? "unknown error");
	console.error(`artisan: unexpected error: ${message}`);
	process.exit(1);
}
