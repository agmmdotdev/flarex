import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { build } from "vite";

import type { ProbeGatewayEnv } from "../src/gateway";
import type { ProbeMockCommitEnv } from "../src/mockCommitWorker";

export const PROBE_TEST_TOKEN = "runtime-topology-probe-test-secret";
export const PROBE_TEST_AUTHORIZATION = `Bearer ${PROBE_TEST_TOKEN}`;
export const PROBE_GATEWAY_WORKER_NAME = "runtime-topology-probe-gateway-test";
export const PROBE_MOCK_WORKER_NAME = "runtime-topology-probe-mock-test";
export const PROBE_SYNC_WORKER_NAME = "runtime-topology-probe-sync-test";

export interface RuntimeProbeHarness {
  readonly mf: Miniflare;
  readonly persistPath: string;
  bindings(): Promise<ProbeGatewayEnv>;
  mockBindings(): Promise<ProbeMockCommitEnv>;
  dispose(): Promise<void>;
}

export interface RuntimeProbeHarnessOptions {
  readonly persistPath?: string;
  readonly removePersistPathOnDispose?: boolean;
  readonly mockFinish?: boolean;
  readonly mockRead?: boolean;
  readonly token?: string | false;
  readonly workerLoader?: boolean;
}

let gatewayBundlePromise: Promise<string> | undefined;
let mockBundlePromise: Promise<string> | undefined;
let syncBundlePromise: Promise<string> | undefined;

export async function createRuntimeProbeHarness(
  options: RuntimeProbeHarnessOptions = {},
): Promise<RuntimeProbeHarness> {
  const persistPath = options.persistPath ??
    await mkdtemp(join(tmpdir(), "flarex-runtime-probe-"));
  const removePersistPathOnDispose =
    options.removePersistPathOnDispose ?? options.persistPath === undefined;
  const bindings = options.token === false
    ? {}
    : {
        RUNTIME_TOPOLOGY_PROBE_TOKEN: options.token ?? PROBE_TEST_TOKEN,
      };
  const miniflareOptions = {
    durableObjectsPersist: persistPath,
    workers: [
      {
        name: PROBE_GATEWAY_WORKER_NAME,
        compatibilityDate: "2026-06-14",
        modules: [
          {
            type: "ESModule",
            path: "worker.js",
            contents: await gatewayBundle(),
          },
        ],
        bindings,
        ...(options.workerLoader === false
          ? {}
          : { workerLoaders: { LOADER: {} } }),
        serviceBindings: {
          ...(options.mockRead === false
            ? {}
            : {
                MOCK_READ: {
                  name: PROBE_MOCK_WORKER_NAME,
                  entrypoint: "MockReadEntrypoint",
                },
              }),
          ...(options.mockFinish === false
            ? {}
            : {
                MOCK_FINISH: {
                  name: PROBE_MOCK_WORKER_NAME,
                  entrypoint: "MockFinishEntrypoint",
                },
              }),
        },
        durableObjects: {
          PROBE_SESSIONS: {
            className: "ProbeSessionDO",
            useSQLite: true,
          },
        },
      },
      {
        name: PROBE_MOCK_WORKER_NAME,
        compatibilityDate: "2026-06-14",
        modules: [
          {
            type: "ESModule",
            path: "worker.js",
            contents: await mockBundle(),
          },
        ],
        durableObjects: {
          PROBE_SYNC: {
            className: "ProbeSyncDO",
            scriptName: PROBE_SYNC_WORKER_NAME,
          },
        },
      },
      {
        name: PROBE_SYNC_WORKER_NAME,
        compatibilityDate: "2026-06-14",
        modules: [
          {
            type: "ESModule",
            path: "worker.js",
            contents: await syncBundle(),
          },
        ],
        durableObjects: {
          PROBE_SYNC: {
            className: "ProbeSyncDO",
            useSQLite: true,
          },
        },
      },
    ],
  } satisfies MiniflareOptions;
  const mf = new Miniflare(miniflareOptions);

  return {
    mf,
    persistPath,
    bindings: async () =>
      await mf.getBindings<ProbeGatewayEnv>(PROBE_GATEWAY_WORKER_NAME),
    mockBindings: async () =>
      await mf.getBindings<ProbeMockCommitEnv>(PROBE_MOCK_WORKER_NAME),
    dispose: async () => {
      await mf.dispose();
      if (removePersistPathOnDispose) {
        await rm(persistPath, { recursive: true, force: true });
      }
    },
  };
}

export async function removeRuntimeProbePersistPath(
  persistPath: string,
): Promise<void> {
  await rm(persistPath, { recursive: true, force: true });
}

async function gatewayBundle(): Promise<string> {
  gatewayBundlePromise ??= bundleGatewayWorker();
  return await gatewayBundlePromise;
}

async function mockBundle(): Promise<string> {
  mockBundlePromise ??= bundleWorker("mockCommitWorker.ts");
  return await mockBundlePromise;
}

async function syncBundle(): Promise<string> {
  syncBundlePromise ??= bundleWorker("syncWorker.ts");
  return await syncBundlePromise;
}

async function bundleGatewayWorker(): Promise<string> {
  return await bundleWorker("gatewayWorker.ts");
}

async function bundleWorker(entry: string): Promise<string> {
  const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(appDir, `src/${entry}`),
        formats: ["es"],
        fileName: "worker",
      },
      rollupOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : []
  );
  const worker = chunks.find(
    chunk => chunk.type === "chunk" && chunk.fileName === "worker.js",
  );
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error("Runtime topology gateway bundle was not emitted.");
  }
  return worker.code;
}
