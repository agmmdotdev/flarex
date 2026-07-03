import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  runFlarexDevCli,
  type FlarexDeployJsonOutput,
  type FlarexDevCliOptions,
} from "flarex-dev";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function packageBinPath(packageJson: unknown, binName: string): string | undefined {
  if (!isRecord(packageJson)) {
    return undefined;
  }
  if (!("bin" in packageJson)) {
    return undefined;
  }
  const bin = packageJson.bin;
  if (!isRecord(bin)) {
    return undefined;
  }
  const value = bin[binName];
  return typeof value === "string" ? value : undefined;
}

class StringWriter {
  value = "";

  write(chunk: string): void {
    this.value += chunk;
  }
}

describe("flarex-dev package entrypoint", () => {
  it("exports the CLI runner and deploy JSON output types", async () => {
    const stdout = new StringWriter();
    const options = {
      argv: ["help"],
      stdout,
    } satisfies FlarexDevCliOptions;

    await expect(runFlarexDevCli(options)).resolves.toBe(0);

    const output: FlarexDeployJsonOutput = {
      command: "deploy",
      result: "activated",
      started: { pushId: "push1", state: "analyzed" },
      finished: { pushId: "push1", state: "activated" },
    };
    expect(output.result).toBe("activated");
    expect(stdout.value).toContain("flarex-dev <command>");
  });

  it("declares a package bin that invokes the same CLI surface", () => {
    const packageJson: unknown = JSON.parse(
      readFileSync(resolve(packageRoot, "package.json"), "utf8"),
    );
    const binPath = packageBinPath(packageJson, "flarex-dev");

    expect(binPath).toBe("./bin/flarex-dev.mjs");
    if (binPath === undefined) {
      throw new Error("flarex-dev bin path is missing");
    }

    const result = spawnSync(
      process.execPath,
      [resolve(packageRoot, binPath), "help"],
      {
        cwd: packageRoot,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("flarex-dev <command>");
    expect(result.stderr).toBe("");
  }, 60000);
});
