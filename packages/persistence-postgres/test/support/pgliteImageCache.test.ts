import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pgliteImageKey, readOrBuildPGliteImage } from "./pgliteImageCache";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile), rm: vi.fn(actual.rm) };
});

const directories: string[] = [];
async function temporaryDirectory() {
  const root = await mkdtemp(join(tmpdir(), "flarex-image-cache-test-"));
  directories.push(root);
  return root;
}
afterEach(async () => { for (const root of directories.splice(0)) await rm(root, { recursive: true, force: true }); });

describe("PGlite schema image cache", () => {
  it.each([false, true])("reacquires a concurrently retired image (republished: %s)", async republish => {
    const root = await temporaryDirectory();
    const key = "e".repeat(64);
    await readOrBuildPGliteImage({ root, key, build: async () => new Blob(["original"]) });
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let releaseManifest: () => void = () => { throw new Error("Manifest barrier missing"); };
    const retired = new Promise<void>(resolve => { releaseManifest = resolve; });
    vi.mocked(readFile).mockImplementationOnce(async (...args) => {
      const bytes = await actual.readFile(...args);
      try {
        await rename(join(root, key), join(root, "retired"));
        if (republish) await readOrBuildPGliteImage({ root, key, build: async () => new Blob(["replacement"]) });
      } finally { releaseManifest(); }
      return bytes;
    }).mockImplementationOnce(async (...args) => {
      await retired;
      return actual.readFile(...args);
    });
    let rebuilds = 0;
    const image = await readOrBuildPGliteImage({ root, key,
      build: async () => { rebuilds++; return new Blob(["replacement"]); } });
    expect(await image.text()).toBe("replacement");
    expect(rebuilds).toBe(republish ? 0 : 1);
  });

  it("coordinates builders and reloads the same immutable image without rebuilding", async () => {
    const root = await temporaryDirectory();
    const key = "a".repeat(64);
    let builds = 0;
    const build = async () => { builds++; return new Blob(["schema image"]); };
    const images = await Promise.all(Array.from({ length: 3 }, () => readOrBuildPGliteImage({ root, key, build })));
    expect(builds).toBe(1);
    expect(await Promise.all(images.map(image => image.text()))).toEqual(Array(3).fill("schema image"));
    expect(await (await readOrBuildPGliteImage({ root, key, build })).text()).toBe("schema image");
    expect(builds).toBe(1);
    expect(await readdir(root)).toEqual([key]);
  });

  it.each(["manifest", "bytes", "missing"] as const)("refuses %s corruption rather than hiding it with a rebuild", async corruption => {
    const root = await temporaryDirectory();
    const key = "b".repeat(64);
    let builds = 0;
    const build = async () => { builds++; return new Blob(["valid"]); };
    await readOrBuildPGliteImage({ root, key, build });
    if (corruption === "manifest") await writeFile(join(root, key, "manifest.json"), "{}");
    else if (corruption === "bytes") await writeFile(join(root, key, "image.tar"), "altered");
    else await rm(join(root, key, "image.tar"));
    await expect(readOrBuildPGliteImage({ root, key, build })).rejects.toMatchObject({
      _tag: "PGliteImageCacheError", reason: "corrupt",
    });
    expect(builds).toBe(1);
  });

  it("releases a failed builder's claim, preserves its failure and never publishes changed inputs", async () => {
    const root = await temporaryDirectory();
    const key = "c".repeat(64);
    const failure = new Error("builder failed");
    await expect(readOrBuildPGliteImage({ root, key, build: () => Promise.reject(failure) })).rejects.toBe(failure);
    expect(await readdir(root)).toEqual([]);
    await expect(readOrBuildPGliteImage({ root, key, build: async () => new Blob(["stale"]),
      verifyInputs: async () => "d".repeat(64) })).rejects.toMatchObject({ reason: "sourceChanged" });
    expect(await readdir(root)).toEqual([]);
    expect(await (await readOrBuildPGliteImage({ root, key, build: async () => new Blob(["current"]) })).text())
      .toBe("current");
  });

  it("bounds waits without stealing a claim and preserves unrelated filesystem errors", async () => {
    const root = await temporaryDirectory();
    const key = "d".repeat(64);
    await mkdir(join(root, `${key}.lock`));
    await expect(readOrBuildPGliteImage({ root, key, waitMilliseconds: 0,
      build: async () => new Blob(["unused"]) })).rejects.toMatchObject({ reason: "busy" });
    expect(await readdir(root)).toEqual([`${key}.lock`]);
    const file = join(root, "not-directory");
    await writeFile(file, "keep");
    await expect(readOrBuildPGliteImage({ root: file, key, build: async () => new Blob() })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(file, "utf8")).toBe("keep");
  });

  it("retains at most four completed images without evicting the current one", async () => {
    const root = await temporaryDirectory();
    for (let index = 0; index < 6; index++) {
      await readOrBuildPGliteImage({ root, key: index.toString(16).repeat(64), build: async () => new Blob([String(index)]) });
    }
    const entries = await readdir(root);
    expect(entries).toHaveLength(4);
    expect(entries).toContain("5".repeat(64));
  });

  it("keeps a valid publication when removal of an atomically retired image is busy", async () => {
    const root = await temporaryDirectory();
    for (let index = 0; index < 4; index++) {
      await readOrBuildPGliteImage({ root, key: index.toString(16).repeat(64), build: async () => new Blob([String(index)]) });
    }
    vi.mocked(rm).mockRejectedValueOnce(Object.assign(new Error("Image is open"), { code: "EBUSY" }));
    const image = await readOrBuildPGliteImage({ root, key: "f".repeat(64), build: async () => new Blob(["published"]) });
    expect(await image.text()).toBe("published");
    const entries = await readdir(root);
    expect(entries.filter(entry => /^[a-f0-9]{64}$/.test(entry))).toHaveLength(4);
    expect(entries.filter(entry => entry.endsWith(".evicting"))).toHaveLength(1);
    expect(entries.some(entry => entry.endsWith(".lock") || entry.endsWith(".building"))).toBe(false);
  });

  it("invalidates SQL, bootstrap sources, runtime dependencies and lockfile, but not unrelated sources", async () => {
    const repositoryRoot = await temporaryDirectory();
    const packageRoot = join(repositoryRoot, "packages/persistence-postgres");
    const dependencyRoot = join(repositoryRoot, "packages/dependency");
    const unrelatedRoot = join(repositoryRoot, "packages/unrelated");
    for (const directory of [join(packageRoot, "src"), join(packageRoot, "drizzle/meta"),
      join(packageRoot, "test/support"), join(dependencyRoot, "src"), join(unrelatedRoot, "src")]) {
      await mkdir(directory, { recursive: true });
    }
    for (const [directory, name, dependencies] of [
      [packageRoot, "@flarex/persistence-postgres", { dependency: "workspace:*" }],
      [dependencyRoot, "dependency", {}], [unrelatedRoot, "unrelated", {}],
    ] as const) await writeFile(join(directory, "package.json"), JSON.stringify({ name, dependencies }));
    const inputs = [join(packageRoot, "src/bootstrap.ts"), join(packageRoot, "drizzle/0000.sql"),
      join(packageRoot, "drizzle/meta/_journal.json"), join(dependencyRoot, "src/value.ts"),
      join(repositoryRoot, "pnpm-lock.yaml"), join(packageRoot, "test/support/pgliteMigrationBaseline.ts"),
      join(packageRoot, "test/support/pgliteSearchExtensions.ts")];
    for (const input of inputs) await writeFile(input, "initial");
    let previous = await pgliteImageKey({ repositoryRoot, packageRoot });
    await writeFile(join(unrelatedRoot, "src/other.ts"), "unrelated edit");
    expect(await pgliteImageKey({ repositoryRoot, packageRoot })).toBe(previous);
    for (const input of inputs) {
      await writeFile(input, "changed");
      const next = await pgliteImageKey({ repositoryRoot, packageRoot });
      expect(next).not.toBe(previous);
      previous = next;
    }
  });
});
