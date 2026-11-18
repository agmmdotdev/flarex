import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Data, Schema } from "effect";
import { persistenceFixtureSourceKey } from "./persistenceFixtureFingerprint";

const packageRoot = fileURLToPath(new URL("../..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
const manifestDecoder = Schema.decodeUnknownSync(Schema.Struct({
  format: Schema.Literal(1), key: Schema.String,
  byteLength: Schema.Int, sha256: Schema.String,
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

/** The image and native schema lanes share one bootstrap-input owner. */
export function pgliteImageKey(inputs = { packageRoot, repositoryRoot }): Promise<string> {
  return persistenceFixtureSourceKey("pglite-schema-image", [
    "test/support/pgliteImageCache.ts", "test/support/pgliteMigrationBaseline.ts",
    "test/support/pgliteSearchExtensions.ts",
  ], inputs);
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
