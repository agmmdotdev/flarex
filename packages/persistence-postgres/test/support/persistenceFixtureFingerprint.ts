import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Schema } from "effect";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const packageDecoder = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}));

async function sourceFiles(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return [];
    throw cause;
  }
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name))
    : /\.(?:ts|js|mjs|json|sql|wasm)$/.test(entry.name) ? [join(directory, entry.name)] : []));
  return nested.flat();
}

/** Conservative runtime source closure shared by prepared test resources.
 * Scenario-only edits do not invalidate schemas; bootstrap/runtime changes do. */
export async function persistenceFixtureSourceKey(domain: string, bootstrapFiles: readonly string[],
  inputs = { packageRoot, repositoryRoot }): Promise<string> {
  const { packageRoot, repositoryRoot } = inputs;
  const packages = await readdir(join(repositoryRoot, "packages"), { withFileTypes: true });
  const manifests = await Promise.all(packages.filter(entry => entry.isDirectory()).map(async entry => {
    const directory = join(repositoryRoot, "packages", entry.name);
    return { directory, manifest: packageDecoder(JSON.parse(await readFile(join(directory, "package.json"), "utf8"))) };
  }));
  const byName = new Map(manifests.map(entry => [entry.manifest.name, entry]));
  const pending = ["@flarex/persistence-postgres"];
  const visited = new Set<string>();
  const sources: string[] = [];
  while (pending.length > 0) {
    const name = pending.pop();
    if (name === undefined || visited.has(name)) continue;
    visited.add(name);
    const entry = byName.get(name);
    if (entry === undefined) throw new Error(`Missing workspace fixture input ${name}`);
    sources.push(join(entry.directory, "package.json"), ...await sourceFiles(join(entry.directory, "src")));
    for (const [dependency, version] of Object.entries({ ...entry.manifest.dependencies,
      ...entry.manifest.optionalDependencies, ...entry.manifest.peerDependencies })) {
      if (version.startsWith("workspace:")) pending.push(dependency);
    }
  }
  const migrations = (await readdir(join(packageRoot, "drizzle"))).filter(name => name.endsWith(".sql"))
    .map(name => join(packageRoot, "drizzle", name));
  const files = [...new Set([...sources, ...migrations, join(packageRoot, "drizzle/meta/_journal.json"),
    join(repositoryRoot, "pnpm-lock.yaml"), join(packageRoot, "package.json"), fileURLToPath(import.meta.url),
    ...bootstrapFiles.map(path => join(packageRoot, path))])].sort();
  const hash = createHash("sha256").update(`${domain}:1:${process.platform}:${process.arch}\0`);
  for (let start = 0; start < files.length; start += 32) {
    const batch = files.slice(start, start + 32);
    const contents = await Promise.all(batch.map(path => readFile(path)));
    for (const [index, bytes] of contents.entries()) {
      const path = batch[index];
      if (path === undefined) throw new Error("Missing fixture fingerprint input");
      hash.update(relative(repositoryRoot, path)).update("\0").update(bytes).update("\0");
    }
  }
  return hash.digest("hex");
}
