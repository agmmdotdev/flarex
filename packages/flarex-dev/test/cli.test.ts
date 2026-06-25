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

  it("ignores a leading package-script argument separator", async () => {
    let generateRoot: string | undefined;

    await expect(runFlarexDevCli({
      projectRoot: "/current-project",
      argv: ["--", "codegen"],
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

  it("prints dry-run writes and deletes without normal codegen or typecheck", async () => {
    const stdout = new StringWriter();
    let generateCalls = 0;
    let typecheckCalls = 0;
    let dryRunRoot: string | undefined;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--dry-run", "--typecheck", "enable"],
      stdout,
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
        dryRun: async options => {
          dryRunRoot = options.root;
          return {
            writes: [{
              name: "server.ts",
              path: "/app/flarex/_generated/server.ts",
              contents: "server",
            }],
            deletes: [{
              name: "old.ts",
              path: "/app/flarex/_generated/old.ts",
              kind: "file",
            }, {
              name: "oldDir",
              path: "/app/flarex/_generated/oldDir",
              kind: "directory",
            }],
          };
        },
        typecheckGenerated: async () => {
          typecheckCalls += 1;
        },
      },
    })).resolves.toBe(0);

    expect(dryRunRoot).toBe("/app");
    expect(generateCalls).toBe(0);
    expect(typecheckCalls).toBe(0);
    expect(stdout.value).toContain("Command would write file: /app/flarex/_generated/server.ts");
    expect(stdout.value).toContain("Command would delete file: /app/flarex/_generated/old.ts");
    expect(stdout.value).toContain("Command would delete directory: /app/flarex/_generated/oldDir");
  });

  it("dry-runs real codegen without writing generated files", async () => {
    const root = await createMinimalFlarexProject("flarex-cli-dry-run-");
    const stdout = new StringWriter();
    try {
      await expect(runFlarexDevCli({
        projectRoot: root,
        argv: ["codegen", "--dry-run"],
        stdout,
      })).resolves.toBe(0);

      expect(stdout.value).toContain("Command would write file:");
      expect(stdout.value).toContain("server.ts");
      await expect(stat(path.join(root, "flarex/_generated/server.ts"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);

  it("skips generated-output typecheck when mode is disable", async () => {
    let typecheckCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "disable"],
      dependencies: {
        generate: async () => {},
        typecheckGenerated: async () => {
          typecheckCalls += 1;
        },
      },
    })).resolves.toBe(0);

    expect(typecheckCalls).toBe(0);
  });

  it("continues when generated-output typecheck fails in try mode", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "try"],
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
        typecheckGenerated: async () => {
          throw new Error("tsc failed");
        },
      },
      stderr,
    })).resolves.toBe(0);

    expect(generateCalls).toBe(1);
    expect(stderr.value).toContain("--typecheck try");
    expect(stderr.value).toContain("tsc failed");
  });

  it("rejects invalid typecheck modes before codegen", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "maybe"],
      dependencies: {
        generate: async () => {
          generateCalls += 1;
        },
      },
      stderr,
    })).resolves.toBe(1);

    expect(generateCalls).toBe(0);
    expect(stderr.value).toContain('Invalid --typecheck value "maybe"');
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

  it("rejects malformed typecheck path mappings before codegen even when typecheck is disabled", async () => {
    const stderr = new StringWriter();
    let generateCalls = 0;

    await expect(runFlarexDevCli({
      argv: ["codegen", "--root", "/app", "--typecheck", "disable", "--path", "flarex"],
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
