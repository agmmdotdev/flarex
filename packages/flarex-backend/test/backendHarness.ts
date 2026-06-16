import { Miniflare } from "miniflare";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import type { Plugin } from "vite";

export type BackendHarness = {
  mf: Miniflare;
  dispose: () => Promise<void>;
};

export async function createBackendHarness(): Promise<BackendHarness> {
  const persistPath = await mkdtemp(join(tmpdir(), "flarex-miniflare-"));
  const mf = new Miniflare({
    modules: [
      {
        type: "ESModule",
        path: "worker.js",
        contents: await bundleWorker(),
      },
    ],
    compatibilityDate: "2026-06-14",
    durableObjectsPersist: persistPath,
    durableObjects: {
      REGISTRY: { className: "RegistryDO", useSQLite: true },
      DEPLOYMENTS: { className: "DeploymentDO", useSQLite: true },
      PARTITIONS: { className: "PartitionDO", useSQLite: true },
      EXECUTIONS: { className: "ExecutionDO", useSQLite: true },
      CONNECTIONS: { className: "ConnectionDO", useSQLite: true },
      SCHEDULERS: { className: "SchedulerDO", useSQLite: true },
    },
  });

  return {
    mf,
    dispose: async () => {
      await mf.dispose();
      await rm(persistPath, { recursive: true, force: true });
    },
  };
}

async function bundleWorker(): Promise<string> {
  const backendDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    build: {
      write: false,
      target: "es2022",
      lib: { entry: join(backendDir, "src/worker.ts"), formats: ["es"], fileName: "worker" },
      rollupOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : [],
  );
  const worker = chunks.find(chunk => chunk.type === "chunk" && chunk.fileName === "worker.js");
  if (!worker || worker.type !== "chunk") {
    throw new Error("Worker bundle was not emitted.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-workspace-package-resolution",
    resolveId(id) {
      if (id === "flarex" || id.startsWith("flarex/")) {
        return fileURLToPath(import.meta.resolve(id));
      }
      return undefined;
    },
  };
}
