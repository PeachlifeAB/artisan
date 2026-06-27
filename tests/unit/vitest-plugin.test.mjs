import { expect, test } from "vitest";
import { createTestContext } from "../../src/api/injection.mjs";

// Verify context shape is correct
test("createTestContext returns object with run, copyFixture, setup", () => {
	const mockContainer = {
		exec: async () => ({
			stdout: "",
			stderr: "",
			exitCode: 0,
			timedOut: false,
		}),
		copyFile: async () => {},
	};
	const context = createTestContext(mockContainer);
	expect(typeof context.run).toBe("function");
	expect(typeof context.copyFixture).toBe("function");
	expect(typeof context.setup).toBe("function");
});
