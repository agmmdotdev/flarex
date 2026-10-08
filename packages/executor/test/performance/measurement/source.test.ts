import type { Dirent, PathLike } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { measurementSourceDigest } from "./source";

const boundary = vi.hoisted(() => ({ inventory: vi.fn<(directory: PathLike) => Promise<Dirent[]>>() }));
vi.mock("node:fs/promises", async importOriginal => ({
  ...await importOriginal<typeof import("node:fs/promises")>(),
  readdir: boundary.inventory,
}));

const repository = fileURLToPath(new URL("../../../../../", import.meta.url));
const require = createRequire(import.meta.url);
const compiledDirectory = join(repository, "packages/medusa-framework/dist");
const authoredDirectory = join(repository, "packages/medusa-framework/src/modules-sdk");
const authoredFile = join(authoredDirectory, "module.ts");
let fixture: string;
let compiledFile: string;

beforeEach(async () => {
  // Keep the real directory entries and actual file reads, but bound authored
  // inventory to one stable source file rather than scanning the repository.
  const filesystem = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
  const authored = (await filesystem.readdir(authoredDirectory, { withFileTypes: true }))
    .filter(entry => entry.name === "module.ts");
  expect(authored).toHaveLength(1);
  boundary.inventory.mockImplementation(async directory => {
    expect(directory).toBe(join(repository, "packages"));
    return authored;
  });
  await mkdir(compiledDirectory, { recursive: true });
  fixture = await mkdtemp(join(compiledDirectory, "measurement-source-"));
  compiledFile = join(fixture, "executing.js");
  await writeFile(compiledFile, 'module.exports = { receipt: "before" };\n');
});

afterEach(async () => {
  delete require.cache[compiledFile];
  // Only remove the unique fixture directory created by this test.
  expect(dirname(fixture)).toBe(compiledDirectory);
  await rm(fixture, { recursive: true, force: true });
  boundary.inventory.mockReset();
});

describe("measurement source stability", () => {
  it("detects loaded promoted Medusa build drift with unchanged authored source", async () => {
    const authoredBefore = await readFile(authoredFile);
    const unloaded = await measurementSourceDigest(false);
    expect(require(compiledFile)).toEqual({ receipt: "before" });
    const before = await measurementSourceDigest(false);
    expect(before.files).toBe(unloaded.files + 1);

    await writeFile(compiledFile, 'module.exports = { receipt: "changed" };\n');
    const after = await measurementSourceDigest(false);
    expect(after.files).toBe(before.files);
    expect(after.digest).not.toBe(before.digest);
    expect(await readFile(authoredFile)).toEqual(authoredBefore);
    // Inventory observes already-loaded sources without importing/reloading them.
    expect(require(compiledFile)).toEqual({ receipt: "before" });
  });

  it("does not eagerly load or inventory unused compiled Medusa output", async () => {
    const before = await measurementSourceDigest(false);
    await writeFile(compiledFile, 'module.exports = { receipt: "unused change" };\n');
    expect(await measurementSourceDigest(false)).toEqual(before);
    expect(require.cache[compiledFile]).toBeUndefined();
  });

  it("rejects when the source of a loaded promoted module disappears", async () => {
    require(compiledFile);
    await rm(compiledFile);
    await expect(measurementSourceDigest(false)).rejects.toMatchObject({ code: "ENOENT", path: compiledFile });
  });

  it("propagates a failed read of a loaded promoted module", async () => {
    require(compiledFile);
    await rm(compiledFile);
    await mkdir(compiledFile);
    await expect(measurementSourceDigest(false)).rejects.toMatchObject({ code: "EISDIR" });
  });
});
