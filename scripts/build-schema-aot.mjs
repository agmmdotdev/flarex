import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = new URL("../", import.meta.url);
const require = createRequire(new URL("packages/persistence-postgres/package.json", root));
const { compile } = await import(pathToFileURL(require.resolve("effect/schema/SchemaAOTCompiler")).href);
const { version } = require("effect/package.json");

/** Build and verification must work even when the checked-in output is stale.
 * Never execute old generated AST paths while loading the current definitions. */
const bypass = registerHooks({
  load(url, context, nextLoad) {
    if (url.startsWith(root.href) && url.endsWith(".schema-aot.generated.mjs")) {
      return { format: "module", source: "export function install() {}", shortCircuit: true };
    }
    return nextLoad(url, context);
  },
});

export const modules = [
  "packages/persistence-postgres/src/core/iteratorBudget.ts",
  "packages/persistence-postgres/src/core/api.ts",
  "packages/persistence-postgres/src/core/nativePolicyTypes.ts",
  "packages/persistence-postgres/src/core/indexState.ts",
  "packages/persistence-postgres/src/core/document.ts",
  "packages/persistence-postgres/src/core/schemaTypes.ts",
  "packages/medusa-adapter/src/modules/product/service-schemas.ts",
  "packages/medusa-adapter/src/modules/product/value-schemas.ts",
];

assert(process.argv.slice(2).every(arg => arg === "--check"), "Only --check is supported");
const check = process.argv.includes("--check");
let targets = 0;
try {
  for (const module of modules) {
    const { schemaAotTargets } = await import(new URL(module, root).href);
    assert(Array.isArray(schemaAotTargets) && schemaAotTargets.length > 0, module);
    const output = new URL(module.replace(/\.ts$/, ".schema-aot.generated.mjs"), root);
    const source = `// Effect ${version}. Run: pnpm schema:aot:generate\n` + compile(
      schemaAotTargets.map(schema => ({ ast: schema.ast, operations: ["decode"] })),
    );
    const declaration = 'import type { AST } from "effect/SchemaAST";\nexport declare function install(asts: ReadonlyArray<AST>): void;\n';
    const outputs = [[output, source], [new URL(output.href.replace(/\.mjs$/, ".d.mts")), declaration]];
    for (const [file, content] of outputs) {
      if (check) assert.equal(await readFile(file, "utf8"), content, `Stale AOT output: ${fileURLToPath(file)}`);
      else await writeFile(file, content);
    }
    targets += schemaAotTargets.length;
  }
} finally {
  bypass.deregister();
}
console.log(`${check ? "Verified" : "Generated"} ${targets} decode targets in ${modules.length} modules (Effect ${version}).`);
