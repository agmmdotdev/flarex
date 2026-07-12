import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertManifestDependencyProtocols,
  assertNoPackedDevelopmentEntries,
  exportedTargetEntries,
  expectSuccessfulCommand,
  optionalStringRecord,
  readPackedManifest,
  readSourceManifest,
  recordValue,
  runPnpmPack,
  singlePackedTarball,
  stringRecord,
  tarballEntries,
  workspaceRoot,
} from "./packabilityHelpers.ts";

const flarexDevRoot = resolve(workspaceRoot, "packages/flarex-dev");

describe("flarex-dev packed package", () => {
  it("contains the CLI bin and source entrypoints without test files", async () => {
    const packDir = await mkdtemp(join(tmpdir(), "flarex-dev-pack-"));
    try {
      const sourceManifest = await readSourceManifest(flarexDevRoot);
      const pack = runPnpmPack(flarexDevRoot, packDir);
      expectSuccessfulCommand(pack);

      const tarballPath = await singlePackedTarball(packDir);
      const entries = tarballEntries(tarballPath);

      expect(entries).toContain("package/bin/flarex-dev.mjs");
      expect(entries).toContain("package/src/bin.ts");
      expect(entries).toContain("package/src/cli.ts");
      assertNoPackedDevelopmentEntries(entries);

      const manifest = readPackedManifest(tarballPath);
      const bin = stringRecord(manifest.bin);
      const exportedTargets = exportedTargetEntries(manifest.exports);
      const dependencies = stringRecord(manifest.dependencies);

      expect(manifest.name).toBe(sourceManifest.name);
      expect(manifest.version).toBe(sourceManifest.version);
      expect(bin["flarex-dev"]).toBe("./bin/flarex-dev.mjs");
      for (const exportedTarget of exportedTargets) {
        expect(entries).toContain(exportedTarget);
      }
      expect(dependencies["tsx"]).toBeDefined();
      expect(optionalStringRecord(manifest.peerDependencies)).toMatchObject({
        "@cloudflare/workers-types": expect.any(String),
        typescript: expect.any(String),
        vite: expect.any(String),
      });
      assertManifestDependencyProtocols(manifest);
      expect(recordValue(manifest, "devDependencies")).toBeUndefined();
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  }, 120_000);
});
