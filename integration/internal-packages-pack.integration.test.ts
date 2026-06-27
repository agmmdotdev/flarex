import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertManifestDependencyProtocols,
  assertNoPackedDevelopmentEntries,
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
  readonly expectedDrizzleMigrationsRoot?: string;
  readonly requiredPeerDependencies?: readonly string[];
};

type DrizzleJournalEntry = {
  idx: number;
  tag: string;
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
  {
    packageName: "@flarex/persistence-postgres",
    packageRoot: resolve(workspaceRoot, "packages/persistence-postgres"),
    expectedEntries: [
      "package/src/index.ts",
      "package/src/postgres.ts",
      "package/src/pglite.ts",
      "package/src/schema.ts",
      "package/drizzle/meta/_journal.json",
      "package/drizzle/0000_dapper_warbird.sql",
    ],
    expectedDrizzleMigrationsRoot: resolve(
      workspaceRoot,
      "packages/persistence-postgres/drizzle",
    ),
  },
  {
    packageName: "@flarex/freshness",
    packageRoot: resolve(workspaceRoot, "packages/freshness"),
    expectedEntries: ["package/src/index.ts"],
  },
  {
    packageName: "@flarex/executor",
    packageRoot: resolve(workspaceRoot, "packages/executor"),
    expectedEntries: [
      "package/src/index.ts",
      "package/src/invoke.ts",
      "package/src/liveQueries.ts",
      "package/src/maintenance.ts",
    ],
  },
  {
    packageName: "@flarex/executor-http",
    packageRoot: resolve(workspaceRoot, "packages/executor-http"),
    expectedEntries: [
      "package/src/index.ts",
      "package/src/liveQueryDelivery.ts",
    ],
  },
] satisfies readonly PackagePackCase[];

describe("internal package tarballs", () => {
  it.each(packages)("%s packs only its public source surface", async packCase => {
    const tempPrefix = `${packCase.packageName.replaceAll(/[^a-zA-Z0-9-]/g, "-")}-pack-`;
    const packDir = await mkdtemp(join(tmpdir(), tempPrefix));
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
      for (const expectedMigrationEntry of await expectedDrizzleMigrationEntries(packCase)) {
        expect(entries).toContain(expectedMigrationEntry);
      }
      for (const exportedTarget of exportedTargetEntries(manifest.exports)) {
        expect(entries).toContain(exportedTarget);
      }
      const exportedNames = Object.keys(stringRecord(manifest.exports));
      for (const expectedTestExport of packCase.expectedTestExports ?? []) {
        expect(exportedNames).toContain(expectedTestExport);
      }

      assertNoPackedDevelopmentEntries(entries, packCase.allowedTestEntries);
      assertManifestDependencyProtocols(manifest);
      assertOptionalPeerDependencies(manifest, packCase.requiredPeerDependencies ?? []);
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  });
});

async function expectedDrizzleMigrationEntries(
  packCase: PackagePackCase,
): Promise<string[]> {
  if (packCase.expectedDrizzleMigrationsRoot === undefined) {
    return [];
  }
  const journal = parseDrizzleJournal(
    await readFile(
      join(packCase.expectedDrizzleMigrationsRoot, "meta/_journal.json"),
      "utf8",
    ),
  );
  return journal.flatMap(entry => [
    `package/drizzle/${entry.tag}.sql`,
    `package/drizzle/meta/${entry.idx.toString().padStart(4, "0")}_snapshot.json`,
  ]);
}

function parseDrizzleJournal(json: string): DrizzleJournalEntry[] {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed) || !Array.isArray(parsed.entries)) {
    throw new Error("Expected Drizzle journal entries array");
  }
  return parsed.entries.map(parseDrizzleJournalEntry);
}

function parseDrizzleJournalEntry(entry: unknown): DrizzleJournalEntry {
  if (!isRecord(entry)) {
    throw new Error("Expected Drizzle journal entry object");
  }
  if (typeof entry.idx !== "number") {
    throw new Error("Expected Drizzle journal idx to be a number");
  }
  if (typeof entry.tag !== "string" || entry.tag.length === 0) {
    throw new Error("Expected Drizzle journal tag to be a non-empty string");
  }
  return { idx: entry.idx, tag: entry.tag };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
