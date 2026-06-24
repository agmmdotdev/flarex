import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { FlarexGeneratedOutputTypecheckOptions } from "../src/generatedTypecheck";
import { runFlarexDevCli } from "../src/cli";
import { createMinimalFlarexProject } from "./fixtures";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

class StringWriter {
  value = "";

  write(chunk: string): void {
    this.value += chunk;
  }
}

describe("runFlarexDevCli", () => {
  it("runs codegen and generated-output typecheck", async () => {
    const root = await createMinimalFlarexProject("flarex-cli-");
    try {
      await expect(runFlarexDevCli({
        projectRoot: root,
        argv: [
          "codegen",
          "--typecheck",
          "--cwd",
          workspaceRoot,
          "--typescript-cli",
          "node_modules/typescript/bin/tsc",
          "--path",
          "flarex=packages/flarex/src/index.ts",
          "--path",
          "flarex/*=packages/flarex/src/*",
        ],
      })).resolves.toBe(0);

      await expect(stat(path.join(root, "flarex/_generated/server.ts"))).resolves.toBeTruthy();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("rejects an empty explicit root", async () => {
    const stderr = new StringWriter();

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", ""],
      stderr,
    })).resolves.toBe(1);

    expect(stderr.value).toContain("--root must be a non-empty path");
    expect(stderr.value).toContain("flarex-dev codegen [--root <path>]");
  });

  it("defaults codegen root to the project root", async () => {
    let generateRoot: string | undefined;

    await expect(runFlarexDevCli({
      projectRoot: "/current-project",
      argv: ["codegen"],
      dependencies: {
        generate: async options => {
          generateRoot = options.root;
        },
      },
    })).resolves.toBe(0);

    expect(generateRoot).toBe("/current-project");
  });

  it("passes app paths and typecheck path mappings to dependencies", async () => {
    const seen: {
      generateRoot: string | undefined;
      appDir: string | undefined;
      generatedDir: string | undefined;
      paths: NonNullable<FlarexGeneratedOutputTypecheckOptions["compilerOptions"]>["paths"] | undefined;
    } = {
      generateRoot: undefined,
      appDir: undefined,
      generatedDir: undefined,
      paths: undefined,
    };

    await expect(runFlarexDevCli({
      argv: [
        "codegen",
        "--root",
        "/app",
        "--app-dir",
        "custom",
        "--generated-dir",
        "gen",
        "--typecheck",
        "--path",
        "flarex=packages/flarex/src/index.ts",
        "--path",
        "flarex=packages/flarex/src/alt.ts",
      ],
      dependencies: {
        generate: async options => {
          seen.generateRoot = options.root;
          seen.appDir = options.appDir;
          seen.generatedDir = options.generatedDir;
        },
        typecheckGenerated: async options => {
          seen.paths = options.compilerOptions?.paths;
        },
      },
    })).resolves.toBe(0);

    expect(seen).toEqual({
      generateRoot: "/app",
      appDir: "custom",
      generatedDir: "gen",
      paths: {
        flarex: ["packages/flarex/src/index.ts", "packages/flarex/src/alt.ts"],
      },
    });
  });

  it("rejects malformed typecheck path mappings", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "--path", "flarex"],
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
      stderr,
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain('Invalid --path value "flarex"');
  });
});
