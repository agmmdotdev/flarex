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

export const DEPLOY_PUSH_TEST_TOKEN = "test-deploy-push-secret";
export const DEPLOY_PUSH_TEST_AUTHORIZATION = `Bearer ${DEPLOY_PUSH_TEST_TOKEN}`;
export const ANALYZED_START_TEST_TOKEN = DEPLOY_PUSH_TEST_TOKEN;
export const ANALYZED_START_TEST_AUTHORIZATION = DEPLOY_PUSH_TEST_AUTHORIZATION;

export function deployPushJsonHeaders(
  authorization = DEPLOY_PUSH_TEST_AUTHORIZATION,
): Record<string, string> {
  return {
    authorization,
    "content-type": "application/json",
  };
}

export type BackendHarnessOptions = {
  bindings?: Record<string, string>;
  analyzedStartTestToken?: string | false;
  r2Buckets?: string[];
  serviceBindings?: Record<string, (request: Request) => Response | Promise<Response>>;
};

export async function createBackendHarness(options: BackendHarnessOptions = {}): Promise<BackendHarness> {
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
      DELIVERIES: { className: "DeliveryDO", useSQLite: true },
      SCHEDULERS: { className: "SchedulerDO", useSQLite: true },
    },
    ...(options.r2Buckets === undefined
      ? {}
      : { r2Buckets: options.r2Buckets, r2Persist: persistPath }),
    bindings: {
      ...(options.analyzedStartTestToken === false
        ? {}
        : { FLAREX_ANALYZED_START_TOKEN: options.analyzedStartTestToken ?? DEPLOY_PUSH_TEST_TOKEN }),
      ...options.bindings,
    },
    ...(options.serviceBindings === undefined ? {} : { serviceBindings: options.serviceBindings }),
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
      rolldownOptions: { external: ["cloudflare:workers"] },
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
