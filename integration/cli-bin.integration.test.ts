import { existsSync } from "node:fs";
import { delimiter, resolve } from "node:path";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { describe, expect, it } from "vitest";

const workspaceRoot = resolve(import.meta.dirname, "..");
const exampleRoot = resolve(workspaceRoot, "apps/example");
const commandTimeoutMs = 30_000;

function runExampleFlarexDevHelp(): SpawnSyncReturns<string> {
  const binDir = resolve(exampleRoot, "node_modules/.bin");
  const expectedShimPath = resolve(
    binDir,
    process.platform === "win32" ? "flarex-dev.CMD" : "flarex-dev",
  );
  const env = {
    ...process.env,
    PATH: `${binDir}${delimiter}${process.env.PATH ?? ""}`,
  };

  expect(existsSync(expectedShimPath)).toBe(true);

  if (process.platform === "win32") {
    return spawnSync("cmd.exe", ["/d", "/s", "/c", "flarex-dev help"], {
      cwd: exampleRoot,
      encoding: "utf8",
      env,
      timeout: commandTimeoutMs,
    });
  }

  return spawnSync("flarex-dev", ["help"], {
    cwd: exampleRoot,
    encoding: "utf8",
    env,
    timeout: commandTimeoutMs,
  });
}

describe("flarex-dev package-manager bin", () => {
  it("runs from the example app local .bin shim", () => {
    const result = runExampleFlarexDevHelp();

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("flarex-dev <command>");
    expect(result.stdout).toContain("codegen");
    expect(result.stdout).toContain("deploy");
    expect(result.stderr).toBe("");
  });
});
