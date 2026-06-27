import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { expect } from "vitest";

export const workspaceRoot = resolve(import.meta.dirname, "..");
export const commandTimeoutMs = 60_000;

export type PackedManifest = {
  name: string;
  version: string;
  bin?: unknown;
  exports?: unknown;
  dependencies?: unknown;
  peerDependencies?: unknown;
  peerDependenciesMeta?: unknown;
  optionalDependencies?: unknown;
  devDependencies?: unknown;
};

export function runCommand(
  command: string,
  args: string[],
  cwd: string,
  timeoutMs: number = commandTimeoutMs,
): SpawnSyncReturns<string> {
  return spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: timeoutMs,
  });
}

export function runPnpmPack(
  packageRoot: string,
  packDir: string,
): SpawnSyncReturns<string> {
  if (process.platform === "win32") {
    return runCommand(
      "cmd.exe",
      [
        "/d",
        "/c",
        "pnpm",
        "--dir",
        packageRoot,
        "pack",
        "--pack-destination",
        packDir,
      ],
      workspaceRoot,
    );
  }
  return runCommand(
    "pnpm",
    ["--dir", packageRoot, "pack", "--pack-destination", packDir],
    workspaceRoot,
  );
}

export function expectSuccessfulCommand(result: SpawnSyncReturns<string>): void {
  expect(result.error).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
}

export function parsePackedManifest(json: string): PackedManifest {
  const parsed: unknown = JSON.parse(json);
  if (!isRecord(parsed)) {
    throw new Error("Expected packed package manifest to be an object");
  }
  const name = stringValue(parsed.name, "name");
  const version = stringValue(parsed.version, "version");
  return { ...parsed, name, version };
}

export async function readSourceManifest(packageRoot: string): Promise<PackedManifest> {
  return parsePackedManifest(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
}

export function recordValue(value: unknown, key: string): unknown {
  if (!isRecord(value)) {
    return undefined;
  }
  return value[key];
}

export function stringRecord(value: unknown): Record<string, string> {
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

export function optionalStringRecord(value: unknown): Record<string, string> {
  return value === undefined ? {} : stringRecord(value);
}

export function exportedTargetEntries(exportsValue: unknown): string[] {
  const exports = stringRecord(exportsValue);
  return Object.values(exports).map(packageEntry);
}

export function assertNoLocalDependencyProtocols(
  label: string,
  dependencies: Record<string, string>,
): void {
  const localProtocols = ["workspace:", "catalog:", "link:", "file:"];
  const invalid = Object.entries(dependencies).filter(([, version]) =>
    localProtocols.some(protocol => version.startsWith(protocol)),
  );
  expect(invalid, `${label} contains local dependency protocols`).toEqual([]);
}

export function assertManifestDependencyProtocols(manifest: PackedManifest): void {
  assertNoLocalDependencyProtocols(
    "dependencies",
    optionalStringRecord(manifest.dependencies),
  );
  assertNoLocalDependencyProtocols(
    "peerDependencies",
    optionalStringRecord(manifest.peerDependencies),
  );
  assertNoLocalDependencyProtocols(
    "optionalDependencies",
    optionalStringRecord(manifest.optionalDependencies),
  );
  assertNoLocalDependencyProtocols(
    "devDependencies",
    optionalStringRecord(manifest.devDependencies),
  );
}

export function assertOptionalPeerDependencies(
  manifest: PackedManifest,
  dependencyNames: readonly string[],
): void {
  const peerDependencies = optionalStringRecord(manifest.peerDependencies);
  const peerDependenciesMeta = optionalRecord(manifest.peerDependenciesMeta);
  for (const dependencyName of dependencyNames) {
    expect(peerDependencies[dependencyName]).toBeDefined();
    const metadata = optionalRecord(peerDependenciesMeta[dependencyName]);
    expect(metadata.optional).toBe(true);
  }
}

export function assertNoPackedDevelopmentEntries(
  entries: readonly string[],
  allowedEntries: readonly string[] = [],
): void {
  const allowed = new Set(allowedEntries);
  const invalidEntries = entries.filter(entry =>
    !allowed.has(entry) && isDevelopmentEntry(entry),
  );
  expect(invalidEntries, "tarball contains development-only entries").toEqual([]);
}

export async function singlePackedTarball(packDir: string): Promise<string> {
  const files = await readdir(packDir);
  const tarballs = files.filter(file => file.endsWith(".tgz"));
  expect(tarballs).toHaveLength(1);
  const [tarball] = tarballs;
  if (tarball === undefined) {
    throw new Error("Expected pnpm pack to create one tarball");
  }
  return join(packDir, tarball);
}

export function tarballEntries(tarballPath: string): string[] {
  const list = runCommand("tar", ["-tf", tarballPath], workspaceRoot);
  expectSuccessfulCommand(list);
  return list.stdout.split(/\r?\n/).filter(Boolean);
}

export function readPackedManifest(tarballPath: string): PackedManifest {
  const manifestJson = runCommand(
    "tar",
    ["-xOf", tarballPath, "package/package.json"],
    workspaceRoot,
  );
  expectSuccessfulCommand(manifestJson);
  return parsePackedManifest(manifestJson.stdout);
}

function packageEntry(path: string): string {
  return `package/${path.replace(/^\.\//, "")}`;
}

function isDevelopmentEntry(entry: string): boolean {
  const parts = entry.split("/");
  const filename = parts.at(-1) ?? "";
  return (
    parts.some(part => developmentOnlyPathSegments.has(part)) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename) ||
    isConfigFilename(filename)
  );
}

const developmentOnlyPathSegments = new Set([
  "__fixtures__",
  "__tests__",
  "fixture",
  "fixtures",
  "test",
  "tests",
]);

function isConfigFilename(filename: string): boolean {
  return (
    filename === "tsconfig.json" ||
    /^tsconfig\..+\.json$/.test(filename) ||
    /^vitest\.config\.[cm]?[jt]s$/.test(filename) ||
    /^vite\.config\.[cm]?[jt]s$/.test(filename)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return value === undefined ? {} : recordValueAsRecord(value);
}

function recordValueAsRecord(value: unknown): Record<string, unknown> {
  expect(isRecord(value)).toBe(true);
  if (!isRecord(value)) {
    throw new Error("Expected a record");
  }
  return value;
}

function stringValue(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Expected package manifest ${fieldName} to be a non-empty string`);
  }
  return value;
}
