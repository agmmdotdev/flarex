import { createHash } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import { createRequire, isBuiltin } from "node:module";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const require = createRequire(import.meta.url);
let retainedInventory;

/** Conservative dirty-byte inventory. Reports are excluded, never executing SQL,
 * configuration or installed/compiled native dependencies. Run after warmup. */
export async function sourceFingerprint() {
  const files = new Set(retainedInventory ?? []);
  const visitedDirectories = new Set();
  files.add(process.execPath);
  const visit = async (directory, runtimeOnly = false) => {
    if (visitedDirectories.has(directory)) return;
    visitedDirectories.add(directory); const children = [];
    for (const item of await readdir(directory, { withFileTypes: true })) {
      if (["node_modules", ".reports", ".scratch", "validation", ".git"].includes(item.name)) continue;
      if (runtimeOnly && ["test", "tests", "benchmarks", "docs", "examples"].includes(item.name)) continue;
      const path = join(directory, item.name);
      if (item.isDirectory()) children.push(path);
      else if (/\.(ts|mjs|cjs|js|json|sql|yaml|node|wasm)$/.test(item.name)) files.add(path);
    }
    await Promise.all(children.map(path => visit(path, runtimeOnly)));
  };
  if (retainedInventory === undefined) {
  await visit(join(repository, "experiments/core"));
  const packages = join(repository, "packages");
  for (const entry of await readdir(packages, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try { await visit(join(packages, entry.name, "src")); }
    catch (cause) { if (cause.code !== "ENOENT") throw cause; }
  }
  for (const directory of ["packages/executor/test/performance/measurement", "packages/executor/test/performance/support", "packages/persistence-postgres/test",
    "packages/persistence-postgres/drizzle"]) await visit(join(repository, directory));
  for (const name of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json",
    "work/native-business-baseline/dependencies/package.json", "work/native-business-baseline/dependencies/package-lock.json"])
    files.add(join(repository, name));
  const nativeRequire = createRequire(join(repository, "work/native-business-baseline/dependencies/package.json"));
  const visitedPackages = new Set();
  const resolveManifest = async (resolver, name, optional) => {
    for (const directory of resolver.resolve.paths(isBuiltin(name) ? `${name}/` : name) ?? []) {
      try { return await realpath(join(directory, name, "package.json")); }
      catch (cause) { if (cause.code !== "ENOENT") throw cause; }
    }
    if (!optional && !isBuiltin(name)) throw new Error(`Missing installed dependency manifest for ${name}`);
    return undefined;
  };
  const installedPackage = async path => {
    const manifest = await realpath(path); if (visitedPackages.has(manifest)) return;
    visitedPackages.add(manifest); files.add(manifest);
    const data = JSON.parse(await readFile(manifest, "utf8"));
    await visit(dirname(manifest), true);
    const resolver = createRequire(manifest);
    for (const [name] of Object.entries({ ...data.dependencies, ...data.optionalDependencies, ...data.peerDependencies })) {
      const dependency = await resolveManifest(resolver, name, name in (data.optionalDependencies ?? {}) || name in (data.peerDependencies ?? {}));
      if (dependency !== undefined) await installedPackage(dependency);
    }
  };
  for (const [resolver, names] of [[require, ["payload", "effect", "drizzle-orm", "pg"]],
    [nativeRequire, ["@payloadcms/db-postgres", "@payloadcms/drizzle", "payload", "drizzle-orm", "pg"]]]) {
    for (const name of names) {
      await installedPackage(await resolveManifest(resolver, name, false));
    }
  }
  for (const path of ["packages/medusa-product/package.json", "packages/medusa-framework/package.json", "packages/medusa-drizzle/package.json",
    "third_party/medusa/upstream/packages/modules/product/package.json", "third_party/medusa/upstream/packages/medusa-test-utils/package.json"])
    await installedPackage(join(repository, path));
  }
  // Includes actual loaded compiled Medusa and its CJS dependency tree. Authored
  // workspace source alone does not identify the bytes executed by native code.
  for (const path of Object.keys(require.cache)) if (/\.(js|cjs|json|node)$/.test(path)) files.add(path);
  // Retain paths, never digests: fresh bytes are hashed on every boundary.
  // Changed importers/manifests invalidate the cohort; newly loaded CJS files
  // extend this conservative installed dependency closure.
  retainedInventory = [...files];
  const hash = createHash("sha256"); const inventory = [];
  const ordered = [...files].toSorted();
  for (let offset = 0; offset < ordered.length; offset += 32) {
    const batch = await Promise.all(ordered.slice(offset, offset + 32).map(async path => ({
      path: relative(repository, path).replaceAll("\\", "/"), sha256: createHash("sha256").update(await readFile(path)).digest("hex") })));
    for (const item of batch) {
      hash.update(item.path); hash.update("\0"); hash.update(item.sha256); hash.update("\0"); inventory.push(item);
    }
  }
  return { sha256: hash.digest("hex"), files: inventory.length, inventory };
}
