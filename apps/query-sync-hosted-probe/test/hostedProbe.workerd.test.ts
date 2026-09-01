import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, type Plugin } from "vite";

import {
  FX02B_IDENTITY_PATH,
  FX02B_INITIAL_PATH,
  FX02B_RESUME_PATH,
} from "../src/fixture";
import { fx02bSourceWorker } from "../src/sourceWorker";

const GATEWAY_TOKEN = "fx02b-gateway-secret";
const PROBE_TOKEN = "fx02b-internal-probe-secret";
const EXECUTOR_TOKEN = "fx02b-executor-secret";

let initialBundle: string;
let restartBundle: string;

beforeAll(async () => {
  [initialBundle, restartBundle] = await Promise.all([
    bundleHostWorker("local-initial"),
    bundleHostWorker("local-restart"),
  ]);
}, 120_000);

afterAll(() => {
  initialBundle = "";
  restartBundle = "";
});

describe("FX02-B isolated hosted probe", () => {
  it("fails closed before dispatching to the Durable Object", async () => {
    const runtime = makeRuntime(initialBundle, "version-initial");
    try {
      await expect(invoke(runtime, FX02B_INITIAL_PATH, "wrong-token"))
        .resolves.toMatchObject({
          status: 401,
          body: { error: "unauthorized" },
        });
      await expect(invoke(runtime, "/not-a-probe", GATEWAY_TOKEN))
        .resolves.toMatchObject({
          status: 404,
          body: { error: "not_found" },
        });
    } finally {
      await runtime.dispose();
    }
  });

  it("proves a new boot over the same persisted cursor after reconstruction", async () => {
    const persistPath = await mkdtemp(join(tmpdir(), "flarex-fx02b-hosted-"));
    let initial: Miniflare | undefined;
    let restart: Miniflare | undefined;
    try {
      initial = makeRuntime(
        initialBundle,
        "version-initial",
        persistPath,
      );
      const first = await invoke(
        initial,
        FX02B_INITIAL_PATH,
        GATEWAY_TOKEN,
      );
      expect(first).toMatchObject({
        status: 200,
        body: {
          protocolVersion: 1,
          phase: "initialize",
          releaseMarker: "local-initial",
          workerVersionId: "version-initial",
          objectName: "deployment-sync:93000000-0000-4000-8000-000000000001",
          outcome: {
            state: "continuationRequired",
            reason: "admittedBatchLimitReached",
            cursor: "1",
          },
        },
      });
      const firstBootId = readBootId(first.body);
      await initial.dispose();
      initial = undefined;

      restart = makeRuntime(
        restartBundle,
        "version-restart",
        persistPath,
      );
      const identity = await invoke(
        restart,
        FX02B_IDENTITY_PATH,
        GATEWAY_TOKEN,
      );
      expect(identity).toMatchObject({
        status: 200,
        body: {
          protocolVersion: 1,
          phase: "identity",
          releaseMarker: "local-restart",
          workerVersionId: "version-restart",
          objectName: "deployment-sync:93000000-0000-4000-8000-000000000001",
        },
      });
      const restartBootId = readBootId(identity.body);
      expect(restartBootId).not.toBe(firstBootId);
      const second = await invoke(
        restart,
        FX02B_RESUME_PATH,
        GATEWAY_TOKEN,
      );
      expect(second).toMatchObject({
        status: 200,
        body: {
          protocolVersion: 1,
          phase: "resume",
          releaseMarker: "local-restart",
          workerVersionId: "version-restart",
          objectName: "deployment-sync:93000000-0000-4000-8000-000000000001",
          outcome: {
            state: "caughtUp",
            cursor: "2",
          },
        },
      });
      expect(readBootId(second.body)).toBe(restartBootId);
    } finally {
      if (initial !== undefined) await initial.dispose();
      if (restart !== undefined) await restart.dispose();
      await rm(persistPath, { recursive: true, force: true });
    }
  });
});

function makeRuntime(
  bundle: string,
  versionId: string,
  persistPath?: string,
): Miniflare {
  return new Miniflare({
    modules: [{ type: "ESModule", path: "worker.js", contents: bundle }],
    compatibilityDate: "2026-06-14",
    bindings: {
      CF_VERSION_METADATA: {
        id: versionId,
        tag: "",
        timestamp: "2026-09-01T00:00:00.000Z",
      },
      FLAREX_EXECUTOR_TOKEN: EXECUTOR_TOKEN,
      FLAREX_FX02B_GATEWAY_TOKEN: GATEWAY_TOKEN,
      FLAREX_QUERY_SYNC_PROBE_TOKEN: PROBE_TOKEN,
    },
    serviceBindings: {
      FLAREX_EXECUTOR: (request: Request) => fx02bSourceWorker.fetch(request, {
        FLAREX_EXECUTOR_TOKEN: EXECUTOR_TOKEN,
      }),
    },
    durableObjects: {
      DEPLOYMENT_SYNCS: {
        className: "DeploymentSyncProbeDO",
        useSQLite: true,
      },
    },
    ...(persistPath === undefined
      ? {}
      : { durableObjectsPersist: persistPath }),
  });
}

async function invoke(
  runtime: Miniflare,
  path: string,
  token: string,
): Promise<Readonly<{ readonly status: number; readonly body: unknown }>> {
  const response = await runtime.dispatchFetch(`https://fx02b.test${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  return Object.freeze({
    status: response.status,
    body: await response.json(),
  });
}

function readBootId(value: unknown): string {
  if (!isRecord(value) || typeof value.bootId !== "string") {
    throw new Error("FX02-B hosted probe boot ID missing.");
  }
  return value.bootId;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function bundleHostWorker(releaseMarker: string): Promise<string> {
  const appDirectory = dirname(dirname(fileURLToPath(import.meta.url)));
  const output = await build({
    configFile: false,
    logLevel: "silent",
    plugins: [workspacePackageResolution()],
    define: { FX02B_RELEASE_MARKER: JSON.stringify(releaseMarker) },
    build: {
      write: false,
      target: "es2022",
      lib: {
        entry: join(appDirectory, "src/hostWorker.ts"),
        formats: ["es"],
        fileName: "worker",
      },
      rolldownOptions: { external: ["cloudflare:workers"] },
    },
  });
  const chunks = (Array.isArray(output) ? output : [output]).flatMap(result =>
    "output" in result ? result.output : []
  );
  const worker = chunks.find(chunk =>
    chunk.type === "chunk" && chunk.fileName === "worker.js"
  );
  if (worker === undefined || worker.type !== "chunk") {
    throw new Error("FX02-B hosted probe worker bundle missing.");
  }
  return worker.code;
}

function workspacePackageResolution(): Plugin {
  return {
    name: "flarex-fx02b-hosted-probe-resolution",
    resolveId(id) {
      if (
        id.startsWith("@flarex/")
        || id === "flarex-backend"
        || id.startsWith("flarex-backend/")
        || id === "flarex-protocol"
        || id.startsWith("flarex-protocol/")
      ) return fileURLToPath(import.meta.resolve(id));
      return undefined;
    },
  };
}
