import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertManifestDependencyProtocols,
  assertOptionalPeerDependencies,
  exportedTargetEntries,
  expectSuccessfulCommand,
  readPackedManifest,
  readSourceManifest,
  runPnpmPack,
  singlePackedTarball,
  stringRecord,
  tarballEntries,
  workspaceRoot,
} from "./packabilityHelpers.ts";

type PackagePackCase = {
  readonly packageName: string;
  readonly packageRoot: string;
  readonly expectedEntries: readonly string[];
  readonly allowedTestEntries?: readonly string[];
  readonly expectedTestExports?: readonly string[];
  readonly requiredPeerDependencies?: readonly string[];
};

const packages = [
  {
    packageName: "flarex",
    packageRoot: resolve(workspaceRoot, "packages/flarex"),
    expectedEntries: [
      "package/LICENSE.convex",
      "package/src/index.ts",
      "package/src/server.ts",
      "package/src/client.ts",
      "package/src/react.ts",
      "package/src/sync/simpleClient.ts",
    ],
  },
  {
    packageName: "flarex-backend",
    packageRoot: resolve(workspaceRoot, "packages/flarex-backend"),
    expectedEntries: [
      "package/src/worker.ts",
      "package/src/artifactRuntime.ts",
      "package/src/artifactStore.ts",
      "package/src/syncProtocol.ts",
      "package/test/backendHarness.ts",
    ],
    allowedTestEntries: ["package/test/backendHarness.ts"],
    expectedTestExports: ["./test/backendHarness", "./test/sync-protocol"],
    requiredPeerDependencies: ["miniflare", "vite"],
  },
] satisfies readonly PackagePackCase[];

describe("internal package tarballs", () => {
  it.each(packages)("%s packs only its public source surface", async packCase => {
    const packDir = await mkdtemp(join(tmpdir(), `${packCase.packageName}-pack-`));
    try {
      const sourceManifest = await readSourceManifest(packCase.packageRoot);
      const pack = runPnpmPack(packCase.packageRoot, packDir);
      expectSuccessfulCommand(pack);

      const tarballPath = await singlePackedTarball(packDir);
      const entries = tarballEntries(tarballPath);
      const manifest = readPackedManifest(tarballPath);

      expect(manifest.name).toBe(sourceManifest.name);
      expect(manifest.version).toBe(sourceManifest.version);
      for (const expectedEntry of packCase.expectedEntries) {
        expect(entries).toContain(expectedEntry);
      }
      for (const exportedTarget of exportedTargetEntries(manifest.exports)) {
        expect(entries).toContain(exportedTarget);
      }
      const exportedNames = Object.keys(stringRecord(manifest.exports));
      for (const expectedTestExport of packCase.expectedTestExports ?? []) {
        expect(exportedNames).toContain(expectedTestExport);
      }

      const testEntries = entries.filter(entry => entry.startsWith("package/test/"));
      expect(testEntries).toEqual(packCase.allowedTestEntries ?? []);
      expect(entries).not.toContain("package/vitest.config.ts");
      expect(entries).not.toContain("package/tsconfig.json");
      assertManifestDependencyProtocols(manifest);
      assertOptionalPeerDependencies(manifest, packCase.requiredPeerDependencies ?? []);
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  });
});
