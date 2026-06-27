import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "..");
const flarexDevRoot = resolve(workspaceRoot, "packages/flarex-dev");
const commandTimeoutMs = 60_000;

type PackedManifest = {
  name: string;
  version: string;
  bin?: unknown;
  exports?: unknown;
  dependencies?: unknown;
  peerDependencies?: unknown;
  optionalDependencies?: unknown;
};

function runCommand(
  command: string,
  args: string[],
  cwd: string,
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: commandTimeoutMs,
  });
}

function runPnpmPack(packDir: string): SpawnSyncReturns<string> {
  if (process.platform === "win32") {
    return runCommand(
      "cmd.exe",
      [
        "/d",
        "/c",
        "pnpm",
        "--dir",
        flarexDevRoot,
        "pack",
        "--pack-destination",
        packDir,
      ],
      workspaceRoot,
    );
  }
  return runCommand(
    "pnpm",
    ["--dir", flarexDevRoot, "pack", "--pack-destination", packDir],
    workspaceRoot,
  );
}

function expectSuccessfulCommand(result: SpawnSyncReturns<string>): void {
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}

function parsePackedManifest(json: string): PackedManifest {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error("Expected packed package manifest to be an object");
  }
  const name = stringValue(parsed.name, "name");
  const version = stringValue(parsed.version, "version");
  return { ...parsed, name, version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function recordValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  return value[key];
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected package manifest ${fieldName} to be a non-empty string`);
  }
  return value;
}

function stringRecord(value: unknown): Record<string, string> {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) {
    throw new Error("Expected a record");
  }
  const result: Record<string, string> = {};
  const entries = Object.entries(value);
  for (const [, entryValue] of entries) {
    expect(typeof entryValue).toBe("string");
  }
  for (const [entryKey, entryValue] of entries) {
    if (typeof entryValue === "string") {
      result[entryKey] = entryValue;
    }
  }
  return result;
}

function packageEntry(path: string): string {
  return `package/${path.replace(/^\.\//, "")}`;
}

function exportedTargetEntries(exportsValue: unknown): string[] {
  const exports = stringRecord(exportsValue);
  return Object.values(exports).map(packageEntry);
}

function optionalStringRecord(value: unknown): Record<string, string> {
  return value === undefined ? {} : stringRecord(value);
}

function assertNoLocalDependencyProtocols(
  label: string,
  dependencies: Record<string, string>,
): void {
  const localProtocols = ["workspace:", "catalog:", "link:", "file:"];
  const invalid = Object.entries(dependencies).filter(([, version]) =>
    localProtocols.some(protocol => version.startsWith(protocol)),
  );
  expect(invalid, `${label} contains local dependency protocols`).toEqual([]);
}

async function singlePackedTarball(packDir: string): Promise<string> {
  const files = await readdir(packDir);
  const tarballs = files.filter(file => file.endsWith(".tgz"));
  expect(tarballs).toHaveLength(1);
  const [tarball] = tarballs;
  if (tarball === undefined) {
    throw new Error("Expected pnpm pack to create one tarball");
  }
  return join(packDir, tarball);
}

describe("flarex-dev packed package", () => {
  it("contains the CLI bin and source entrypoints without test files", async () => {
    const packDir = await mkdtemp(join(tmpdir(), "flarex-dev-pack-"));
    try {
      const sourceManifest = parsePackedManifest(
        await readFile(join(flarexDevRoot, "package.json"), "utf8"),
      );
      const pack = runPnpmPack(packDir);
      expectSuccessfulCommand(pack);

      const tarballPath = await singlePackedTarball(packDir);
      const list = runCommand("tar", ["-tf", tarballPath], workspaceRoot);
      expectSuccessfulCommand(list);
      const entries = list.stdout.split(/\r?\n/).filter(Boolean);

      expect(entries).toContain("package/bin/flarex-dev.mjs");
      expect(entries).toContain("package/src/bin.ts");
      expect(entries).toContain("package/src/cli.ts");
      expect(entries.some(entry => entry.startsWith("package/test/"))).toBe(false);
      expect(entries).not.toContain("package/vitest.config.ts");

      const manifestJson = runCommand(
        "tar",
        ["-xOf", tarballPath, "package/package.json"],
        workspaceRoot,
      );
      expectSuccessfulCommand(manifestJson);
      const manifest = parsePackedManifest(manifestJson.stdout);
      const bin = stringRecord(manifest.bin);
      const exportedTargets = exportedTargetEntries(manifest.exports);
      const dependencies = stringRecord(manifest.dependencies);
      const peerDependencies = optionalStringRecord(manifest.peerDependencies);
      const optionalDependencies = optionalStringRecord(manifest.optionalDependencies);

      expect(manifest.name).toBe(sourceManifest.name);
      expect(manifest.version).toBe(sourceManifest.version);
      expect(bin["flarex-dev"]).toBe("./bin/flarex-dev.mjs");
      for (const exportedTarget of exportedTargets) {
        expect(entries).toContain(exportedTarget);
      }
      expect(dependencies["tsx"]).toBeDefined();
      assertNoLocalDependencyProtocols("dependencies", dependencies);
      assertNoLocalDependencyProtocols("peerDependencies", peerDependencies);
      assertNoLocalDependencyProtocols("optionalDependencies", optionalDependencies);
      expect(recordValue(manifest, "devDependencies")).toBeUndefined();
    } finally {
      await rm(packDir, { recursive: true, force: true });
    }
  });
});
