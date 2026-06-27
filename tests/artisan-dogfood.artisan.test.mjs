import { expect, test } from "@peachlife/artisan";

test("runs the built CLI like a regular Vitest test", async ({ run }) => {
	const { exitCode, stdout } = await run("--version");

	expect(exitCode).toBe(0);
	expect(stdout).toContain("1.0.0");
});

test("checks normal CLI output", async ({ run }) => {
	const { exitCode, stdout } = await run("--help");

	expect(exitCode).toBe(0);
	expect(stdout).toContain("Usage: dogfood-cli <command>");
});

test("checks filesystem side effects", async ({ run, setup }) => {
	await setup(["rm -f /tmp/dogfood-output.txt"]);

	const { exitCode, stdout } = await run(
		"write-file /tmp/dogfood-output.txt sandboxed",
	);

	expect(exitCode).toBe(0);
	expect(stdout).toContain("wrote /tmp/dogfood-output.txt");

	await setup([
		"test -f /tmp/dogfood-output.txt",
		"grep -q '^sandboxed$' /tmp/dogfood-output.txt",
	]);
});

test("surfaces runtime failures as normal failed assertions", async ({
	run,
}) => {
	const { exitCode, stderr, stdout } = await run("fail");

	expect(exitCode).toBe(1);
	expect(`${stdout}${stderr}`).toContain("intentional failure");
});

test("config fixture is copied into container and readable by artifact", async ({
	run,
}) => {
	const { exitCode, stdout } = await run("read-config");

	expect(exitCode).toBe(0);
	expect(stdout).toContain('theme = "dark"');
});
