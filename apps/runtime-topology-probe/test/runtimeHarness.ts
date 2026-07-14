import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Miniflare, type MiniflareOptions } from "miniflare";
import { build } from "vite";

import type { ProbeGatewayEnv } from "../src/gateway";

export const PROBE_TEST_TOKEN = "runtime-topology-probe-test-secret";
export const PROBE_TEST_AUTHORIZATION = `Bearer ${PROBE_TEST_TOKEN}`;
export const PROBE_GATEWAY_WORKER_NAME = "runtime-topology-probe-gateway-test";

export interface RuntimeProbeHarness {
  readonly mf: Miniflare;
  readonly persistPath: string;
  bindings(): Promise<ProbeGatewayEnv>;
  dispose(): Promise<void>;
}

export interface RuntimeProbeHarnessOptions {
  readonly persistPath?: string;
  readonly removePersistPathOnDispose?: boolean;
  readonly token?: string | false;
}

let gatewayBundlePromise: Promise<string> | undefined;

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
        durableObjects: {
          PROBE_SESSIONS: {
            className: "ProbeSessionDO",
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

async function bundleGatewayWorker(): Promise<string> {
  const appDir = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(appDir, "src/gatewayWorker.ts"),
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
