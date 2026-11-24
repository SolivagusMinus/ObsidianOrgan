import esbuild from "esbuild";
import builtins from "builtin-modules";

const mode = process.argv[2];

if (mode === "test") {
	// Bundle pure-logic tests for node --test (no Obsidian runtime needed).
	await esbuild.build({
		entryPoints: ["test/render.test.ts"],
		bundle: true,
		platform: "node",
		format: "esm",
		outdir: "test-dist",
		outExtension: { ".js": ".mjs" },
		logLevel: "info",
	});
	process.exit(0);
}

const prod = mode === "production";

const context = await esbuild.context({
	entryPoints: ["src/main.ts"],
	bundle: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/*",
		"@lezer/*",
		...builtins,
	],
	format: "cjs",
	target: "es2020",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outfile: "main.js",
});

if (prod) {
	await context.rebuild();
	process.exit(0);
} else {
	await context.watch();
}
