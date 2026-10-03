// Bundles each extension entry point into a single self-contained file in dist/.
// MV3 content scripts cannot load ES modules, so every entry is built as an IIFE with no shared chunks.
import { build, context } from "esbuild";
import { cpSync, mkdirSync, rmSync } from "node:fs";

const watch = process.argv.includes("--watch");
const outdir = "dist";

rmSync(outdir, { recursive: true, force: true });
mkdirSync(outdir, { recursive: true });
cpSync("public", outdir, { recursive: true });
cpSync("manifest.json", `${outdir}/manifest.json`);

const options = {
  entryPoints: {
    background: "src/background/index.ts",
    content: "src/content/index.ts",
    popup: "src/popup/main.tsx",
  },
  outdir,
  bundle: true,
  format: "iife",
  target: "chrome120",
  sourcemap: watch ? "inline" : false,
  minify: !watch,
  jsx: "automatic",
  define: { "process.env.NODE_ENV": JSON.stringify(watch ? "development" : "production") },
  logLevel: "info",
};

if (watch) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
