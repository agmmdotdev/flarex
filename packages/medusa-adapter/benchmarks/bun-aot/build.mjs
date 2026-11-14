import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [entry, mode, output] = process.argv.slice(2);
assert(entry === "decoders" || entry === "mechanisms");
assert(mode === "interpreter" || mode === "generated");
assert(output !== undefined);
await mkdir(resolve(output), { recursive: true });
// This is an experiment-only build control; installed schemas stay unchanged.
const bypass = { name: "schema-interpreter-control", setup(build) {
  build.onLoad({ filter: /\.schema-aot\.generated\.mjs$/ }, () => ({ contents: "export function install() {}", loader: "js" }));
} };
const result = await Bun.build({ entrypoints: [fileURLToPath(new URL(`./${entry}.ts`, import.meta.url))],
  target: "node", format: "esm", conditions: ["source"],
  outdir: resolve(output), naming: `${entry}-${mode}.mjs`,
  plugins: mode === "interpreter" ? [bypass] : [], sourcemap: "external" });
assert(result.success, result.logs.join("\n"));
console.log(JSON.stringify({ entry, mode, outputs: result.outputs.map(value => ({ path: value.path, size: value.size })) }));
