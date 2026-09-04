import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveFlarexAppDir,
  resolveFlarexDirs,
  resolveFlarexGeneratedDir,
} from "../src/flarexPaths";

describe("resolveFlarexDirs", () => {
  it("applies the flarex/_generated defaults", () => {
    const dirs = resolveFlarexDirs({ root: "/proj" });
    expect(dirs.appDir).toBe(resolve("/proj", "flarex"));
    expect(dirs.generatedDir).toBe(
      resolve(resolve("/proj", "flarex"), "_generated"),
    );
  });

  it("honors explicit app and generated directory names", () => {
    const dirs = resolveFlarexDirs({
      root: "/proj",
      appDir: "custom",
      generatedDir: "out",
    });
    expect(dirs.appDir).toBe(resolve("/proj", "custom"));
    expect(dirs.generatedDir).toBe(resolve(resolve("/proj", "custom"), "out"));
  });

  it("matches single-resolve worker entry composition", () => {
    const options = { root: "/proj" };
    expect(join(resolveFlarexDirs(options).generatedDir, "worker.ts")).toBe(
      resolve("/proj", "flarex", "_generated", "worker.ts"),
    );
  });

  it("resolves an absolute generated dir against itself", () => {
    const appDir = resolveFlarexAppDir("/proj", "custom");
    expect(resolveFlarexGeneratedDir(appDir, "/abs/out")).toBe(
      resolve("/abs/out"),
    );
  });
});
