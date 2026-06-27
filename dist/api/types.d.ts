/// <reference lib="dom" />

export type ConfigEntry = string | { src: string; dest: string };

export interface ArtisanConfig {
	artifact: string;
	distros: string[];
	testMatch: string;
	timeout: number;
	parallel: boolean;
	setup: Record<string, string[]>;
	configs: ConfigEntry[];
	reporter: "default" | "junit" | "json" | "tap";
}

export interface RunResult {
	stdout: string;
	stderr: string;
	exitCode: number;
	timedOut: boolean;
}

export interface RunOptions {
	env?: Record<string, string>;
	timeout?: number;
	cwd?: string;
}

export interface ArtisanTestContext {
	run: (args?: string, options?: RunOptions) => Promise<RunResult>;
	copyFixture: (localPath: string, containerPath: string) => Promise<void>;
	setup: (commands: string[]) => Promise<void>;
}

export {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
} from "vitest";
