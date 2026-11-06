import { build } from "esbuild";
import { gzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const outfile = `${root}public/widget.js`;
const MAX_GZIP = 40 * 1024;

await build({
  entryPoints: [`${root}widget/src/main.ts`],
  outfile,
  bundle: true,
  minify: true,
  format: "iife",
  target: "es2019",
  jsx: "automatic",
  jsxImportSource: "preact",
  loader: { ".css": "text" },
  legalComments: "none",
  logLevel: "warning",
});

const bytes = readFileSync(outfile);
const gz = gzipSync(bytes, { level: 9 }).length;
const kb = (n) => (n / 1024).toFixed(1);
console.log(`public/widget.js: ${bytes.length} bytes raw (${kb(bytes.length)} KB), ${gz} bytes gzip (${kb(gz)} KB)`);
if (gz > MAX_GZIP) {
  console.error(`widget.js gzip size ${kb(gz)} KB exceeds the ${MAX_GZIP / 1024} KB budget`);
  process.exit(1);
}
