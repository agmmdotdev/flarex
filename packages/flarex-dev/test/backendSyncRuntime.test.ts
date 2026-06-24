import { afterAll, describe, expect, it } from "vitest";
import type { BeginInvokeSessionResult } from "@flarex/executor";
import {
  createExecutionArtifactRuntimeService,
  type ExecutionArtifactRuntimeService,
} from "flarex-backend/artifact-runtime";
import { R2BackendExecutionArtifactStore, type R2BucketLike } from "flarex-backend/artifact-store";
import {
  createBackendHarness,
  type BackendHarness,
} from "flarex-backend/test/backendHarness";
import type {
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  PushStatus,
  PushSourcePackage,
} from "flarex-backend/types";

import {
  createLocalPGliteExecutorHttpRuntime,
  type LocalPGliteExecutorHttpRuntime,
} from "../src/executorHttpRuntime";
import { LocalMiniflareExecutionArtifactMaterializer } from "../src/runtimeMaterializer";

type BackendDispatchResponse = Awaited<ReturnType<BackendHarness["mf"]["dispatchFetch"]>>;
type SyncWebSocket = NonNullable<BackendDispatchResponse["webSocket"]>;

describe("backend sync with local executor runtime", () => {
  const harnesses: BackendHarness[] = [];
  const runtimes: LocalPGliteExecutorHttpRuntime[] = [];
  const artifactRuntimes: ExecutionArtifactRuntimeService[] = [];

  afterAll(async () => {
    await Promise.all([
      ...harnesses.map(harness => harness.dispose()),
      ...runtimes.map(runtime => runtime.dispose()),
      ...artifactRuntimes.map(runtime => runtime.dispose()),
    ]);
  });

  it("reruns stale live queries through PGlite executor state and delivers QueryUpdated over Cloudflare DOs", async () => {
    let now = 100;
    let nextSession = 0;
    const deploymentId = "deployment-backend-runtime-live";
    const projectId = "project-backend-runtime-live";
    const sessionId = "runtime-live-session";
    const connectionId = `connection:${deploymentId}:${sessionId}`;
    const sourcePackage = messageSourcePackage();

    const runtime = await createLocalPGliteExecutorHttpRuntime({
      projectId,
      capabilityToken: "executor-secret",
      backendUrl: "https://backend.test",
      triggerFetch: async () => Response.json({ triggered: false }),
      clock: { now: () => new Date(++now) },
      ids: { nextId: () => `runtime_live_${++nextSession}` },
    });
    runtimes.push(runtime);

    const registered = await runtime.executor.registerDeploymentPackage({
      deploymentId,
      projectId,
      sourcePackage,
      analysisJson: messageAnalysis(),
    });
    await runtime.executor.activateDeploymentPackage({
      deploymentId,
      projectId,
      packageId: registered.package.packageId,
      schemaVersion: 1,
    });

    let harness: BackendHarness | undefined;
    let materializeCount = 0;
    let storeGetCount = 0;
    const baseMaterializer = new LocalMiniflareExecutionArtifactMaterializer({
      executorTransport: "postgres",
      projectId,
      executorToken: "executor-secret",
      backend: request => runtime.fetch(request),
    });
    const artifactRuntime = createExecutionArtifactRuntimeService({
      capabilityToken: "sync-secret",
      store: {
        put: async package_ => new R2BackendExecutionArtifactStore(
          r2BucketLikeFromMiniflare(await requireHarness(harness).mf.getR2Bucket("ARTIFACTS")),
        ).put(package_),
        get: async ref => {
          storeGetCount += 1;
          return new R2BackendExecutionArtifactStore(
            r2BucketLikeFromMiniflare(await requireHarness(harness).mf.getR2Bucket("ARTIFACTS")),
          ).get(ref);
        },
      },
      materializer: {
        materialize: async payload => {
          materializeCount += 1;
          return baseMaterializer.materialize(payload);
        },
      },
    });
    artifactRuntimes.push(artifactRuntime);

    harness = await createBackendHarness({
      bindings: {
        FLAREX_ARTIFACT_RUNTIME_TOKEN: "sync-secret",
        FLAREX_ARTIFACT_RUNTIME_LOADS_SOURCE: "true",
        FLAREX_EXECUTOR_TOKEN: "executor-secret",
        FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        FLAREX_PROJECT_ID: projectId,
      },
      r2Buckets: ["ARTIFACTS"],
      serviceBindings: {
        FLAREX_EXECUTOR: request => runtime.fetch(request),
        FLAREX_ARTIFACT_RUNTIME: artifactRuntime,
      },
    });
    harnesses.push(harness);
    await activateBackendDeployment(harness, deploymentId, sourcePackage);

    const ws = await openSync(harness, deploymentId, sessionId);
    try {
      ws.send(JSON.stringify({
        type: "ModifyQuerySet",
        baseVersion: 0,
        newVersion: 1,
        modifications: [
          {
            type: "Add",
            queryId: 1,
            udfPath: "messages:get",
            args: [{ messageId: "1:message" }],
            partitionKey: "1:message",
          },
        ],
      }));
      await expect(nextJsonMessage(ws)).resolves.toMatchObject({
        type: "Transition",
        modifications: [
          {
            type: "QueryUpdated",
            queryId: 1,
            value: null,
          },
        ],
      });
      expect(materializeCount).toBe(1);
      expect(storeGetCount).toBe(1);

      await expect(
        runtime.executor.findStaleLiveQuerySubscriptions({
          deploymentId,
          freshnessStore: runtime.freshnessStore,
        }),
      ).resolves.toMatchObject({ stale: [] });

      await writeMessage(runtime, deploymentId, projectId);
      await expect(
        runtime.executor.findStaleLiveQuerySubscriptions({
          deploymentId,
          freshnessStore: runtime.freshnessStore,
        }),
      ).resolves.toMatchObject({
        stale: [
          {
            subscription: {
              deploymentId,
              connectionId,
              queryId: 1,
            },
          },
        ],
      });

      const delivered = nextJsonMessage(ws);
      const response = await harness.mf.dispatchFetch(
        "http://flarex.test/scheduler/live-query-subscriptions/trigger",
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer delivery-secret",
          },
          body: JSON.stringify({
            deploymentId,
            projectId,
            limit: 1,
            deliveryLimit: 1,
            maxBatches: 1,
          }),
        },
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        deploymentId,
        changed: 1,
        unchanged: 0,
        unsupported: 0,
        hasMoreStale: false,
        delivery: {
          woken: true,
          status: 200,
          result: {
            deploymentId,
            claimed: 1,
            acked: 1,
            delivered: 1,
            skipped: 0,
            hasMore: false,
          },
        },
      });

      await expect(delivered).resolves.toMatchObject({
        type: "Transition",
        modifications: [
          {
            type: "QueryUpdated",
            queryId: 1,
            value: { _id: "1:message", text: "fresh" },
          },
        ],
      });
      await expect(
        runtime.persistence.listUndeliveredLiveQueryDeliveries({
          deploymentId,
          limit: 10,
        }),
      ).resolves.toMatchObject({ deliveries: [], hasMore: false });
      expect(runtime.cacheSize()).toBe(1);
    } finally {
      ws.close();
    }
  });
});

async function writeMessage(
  runtime: LocalPGliteExecutorHttpRuntime,
  deploymentId: string,
  projectId: string,
): Promise<void> {
  const started = sessionStartFromUnknown(await postJson(
    runtime,
    "/invoke/start",
    {
      deploymentId,
      projectId,
      path: "messages:seed",
      kind: "mutation",
      args: { messageId: "1:message", text: "fresh" },
      partitionKey: "1:message",
    },
  ));
  await postJson(runtime, "/invoke/syscall", {
    deploymentId,
    projectId,
    sessionId: started.sessionId,
    op: "insert",
    table: "messages",
    id: "1:message",
    value: { text: "fresh" },
  });
  await postJson(runtime, "/invoke/finish", {
    deploymentId,
    projectId,
    sessionId: started.sessionId,
    value: "1:message",
  });
}

async function postJson(
  runtime: LocalPGliteExecutorHttpRuntime,
  path: string,
  body: unknown,
): Promise<unknown> {
  const response = await runtime.fetch(new Request(`https://executor.test${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer executor-secret",
    },
    body: JSON.stringify(body),
  }));
  if (!response.ok) {
    expect(response.status, await response.text()).toBe(200);
  }
  return await response.json();
}

async function activateBackendDeployment(
  harness: BackendHarness,
  deploymentId: string,
  sourcePackage: PushSourcePackage,
): Promise<void> {
  const start = await startPush(harness, deploymentId, {
    sourcePackage,
    analysis: messageAnalysis(),
  });
  const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
  await new R2BackendExecutionArtifactStore(r2BucketLikeFromMiniflare(bucket))
    .put(sourcePackage);
  const finish = await finishPush(harness, deploymentId, start.pushId);
  expect(finish.state).toBe("activated");
}

async function startPush(
  harness: BackendHarness,
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<Pick<PushStatus, "pushId" | "state">> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!response.ok) {
    expect(response.ok, await response.text()).toBe(true);
  }
  return pushStatusFromUnknown(await response.json());
}

async function finishPush(
  harness: BackendHarness,
  deploymentId: string,
  pushId: string,
): Promise<Pick<PushStatus, "pushId" | "state">> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  if (!response.ok) {
    expect(response.ok, await response.text()).toBe(true);
  }
  return pushStatusFromUnknown(await response.json());
}

async function openSync(
  harness: BackendHarness,
  deploymentId: string,
  sessionId: string,
): Promise<SyncWebSocket> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/sync`,
    { headers: { Upgrade: "websocket", "x-flarex-session": sessionId } },
  );
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  if (ws == null) {
    throw new Error("Expected sync route to return a WebSocket.");
  }
  ws.accept();
  return ws;
}

function requireHarness(harness: BackendHarness | undefined): BackendHarness {
  if (harness === undefined) {
    throw new Error("Backend harness is not initialized.");
  }
  return harness;
}

function r2BucketLikeFromMiniflare(bucket: unknown): R2BucketLike {
  if (!isR2BucketLike(bucket)) {
    throw new Error("Miniflare ARTIFACTS bucket does not implement the R2 artifact store API.");
  }
  return bucket;
}

function isR2BucketLike(value: unknown): value is R2BucketLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  return (
    "put" in value &&
    typeof value.put === "function" &&
    "get" in value &&
    typeof value.get === "function" &&
    "delete" in value &&
    typeof value.delete === "function"
  );
}

function sessionStartFromUnknown(
  value: unknown,
): Pick<BeginInvokeSessionResult, "sessionId"> {
  const record = jsonRecord(value, "invoke start response");
  if (typeof record.sessionId !== "string" || record.sessionId.length === 0) {
    throw new Error("invoke start response.sessionId must be a non-empty string.");
  }
  return { sessionId: record.sessionId };
}

function pushStatusFromUnknown(value: unknown): Pick<PushStatus, "pushId" | "state"> {
  const record = jsonRecord(value, "push status");
  if (typeof record.pushId !== "string" || record.pushId.length === 0) {
    throw new Error("push status.pushId must be a non-empty string.");
  }
  if (!isPushStatusState(record.state)) {
    throw new Error("push status.state must be a valid push status state.");
  }
  return {
    pushId: record.pushId,
    state: record.state,
  };
}

function isPushStatusState(value: unknown): value is PushStatus["state"] {
  return typeof value === "string" && value in pushStatusStates;
}

function jsonRecord(value: unknown, name: string): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error(`${name} must be an object.`);
}

const pushStatusStates = {
  pending: true,
  analyzed: true,
  failed: true,
  activated: true,
  superseded: true,
} satisfies Record<PushStatus["state"], true>;

function nextJsonMessage(ws: SyncWebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Timed out waiting for WebSocket message.")),
      5000,
    );
    ws.addEventListener("message", event => {
      clearTimeout(timeout);
      resolve(JSON.parse(String(event.data)));
    }, { once: true });
    ws.addEventListener("error", event => {
      clearTimeout(timeout);
      reject(event);
    }, { once: true });
  });
}

function messageAnalysis(): DeploymentAnalysis {
  const partition = {
    type: "partition",
    table: "messages",
    selector: "byId",
    partitionField: "_id",
    argField: "messageId",
  } as const;
  return {
    schema: {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "messages",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    },
    functions: {
      functions: [
        {
          path: "messages:get",
          kind: "query",
          args: {
            type: "object",
            value: {
              messageId: {
                fieldType: { type: "id", tableName: "messages" },
                optional: false,
              },
            },
          },
          returns: null,
          route: { type: "args", field: "messageId" },
          partition,
        },
        {
          path: "messages:seed",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              messageId: {
                fieldType: { type: "id", tableName: "messages" },
                optional: false,
              },
              text: {
                fieldType: { type: "string" },
                optional: false,
              },
            },
          },
          returns: null,
          route: { type: "args", field: "messageId" },
          partition,
        },
      ],
    },
  };
}

function messageSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "e".repeat(64),
        source: `export default {
  messages: {
    get: {
      isQuery: true,
      _handler: async ({ db }, args) => {
        return await db.get(args.messageId);
      },
    },
    seed: {
      isMutation: true,
      _handler: async () => {
        throw new Error("seed is exercised directly through executor syscalls");
      },
    },
  },
};`,
      },
    ],
    functions: ["_flarex/execution.js"],
    execution: "_flarex/execution.js",
  };
}
