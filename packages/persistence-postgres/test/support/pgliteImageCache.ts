import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Data, Schema } from "effect";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const manifestDecoder = Schema.decodeUnknownSync(Schema.Struct({
  format: Schema.Literal(1), key: Schema.String,
  byteLength: Schema.Int, sha256: Schema.String,
}));
const packageDecoder = Schema.decodeUnknownSync(Schema.Struct({ name: Schema.String,
  dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  optionalDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
  peerDependencies: Schema.optional(Schema.Record(Schema.String, Schema.String)),
}));

export class PGliteImageCacheError extends Data.TaggedError("PGliteImageCacheError")<{
  readonly reason: "corrupt" | "busy" | "sourceChanged";
  readonly path: string;
  readonly cause?: unknown;
}> {}

function hasCode(cause: unknown, code: string): boolean {
  return cause instanceof Error && "code" in cause && cause.code === code;
}

/** This Node/Vitest filesystem boundary preserves native I/O rejections. Only
 * ENOENT is cache absence; malformed or mismatched assets are explicit failures. */
async function readImage(directory: string, key: string): Promise<Blob | undefined> {
  let original;
  try { original = await stat(directory); }
  catch (cause: unknown) {
    if (hasCode(cause, "ENOENT")) return undefined;
    throw cause;
  }
  let bytes: Buffer;
  let encodedManifest: string;
  try {
    [bytes, encodedManifest] = await Promise.all([
      readFile(join(directory, "image.tar")), readFile(join(directory, "manifest.json"), "utf8"),
    ]);
  } catch (cause: unknown) {
    if (hasCode(cause, "ENOENT")) {
      try {
        const current = await stat(directory);
        if (current.ino !== original.ino || current.birthtimeMs !== original.birthtimeMs) return undefined;
      }
      catch (missing: unknown) {
        if (hasCode(missing, "ENOENT")) return undefined;
        throw missing;
      }
      throw new PGliteImageCacheError({ reason: "corrupt", path: directory, cause });
    }
    throw cause;
  }
  // Eviction and a rebuild can replace this directory between the two reads.
  // Never diagnose mixed generations as corruption of either complete image.
  try {
    const current = await stat(directory);
    if (current.ino !== original.ino || current.birthtimeMs !== original.birthtimeMs) return undefined;
  } catch (cause: unknown) {
    if (hasCode(cause, "ENOENT")) return undefined;
    throw cause;
  }
  let manifest: ReturnType<typeof manifestDecoder>;
  try { manifest = manifestDecoder(JSON.parse(encodedManifest)); }
  catch (cause: unknown) { throw new PGliteImageCacheError({ reason: "corrupt", path: directory, cause }); }
  if (manifest.key !== key || manifest.byteLength !== bytes.byteLength ||
    manifest.sha256 !== createHash("sha256").update(bytes).digest("hex")) {
    throw new PGliteImageCacheError({ reason: "corrupt", path: directory });
  }
  return new Blob([new Uint8Array(bytes)]);
}

async function sourceFiles(directory: string): Promise<string[]> {
  let entries;
  try { entries = await readdir(directory, { withFileTypes: true }); }
  catch (cause: unknown) {
    if (hasCode(cause, "ENOENT")) return [];
    throw cause;
  }
  const nested = await Promise.all(entries.map(entry => entry.isDirectory()
    ? sourceFiles(join(directory, entry.name))
    : /\.(?:ts|js|mjs|json|sql|wasm)$/.test(entry.name) ? [join(directory, entry.name)] : []));
  return nested.flat();
}

/** Conservative source closure: include runtime dependency-package sources as well as
 * SQL/journal, lockfile and image construction. Test-only edits don't invalidate
 * an image, but any bootstrap/runtime input change does. Narrowing this closure
 * needs an independently verified migration dependency graph. */
export async function pgliteImageKey(inputs = { packageRoot, repositoryRoot }): Promise<string> {
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
    if (entry === undefined) throw new Error(`Missing workspace image input ${name}`);
    sources.push(join(entry.directory, "package.json"), ...await sourceFiles(join(entry.directory, "src")));
    for (const [dependency, version] of Object.entries({ ...entry.manifest.dependencies,
      ...entry.manifest.optionalDependencies, ...entry.manifest.peerDependencies })) {
      if (version.startsWith("workspace:")) pending.push(dependency);
    }
  }
  const migrations = (await readdir(join(packageRoot, "drizzle"))).filter(name => name.endsWith(".sql"))
    .map(name => join(packageRoot, "drizzle", name));
  const files = [...sources, ...migrations, join(packageRoot, "drizzle/meta/_journal.json"),
    join(repositoryRoot, "pnpm-lock.yaml"), join(packageRoot, "package.json"),
    fileURLToPath(import.meta.url), join(packageRoot, "test/support/pgliteMigrationBaseline.ts"),
    join(packageRoot, "test/support/pgliteSearchExtensions.ts")].sort();
  const hash = createHash("sha256").update(`pglite-schema-image:1:${process.platform}:${process.arch}\0`);
  for (let start = 0; start < files.length; start += 32) {
    const batch = files.slice(start, start + 32);
    const contents = await Promise.all(batch.map(path => readFile(path)));
    for (const [index, bytes] of contents.entries()) {
      const path = batch[index];
      if (path === undefined) throw new Error("Missing image fingerprint input");
      hash.update(relative(repositoryRoot, path)).update("\0").update(bytes).update("\0");
    }
  }
  return hash.digest("hex");
}

export interface PGliteImageCacheOptions {
  readonly root: string;
  readonly key: string;
  readonly build: () => Promise<Blob | File>;
  readonly verifyInputs?: () => Promise<string>;
  readonly waitMilliseconds?: number;
}

async function pruneImages(root: string, current: string): Promise<void> {
  const entries = (await readdir(root, { withFileTypes: true }))
    .filter(entry => entry.isDirectory() && /^[a-f0-9]{64}$/.test(entry.name) && entry.name !== current);
  const dated = await Promise.all(entries.map(async entry => {
    try { return { name: entry.name, modified: (await stat(join(root, entry.name))).mtimeMs }; }
    catch (cause: unknown) {
      if (hasCode(cause, "ENOENT")) return undefined;
      throw cause;
    }
  }));
  for (const entry of dated.filter(entry => entry !== undefined)
    .sort((a, b) => b.modified - a.modified || a.name.localeCompare(b.name)).slice(3)) {
    // Remove the published name atomically before deleting either asset. Readers
    // losing that name reacquire this key; a partial surviving image is corruption.
    const retired = join(root, `${entry.name}.${randomUUID()}.evicting`);
    try { await rename(join(root, entry.name), retired); }
    catch (cause: unknown) {
      if (!hasCode(cause, "ENOENT") && !hasCode(cause, "EBUSY")) throw cause;
      continue;
    }
    try { await rm(retired, { recursive: true }); }
    catch (cause: unknown) {
      if (!hasCode(cause, "ENOENT") && !hasCode(cause, "EBUSY")) throw cause;
    }
  }
}

/** Atomic directory publication coordinates builders across Vitest processes.
 * An abandoned lock fails within the bounded wait rather than stealing an
 * unknown owner's resource. Graceful failures always remove their own claim. */
export async function readOrBuildPGliteImage(options: PGliteImageCacheOptions): Promise<Blob> {
  if (!/^[a-f0-9]{64}$/.test(options.key)) throw new Error("Invalid PGlite image cache key");
  await mkdir(options.root, { recursive: true });
  const directory = join(options.root, options.key);
  const lock = `${directory}.lock`;
  const deadline = performance.now() + (options.waitMilliseconds ?? 90_000);
  while (true) {
    const existing = await readImage(directory, options.key);
    if (existing !== undefined) return existing;
    try { await mkdir(lock); break; }
    catch (cause: unknown) {
      if (!hasCode(cause, "EEXIST")) throw cause;
      if (performance.now() >= deadline) throw new PGliteImageCacheError({ reason: "busy", path: lock });
      await delay(50);
    }
  }
  const temporary = join(options.root, `${options.key}.${randomUUID()}.building`);
  let primaryFailure: unknown;
  let failed = false;
  try {
    // Another builder can have published between our read and claim.
    const existing = await readImage(directory, options.key);
    if (existing !== undefined) return existing;
    const image = await options.build();
    const bytes = new Uint8Array(await image.arrayBuffer());
    if (options.verifyInputs !== undefined && await options.verifyInputs() !== options.key) {
      throw new PGliteImageCacheError({ reason: "sourceChanged", path: directory });
    }
    await mkdir(temporary);
    await writeFile(join(temporary, "image.tar"), bytes);
    await writeFile(join(temporary, "manifest.json"), JSON.stringify({ format: 1, key: options.key,
      byteLength: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") }));
    await rename(temporary, directory);
    await pruneImages(options.root, options.key);
    return new Blob([bytes]);
  } catch (cause: unknown) { failed = true; primaryFailure = cause; throw cause; }
  finally {
    const cleanup = await Promise.allSettled([rm(temporary, { recursive: true, force: true }), rm(lock, { recursive: true })]);
    const failures = cleanup.filter(result => result.status === "rejected").map(result => result.reason);
    if (failures.length > 0) throw new AggregateError(
      failed ? [primaryFailure, ...failures] : failures, "PGlite image build and cleanup failed");
  }
}

export async function cachedPGliteDataDir(): Promise<Blob> {
  const key = await pgliteImageKey();
  const repositoryKey = createHash("sha256").update(repositoryRoot).digest("hex").slice(0, 16);
  return readOrBuildPGliteImage({ root: join(tmpdir(), "flarex-pglite-images", repositoryKey), key,
    verifyInputs: pgliteImageKey,
    build: async () => (await import("./pgliteMigrationBaseline")).buildMigratedPGliteDataDir() });
}
