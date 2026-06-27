import { expect, test } from "@peachlife/artisan";

const INSTALL_NODE_COMMAND = [
	"if command -v node >/dev/null 2>&1; then exit 0; fi",
	"if command -v apt-get >/dev/null 2>&1; then apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends nodejs >/dev/null; exit $?; fi",
	"if command -v apk >/dev/null 2>&1; then apk add --no-cache nodejs >/dev/null; exit $?; fi",
	"if command -v pacman >/dev/null 2>&1; then pacman --disable-sandbox -Sy --noconfirm --needed nodejs >/dev/null; exit $?; fi",
	"echo 'No supported package manager found for installing nodejs' >&2; exit 1",
].join("; ");

async function copyArtisanRuntime(copyFixture) {
	await copyFixture("src", "/usr/local/src");
	await copyFixture("templates", "/usr/local/templates");
	await copyFixture("package.json", "/usr/local/package.json");
	await copyFixture("node_modules", "/usr/local/node_modules");
}

test("dogfoods Artisan init with the real CLI artifact", async ({
	copyFixture,
	run,
	setup,
}) => {
	await setup([
		INSTALL_NODE_COMMAND,
		"rm -rf /tmp/artisan-self-project",
		"mkdir -p /tmp/artisan-self-project/dist",
		String.raw`printf '#!/bin/sh\necho self-project\n' > /tmp/artisan-self-project/dist/self-cli`,
		"chmod +x /tmp/artisan-self-project/dist/self-cli",
	]);
	await copyArtisanRuntime(copyFixture);

	const init = await run("init --no-install --distros debian:stable-slim", {
		cwd: "/tmp/artisan-self-project",
	});
	expect(init.exitCode).toBe(0);
	expect(init.stdout).toContain("Created artisan.config.json");
	expect(init.stdout).toContain(
		"Created ./tests/artisan/cli-version.artisan.test.mjs",
	);

	await setup([
		"test -f /tmp/artisan-self-project/artisan.config.json",
		"test -f /tmp/artisan-self-project/tests/artisan/cli-version.artisan.test.mjs",
		"grep -q 'debian:stable-slim' /tmp/artisan-self-project/artisan.config.json",
	]);
});

test("dogfoods Artisan config fixture onboarding", async ({
	copyFixture,
	run,
	setup,
}) => {
	await setup([
		INSTALL_NODE_COMMAND,
		"rm -rf /tmp/artisan-config-project /tmp/artisan-config-source",
		"mkdir -p /tmp/artisan-config-project/dist /tmp/artisan-config-source",
		String.raw`printf '#!/bin/sh\necho config-project\n' > /tmp/artisan-config-project/dist/config-cli`,
		"chmod +x /tmp/artisan-config-project/dist/config-cli",
		String.raw`printf 'token=secret-token\n' > /tmp/artisan-config-source/.env`,
		String.raw`printf 'theme=dark\n' > /tmp/artisan-config-source/app.conf`,
	]);
	await copyArtisanRuntime(copyFixture);

	const init = await run("init --no-install --distros debian:stable-slim", {
		cwd: "/tmp/artisan-config-project",
	});
	expect(init.exitCode).toBe(0);
	const addConfig = await run(
		"add config /tmp/artisan-config-source --name app",
		{
			cwd: "/tmp/artisan-config-project",
		},
	);
	expect(addConfig.exitCode).toBe(0);
	expect(addConfig.stdout).toContain(
		"Created /tmp/artisan-config-project/fixtures/app",
	);
	expect(addConfig.stdout).toContain("scrubbed");
	expect(addConfig.stdout).toContain("manifest");

	await setup([
		"test -f /tmp/artisan-config-project/fixtures/app/app.conf",
		"test -f /tmp/artisan-config-project/fixtures/app.artisan-sanitized",
		"test ! -f /tmp/artisan-config-project/fixtures/app/.env",
		"grep -q './fixtures/app' /tmp/artisan-config-project/artisan.config.json",
	]);
});
