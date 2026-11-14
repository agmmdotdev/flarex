import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { readRuntimeSources } from "./runtime-sources.mjs";

const { values, positionals } = parseArgs({ allowPositionals: true,
  options: { "runtime-source-revision": { type: "string" }, scenario: { type: "string", default: "mixed-product" } } });
const [mode, output] = positionals;
assert.equal(positionals.length, 2);
assert(mode === "interpreter" || mode === "generated");
assert(output !== undefined);
assert(["mixed-product", "product-workflow"].includes(values.scenario));
await mkdir(resolve(output), { recursive: true });
const bypass = { name: "schema-interpreter-control", setup(build) {
  build.onLoad({ filter: /\.schema-aot\.generated\.mjs$/ }, () => ({ contents: "export function install() {}", loader: "js" }));
} };
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const source = values["runtime-source-revision"] === undefined ? undefined : readRuntimeSources(root, values["runtime-source-revision"]);
const normalizePath = path => process.platform === "win32" ? resolve(path).toLowerCase() : resolve(path);
const replacements = new Map(source?.files.map(file => [normalizePath(resolve(root, file.path)), file.contents]));
const override = { name: "fixed-runtime-source-control", setup(build) {
  build.onLoad({ filter: /(?:bytes|document-value|query)\.ts$/ }, args => {
    const contents = replacements.get(normalizePath(args.path));
    if (contents !== undefined) return { contents, loader: "ts", resolveDir: dirname(args.path) };
  });
} };
const built = await Bun.build({ entrypoints: [fileURLToPath(new URL(values.scenario === "mixed-product" ? "./worker.ts" : "./workflow-worker.ts", import.meta.url))],
  // Native Medusa entrypoints use their existing built legacy-decorator output,
  // as the direct performance harness does. The Core imports remain real source.
  target: "node", format: "esm", outdir: resolve(output),
  naming: `${values.scenario}-${mode}.mjs`, sourcemap: "external",
  plugins: [...(source === undefined ? [] : [override]), ...(mode === "interpreter" ? [bypass] : [])] });
assert(built.success, built.logs.join("\n"));
console.log(JSON.stringify({ mode, ...(source === undefined ? {} : {
  runtimeSource: { revision: source.revision, files: source.files.map(({ path, sha256 }) => ({ path, sha256 })) },
}), outputs: built.outputs.map(value => ({ path: value.path, bytes: value.size })) }));
