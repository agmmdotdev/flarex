import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, createServer } from "vite";
import { describe, expect, it } from "vitest";
import { flarex } from "../src/vite";
import { createMinimalFlarexProject } from "./fixtures";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

describe("flarex Vite plugin", () => {
  it("forwards generated output typecheck into the default dev runtime", async () => {
    const root = await createMinimalFlarexProject("flarex-vite-plugin-");
    try {
      await expect(createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [
          flarex({
            typecheckGeneratedOutput: {
              typescriptCliPath: "node_modules/typescript/bin/not-tsc.js",
              cwd: workspaceRoot,
              compilerOptions: {
                paths: {
                  flarex: ["packages/flarex/src/index.ts"],
                  "flarex/*": ["packages/flarex/src/*"],
                },
              },
            },
          }),
        ],
    })).rejects.toThrow("Generated output typecheck failed.");
    } finally {
      await removeRoot(root);
    }
  }, 60000);

  it("runs plugin-owned generated output typecheck once in dev:false serve mode", async () => {
    const root = await createMinimalFlarexProject("flarex-vite-plugin-");
    const typecheckConfig = {
      typescriptCliPath: "node_modules/typescript/bin/tsc",
      cwd: workspaceRoot,
      compilerOptions: {
        paths: {
          flarex: ["packages/flarex/src/index.ts"],
          "flarex/*": ["packages/flarex/src/*"],
        },
      },
    };
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    try {
      server = await createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [
          flarex({
            dev: false,
            typecheckGeneratedOutput: typecheckConfig,
          }),
        ],
      });
      typecheckConfig.typescriptCliPath = "node_modules/typescript/bin/not-tsc.js";
      await expect(server.pluginContainer.buildStart({})).resolves.toBeUndefined();
    } finally {
      await server?.close();
      await removeRoot(root);
    }
  }, 60000);

  it("logs dev:false watcher generated output typecheck failures", async () => {
    const root = await createMinimalFlarexProject("flarex-vite-plugin-");
    const typecheckConfig = {
      typescriptCliPath: "node_modules/typescript/bin/tsc",
      cwd: workspaceRoot,
      compilerOptions: {
        paths: {
          flarex: ["packages/flarex/src/index.ts"],
          "flarex/*": ["packages/flarex/src/*"],
        },
      },
    };
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    const errors: string[] = [];
    try {
      server = await createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [
          flarex({
            dev: false,
            typecheckGeneratedOutput: typecheckConfig,
          }),
        ],
      });
      server.config.logger.error = message => {
        errors.push(message);
      };
      typecheckConfig.typescriptCliPath = "node_modules/typescript/bin/not-tsc.js";
      server.watcher.emit("change", path.join(root, "flarex/functions/messages.ts"));

      await waitFor(() => errors.some(error =>
        error.includes("Generated output typecheck failed."),
      ), 30000);
    } finally {
      await server?.close();
      await removeRoot(root);
    }
  }, 60000);

  it("ignores generated directory changes in the dev:false watcher", async () => {
    const root = await createMinimalFlarexProject("flarex-vite-plugin-");
    const typecheckConfig = {
      typescriptCliPath: "node_modules/typescript/bin/tsc",
      cwd: workspaceRoot,
      compilerOptions: {
        paths: {
          flarex: ["packages/flarex/src/index.ts"],
          "flarex/*": ["packages/flarex/src/*"],
        },
      },
    };
    let server: Awaited<ReturnType<typeof createServer>> | undefined;
    const errors: string[] = [];
    try {
      server = await createServer({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [
          flarex({
            dev: false,
            typecheckGeneratedOutput: typecheckConfig,
          }),
        ],
      });
      server.config.logger.error = message => {
        errors.push(message);
      };
      typecheckConfig.typescriptCliPath = "node_modules/typescript/bin/not-tsc.js";
      server.watcher.emit("change", path.join(root, "flarex/_generated/server.ts"));

      await new Promise(resolve => setTimeout(resolve, 500));
      expect(errors).toEqual([]);
    } finally {
      await server?.close();
      await removeRoot(root);
    }
  }, 60000);

  it("runs generated output typecheck during build codegen when enabled", async () => {
    const root = await createMinimalFlarexProject("flarex-vite-plugin-");
    try {
      await expect(build({
        root,
        configFile: false,
        logLevel: "silent",
        plugins: [
          flarex({
            dev: false,
            typecheckGeneratedOutput: {
              typescriptCliPath: "node_modules/typescript/bin/not-tsc.js",
              cwd: workspaceRoot,
              compilerOptions: {
                paths: {
                  flarex: ["packages/flarex/src/index.ts"],
                  "flarex/*": ["packages/flarex/src/*"],
                },
              },
            },
          }),
        ],
        build: {
          write: false,
          target: "es2022",
          lib: {
            entry: path.join(root, "flarex/_generated/worker.ts"),
            formats: ["es"],
            fileName: "worker",
          },
          rolldownOptions: { external: ["cloudflare:workers"] },
        },
    })).rejects.toThrow("Generated output typecheck failed.");
    } finally {
      await removeRoot(root);
    }
  }, 60000);
});

async function removeRoot(root: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await rm(root, { recursive: true, force: true });
      return;
    } catch (error) {
      if (attempt === 4) throw error;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
  }
}

async function waitFor(assertion: () => boolean, timeoutMs = 5000): Promise<void> {
  const started = Date.now();
  while (!assertion()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error("Timed out waiting for assertion.");
    }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}
