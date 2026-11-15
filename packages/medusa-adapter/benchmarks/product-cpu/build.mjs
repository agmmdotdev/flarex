import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const output = resolve(process.argv[2]);
await mkdir(output, { recursive: true });
const modules = new Set();
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const fixturePath = resolve(root, "packages/persistence-postgres/test/core/fixture.ts");
const replacement = fileURLToPath(new URL("./forbidden-fixture.ts", import.meta.url));
const databaseTrap = fileURLToPath(new URL("./forbidden-database.ts", import.meta.url));
const originalFixture = await readFile(fixturePath, "utf8");
const registryReader = originalFixture.slice(originalFixture.indexOf("export const readCoreFixtureRegistry ="),
  originalFixture.indexOf("export interface CorePersistenceFixtureOptions"));
const fixtureContents = 'import { Effect } from "effect";\nimport { loadBootstrapRegistry } from "../../src/core/bootstrap";\nimport { loadCoreRegistry } from "../../src/core/registry";\n' + registryReader + await readFile(replacement, "utf8");
const forbidden = /^(?:pg(?:-pool|-protocol|-native)?|postgres|@electric-sql\/pglite|vitest)(?:\/|$)/;
const result = await Bun.build({ entrypoints: [fileURLToPath(new URL("./worker.ts", import.meta.url))],
  outdir: output, naming: "worker.mjs", target: "node", format: "esm",
  external: ["effect", "effect/*"], sourcemap: "external", plugins: [{ name: "no-database-engines", setup(build) {
    build.onResolve({ filter: /^(?:pg(?:-pool|-protocol|-native)?|postgres|@electric-sql\/pglite|vitest)(?:\/|$)/ }, args => {
      assert(args.path !== "vitest", "Vitest cannot enter the benchmark");
      return { path: databaseTrap };
    });
    build.onLoad({ filter: /\.[cm]?[jt]sx?$/ }, async args => {
      modules.add(args.path);
      if (args.path === fixturePath) return { contents: fixtureContents, loader: "ts" };
    });
  } }] });
assert(result.success, result.logs.join("\n"));
const imports = new Bun.Transpiler({ loader: "js" }).scan(await result.outputs[0].text()).imports;
assert(!imports.some(value => forbidden.test(value.path)), "Database/test-runner import survived tree shaking: " + JSON.stringify(imports.filter(value => forbidden.test(value.path))));
const inputs = await Promise.all([...modules].sort().map(async path => ({ path,
  sha256: createHash("sha256").update(path === fixturePath ? fixtureContents : await readFile(path)).digest("hex"),
  ...(path === fixturePath ? { replacement } : {}),
})));
await writeFile(resolve(output, "graph.json"), JSON.stringify({ inputs, outputs: result.outputs.map(value => ({ path: value.path, bytes: value.size })) }, null, 2));
console.log(JSON.stringify({ modules: inputs.length, bytes: result.outputs[0]?.size }));
