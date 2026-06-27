# Artisan

> **End-to-end artifact testing for CLIs.**
> Stop merging green unit tests for broken binaries.

Unit tests verify your logic. Artisan proves your binary actually executes.

Artisan mounts your compiled CLI into ephemeral Linux containers across a
distro matrix (Debian, Alpine, Arch) and lets you assert stdout, stderr,
exit codes, and real filesystem mutations using a familiar Vitest API.

Backed by **Testcontainers**, **Execa**, and **Vitest**.

## Why Artisan?

* **Catch runtime blindspots:** Detect `glibc` vs `musl` mismatches,
  missing system dependencies, and hardcoded host paths.
* **Agent-proof your workflow:** LLMs are great at writing passing unit
  tests for code that fails at runtime. Artisan enforces that "done" means
  the *artifact* works.
* **Zero-config discovery:** Automatically finds executables in
  `package.json#bin`, `./dist`, or `./bin`.

## Quickstart

Build your project, then run Artisan. It auto-discovers a single executable
in `dist/` or `bin/` — no config needed.

```bash
npx @peachlife/artisan test
```

If you don't have tests yet, Artisan bootstraps your environment, installs
dependencies, and generates a starter test on the first run.

If you have multiple binaries or a non-standard output path, point to
a single artifact:

```bash
npx @peachlife/artisan test --artifact ./build/my-cli
```

## The API

Test what users actually observe. Assert on exit codes, output, and
container filesystem side-effects.

```javascript
// tests/artisan/cli.artisan.test.mjs
import { expect, test } from "@peachlife/artisan";

test("writes expected output to the filesystem", async ({ run, setup }) => {
  // Setup container state
  await setup(["rm -f /tmp/output.txt"]);

  // Execute the compiled artifact
  const { stdout, exitCode } = await run([
    "write-file",
    "/tmp/output.txt",
    "unicorn sequence initiated",
  ]);

  // Assert binary execution
  expect(exitCode).toBe(0);
  expect(stdout).toContain("wrote /tmp/output.txt");

  // Assert filesystem side-effects
  await setup([
    "test -f /tmp/output.txt",
    "grep -q '^unicorn sequence initiated$' /tmp/output.txt",
  ]);
});
```

## Matrix Testing via Config

Need to test across different environments? Drop an `artisan.config.json`
in your root:

```json
{
  "distros": ["debian:stable-slim", "alpine:latest", "archlinux/archlinux:latest"],
  "testMatch": "**/*.artisan.test.mjs",
  "parallel": true
}
```

Set `"artifact"` only if auto-discovery can't find your binary (multiple
executables or a non-standard path).

## Config Fixtures

Config parsing is where most CLIs silently fail (`~` paths, wrong XDG
locations, missing files). Artisan can capture your host configuration,
scrub secrets, and mount it cleanly into the sandbox's `$XDG_CONFIG_HOME`.

```bash
# Capture, sanitize, and inject real config into your tests
npx @peachlife/artisan add config ~/.config/mycli --name mycli-config
```

## CLI Reference

| Command | Description |
| --- | --- |
| `npx @peachlife/artisan test` | Run all tests across the configured matrix |
| `npx @peachlife/artisan test <file>` | Run a specific test file |
| `npx @peachlife/artisan test -t "auth"` | Filter test execution by regex |
| `npx @peachlife/artisan test --serial` | Run distros sequentially |
| `npx @peachlife/artisan init` | Scaffold setup without running tests |

### Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | All tests passed |
| `1` | One or more tests failed / timed out |
| `2` | Usage or configuration error |
| `125` | Docker/container startup error |
| `130` | Interrupted by the user |

## CI Integration

Artisan runs perfectly in CI as long as the runner has Docker access.

> **CI tip:** if your pipeline manages its own `npm ci` step, pass
> `--no-install` to `artisan init` or `artisan test --bootstrap` to skip
> the redundant install.

```yaml
name: Artifact Tests
on: [push, pull_request]

jobs:
  artisan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm ci
      - run: npm run build # Ensure your artifact is compiled!
      - run: npx @peachlife/artisan test --artifact <my-cli> --no-color
```

## License

MIT
