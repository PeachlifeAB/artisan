import { describe, expect, test } from "vitest";
import {
	ArtisanError,
	DockerError,
	InterruptError,
	UsageError,
} from "../../src/utils/errors.mjs";

describe("ArtisanError", () => {
	test("has exitCode 1 by default", () => {
		const artisanError = new ArtisanError("boom");
		expect(artisanError.exitCode).toBe(1);
		expect(artisanError.message).toBe("boom");
	});

	test("UsageError has exitCode 2", () => {
		expect(new UsageError("bad arg").exitCode).toBe(2);
	});

	test("DockerError has exitCode 125", () => {
		expect(new DockerError("no daemon").exitCode).toBe(125);
	});

	test("InterruptError has exitCode 130", () => {
		expect(new InterruptError().exitCode).toBe(130);
	});
});
