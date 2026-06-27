---
name: artisan-dogfood-test
description: "Use when proving a CLI artifact works in real sandboxes: dogfood tests, artifact tests, Docker distro tests, config fixtures, stdout/stderr/exit-code assertions, artisan init/test/add config."
license: Apache-2.0
metadata:
  author: David Åberg
  version: "1.0"
---

# Artisan Dogfood Test

Use this skill when CLI work must be proven against the **built artifact**, not
just source-level unit tests.

Artisan closes the gap between unit tests, integration tests, and dogfood tests.
It runs the binary users will run inside clean Docker containers, then asserts
real command behavior with JavaScript tests.

## Activate When

- A feature or fix touches a CLI artifact.
- An agent is about to claim CLI work is ready.
- Unit tests are green but the compiled binary still needs proof.
- Runtime behavior depends on args, config, files, paths, permissions, distro
  packages, or environment variables.
- The task mentions artifact tests, dogfood tests, sandbox tests, Docker, distro
  compatibility, `artisan init`, `artisan test`, or `artisan add config`.

## What Artisan Proves

- The artifact exists and is executable.
- The command starts in a clean Linux container.
- stdout, stderr, and exit codes match user-visible behavior.
- Config fixtures resolve without host-only paths.
- Filesystem side effects happen where expected.
- Distro-specific dependencies are declared explicitly.
- The result is reproducible outside the developer's machine.

## Hard Rules

- Test the artifact users run. Do not replace dogfood proof with source-level
  unit tests.
- Exit code is truth: green means `artisan test` exits `0`.
- No error-substring whitelists. Fix the artifact, fixture, setup, or assertion.
- Keep `artifact` and `configs` paths repo-relative in `artisan.config.json`.
- Never commit `~`, absolute host paths, or paths that escape the repo in config.
- Import real configs with `npx @peachlife/artisan add config <source> --name
  <fixture>` unless the user explicitly accepts `--raw`.
- Use `copyFixture()` for one-off test files; use `configs` for committed config
  directories or files shared across tests.
- Declare sandbox dependencies explicitly with distro-appropriate setup
  commands. Do not silently install or skip dependencies.

## Decision Gates

- **Artifact path unknown** — Inspect project build output, `package.json#bin`,
  `./dist`, and `./bin`; choose the actual executable artifact.
- **Artifact missing** — Build the project first; do not scaffold tests against
  a non-existent binary.
- **Artifact not executable** — Fix the build or run `chmod +x <artifact>`
  when that is the correct artifact packaging step.
- **Docker unavailable** — Report Docker as a blocker; do not call artifact
  tests complete.
- **Config path uses `~` or absolute host path** — Import/copy it into
  `./fixtures/` and reference the repo-relative fixture.
- **Test needs one file** — Prefer `copyFixture(localPath, containerPath)`
  inside that test.
- **Test needs a reusable config tree** — Use
  `npx @peachlife/artisan add config <source> --name <fixture>`.
- **Alpine package missing** — Add `apk add --no-cache ...` setup for Alpine.
- **Debian package missing** — Add `apt-get update -qq && apt-get install -y
  --no-install-recommends ...` setup for Debian.
- **Failure only happens in one distro** — Keep that distro in the matrix and
  fix the product/setup; do not remove the distro to get green.

## Execution Steps

1. Identify the artifact path users execute.
2. Build the artifact if it does not exist.
3. Verify prerequisites:
   - `node --version` satisfies the project requirement.
   - `docker info` exits `0`.
   - `test -x <artifact>` exits `0`.
4. Run Artisan via npx (no install needed):
   - `npx @peachlife/artisan ...`
5. Initialize config when needed:
   - `npx @peachlife/artisan init -y --artifact ./dist/mycli --distros debian:stable-slim,alpine:latest`.
6. Keep `artisan.config.json` minimal and explicit:
   - `artifact`, `distros`, `testMatch`, `timeout`, `parallel`, `setup`,
     `configs`, `reporter` only when needed.
7. Add the smallest meaningful `*.artisan.test.mjs` first:
   - assert `exitCode`;
   - assert stdout/stderr that users see;
   - assert filesystem side effects when relevant.
8. Add config fixture tests only when config is part of the behavior.
9. Run a focused test while developing:
   - `npx @peachlife/artisan test ./tests/<name>.artisan.test.mjs --serial --verbose`.
10. Run the full dogfood matrix before claiming ready:
    - `npx @peachlife/artisan test`.
11. Report commands, exit codes, distros, artifact path, config fixtures, and
    unresolved blockers.

## Minimal Test Pattern

```javascript
import { expect, test } from "@peachlife/artisan";

test("CLI outputs correct version", async ({ run }) => {
  const { stdout, exitCode } = await run("--version");

  expect(exitCode).toBe(0);
  expect(stdout).toContain("1.0.0");
});
```

## Config Fixture Pattern

```bash
npx @peachlife/artisan add config ~/.config/mycli --name mycli-config
```

Then assert the artifact reads the fixture from the sandbox, not from the host machine:

```javascript
import { expect, test } from "@peachlife/artisan";

test("CLI reads committed config fixture", async ({ run }) => {
  const { stdout, exitCode } = await run("read-config");

  expect(exitCode).toBe(0);
  expect(stdout).toContain("theme");
});
```

## Output Contract

Return:

- artifact path tested;
- files changed;
- commands run with exit codes;
- distros tested;
- config fixtures added or used;
- failing stdout/stderr excerpts when red;
- unresolved Docker, artifact, config, or distro blockers.

## References

- `references/bootstrap-cli-artifact-tests.md` — fuller command/config examples
  and troubleshooting matrix.
