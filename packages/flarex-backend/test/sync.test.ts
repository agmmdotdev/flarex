import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { afterAll, describe, expect, it } from "vitest";
import { R2BackendExecutionArtifactStore, type R2BucketLike } from "../src/artifactStore";
import { createExecutionArtifactRuntimeService } from "../src/artifactRuntime";
import type {
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  Env,
  Json,
  PushSourcePackage,
  PushStatus,
} from "../src/types";
import { createBackendHarness, type BackendHarness } from "./backendHarness";

type MiniflareWebSocket = {
  accept(): void;
  send(message: string): void;
  close(): void;
  addEventListener(
    type: "message",
    listener: (event: { data: unknown }) => void,
    options?: { once?: boolean },
  ): void;
  addEventListener(
    type: "error",
    listener: (event: unknown) => void,
    options?: { once?: boolean },
  ): void;
};

describe("sync protocol", () => {
  const harnesses: BackendHarness[] = [];

  afterAll(async () => {
    await Promise.all(harnesses.map(harness => harness.dispose()));
  });

  it("executes Add query modifications and emits Convex-style transitions", async () => {
    const runtimeCalls: unknown[] = [];
    const harness = await createSyncHarness(runtimeCalls);
    harnesses.push(harness);
    await activateDeployment(harness, "sync-deployment");

    const ws = await openSync(harness, "sync-deployment");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 7,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));

    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "Transition",
      startVersion: { querySet: 0, ts: 0, identity: 0 },
      endVersion: { querySet: 1, ts: 3, identity: 0 },
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 7,
          value: { result: "users:get", args: { id: "1:ada" } },
          logLines: [],
          journal: null,
        },
      ],
    });
    expect(runtimeCalls).toEqual([
      expect.objectContaining({
        deploymentId: "sync-deployment",
        request: {
          path: "users:get",
          kind: "query",
          partitionKey: "user:ada",
          args: { id: "1:ada" },
        },
      }),
    ]);

    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 1,
      newVersion: 2,
      modifications: [{ type: "Remove", queryId: 7 }],
    }));

    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "Transition",
      startVersion: { querySet: 1, ts: 3, identity: 0 },
      endVersion: { querySet: 2, ts: 3, identity: 0 },
      modifications: [{ type: "QueryRemoved", queryId: 7 }],
    });
    ws.close();
  });

  it("reruns a subscribed query when a partition commit overlaps its read set", async () => {
    let currentName = "Ada";
    const harness = await createSyncHarness([], () => ({ user: currentName }));
    harnesses.push(harness);
    await activateDeployment(harness, "sync-invalidation-deployment");

    const ws = await openSync(harness, "sync-invalidation-deployment");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 9,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 9,
          value: { user: "Ada" },
        },
      ],
    });

    currentName = "Grace";
    const invalidated = nextJsonMessage(ws);
    await commitDirect(harness, "sync-invalidation-deployment", "user:ada", {
      beginTs: 0,
      writes: [{ tableId: 1, id: "1:ada", value: { name: "Grace" } }],
    });

    await expect(invalidated).resolves.toMatchObject({
      type: "Transition",
      startVersion: { querySet: 1, ts: 3, identity: 0 },
      endVersion: { querySet: 1, ts: 4, identity: 0 },
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 9,
          value: { user: "Grace" },
        },
      ],
    });
    ws.close();
  });

  it("reports query failures inside transitions", async () => {
    const harness = await createSyncHarness([]);
    harnesses.push(harness);
    await activateDeployment(harness, "sync-failure-deployment");

    const ws = await openSync(harness, "sync-failure-deployment");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 1,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
        },
      ],
    }));

    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "Transition",
      startVersion: { querySet: 0, ts: 0, identity: 0 },
      endVersion: { querySet: 1, ts: 1, identity: 0 },
      modifications: [
        {
          type: "QueryFailed",
          queryId: 1,
          errorMessage: "Add.partitionKey is required until Flarex routing inference is implemented.",
          logLines: [],
          errorData: null,
          journal: null,
        },
      ],
    });
    ws.close();
  });

  it("rejects stale query-set base versions", async () => {
    const harness = await createSyncHarness([]);
    harnesses.push(harness);
    await activateDeployment(harness, "sync-version-deployment");

    const ws = await openSync(harness, "sync-version-deployment");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 99,
      newVersion: 100,
      modifications: [],
    }));

    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "FatalError",
      error:
        "BaseVersionMismatch: base version 99 does not match current query set version 0.",
    });
    ws.close();
  });
});

async function createSyncHarness(
  runtimeCalls: unknown[],
  valueForRequest: (payload: { request: { path: string; args: unknown } }) => Json =
    payload => ({
      result: payload.request.path,
      args: payload.request.args as Json,
    }),
): Promise<BackendHarness> {
  return createBackendHarness({
    bindings: { FLAREX_ARTIFACT_RUNTIME_TOKEN: "sync-secret" },
    r2Buckets: ["ARTIFACTS"],
    serviceBindings: {
      FLAREX_ARTIFACT_RUNTIME: createExecutionArtifactRuntimeService({
        capabilityToken: "sync-secret",
        materializer: {
          materialize: async () => ({
            invoke: async payload => {
              runtimeCalls.push(payload);
              return {
                value: valueForRequest(payload),
                readSet: { documents: [{ tableId: 1, id: "1:ada" }] },
                readTs: 3,
              };
            },
          }),
        },
      }),
    },
  });
}

async function commitDirect(
  harness: BackendHarness,
  deploymentId: string,
  partitionKey: string,
  body: unknown,
): Promise<void> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/partitions/${partitionKey}/commit`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  expect(response.status).toBe(201);
}

async function openSync(
  harness: BackendHarness,
  deploymentId: string,
): Promise<MiniflareWebSocket> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/sync`,
    { headers: { Upgrade: "websocket" } },
  );
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  expect(ws).toBeDefined();
  ws!.accept();
  return ws! as unknown as MiniflareWebSocket;
}

function nextJsonMessage(ws: MiniflareWebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message.")), 1000);
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

async function activateDeployment(
  harness: BackendHarness,
  deploymentId: string,
): Promise<void> {
  const sourcePackage = testSourcePackage();
  const start = await startPush(harness, deploymentId, {
    sourcePackage,
    analysis: testAnalysis(),
  });
  const bucket = await harness.mf.getR2Bucket("ARTIFACTS");
  await new R2BackendExecutionArtifactStore(bucket as unknown as R2BucketLike)
    .put(sourcePackage);
  const finish = await finishPush(harness, deploymentId, start.pushId);
  expect(finish.state).toBe("activated");
}

async function startPush(
  harness: BackendHarness,
  deploymentId: string,
  body: AnalyzedStartPushRequest,
): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/start-analyzed`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<PushStatus>;
}

async function finishPush(
  harness: BackendHarness,
  deploymentId: string,
  pushId: string,
): Promise<PushStatus> {
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/push/${pushId}/finish`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    },
  );
  expect(response.ok).toBe(true);
  return response.json() as Promise<PushStatus>;
}

function testAnalysis(): DeploymentAnalysis {
  return {
    schema: {
      version: 1,
      tables: [
        {
          tableId: 1,
          name: "users",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [],
    },
    functions: {
      functions: [
        {
          path: "users:get",
          kind: "query",
          args: { type: "object", value: {} },
          returns: null,
        },
      ],
    },
  };
}

function testSourcePackage(): PushSourcePackage {
  return {
    modules: [
      {
        path: "_flarex/execution.js",
        environment: "isolate",
        sha256: "a".repeat(64),
        source: "export default {};",
      },
      {
        path: "users.js",
        environment: "isolate",
        sha256: "b".repeat(64),
        source: "export const get = {};",
      },
    ],
    functions: ["users.js"],
    execution: "_flarex/execution.js",
  };
}
