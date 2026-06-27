import { describe, expect, test } from "vitest";
import { createProgram } from "../../src/cli/parser.mjs";

describe("createProgram", () => {
	function findCommand(parent, name) {
		return parent.commands.find((command) => command.name() === name);
	}

	function findOption(command, flag) {
		return command.options.find((option) => option.long === flag);
	}

	test("exits 0 on --version", async () => {
		const program = createProgram();
		let version;
		program.exitOverride();
		try {
			await program.parseAsync(["node", "artisan", "--version"]);
		} catch (error) {
			version = error.code === "commander.version" ? error.message : undefined;
		}
		expect(version).toMatch(/\d{1,10}\.\d{1,10}\.\d{1,10}/u);
	});

	test("has init, test, add subcommands", () => {
		const program = createProgram();
		const names = program.commands.map((command) => command.name());
		expect(names).toContain("init");
		expect(names).toContain("test");
		expect(names).toContain("add");
	});

	test("test cmd has --distros flag", () => {
		const program = createProgram();
		expect(findOption(findCommand(program, "test"), "--distros")).toBeDefined();
	});

	test("test cmd has --reporter flag", () => {
		const program = createProgram();
		expect(
			findOption(findCommand(program, "test"), "--reporter"),
		).toBeDefined();
	});

	test("add has subcommands: version, help, custom, config", () => {
		const program = createProgram();
		const names = findCommand(program, "add").commands.map((command) =>
			command.name(),
		);
		expect(names).toContain("version");
		expect(names).toContain("help");
		expect(names).toContain("custom");
		expect(names).toContain("config");
	});

	test("add custom has --name flag", () => {
		const program = createProgram();
		const customCommand = findCommand(findCommand(program, "add"), "custom");
		expect(findOption(customCommand, "--name")).toBeDefined();
	});

	test("add config has --raw, --force, --name flags", () => {
		const program = createProgram();
		const configCommand = findCommand(findCommand(program, "add"), "config");
		const optNames = configCommand.options.map((option) => option.long);
		expect(optNames).toContain("--raw");
		expect(optNames).toContain("--force");
		expect(optNames).toContain("--name");
	});

	test("--reporter has no hardcoded default so config can provide it", () => {
		const program = createProgram();
		const opt = findOption(findCommand(program, "test"), "--reporter");
		expect(opt.defaultValue).toBeUndefined();
	});

	test("--timeout rejects non-numeric values", async () => {
		const program = createProgram().exitOverride();
		let caught;
		try {
			await program.parseAsync(["node", "artisan", "test", "--timeout", "abc"]);
		} catch (error) {
			caught = error;
		}
		expect(caught).toBeDefined();
		expect(String(caught?.message ?? "")).toMatch(/timeout/);
	});
});
