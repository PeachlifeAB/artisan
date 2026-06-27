// .dependency-cruiser.cjs
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
	forbidden: [
		{
			name: "api-no-concrete-container",
			severity: "error",
			comment:
				"Only src/api/injection.mjs may depend on ContainerManager directly",
			from: {
				path: "^src/api/",
				pathNot: String.raw`^src/api/injection\.mjs$`,
			},
			to: { path: String.raw`^src/core/container-manager\.mjs$` },
		},
		{
			name: "cli-must-use-core-loader",
			severity: "warn",
			comment: "add-config.mjs should call loadConfig from config.mjs",
			from: { path: String.raw`^src/cli/commands/add-config\.mjs$` },
			to: { path: "^node:fs$|^fs$" },
		},
		{
			name: "cli-not-into-api-internals",
			severity: "error",
			from: { path: "^src/cli/commands/" },
			to: { path: String.raw`^src/api/(?!injection\.mjs)` },
		},
		{
			name: "not-to-template",
			severity: "error",
			from: { path: "^src/" },
			to: { path: "^templates/" },
		},
		// No circular imports
		{
			name: "no-circular",
			severity: "error",
			comment: "No circular imports allowed",
			from: {},
			to: { circular: true },
		},
		{
			name: "no-orphans",
			severity: "warn",
			comment: "Require every source file to be reachable from an entry",
			from: { orphan: true, path: "^src/" },
			to: {},
		},
		{
			name: "no-unresolved",
			severity: "error",
			from: {},
			to: {
				pathNot: ["^fs$", "^path$", "^crypto/polyfill", "^node:"],
				couldNotResolve: true,
			},
		},
		{
			name: "no-deprecated-core",
			severity: "warn",
			from: {},
			to: {
				dependencyTypes: ["core"],
				path: ["^util$", "^punycode$"],
				pathNot: "^node:",
			},
		},
	],
	options: {
		doNotFollow: { path: "node_modules" },
		exclude: {
			path: [
				"tests/",
				"examples/",
				".omt/",
				"node_modules",
				"dist/",
				".jscpd-report/",
			],
		},
		tsPreCompilationDeps: true,
	},
};
