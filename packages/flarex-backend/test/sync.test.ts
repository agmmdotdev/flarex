import { executionArtifactRefForSourcePackage } from "flarex/artifacts";
import { afterAll, describe, expect, it } from "vitest";
import { R2BackendExecutionArtifactStore, type R2BucketLike } from "../src/artifactStore";
import { createExecutionArtifactRuntimeService } from "../src/artifactRuntime";
import type { DeliveryDrainFailureResult } from "../src/deliveryDO";
import type {
  AnalyzedStartPushRequest,
  DeploymentAnalysis,
  Env,
  FinishPushResponse,
  InvokeResponse,
  Json,
  PushSourcePackage,
  PushStatus,
} from "../src/types";
import {
  createBackendHarness,
  type BackendHarness,
  type BackendHarnessOptions,
} from "./backendHarness";

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
  addEventListener(
    type: "close",
    listener: (event: { code?: number; reason?: string }) => void,
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

  it("records WebSocket query subscriptions through the configured executor", async () => {
    const executorRequests: Array<{
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-subscriptions/record") {
              return Response.json({
                subscription: {
                  ...jsonRecord(body),
                  resultHash: "{\"user\":\"Ada\"}",
                  createdAt: "2026-06-22T00:00:00.000Z",
                  updatedAt: "2026-06-22T00:00:00.000Z",
                },
                resultHash: "{\"user\":\"Ada\"}",
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove") {
              return Response.json({ deleted: true });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              return Response.json({ deleted: true });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, "sync-executor-subscription-deployment");

    const ws = await openSync(
      harness,
      "sync-executor-subscription-deployment",
      "executor-sub-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 17,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));

    const initial = await nextJsonMessage(ws);
    expect(initial).toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 17,
          value: { user: "Ada" },
        },
      ],
    });

    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 1,
      newVersion: 2,
      modifications: [{ type: "Remove", queryId: 17 }],
    }));

    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "Transition",
      modifications: [{ type: "QueryRemoved", queryId: 17 }],
    });
    expect(executorRequests).toEqual([
      {
        path: "/live-query-subscriptions/record",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "sync-executor-subscription-deployment",
          projectId: "project_sync",
          connectionId:
            "connection:sync-executor-subscription-deployment:executor-sub-session",
          queryId: 17,
          functionPath: "users:get",
          argsJson: { id: "1:ada" },
          partitionKey: "user:ada",
          beginTs: 3,
          readSet: { documents: [{ tableId: 1, id: "1:ada" }] },
          resultJson: { user: "Ada" },
        },
      },
      {
        path: "/live-query-subscriptions/remove",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "sync-executor-subscription-deployment",
          projectId: "project_sync",
          connectionId:
            "connection:sync-executor-subscription-deployment:executor-sub-session",
          queryId: 17,
        },
      },
    ]);
    ws.close();
  });

  it("removes executor subscriptions for the whole connection when a WebSocket closes", async () => {
    const executorRequests: Array<{
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-subscriptions/record") {
              return Response.json({
                subscription: {
                  ...jsonRecord(body),
                  resultHash: "{\"user\":\"Ada\"}",
                  createdAt: "2026-06-22T00:00:00.000Z",
                  updatedAt: "2026-06-22T00:00:00.000Z",
                },
                resultHash: "{\"user\":\"Ada\"}",
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              return Response.json({ deleted: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    const deploymentId = "sync-executor-close-cleanup-deployment";
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "executor-close-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 18,
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
          queryId: 18,
          value: { user: "Ada" },
        },
      ],
    });
    executorRequests.length = 0;

    ws.close();
    await waitFor(() =>
      executorRequests.some(request => request.path === "/live-query-subscriptions/remove-connection"),
    );

    expect(executorRequests).toEqual([
      {
        path: "/live-query-subscriptions/remove-connection",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_sync",
          connectionId: `connection:${deploymentId}:executor-close-session`,
        },
      },
    ]);
  });

  it("retries connection subscription cleanup after a transient executor failure", async () => {
    const executorRequests: Array<{
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    let removeConnectionAttempts = 0;
    const deploymentId = "sync-executor-cleanup-retry-deployment";
    const connectionId = `connection:${deploymentId}:executor-cleanup-retry-session`;
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-subscriptions/record") {
              return Response.json({
                subscription: {
                  ...jsonRecord(body),
                  resultHash: "{\"user\":\"Ada\"}",
                  createdAt: "2026-06-22T00:00:00.000Z",
                  updatedAt: "2026-06-22T00:00:00.000Z",
                },
                resultHash: "{\"user\":\"Ada\"}",
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              removeConnectionAttempts += 1;
              if (removeConnectionAttempts === 1) {
                return Response.json({ error: "temporary cleanup failure" }, { status: 503 });
              }
              return Response.json({ deleted: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "executor-cleanup-retry-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 19,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

    const env = await harness.mf.getBindings<Env>();
    const connection = env.CONNECTIONS.getByName(connectionId);
    const firstReconnect = await connection
      .fetch("https://flarex.internal/force-reconnect", { method: "POST" })
      .catch(error => error as Error);

    expect(removeConnectionAttempts).toBe(1);
    expect(firstReconnect).not.toMatchObject({ status: 200 });
    const closed = nextClose(ws);
    const secondReconnect = await connection.fetch(
      "https://flarex.internal/force-reconnect",
      { method: "POST" },
    );

    expect(secondReconnect.status).toBe(200);
    await expect(secondReconnect.json()).resolves.toEqual({
      closed: 1,
      activeQueries: 1,
    });
    await expect(closed).resolves.toMatchObject({
      code: 1012,
      reason: "flarex reconnect",
    });
    expect(executorRequests.filter(request =>
      request.path === "/live-query-subscriptions/remove-connection",
    )).toEqual([
      {
        path: "/live-query-subscriptions/remove-connection",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_sync",
          connectionId,
        },
      },
      {
        path: "/live-query-subscriptions/remove-connection",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_sync",
          connectionId,
        },
      },
    ]);
  });

  it("refreshes executor connection leases from ConnectionDO heartbeat", async () => {
    const executorRequests: Array<{
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const deploymentId = "sync-executor-heartbeat-deployment";
    const connectionId = `connection:${deploymentId}:executor-heartbeat-session`;
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-connections/touch") {
              return Response.json({
                connection: {
                  ...(body as Record<string, unknown>),
                  lastSeenAt: "2026-06-23T00:00:00.000Z",
                  expiresAt: "2026-06-23T00:02:00.000Z",
                  closedAt: null,
                  createdAt: "2026-06-23T00:00:00.000Z",
                  updatedAt: "2026-06-23T00:00:00.000Z",
                },
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              return Response.json({ deleted: 0 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "executor-heartbeat-session");
    executorRequests.length = 0;

    const env = await harness.mf.getBindings<Env>();
    const connection = env.CONNECTIONS.getByName(connectionId);
    const response = await connection.fetch("https://flarex.internal/heartbeat", {
      method: "POST",
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ touched: true });
    expect(executorRequests).toEqual([
      {
        path: "/live-query-connections/touch",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_sync",
          connectionId,
          leaseDurationMs: 120000,
        },
      },
    ]);
    ws.close();
  });

  it("routes expired live query connection cleanup through SchedulerDO", async () => {
    const executorRequests: Array<{
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const deploymentId = "sync-connection-cleanup-deployment";
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/connections/cleanup") {
              return Response.json({ deleted: 3, deletedConnections: 2 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/cleanup",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer delivery-secret",
        },
        body: JSON.stringify({
          deploymentId,
          expiredAt: "2026-06-23T00:02:00.000+00:00",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deploymentId,
      deleted: 3,
      deletedConnections: 2,
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/connections/cleanup",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_sync",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      },
    ]);
  });

  it("routes expired live query connection cleanup with explicit project id", async () => {
    const executorRequests: Array<{
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const deploymentId = "sync-connection-cleanup-explicit-project";
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_PROJECT_ID: "",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/connections/cleanup") {
              return Response.json({ deleted: 1, deletedConnections: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/cleanup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deploymentId,
          projectId: "project_explicit",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deploymentId,
      deleted: 1,
      deletedConnections: 1,
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/connections/cleanup",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_explicit",
        },
      },
    ]);
  });

  it("rejects expired live query connection cleanup without a project id", async () => {
    const executorRequests: unknown[] = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_PROJECT_ID: "",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            executorRequests.push(await request.json());
            return Response.json({ deleted: 1, deletedConnections: 1 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/cleanup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deploymentId: "sync-connection-cleanup-missing-project",
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "projectId is required when FLAREX_PROJECT_ID is not configured.",
    });
    expect(executorRequests).toEqual([]);
  });

  it("reports executor failures during expired live query connection cleanup", async () => {
    const deploymentId = "sync-connection-cleanup-executor-failure";
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            if (url.pathname === "/maintenance/live-queries/connections/cleanup") {
              return Response.json({ error: "executor unavailable" }, { status: 503 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/cleanup",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deploymentId }),
      },
    );

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      error: "Live query connection cleanup failed with status 503.",
    });
  });

  it("reconciles expired live query connection deployment scans through SchedulerDO", async () => {
    const executorRequests: Array<{
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/expired-connection-deployments") {
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_cleanup_a",
                    projectId: "project_cleanup_a",
                    oldestExpiredAt: "2026-06-23T00:00:30.000Z",
                    expiredConnections: 2,
                  },
                  {
                    deploymentId: "deployment_cleanup_b",
                    projectId: "project_cleanup_b",
                    oldestExpiredAt: "2026-06-23T00:00:45.000Z",
                    expiredConnections: 1,
                  },
                ],
                nextCursor: {
                  oldestExpiredAt: "2026-06-23T00:00:45.000Z",
                  deploymentId: "deployment_cleanup_b",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/connections/cleanup") {
              const cleanup = body as { deploymentId?: string };
              if (cleanup.deploymentId === "deployment_cleanup_b") {
                return Response.json({ error: "temporary cleanup failure" }, { status: 503 });
              }
              return Response.json({ deleted: 3, deletedConnections: 2 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/reconcile",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer delivery-secret",
        },
        body: JSON.stringify({
          expiredAt: "2026-06-23T00:02:00.000+00:00",
          limit: 5,
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deployments: 2,
      cleaned: 1,
      deleted: 3,
      deletedConnections: 2,
      failed: [
        {
          deploymentId: "deployment_cleanup_b",
          status: 502,
          error: "Live query connection cleanup failed with status 503.",
        },
      ],
      nextCursor: {
        oldestExpiredAt: "2026-06-23T00:00:45.000Z",
        deploymentId: "deployment_cleanup_b",
      },
      hasMore: true,
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/expired-connection-deployments",
        authorization: "Bearer executor-secret",
        body: {
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 5,
        },
      },
      {
        path: "/maintenance/live-queries/connections/cleanup",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment_cleanup_a",
          projectId: "project_cleanup_a",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      },
      {
        path: "/maintenance/live-queries/connections/cleanup",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment_cleanup_b",
          projectId: "project_cleanup_b",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      },
    ]);
  });

  it("continues expired live query connection cleanup scans from stored cursors", async () => {
    const executorRequests: Array<{
      path: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/expired-connection-deployments") {
              if (deploymentScanCursorDeploymentId(body) === "deployment_cleanup_page_a") {
                return Response.json({
                  deployments: [
                    {
                      deploymentId: "deployment_cleanup_page_b",
                      projectId: "project_cleanup_page_b",
                      oldestExpiredAt: "2026-06-23T00:00:20.000Z",
                      expiredConnections: 1,
                    },
                  ],
                  nextCursor: null,
                  hasMore: false,
                });
              }
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_cleanup_page_a",
                    projectId: "project_cleanup_page_a",
                    oldestExpiredAt: "2026-06-23T00:00:10.000Z",
                    expiredConnections: 1,
                  },
                ],
                nextCursor: {
                  oldestExpiredAt: "2026-06-23T00:00:10.000Z",
                  deploymentId: "deployment_cleanup_page_a",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/connections/cleanup") {
              return Response.json({ deleted: 1, deletedConnections: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/reconcile",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer delivery-secret",
        },
        body: JSON.stringify({
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 1,
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deployments: 1,
      cleaned: 1,
      deleted: 1,
      deletedConnections: 1,
      failed: [],
      nextCursor: {
        oldestExpiredAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment_cleanup_page_a",
      },
      hasMore: true,
    });

    const env = await harness.mf.getBindings<Env>();
    const scheduler = env.SCHEDULERS.getByName("scheduler:live-query-deliveries");
    const continued = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-connection-cleanup",
      { method: "POST" },
    );

    expect(continued.status).toBe(200);
    const continuedBody: unknown = await continued.json();
    if (isSkippedResponse(continuedBody)) {
      await waitFor(() => executorRequests.length >= 4);
    } else {
      expect(continuedBody).toMatchObject({
        deployments: 1,
        cleaned: 1,
        deleted: 1,
        deletedConnections: 1,
        failed: [],
        nextCursor: null,
        hasMore: false,
      });
    }
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/expired-connection-deployments",
        authorization: "Bearer executor-secret",
        body: {
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 1,
        },
      },
      {
        path: "/maintenance/live-queries/connections/cleanup",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment_cleanup_page_a",
          projectId: "project_cleanup_page_a",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      },
      {
        path: "/maintenance/live-queries/expired-connection-deployments",
        authorization: "Bearer executor-secret",
        body: {
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 1,
          cursor: {
            oldestExpiredAt: "2026-06-23T00:00:10.000Z",
            deploymentId: "deployment_cleanup_page_a",
          },
        },
      },
      {
        path: "/maintenance/live-queries/connections/cleanup",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment_cleanup_page_b",
          projectId: "project_cleanup_page_b",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      },
    ]);

    const skipped = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-connection-cleanup",
      { method: "POST" },
    );
    expect(skipped.status).toBe(200);
    await expect(skipped.json()).resolves.toEqual({ skipped: true });
  });

  it("keeps expired connection cleanup continuation when a deployment cleanup fails", async () => {
    const executorRequests: Array<{ path: string; body: unknown }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({ path: url.pathname, body });
            if (url.pathname === "/maintenance/live-queries/expired-connection-deployments") {
              if (deploymentScanCursorDeploymentId(body) === "deployment_cleanup_failed") {
                return Response.json({
                  deployments: [
                    {
                      deploymentId: "deployment_cleanup_after_failure",
                      projectId: "project_cleanup_after_failure",
                      oldestExpiredAt: "2026-06-23T00:00:30.000Z",
                      expiredConnections: 1,
                    },
                  ],
                  nextCursor: null,
                  hasMore: false,
                });
              }
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_cleanup_failed",
                    projectId: "project_cleanup_failed",
                    oldestExpiredAt: "2026-06-23T00:00:20.000Z",
                    expiredConnections: 1,
                  },
                ],
                nextCursor: {
                  oldestExpiredAt: "2026-06-23T00:00:20.000Z",
                  deploymentId: "deployment_cleanup_failed",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/connections/cleanup") {
              if (cleanupDeploymentId(body) === "deployment_cleanup_failed") {
                return Response.json({ error: "temporary cleanup failure" }, { status: 503 });
              }
              return Response.json({ deleted: 1, deletedConnections: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/reconcile",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer delivery-secret",
        },
        body: JSON.stringify({
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 1,
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deployments: 1,
      cleaned: 0,
      failed: [
        {
          deploymentId: "deployment_cleanup_failed",
          status: 502,
          error: "Live query connection cleanup failed with status 503.",
        },
      ],
      nextCursor: {
        oldestExpiredAt: "2026-06-23T00:00:20.000Z",
        deploymentId: "deployment_cleanup_failed",
      },
      hasMore: true,
    });

    const env = await harness.mf.getBindings<Env>();
    const scheduler = env.SCHEDULERS.getByName("scheduler:live-query-deliveries");
    const continued = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-connection-cleanup",
      { method: "POST" },
    );

    expect(continued.status).toBe(200);
    const continuedBody: unknown = await continued.json();
    if (isSkippedResponse(continuedBody)) {
      await waitFor(() => executorRequests.length >= 4);
    } else {
      expect(continuedBody).toMatchObject({
        deployments: 1,
        cleaned: 1,
        failed: [],
        hasMore: false,
      });
    }
    expect(executorRequests).toEqual([
      expect.objectContaining({
        path: "/maintenance/live-queries/expired-connection-deployments",
        body: {
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 1,
        },
      }),
      expect.objectContaining({
        path: "/maintenance/live-queries/connections/cleanup",
        body: {
          deploymentId: "deployment_cleanup_failed",
          projectId: "project_cleanup_failed",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      }),
      expect.objectContaining({
        path: "/maintenance/live-queries/expired-connection-deployments",
        body: {
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 1,
          cursor: {
            oldestExpiredAt: "2026-06-23T00:00:20.000Z",
            deploymentId: "deployment_cleanup_failed",
          },
        },
      }),
      expect.objectContaining({
        path: "/maintenance/live-queries/connections/cleanup",
        body: {
          deploymentId: "deployment_cleanup_after_failure",
          projectId: "project_cleanup_after_failure",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      }),
    ]);
  });

  it("coalesces concurrent fresh expired connection cleanup reconciles", async () => {
    const executorRequests: Array<{ path: string; body: unknown }> = [];
    let releaseScan: (() => void) | undefined;
    const scanGate = new Promise<void>(resolve => {
      releaseScan = resolve;
    });
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({ path: url.pathname, body });
            if (url.pathname === "/maintenance/live-queries/expired-connection-deployments") {
              await scanGate;
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_cleanup_concurrent",
                    projectId: "project_cleanup_concurrent",
                    oldestExpiredAt: "2026-06-23T00:00:10.000Z",
                    expiredConnections: 1,
                  },
                ],
                nextCursor: {
                  oldestExpiredAt: "2026-06-23T00:00:10.000Z",
                  deploymentId: "deployment_cleanup_concurrent",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/connections/cleanup") {
              return Response.json({ deleted: 1, deletedConnections: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const request = {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer delivery-secret",
      },
      body: JSON.stringify({
        expiredAt: "2026-06-23T00:02:00.000Z",
        limit: 1,
      }),
    };
    const first = harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/reconcile",
      request,
    );
    await waitFor(() => executorRequests.length === 1);
    const second = harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/reconcile",
      request,
    );
    releaseScan?.();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      deployments: 1,
      cleaned: 1,
      hasMore: true,
    });
    await expect(secondResponse.json()).resolves.toMatchObject({
      deployments: 1,
      cleaned: 1,
      hasMore: true,
    });
    expect(executorRequests).toEqual([
      expect.objectContaining({
        path: "/maintenance/live-queries/expired-connection-deployments",
        body: {
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 1,
        },
      }),
      expect.objectContaining({
        path: "/maintenance/live-queries/connections/cleanup",
        body: {
          deploymentId: "deployment_cleanup_concurrent",
          projectId: "project_cleanup_concurrent",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      }),
    ]);
  });

  it("keeps explicit cursor cleanup reconciles stateless", async () => {
    const executorRequests: Array<{ path: string; body: unknown }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({ path: url.pathname, body });
            if (url.pathname === "/maintenance/live-queries/expired-connection-deployments") {
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_cleanup_explicit_cursor",
                    projectId: "project_cleanup_explicit_cursor",
                    oldestExpiredAt: "2026-06-23T00:00:20.000Z",
                    expiredConnections: 1,
                  },
                ],
                nextCursor: {
                  oldestExpiredAt: "2026-06-23T00:00:20.000Z",
                  deploymentId: "deployment_cleanup_explicit_cursor",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/connections/cleanup") {
              return Response.json({ deleted: 1, deletedConnections: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const env = await harness.mf.getBindings<Env>();
    const scheduler = env.SCHEDULERS.getByName("scheduler:live-query-deliveries");
    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/reconcile",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer delivery-secret",
        },
        body: JSON.stringify({
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 1,
          cursor: {
            oldestExpiredAt: "2026-06-23T00:00:10.000Z",
            deploymentId: "deployment_cleanup_before_explicit",
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deployments: 1,
      cleaned: 1,
      hasMore: true,
      nextCursor: {
        oldestExpiredAt: "2026-06-23T00:00:20.000Z",
        deploymentId: "deployment_cleanup_explicit_cursor",
      },
    });
    const continued = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-connection-cleanup",
      { method: "POST" },
    );
    expect(continued.status).toBe(200);
    await expect(continued.json()).resolves.toEqual({ skipped: true });
  });

  it("rejects malformed live query connection cleanup reconcile cursors", async () => {
    const executorRequests: unknown[] = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            executorRequests.push(await request.json());
            return Response.json({ deployments: [], nextCursor: null, hasMore: false });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-connections/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cursor: {
            oldestExpiredAt: "not a date",
            deploymentId: "deployment_bad_cursor",
          },
        }),
      },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "cursor.oldestExpiredAt must be an ISO date string.",
    });
    expect(executorRequests).toEqual([]);
  });

  it("suppresses QueryUpdated when an invalidation rerun returns the same value", async () => {
    const harness = await createSyncHarness([], () => ({ user: "Ada" }));
    harnesses.push(harness);
    await activateDeployment(harness, "sync-dedup-deployment");

    const ws = await openSync(harness, "sync-dedup-deployment");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 10,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "Transition",
      modifications: [{ type: "QueryUpdated", queryId: 10 }],
    });

    const invalidated = nextJsonMessage(ws);
    await commitDirect(harness, "sync-dedup-deployment", "user:ada", {
      beginTs: 0,
      writes: [{ tableId: 1, id: "1:ada", value: { name: "Ada", revision: 2 } }],
    });

    await expect(invalidated).resolves.toMatchObject({
      type: "Transition",
      startVersion: { querySet: 1, ts: 3, identity: 0 },
      endVersion: { querySet: 1, ts: 4, identity: 0 },
      modifications: [],
    });
    ws.close();
  });

  it("delivers materialized live query changes to active WebSocket connections", async () => {
    const runtimeCalls: unknown[] = [];
    const harness = await createSyncHarness(runtimeCalls, () => ({ user: "Ada" }));
    harnesses.push(harness);
    await activateDeployment(harness, "sync-delivery-deployment");

    const ws = await openSync(harness, "sync-delivery-deployment", "delivery-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 14,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "Transition",
      modifications: [{ type: "QueryUpdated", value: { user: "Ada" } }],
    });
    expect(runtimeCalls).toHaveLength(1);

    const env = await harness.mf.getBindings<Env>();
    const connection = env.CONNECTIONS.getByName(
      "connection:sync-delivery-deployment:delivery-session",
    );
    const delivered = nextJsonMessage(ws);
    const response = await connection.fetch("https://flarex.internal/deliver/live-query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveries: [
          {
            deploymentId: "sync-delivery-deployment",
            connectionId: "connection:sync-delivery-deployment:delivery-session",
            queryId: 14,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Grace" },
            previousResultHash: '{"user":"Ada"}',
            resultHash: '{"user":"Grace"}',
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ delivered: 1, skipped: 0 });
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      startVersion: { querySet: 1, ts: 3, identity: 0 },
      endVersion: { querySet: 1, ts: 4, identity: 0 },
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 14,
          value: { user: "Grace" },
          logLines: [],
          journal: null,
        },
      ],
    });
    expect(runtimeCalls).toHaveLength(1);
    ws.close();
  });

  it("skips stale failed live query deliveries after a newer result is active", async () => {
    const runtimeCalls: unknown[] = [];
    const harness = await createSyncHarness(runtimeCalls, () => ({ user: "Ada" }));
    harnesses.push(harness);
    const deploymentId = "sync-stale-failed-delivery-deployment";
    const connectionId = `connection:${deploymentId}:stale-failed-delivery-session`;
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(
      harness,
      deploymentId,
      "stale-failed-delivery-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 15,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);

    const env = await harness.mf.getBindings<Env>();
    const connection = env.CONNECTIONS.getByName(connectionId);
    const updatedMessage = nextJsonMessage(ws);
    const updateResponse = await connection.fetch("https://flarex.internal/deliver/live-query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveries: [
          {
            kind: "updated",
            deploymentId,
            connectionId,
            queryId: 15,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Grace" },
            previousResultHash: '{"user":"Ada"}',
            resultHash: '{"user":"Grace"}',
          },
        ],
      }),
    });
    expect(updateResponse.status).toBe(200);
    const updateBody: unknown = await updateResponse.json();
    expect(updateBody).toEqual({ delivered: 1, skipped: 0 });
    await expect(updatedMessage).resolves.toMatchObject({
      type: "Transition",
      modifications: [{ type: "QueryUpdated", queryId: 15 }],
    });

    const staleFailedResponse = await connection.fetch(
      "https://flarex.internal/deliver/live-query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deliveries: [
            {
              kind: "failed",
              deploymentId,
              connectionId,
              queryId: 15,
              functionPath: "users:get",
              argsJson: { id: "1:ada" },
              previousResultHash: '{"user":"Ada"}',
              errorMessage: "Query returned more than one document.",
              errorData: null,
            },
          ],
        }),
      },
    );

    expect(staleFailedResponse.status).toBe(200);
    const staleFailedBody: unknown = await staleFailedResponse.json();
    expect(staleFailedBody).toEqual({
      delivered: 0,
      skipped: 1,
      staleSkipped: 1,
      skipReasons: { stale: 1 },
    });
    ws.close();
  });

  it("reports live query delivery skip reasons", async () => {
    const runtimeCalls: unknown[] = [];
    const deploymentId = "sync-delivery-skip-reasons-deployment";
    const connectionId = `connection:${deploymentId}:skip-reasons-session`;
    const harness = await createSyncHarness(runtimeCalls, () => ({ user: "Ada" }));
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "skip-reasons-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 16,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);

    const env = await harness.mf.getBindings<Env>();
    const connection = env.CONNECTIONS.getByName(connectionId);
    const response = await connection.fetch("https://flarex.internal/deliver/live-query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveries: [
          {
            deploymentId: "other-deployment",
            connectionId,
            queryId: 16,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Grace" },
            previousResultHash: '{"user":"Ada"}',
            resultHash: '{"user":"Grace"}',
          },
          {
            deploymentId,
            connectionId: `connection:${deploymentId}:other-session`,
            queryId: 16,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Grace" },
            previousResultHash: '{"user":"Ada"}',
            resultHash: '{"user":"Grace"}',
          },
          {
            deploymentId,
            connectionId,
            queryId: 999,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Grace" },
            previousResultHash: '{"user":"Ada"}',
            resultHash: '{"user":"Grace"}',
          },
          {
            deploymentId,
            connectionId,
            queryId: 16,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Ada" },
            previousResultHash: '{"user":"Ada"}',
            resultHash: '{"user":"Ada"}',
          },
        ],
      }),
    });

    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({
      delivered: 0,
      skipped: 4,
      skipReasons: {
        wrongDeployment: 1,
        wrongConnection: 1,
        missingQuery: 1,
        unchanged: 1,
      },
    });
    ws.close();
  });

  it("routes backend live query delivery callbacks to named connections", async () => {
    const runtimeCalls: unknown[] = [];
    const harness = await createSyncHarness(runtimeCalls, () => ({ user: "Ada" }));
    harnesses.push(harness);
    await activateDeployment(harness, "sync-route-delivery-deployment");

    const ws = await openSync(
      harness,
      "sync-route-delivery-deployment",
      "route-delivery-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 16,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    expect(runtimeCalls).toHaveLength(1);

    const delivered = nextJsonMessage(ws);
    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/sync-route-delivery-deployment/sync/deliver-live-query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deliveries: [
            {
              deploymentId: "sync-route-delivery-deployment",
              connectionId: "connection:sync-route-delivery-deployment:route-delivery-session",
              queryId: 16,
              functionPath: "users:get",
              argsJson: { id: "1:ada" },
              resultJson: { user: "Katherine" },
              previousResultHash: '{"user":"Ada"}',
              resultHash: '{"user":"Katherine"}',
            },
          ],
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      delivered: 1,
      skipped: 0,
      connections: 1,
    });
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 16,
          value: { user: "Katherine" },
        },
      ],
    });
    expect(runtimeCalls).toHaveLength(1);
    ws.close();
  });

  it("wakes DeliveryDO to claim, fanout, and ack live query deliveries", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-subscriptions/record") {
              return Response.json({
                subscription: {
                  ...(jsonRecord(body)),
                  resultHash: '{"user":"Ada"}',
                  createdAt: "2026-06-22T00:00:00.000Z",
                  updatedAt: "2026-06-22T00:00:00.000Z",
                },
                resultHash: '{"user":"Ada"}',
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              return Response.json({ deleted: 1 });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({
                deliveries: [
                  {
                    deploymentId: "sync-delivery-do-deployment",
                    deliveryId: "delivery_1",
                    connectionId: "connection:sync-delivery-do-deployment:delivery-do-session",
                    queryId: 17,
                    payloadJson: {
                      deploymentId: "sync-delivery-do-deployment",
                      connectionId: "connection:sync-delivery-do-deployment:delivery-do-session",
                      queryId: 17,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson: { user: "Grace" },
                      previousResultHash: '{"user":"Ada"}',
                      resultHash: '{"user":"Grace"}',
                    },
                    deliveredAt: null,
                    createdAt: "2026-06-21T00:00:00.000Z",
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              return Response.json({ delivered: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, "sync-delivery-do-deployment");

    const ws = await openSync(
      harness,
      "sync-delivery-do-deployment",
      "delivery-do-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 17,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

    const delivered = nextJsonMessage(ws);
    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/deployments/sync-delivery-do-deployment/sync/wake-delivery",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 10, maxBatches: 2 }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deploymentId: "sync-delivery-do-deployment",
      batches: 1,
      claimed: 1,
      acked: 1,
      delivered: 1,
      skipped: 0,
      hasMore: false,
      summary: {
        batches: 1,
        claimed: 1,
        acked: 1,
        delivered: 1,
        skipped: 0,
        pendingAck: 0,
        hasMore: false,
      },
    });
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 17,
          value: { user: "Grace" },
        },
      ],
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "sync-delivery-do-deployment",
          limit: 10,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-do-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "sync-delivery-do-deployment",
          deliveryIds: ["delivery_1"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-do-deployment:/),
        },
      },
    ]);
    ws.close();
  });

  it("wakes DeliveryDO and delivers failed live query reruns as QueryFailed", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "sync-delivery-do-failed-deployment";
    const connectionId = `connection:${deploymentId}:delivery-do-failed-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_PROJECT_ID: "project_sync",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-subscriptions/record") {
              return Response.json({
                subscription: {
                  ...jsonRecord(body),
                  resultHash: '{"user":"Ada"}',
                  createdAt: "2026-06-22T00:00:00.000Z",
                  updatedAt: "2026-06-22T00:00:00.000Z",
                },
                resultHash: '{"user":"Ada"}',
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              return Response.json({ deleted: 1 });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: "delivery_failed_1",
                    connectionId,
                    queryId: 18,
                    payloadJson: {
                      kind: "failed",
                      deploymentId,
                      connectionId,
                      queryId: 18,
                      functionPath: "users:unique",
                      argsJson: { id: "1:ada" },
                      previousResultHash: '{"user":"Ada"}',
                      errorMessage: "Query returned more than one document.",
                      errorData: null,
                    },
                    deliveredAt: null,
                    createdAt: "2026-06-21T00:00:00.000Z",
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              return Response.json({ delivered: 1 });
            }
            return Response.json({ ok: true });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(
      harness,
      deploymentId,
      "delivery-do-failed-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 18,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

    const delivered = nextJsonMessage(ws);
    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 10, maxBatches: 2 }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody: unknown = await response.json();
    expect(responseBody).toMatchObject({
      deploymentId,
      claimed: 1,
      acked: 1,
      delivered: 1,
      skipped: 0,
      hasMore: false,
    });
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryFailed",
          queryId: 18,
          errorMessage: "Query returned more than one document.",
          errorData: null,
        },
      ],
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 10,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-do-failed-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_failed_1"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-do-failed-deployment:/),
        },
      },
    ]);
    ws.close();
  });

  it("records DeliveryDO fanout failures before retrying pending rows", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "sync-delivery-failure-deployment";
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: "delivery_failed",
                    connectionId: "wrong_connection",
                    queryId: 18,
                    payloadJson: {
                      deploymentId,
                      connectionId: "wrong_connection",
                      queryId: 18,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson: { user: "Grace" },
                      previousResultHash: '{"user":"Ada"}',
                      resultHash: '{"user":"Grace"}',
                    },
                    deliveredAt: null,
                    createdAt: "2026-06-21T00:00:00.000Z",
                  },
                ],
                nextCursor: {
                  createdAt: "2026-06-21T00:00:00.000Z",
                  deliveryId: "delivery_failed",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/failure") {
              return Response.json({ failed: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 10, maxBatches: 2 }),
      },
    );

    expect(response.status).toBe(500);
    const responseBody: unknown = await response.json();
    expect(responseBody).toMatchObject({
      deploymentId,
      failure: {
        stage: "fanout",
        status: 400,
      },
      summary: {
        batches: 1,
        claimed: 1,
        acked: 0,
        delivered: 0,
        skipped: 0,
        pendingAck: 1,
        hasMore: true,
        failure: {
          stage: "fanout",
          status: 400,
        },
      },
    });
    expect(jsonRecord(responseBody).error).toContain("wrong_connection");
    expect(executorRequests).toHaveLength(2);
    expect(executorRequests[0]).toEqual({
      path: "/maintenance/live-queries/claim",
      authorization: "Bearer executor-secret",
      body: {
        deploymentId,
        limit: 10,
        leaseDurationMs: 30000,
        claimOwner: expect.stringMatching(/^delivery:sync-delivery-failure-deployment:/),
      },
    });
    expect(executorRequests[1]).toMatchObject({
      path: "/maintenance/live-queries/failure",
      authorization: "Bearer executor-secret",
      body: {
        deploymentId,
        deliveryIds: ["delivery_failed"],
        claimOwner: expect.stringMatching(/^delivery:sync-delivery-failure-deployment:/),
        stage: "fanout",
      },
    });
    expect((executorRequests[1]!.body as { error: string }).error).toContain(
      "wrong_connection",
    );
    expect(typeof (executorRequests[1]!.body as { failedAt: unknown }).failedAt)
      .toBe("string");
  });

  it("records DeliveryDO claim failures", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "sync-delivery-claim-failure-deployment";
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({ error: "temporary claim failure" }, { status: 503 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 10, maxBatches: 2 }),
      },
    );

    expect(response.status).toBe(500);
    const responseBody: unknown = await response.json();
    expect(responseBody).toMatchObject({
      deploymentId,
      error: "Live query delivery claim failed with status 503.",
      failure: {
        stage: "claim",
        status: 502,
        error: "Live query delivery claim failed with status 503.",
      },
      summary: {
        batches: 0,
        claimed: 0,
        acked: 0,
        delivered: 0,
        skipped: 0,
        pendingAck: 0,
        hasMore: false,
        failure: {
          stage: "claim",
          status: 502,
          error: "Live query delivery claim failed with status 503.",
        },
      },
    });
    expect(executorRequests).toHaveLength(1);
    expect(executorRequests[0]).toEqual({
      path: "/maintenance/live-queries/claim",
      authorization: "Bearer executor-secret",
      body: {
        deploymentId,
        limit: 10,
        leaseDurationMs: 30000,
        claimOwner: expect.stringMatching(/^delivery:sync-delivery-claim-failure-deployment:/),
      },
    });
  });

  it("records DeliveryDO ack failures after successful fanout", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "sync-delivery-ack-failure-deployment";
    const connectionId = `connection:${deploymentId}:delivery-ack-failure-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-subscriptions/record") {
              return Response.json({
                subscription: {
                  ...jsonRecord(body),
                  resultHash: '{"user":"Ada"}',
                  createdAt: "2026-06-22T00:00:00.000Z",
                  updatedAt: "2026-06-22T00:00:00.000Z",
                },
                resultHash: '{"user":"Ada"}',
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              return Response.json({ deleted: 1 });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: "delivery_ack_failed",
                    connectionId,
                    queryId: 18,
                    payloadJson: {
                      deploymentId,
                      connectionId,
                      queryId: 18,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson: { user: "Grace" },
                      previousResultHash: '{"user":"Ada"}',
                      resultHash: '{"user":"Grace"}',
                    },
                    deliveredAt: null,
                    createdAt: "2026-06-21T00:00:00.000Z",
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              return Response.json({ error: "temporary ack failure" }, { status: 503 });
            }
            if (url.pathname === "/maintenance/live-queries/failure") {
              return Response.json({ failed: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(
      harness,
      deploymentId,
      "delivery-ack-failure-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 18,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    const initial = await nextJsonMessage(ws);
    expect(initial).toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 18,
          value: { user: "Ada" },
        },
      ],
    });
    executorRequests.length = 0;

    const delivered = nextJsonMessage(ws);
    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 10, maxBatches: 2 }),
      },
    );

    expect(response.status).toBe(500);
    const responseBody: unknown = await response.json();
    expect(responseBody).toMatchObject({
      deploymentId,
      error: "Live query delivery ack failed with status 503.",
      failure: {
        stage: "ack",
        status: 502,
        error: "Live query delivery ack failed with status 503.",
      },
      summary: {
        batches: 1,
        claimed: 1,
        acked: 0,
        delivered: 1,
        skipped: 0,
        pendingAck: 1,
        hasMore: false,
        failure: {
          stage: "ack",
          status: 502,
          error: "Live query delivery ack failed with status 503.",
        },
      },
    });
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 18,
          value: { user: "Grace" },
        },
      ],
    });
    expect(executorRequests).toHaveLength(3);
    expect(executorRequests[0]).toEqual({
      path: "/maintenance/live-queries/claim",
      authorization: "Bearer executor-secret",
      body: {
        deploymentId,
        limit: 10,
        leaseDurationMs: 30000,
        claimOwner: expect.stringMatching(/^delivery:sync-delivery-ack-failure-deployment:/),
      },
    });
    expect(executorRequests[1]).toEqual({
      path: "/maintenance/live-queries/ack",
      authorization: "Bearer executor-secret",
      body: {
        deploymentId,
        deliveryIds: ["delivery_ack_failed"],
        claimOwner: expect.stringMatching(/^delivery:sync-delivery-ack-failure-deployment:/),
      },
    });
    expect(executorRequests[2]).toMatchObject({
      path: "/maintenance/live-queries/failure",
      authorization: "Bearer executor-secret",
      body: {
        deploymentId,
        deliveryIds: ["delivery_ack_failed"],
        claimOwner: expect.stringMatching(/^delivery:sync-delivery-ack-failure-deployment:/),
        stage: "ack",
        error: "Live query delivery ack failed with status 503.",
      },
    });
    expect(typeof jsonRecord(executorRequests[2]!.body).failedAt).toBe("string");
    ws.close();
  });

  it("acks stale DeliveryDO retries after a previous ack failure", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    let ackAttempts = 0;
    const deploymentId = "sync-delivery-ack-retry-deployment";
    const connectionId = `connection:${deploymentId}:delivery-ack-retry-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-subscriptions/record") {
              return Response.json({
                subscription: {
                  ...jsonRecord(body),
                  resultHash: '{"user":"Ada"}',
                  createdAt: "2026-06-22T00:00:00.000Z",
                  updatedAt: "2026-06-22T00:00:00.000Z",
                },
                resultHash: '{"user":"Ada"}',
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              return Response.json({ deleted: 1 });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: "delivery_ack_retry",
                    connectionId,
                    queryId: 19,
                    payloadJson: {
                      deploymentId,
                      connectionId,
                      queryId: 19,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson: { user: "Grace" },
                      previousResultHash: '{"user":"Ada"}',
                      resultHash: '{"user":"Grace"}',
                    },
                    deliveredAt: null,
                    createdAt: "2026-06-21T00:00:00.000Z",
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              ackAttempts += 1;
              if (ackAttempts === 1) {
                return Response.json({ error: "temporary ack failure" }, { status: 503 });
              }
              return Response.json({ delivered: 1 });
            }
            if (url.pathname === "/maintenance/live-queries/failure") {
              return Response.json({ failed: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "delivery-ack-retry-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 19,
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
          queryId: 19,
          value: { user: "Ada" },
        },
      ],
    });
    executorRequests.length = 0;

    const delivered = nextJsonMessage(ws);
    const failedAck = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 10, maxBatches: 1 }),
      },
    );

    expect(failedAck.status).toBe(500);
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 19,
          value: { user: "Grace" },
        },
      ],
    });

    const retried = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 10, maxBatches: 1 }),
      },
    );

    expect(retried.status).toBe(200);
    const retriedBody: unknown = await retried.json();
    expect(retriedBody).toEqual({
      deploymentId,
      batches: 1,
      claimed: 1,
      acked: 1,
      delivered: 0,
      skipped: 1,
      staleSkipped: 1,
      skipReasons: { stale: 1 },
      hasMore: false,
      summary: {
        batches: 1,
        claimed: 1,
        acked: 1,
        delivered: 0,
        skipped: 1,
        staleSkipped: 1,
        skipReasons: { stale: 1 },
        pendingAck: 0,
        hasMore: false,
      },
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 10,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-ack-retry-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_ack_retry"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-ack-retry-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/failure",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_ack_retry"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-ack-retry-deployment:/),
          stage: "ack",
          error: "Live query delivery ack failed with status 503.",
          failedAt: expect.any(String),
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 10,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-ack-retry-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_ack_retry"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-ack-retry-deployment:/),
        },
      },
    ]);
    ws.close();
  });

  it("continues DeliveryDO draining from pending alarm state when more deliveries remain", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    let claimCount = 0;
    const deploymentId = "sync-delivery-alarm-deployment";
    const connectionId = `connection:${deploymentId}:delivery-alarm-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/claim") {
              claimCount += 1;
              const resultJson = claimCount === 1
                ? { user: "Grace" }
                : { user: "Hopper" };
              const previousResultHash = claimCount === 1
                ? '{"user":"Ada"}'
                : '{"user":"Grace"}';
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: `delivery_${claimCount}`,
                    connectionId,
                    queryId: 18,
                    payloadJson: {
                      deploymentId,
                      connectionId,
                      queryId: 18,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson,
                      previousResultHash,
                      resultHash: JSON.stringify(resultJson),
                    },
                    deliveredAt: null,
                    createdAt: `2026-06-21T00:00:0${claimCount}.000Z`,
                  },
                ],
                nextCursor: {
                  createdAt: `2026-06-21T00:00:0${claimCount}.000Z`,
                  deliveryId: `delivery_${claimCount}`,
                },
                hasMore: claimCount === 1,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              return Response.json({ delivered: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(
      harness,
      deploymentId,
      "delivery-alarm-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 18,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

    const delivered = collectJsonMessages(ws, 2);
    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 1, maxBatches: 1 }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deploymentId,
      batches: 1,
      claimed: 1,
      acked: 1,
      delivered: 1,
      skipped: 0,
      hasMore: true,
      summary: {
        batches: 1,
        claimed: 1,
        acked: 1,
        delivered: 1,
        skipped: 0,
        pendingAck: 0,
        hasMore: true,
      },
    });
    const env = await harness.mf.getBindings<Env>();
    const delivery = env.DELIVERIES.getByName(`delivery:${deploymentId}`);
    const continued = await delivery.fetch("https://flarex.internal/continue", {
      method: "POST",
    });

    expect(continued.status).toBe(200);
    const continuedBody: unknown = await continued.json();
    if (isSkippedResponse(continuedBody)) {
      await waitFor(() => executorRequests.length >= 4);
    } else {
      expect(continuedBody).toEqual({
        deploymentId,
        batches: 1,
        claimed: 1,
        acked: 1,
        delivered: 1,
        skipped: 0,
        hasMore: false,
        summary: {
          batches: 1,
          claimed: 1,
          acked: 1,
          delivered: 1,
          skipped: 0,
          pendingAck: 0,
          hasMore: false,
        },
      });
    }
    await expect(delivered).resolves.toMatchObject([
      {
        type: "Transition",
        modifications: [
          {
            type: "QueryUpdated",
            queryId: 18,
            value: { user: "Grace" },
          },
        ],
      },
      {
        type: "Transition",
        modifications: [
          {
            type: "QueryUpdated",
            queryId: 18,
            value: { user: "Hopper" },
          },
        ],
      },
    ]);
    await waitFor(() => deliveryMaintenanceRequests(executorRequests).length >= 4);
    expect(deliveryMaintenanceRequests(executorRequests)).toEqual([
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-alarm-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_1"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-alarm-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-alarm-deployment:/),
          cursor: {
            createdAt: "2026-06-21T00:00:01.000Z",
            deliveryId: "delivery_1",
          },
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_2"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-alarm-deployment:/),
        },
      },
    ]);
    ws.close();
  });

  it("returns structured DeliveryDO continue failures from pending drain state", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    let claimCount = 0;
    const deploymentId = "sync-delivery-continue-failure-deployment";
    const connectionId = `connection:${deploymentId}:delivery-continue-failure-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/claim") {
              claimCount += 1;
              if (claimCount > 1) {
                return Response.json({ error: "temporary continue claim failure" }, { status: 503 });
              }
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: "delivery_continue_1",
                    connectionId,
                    queryId: 20,
                    payloadJson: {
                      deploymentId,
                      connectionId,
                      queryId: 20,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson: { user: "Grace" },
                      previousResultHash: '{"user":"Ada"}',
                      resultHash: '{"user":"Grace"}',
                    },
                    deliveredAt: null,
                    createdAt: "2026-06-21T00:00:01.000Z",
                  },
                ],
                nextCursor: {
                  createdAt: "2026-06-21T00:00:01.000Z",
                  deliveryId: "delivery_continue_1",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              return Response.json({ delivered: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(
      harness,
      deploymentId,
      "delivery-continue-failure-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 20,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

    const delivered = nextJsonMessage(ws);
    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 1, maxBatches: 1 }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deploymentId,
      batches: 1,
      claimed: 1,
      acked: 1,
      delivered: 1,
      skipped: 0,
      hasMore: true,
      summary: {
        batches: 1,
        claimed: 1,
        acked: 1,
        delivered: 1,
        skipped: 0,
        pendingAck: 0,
        hasMore: true,
      },
    });
    const env = await harness.mf.getBindings<Env>();
    const delivery = env.DELIVERIES.getByName(`delivery:${deploymentId}`);
    const continued = await delivery.fetch("https://flarex.internal/continue", {
      method: "POST",
    });

    expect(continued.status).toBe(500);
    const continuedBody: unknown = await continued.json();
    const expectedContinueFailure = {
      deploymentId,
      error: "Live query delivery claim failed with status 503.",
      failure: {
        stage: "claim",
        status: 502,
        error: "Live query delivery claim failed with status 503.",
      },
      summary: {
        batches: 0,
        claimed: 0,
        acked: 0,
        delivered: 0,
        skipped: 0,
        pendingAck: 0,
        hasMore: false,
        failure: {
          stage: "claim",
          status: 502,
          error: "Live query delivery claim failed with status 503.",
        },
      },
    } satisfies DeliveryDrainFailureResult;
    expect(continuedBody).toEqual(expectedContinueFailure);
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 20,
          value: { user: "Grace" },
        },
      ],
    });
    const manualContinueRequests = deliveryMaintenanceRequests(executorRequests)
      .slice(0, 3);
    expect(manualContinueRequests).toEqual([
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-continue-failure-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_continue_1"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-continue-failure-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-continue-failure-deployment:/),
          cursor: {
            createdAt: "2026-06-21T00:00:01.000Z",
            deliveryId: "delivery_continue_1",
          },
        },
      },
    ]);
    ws.close();
  });

  it("rejects DeliveryDO claim pages with hasMore but no cursor", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "sync-delivery-missing-cursor-deployment";
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({
                deliveries: [],
                nextCursor: null,
                hasMore: true,
              });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 1, maxBatches: 1 }),
      },
    );

    expect(response.status).toBe(500);
    const responseBody: unknown = await response.json();
    const expectedFailure = {
      deploymentId,
      error: "Live query delivery claim response.nextCursor must be an object when hasMore is true.",
      failure: {
        stage: "claim",
        status: 502,
        error: "Live query delivery claim response.nextCursor must be an object when hasMore is true.",
      },
      summary: {
        batches: 0,
        claimed: 0,
        acked: 0,
        delivered: 0,
        skipped: 0,
        pendingAck: 0,
        hasMore: false,
        failure: {
          stage: "claim",
          status: 502,
          error: "Live query delivery claim response.nextCursor must be an object when hasMore is true.",
        },
      },
    } satisfies DeliveryDrainFailureResult;
    expect(responseBody).toEqual(expectedFailure);
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-missing-cursor-deployment:/),
        },
      },
    ]);
  });

  it("continues DeliveryDO empty hasMore pages from the returned cursor", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    let claimCount = 0;
    const deploymentId = "sync-delivery-empty-page-cursor-deployment";
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "wake-secret",
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/claim") {
              claimCount += 1;
              return Response.json({
                deliveries: [],
                nextCursor: {
                  createdAt: "2026-06-21T00:00:02.000Z",
                  deliveryId: "delivery_empty_page",
                },
                hasMore: claimCount === 1,
              });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      `http://flarex.test/deployments/${deploymentId}/sync/wake-delivery`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer wake-secret",
        },
        body: JSON.stringify({ limit: 1, maxBatches: 2 }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deploymentId,
      batches: 1,
      claimed: 0,
      acked: 0,
      delivered: 0,
      skipped: 0,
      hasMore: true,
      summary: {
        batches: 1,
        claimed: 0,
        acked: 0,
        delivered: 0,
        skipped: 0,
        pendingAck: 0,
        hasMore: true,
      },
    });

    const env = await harness.mf.getBindings<Env>();
    const delivery = env.DELIVERIES.getByName(`delivery:${deploymentId}`);
    const continued = await delivery.fetch("https://flarex.internal/continue", {
      method: "POST",
    });

    expect(continued.status).toBe(200);
    const continuedBody: unknown = await continued.json();
    if (isSkippedResponse(continuedBody)) {
      await waitFor(() => executorRequests.length >= 2);
    } else {
      expect(continuedBody).toEqual({
        deploymentId,
        batches: 1,
        claimed: 0,
        acked: 0,
        delivered: 0,
        skipped: 0,
        hasMore: false,
        summary: {
          batches: 1,
          claimed: 0,
          acked: 0,
          delivered: 0,
          skipped: 0,
          pendingAck: 0,
          hasMore: false,
        },
      });
    }
    await waitFor(() => deliveryMaintenanceRequests(executorRequests).length >= 2);
    expect(deliveryMaintenanceRequests(executorRequests)).toEqual([
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-empty-page-cursor-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-empty-page-cursor-deployment:/),
          cursor: {
            createdAt: "2026-06-21T00:00:02.000Z",
            deliveryId: "delivery_empty_page",
          },
        },
      },
    ]);
  });

  it("reconciles lost live query wake notifications through SchedulerDO", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "sync-delivery-reconcile-deployment";
    const connectionId = `connection:${deploymentId}:delivery-reconcile-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/pending-deployments") {
              return Response.json({
                deployments: [
                  {
                    deploymentId,
                    oldestCreatedAt: "2026-06-21T00:00:00.000Z",
                    pending: 1,
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: "delivery_reconcile_1",
                    connectionId,
                    queryId: 19,
                    payloadJson: {
                      deploymentId,
                      connectionId,
                      queryId: 19,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson: { user: "Lovelace" },
                      previousResultHash: '{"user":"Ada"}',
                      resultHash: '{"user":"Lovelace"}',
                    },
                    deliveredAt: null,
                    createdAt: "2026-06-21T00:00:00.000Z",
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              return Response.json({ delivered: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(
      harness,
      deploymentId,
      "delivery-reconcile-session",
    );
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 19,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

    const delivered = nextJsonMessage(ws);
    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 5, deliveryLimit: 10, maxBatches: 2 }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      deployments: 1,
      woken: 1,
      failed: [],
      nextCursor: null,
      hasMore: false,
    });
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 19,
          value: { user: "Lovelace" },
        },
      ],
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/pending-deployments",
        authorization: "Bearer executor-secret",
        body: { limit: 5 },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 10,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-reconcile-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_reconcile_1"],
          claimOwner: expect.stringMatching(/^delivery:sync-delivery-reconcile-deployment:/),
        },
      },
    ]);
    ws.close();
  });

  it("continues pending live query delivery deployment scans from stored cursors", async () => {
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/pending-deployments") {
              if (deploymentScanCursorDeploymentId(body) === "deployment_delivery_page_a") {
                return Response.json({
                  deployments: [
                    {
                      deploymentId: "deployment_delivery_page_b",
                      oldestCreatedAt: "2026-06-23T00:00:20.000Z",
                      pending: 1,
                    },
                  ],
                  nextCursor: null,
                  hasMore: false,
                });
              }
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_delivery_page_a",
                    oldestCreatedAt: "2026-06-23T00:00:10.000Z",
                    pending: 1,
                  },
                ],
                nextCursor: {
                  oldestCreatedAt: "2026-06-23T00:00:10.000Z",
                  deploymentId: "deployment_delivery_page_a",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({ deliveries: [], nextCursor: null, hasMore: false });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 1, deliveryLimit: 7, maxBatches: 2 }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deployments: 1,
      woken: 1,
      failed: [],
      nextCursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment_delivery_page_a",
      },
      hasMore: true,
    });

    const env = await harness.mf.getBindings<Env>();
    const scheduler = env.SCHEDULERS.getByName("scheduler:live-query-deliveries");
    const continued = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-deliveries",
      { method: "POST" },
    );

    expect(continued.status).toBe(200);
    const continuedBody: unknown = await continued.json();
    if (isSkippedResponse(continuedBody)) {
      await waitFor(() => executorRequests.length >= 4);
    } else {
      expect(continuedBody).toMatchObject({
        deployments: 1,
        woken: 1,
        failed: [],
        nextCursor: null,
        hasMore: false,
      });
    }
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/pending-deployments",
        authorization: "Bearer executor-secret",
        body: { limit: 1 },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment_delivery_page_a",
          limit: 7,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:deployment_delivery_page_a:/),
        },
      },
      {
        path: "/maintenance/live-queries/pending-deployments",
        authorization: "Bearer executor-secret",
        body: {
          limit: 1,
          cursor: {
            oldestCreatedAt: "2026-06-23T00:00:10.000Z",
            deploymentId: "deployment_delivery_page_a",
          },
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId: "deployment_delivery_page_b",
          limit: 7,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:deployment_delivery_page_b:/),
        },
      },
    ]);

    const cleared = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-deliveries",
      { method: "POST" },
    );
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toEqual({ skipped: true });
  });

  it("continues pending live query delivery scans from alarms", async () => {
    const executorRequests: Array<{ path: string; body: unknown }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({ path: url.pathname, body });
            if (url.pathname === "/maintenance/live-queries/pending-deployments") {
              if (deploymentScanCursorDeploymentId(body) === "deployment_delivery_alarm_a") {
                return Response.json({
                  deployments: [
                    {
                      deploymentId: "deployment_delivery_alarm_b",
                      oldestCreatedAt: "2026-06-23T00:00:20.000Z",
                      pending: 1,
                    },
                  ],
                  nextCursor: null,
                  hasMore: false,
                });
              }
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_delivery_alarm_a",
                    oldestCreatedAt: "2026-06-23T00:00:10.000Z",
                    pending: 1,
                  },
                ],
                nextCursor: {
                  oldestCreatedAt: "2026-06-23T00:00:10.000Z",
                  deploymentId: "deployment_delivery_alarm_a",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({ deliveries: [], nextCursor: null, hasMore: false });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 1, deliveryLimit: 9, maxBatches: 4 }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deployments: 1,
      woken: 1,
      failed: [],
      nextCursor: {
        oldestCreatedAt: "2026-06-23T00:00:10.000Z",
        deploymentId: "deployment_delivery_alarm_a",
      },
      hasMore: true,
    });

    await waitFor(() => executorRequests.length >= 4);
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/pending-deployments",
        body: { limit: 1 },
      },
      {
        path: "/maintenance/live-queries/claim",
        body: {
          deploymentId: "deployment_delivery_alarm_a",
          limit: 9,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:deployment_delivery_alarm_a:/),
        },
      },
      {
        path: "/maintenance/live-queries/pending-deployments",
        body: {
          limit: 1,
          cursor: {
            oldestCreatedAt: "2026-06-23T00:00:10.000Z",
            deploymentId: "deployment_delivery_alarm_a",
          },
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        body: {
          deploymentId: "deployment_delivery_alarm_b",
          limit: 9,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:deployment_delivery_alarm_b:/),
        },
      },
    ]);

    const env = await harness.mf.getBindings<Env>();
    const scheduler = env.SCHEDULERS.getByName("scheduler:live-query-deliveries");
    const cleared = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-deliveries",
      { method: "POST" },
    );
    expect(cleared.status).toBe(200);
    await expect(cleared.json()).resolves.toEqual({ skipped: true });
  });

  it("keeps pending delivery deployment cursor when a wake fails", async () => {
    const executorRequests: Array<{ path: string; body: unknown }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({ path: url.pathname, body });
            if (url.pathname === "/maintenance/live-queries/pending-deployments") {
              if (deploymentScanCursorDeploymentId(body) === "deployment_delivery_failed") {
                return Response.json({
                  deployments: [
                    {
                      deploymentId: "deployment_delivery_after_failure",
                      oldestCreatedAt: "2026-06-23T00:00:30.000Z",
                      pending: 1,
                    },
                  ],
                  nextCursor: null,
                  hasMore: false,
                });
              }
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_delivery_failed",
                    oldestCreatedAt: "2026-06-23T00:00:20.000Z",
                    pending: 1,
                  },
                ],
                nextCursor: {
                  oldestCreatedAt: "2026-06-23T00:00:20.000Z",
                  deploymentId: "deployment_delivery_failed",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              if (cleanupDeploymentId(body) === "deployment_delivery_failed") {
                return Response.json({ error: "temporary delivery failure" }, { status: 503 });
              }
              return Response.json({ deliveries: [], nextCursor: null, hasMore: false });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 1, deliveryLimit: 3, maxBatches: 1 }),
      },
    );

    expect(response.status).toBe(200);
    const responseBody: unknown = await response.json();
    expect(responseBody).toMatchObject({
      deployments: 1,
      woken: 0,
      failed: [
        {
          deploymentId: "deployment_delivery_failed",
          status: 500,
          error: "Live query delivery claim failed with status 503.",
          failure: {
            stage: "claim",
            status: 502,
            error: "Live query delivery claim failed with status 503.",
          },
          summary: {
            batches: 0,
            claimed: 0,
            acked: 0,
            delivered: 0,
            skipped: 0,
            pendingAck: 0,
            hasMore: false,
            failure: {
              stage: "claim",
              status: 502,
              error: "Live query delivery claim failed with status 503.",
            },
          },
        },
      ],
      nextCursor: {
        oldestCreatedAt: "2026-06-23T00:00:20.000Z",
        deploymentId: "deployment_delivery_failed",
      },
      hasMore: true,
    });

    const env = await harness.mf.getBindings<Env>();
    const scheduler = env.SCHEDULERS.getByName("scheduler:live-query-deliveries");
    const continued = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-deliveries",
      { method: "POST" },
    );

    expect(continued.status).toBe(200);
    const continuedBody: unknown = await continued.json();
    if (isSkippedResponse(continuedBody)) {
      await waitFor(() => executorRequests.length >= 4);
    } else {
      expect(continuedBody).toMatchObject({
        deployments: 1,
        woken: 1,
        failed: [],
        nextCursor: null,
        hasMore: false,
      });
    }
    expect(executorRequests).toEqual([
      expect.objectContaining({
        path: "/maintenance/live-queries/pending-deployments",
        body: { limit: 1 },
      }),
      expect.objectContaining({
        path: "/maintenance/live-queries/claim",
        body: {
          deploymentId: "deployment_delivery_failed",
          limit: 3,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:deployment_delivery_failed:/),
        },
      }),
      expect.objectContaining({
        path: "/maintenance/live-queries/pending-deployments",
        body: {
          limit: 1,
          cursor: {
            oldestCreatedAt: "2026-06-23T00:00:20.000Z",
            deploymentId: "deployment_delivery_failed",
          },
        },
      }),
      expect.objectContaining({
        path: "/maintenance/live-queries/claim",
        body: {
          deploymentId: "deployment_delivery_after_failure",
          limit: 3,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:deployment_delivery_after_failure:/),
        },
      }),
    ]);
  });

  it("coalesces concurrent fresh pending delivery reconciles", async () => {
    const executorRequests: Array<{ path: string; body: unknown }> = [];
    let releaseScan: () => void = () => {
      throw new Error("Scan gate was not initialized.");
    };
    const scanGate = new Promise<void>(resolve => {
      releaseScan = resolve;
    });
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({ path: url.pathname, body });
            if (url.pathname === "/maintenance/live-queries/pending-deployments") {
              await scanGate;
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_delivery_concurrent",
                    oldestCreatedAt: "2026-06-23T00:00:10.000Z",
                    pending: 1,
                  },
                ],
                nextCursor: {
                  oldestCreatedAt: "2026-06-23T00:00:10.000Z",
                  deploymentId: "deployment_delivery_concurrent",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({ deliveries: [], nextCursor: null, hasMore: false });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const request = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 1, deliveryLimit: 4, maxBatches: 1 }),
    };
    const first = harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      request,
    );
    await waitFor(() => executorRequests.length === 1);
    const second = harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      request,
    );
    releaseScan();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      deployments: 1,
      woken: 1,
      hasMore: true,
    });
    await expect(secondResponse.json()).resolves.toMatchObject({
      deployments: 1,
      woken: 1,
      hasMore: true,
    });
    expect(executorRequests).toEqual([
      expect.objectContaining({
        path: "/maintenance/live-queries/pending-deployments",
        body: { limit: 1 },
      }),
      expect.objectContaining({
        path: "/maintenance/live-queries/claim",
        body: {
          deploymentId: "deployment_delivery_concurrent",
          limit: 4,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:deployment_delivery_concurrent:/),
        },
      }),
    ]);
  });

  it("does not coalesce concurrent pending delivery reconciles with different parameters", async () => {
    const executorRequests: Array<{ path: string; body: unknown }> = [];
    let releaseScan: () => void = () => {
      throw new Error("Scan gate was not initialized.");
    };
    const scanGate = new Promise<void>(resolve => {
      releaseScan = resolve;
    });
    let scanCount = 0;
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({ path: url.pathname, body });
            if (url.pathname === "/maintenance/live-queries/pending-deployments") {
              scanCount += 1;
              const deploymentId =
                scanCount === 1
                  ? "deployment_delivery_concurrent_params_a"
                  : "deployment_delivery_concurrent_params_b";
              await scanGate;
              return Response.json({
                deployments: [
                  {
                    deploymentId,
                    oldestCreatedAt: "2026-06-23T00:00:10.000Z",
                    pending: 1,
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({ deliveries: [], nextCursor: null, hasMore: false });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const first = harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 1, deliveryLimit: 4, maxBatches: 1 }),
      },
    );
    await waitFor(() => executorRequests.length === 1);
    const second = harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ limit: 1, deliveryLimit: 8, maxBatches: 1 }),
      },
    );
    await waitFor(() => executorRequests.length === 2);
    releaseScan();

    const [firstResponse, secondResponse] = await Promise.all([first, second]);
    expect(firstResponse.status).toBe(200);
    expect(secondResponse.status).toBe(200);
    await expect(firstResponse.json()).resolves.toMatchObject({
      deployments: 1,
      woken: 1,
      hasMore: false,
    });
    await expect(secondResponse.json()).resolves.toMatchObject({
      deployments: 1,
      woken: 1,
      hasMore: false,
    });

    expect(executorRequests.filter(request => request.path === "/maintenance/live-queries/pending-deployments")).toEqual([
      { path: "/maintenance/live-queries/pending-deployments", body: { limit: 1 } },
      { path: "/maintenance/live-queries/pending-deployments", body: { limit: 1 } },
    ]);
    expect(executorRequests).toContainEqual({
      path: "/maintenance/live-queries/claim",
      body: {
        deploymentId: "deployment_delivery_concurrent_params_a",
        limit: 4,
        leaseDurationMs: 30000,
        claimOwner: expect.stringMatching(/^delivery:deployment_delivery_concurrent_params_a:/),
      },
    });
    expect(executorRequests).toContainEqual({
      path: "/maintenance/live-queries/claim",
      body: {
        deploymentId: "deployment_delivery_concurrent_params_b",
        limit: 8,
        leaseDurationMs: 30000,
        claimOwner: expect.stringMatching(/^delivery:deployment_delivery_concurrent_params_b:/),
      },
    });
  });

  it("keeps explicit cursor delivery reconciles stateless", async () => {
    const executorRequests: Array<{ path: string; body: unknown }> = [];
    const harness = await createSyncHarness(
      [],
      () => ({ user: "Ada" }),
      undefined,
      {
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body: unknown = await request.json();
            executorRequests.push({ path: url.pathname, body });
            if (url.pathname === "/maintenance/live-queries/pending-deployments") {
              return Response.json({
                deployments: [
                  {
                    deploymentId: "deployment_delivery_explicit_cursor",
                    oldestCreatedAt: "2026-06-23T00:00:20.000Z",
                    pending: 1,
                  },
                ],
                nextCursor: {
                  oldestCreatedAt: "2026-06-23T00:00:20.000Z",
                  deploymentId: "deployment_delivery_explicit_cursor",
                },
                hasMore: true,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({ deliveries: [], nextCursor: null, hasMore: false });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);

    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/reconcile",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          limit: 1,
          deliveryLimit: 5,
          maxBatches: 1,
          cursor: {
            oldestCreatedAt: "2026-06-23T00:00:10.000Z",
            deploymentId: "deployment_delivery_before_explicit",
          },
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      deployments: 1,
      woken: 1,
      nextCursor: {
        oldestCreatedAt: "2026-06-23T00:00:20.000Z",
        deploymentId: "deployment_delivery_explicit_cursor",
      },
      hasMore: true,
    });
    const env = await harness.mf.getBindings<Env>();
    const scheduler = env.SCHEDULERS.getByName("scheduler:live-query-deliveries");
    const continued = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-deliveries",
      { method: "POST" },
    );
    expect(continued.status).toBe(200);
    await expect(continued.json()).resolves.toEqual({ skipped: true });
  });

  it("triggers stale live query reruns and fans out changed results", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "sync-rerun-fanout-deployment";
    const connectionId = `connection:${deploymentId}:rerun-fanout-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/rerun") {
              return Response.json({
                scanned: {
                  fresh: [],
                  stale: [{ subscription: { deploymentId, connectionId, queryId: 31 } }],
                  unsupported: [],
                },
                changed: [
                  {
                    subscription: { deploymentId, connectionId, queryId: 31 },
                    previousResultHash: '{"user":"Ada"}',
                    resultHash: '{"user":"Grace"}',
                    changed: true,
                    delivery: {
                      deploymentId,
                      deliveryId: "delivery_rerun_fanout_1",
                      connectionId,
                      queryId: 31,
                    },
                  },
                ],
                unchanged: [],
                changes: [
                  {
                    deploymentId,
                    connectionId,
                    queryId: 31,
                    functionPath: "users:get",
                    argsJson: { id: "1:ada" },
                    resultJson: { user: "Grace" },
                    previousResultHash: '{"user":"Ada"}',
                    resultHash: '{"user":"Grace"}',
                  },
                ],
                unsupported: [],
                hasMoreStale: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: "delivery_rerun_fanout_1",
                    connectionId,
                    queryId: 31,
                    payloadJson: {
                      deploymentId,
                      connectionId,
                      queryId: 31,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson: { user: "Grace" },
                      previousResultHash: '{"user":"Ada"}',
                      resultHash: '{"user":"Grace"}',
                    },
                    deliveredAt: null,
                    createdAt: "2026-06-22T00:00:00.000Z",
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              return Response.json({ delivered: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "rerun-fanout-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 31,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

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
          projectId: "project_rerun_fanout",
          limit: 5,
          deliveryLimit: 10,
          maxBatches: 2,
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
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
          batches: 1,
          claimed: 1,
          acked: 1,
          delivered: 1,
          skipped: 0,
          hasMore: false,
          summary: {
            batches: 1,
            claimed: 1,
            acked: 1,
            delivered: 1,
            skipped: 0,
            pendingAck: 0,
            hasMore: false,
          },
        },
        error: null,
      },
    });
    await expect(delivered).resolves.toMatchObject({
      type: "Transition",
      modifications: [
        {
          type: "QueryUpdated",
          queryId: 31,
          value: { user: "Grace" },
        },
      ],
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/rerun",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_rerun_fanout",
          limit: 5,
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 10,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-rerun-fanout-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_rerun_fanout_1"],
          claimOwner: expect.stringMatching(/^delivery:sync-rerun-fanout-deployment:/),
        },
      },
    ]);
    expect(runtimeCalls).toEqual([
      expect.objectContaining({
        deploymentId,
        request: {
          path: "users:get",
          kind: "query",
          partitionKey: "user:ada",
          args: { id: "1:ada" },
        },
      }),
    ]);
    ws.close();
  });

  it("continues stale live query reruns from pending alarm state", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    let rerunCount = 0;
    let claimCount = 0;
    const deploymentId = "sync-rerun-continuation-deployment";
    const connectionId = `connection:${deploymentId}:rerun-continuation-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/maintenance/live-queries/rerun") {
              rerunCount += 1;
              const resultJson = rerunCount === 1
                ? { user: "Grace" }
                : { user: "Hopper" };
              const previousResultHash = rerunCount === 1
                ? '{"user":"Ada"}'
                : '{"user":"Grace"}';
              return Response.json({
                scanned: {
                  fresh: [],
                  stale: [{ subscription: { deploymentId, connectionId, queryId: 32 } }],
                  unsupported: [],
                },
                changed: [
                  {
                    subscription: { deploymentId, connectionId, queryId: 32 },
                    previousResultHash,
                    resultHash: JSON.stringify(resultJson),
                    changed: true,
                    delivery: {
                      deploymentId,
                      deliveryId: `delivery_rerun_continue_${rerunCount}`,
                      connectionId,
                      queryId: 32,
                    },
                  },
                ],
                unchanged: [],
                changes: [
                  {
                    deploymentId,
                    connectionId,
                    queryId: 32,
                    functionPath: "users:get",
                    argsJson: { id: "1:ada" },
                    resultJson,
                    previousResultHash,
                    resultHash: JSON.stringify(resultJson),
                  },
                ],
                unsupported: [],
                hasMoreStale: rerunCount === 1,
              });
            }
            if (url.pathname === "/maintenance/live-queries/claim") {
              claimCount += 1;
              const resultJson = claimCount === 1
                ? { user: "Grace" }
                : { user: "Hopper" };
              const previousResultHash = claimCount === 1
                ? '{"user":"Ada"}'
                : '{"user":"Grace"}';
              return Response.json({
                deliveries: [
                  {
                    deploymentId,
                    deliveryId: `delivery_rerun_continue_${claimCount}`,
                    connectionId,
                    queryId: 32,
                    payloadJson: {
                      deploymentId,
                      connectionId,
                      queryId: 32,
                      functionPath: "users:get",
                      argsJson: { id: "1:ada" },
                      resultJson,
                      previousResultHash,
                      resultHash: JSON.stringify(resultJson),
                    },
                    deliveredAt: null,
                    createdAt: `2026-06-22T00:00:0${claimCount}.000Z`,
                  },
                ],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/maintenance/live-queries/ack") {
              return Response.json({ delivered: 1 });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "rerun-continuation-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 32,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

    const delivered = collectJsonMessages(ws, 2);
    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-subscriptions/rerun",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer delivery-secret",
        },
        body: JSON.stringify({
          deploymentId,
          projectId: "project_rerun_continuation",
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
      hasMoreStale: true,
      delivery: {
        woken: true,
        result: {
          delivered: 1,
          hasMore: false,
        },
      },
    });

    const env = await harness.mf.getBindings<Env>();
    const scheduler = env.SCHEDULERS.getByName("scheduler:live-query-deliveries");
    const continued = await scheduler.fetch(
      "https://flarex.internal/continue-live-query-reruns",
      { method: "POST" },
    );

    expect(continued.status).toBe(200);
    await expect(continued.json()).resolves.toMatchObject({
      deploymentId,
      changed: 1,
      hasMoreStale: false,
      delivery: {
        woken: true,
        result: {
          delivered: 1,
          hasMore: false,
        },
      },
    });
    await expect(delivered).resolves.toMatchObject([
      {
        type: "Transition",
        modifications: [
          {
            type: "QueryUpdated",
            queryId: 32,
            value: { user: "Grace" },
          },
        ],
      },
      {
        type: "Transition",
        modifications: [
          {
            type: "QueryUpdated",
            queryId: 32,
            value: { user: "Hopper" },
          },
        ],
      },
    ]);
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/rerun",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_rerun_continuation",
          limit: 1,
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-rerun-continuation-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_rerun_continue_1"],
          claimOwner: expect.stringMatching(/^delivery:sync-rerun-continuation-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/rerun",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_rerun_continuation",
          limit: 1,
        },
      },
      {
        path: "/maintenance/live-queries/claim",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          limit: 1,
          leaseDurationMs: 30000,
          claimOwner: expect.stringMatching(/^delivery:sync-rerun-continuation-deployment:/),
        },
      },
      {
        path: "/maintenance/live-queries/ack",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          deliveryIds: ["delivery_rerun_continue_2"],
          claimOwner: expect.stringMatching(/^delivery:sync-rerun-continuation-deployment:/),
        },
      },
    ]);
    ws.close();
  });

  it("dead-letters stuck live query deliveries and reconnects affected connections", async () => {
    const runtimeCalls: unknown[] = [];
    const executorRequests: Array<{ path: string; authorization: string | null; body: unknown }> = [];
    const deploymentId = "sync-delivery-dead-letter-deployment";
    const connectionId = `connection:${deploymentId}:dead-letter-session`;
    const harness = await createSyncHarness(
      runtimeCalls,
      () => ({ user: "Ada" }),
      undefined,
      {
        bindings: {
          FLAREX_EXECUTOR_TOKEN: "executor-secret",
          FLAREX_LIVE_QUERY_DELIVERY_TOKEN: "delivery-secret",
        },
        serviceBindings: {
          FLAREX_EXECUTOR: async request => {
            const url = new URL(request.url);
            const body = await request.json();
            executorRequests.push({
              path: url.pathname,
              authorization: request.headers.get("authorization"),
              body,
            });
            if (url.pathname === "/live-query-subscriptions/record") {
              return Response.json({
                subscription: {
                  ...(body as Record<string, unknown>),
                  resultHash: "{\"user\":\"Ada\"}",
                  createdAt: "2026-06-22T00:00:00.000Z",
                  updatedAt: "2026-06-22T00:00:00.000Z",
                },
                resultHash: "{\"user\":\"Ada\"}",
              });
            }
            if (url.pathname === "/maintenance/live-queries/dead-letter-stuck") {
              return Response.json({
                scanned: [
                  {
                    deploymentId,
                    deliveryId: "delivery_dead_letter_1",
                    connectionId,
                    queryId: 23,
                    attempts: 3,
                  },
                ],
                deadLettered: [
                  {
                    deploymentId,
                    deliveryId: "delivery_dead_letter_1",
                    connectionId,
                    queryId: 23,
                    attempts: 3,
                    deadLetteredAt: "2026-06-22T00:00:00.000Z",
                  },
                ],
                reconnectConnectionIds: [connectionId],
                nextCursor: null,
                hasMore: false,
              });
            }
            if (url.pathname === "/live-query-subscriptions/remove") {
              return Response.json({ deleted: true });
            }
            if (url.pathname === "/live-query-subscriptions/remove-connection") {
              return Response.json({ deleted: true });
            }
            return Response.json({ error: "not found" }, { status: 404 });
          },
        },
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "dead-letter-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 23,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);
    executorRequests.length = 0;

    const closed = nextClose(ws);
    const response = await harness.mf.dispatchFetch(
      "http://flarex.test/scheduler/live-query-deliveries/dead-letter",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer delivery-secret",
        },
        body: JSON.stringify({
          deploymentId,
          olderThan: "2026-06-22T00:00:00.000Z",
          deadLetteredAt: "2026-06-22T00:01:00.000Z",
          minAttempts: 3,
          limit: 10,
          maxBatches: 2,
          reason: "test stuck delivery",
        }),
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      batches: 1,
      scanned: 1,
      deadLettered: 1,
      reconnectTargets: 1,
      reconnected: 1,
      failed: [],
      nextCursor: null,
      hasMore: false,
    });
    await expect(closed).resolves.toMatchObject({
      code: 1012,
      reason: "flarex reconnect",
    });
    expect(executorRequests).toEqual([
      {
        path: "/maintenance/live-queries/dead-letter-stuck",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          olderThan: "2026-06-22T00:00:00.000Z",
          minAttempts: 3,
          limit: 10,
          reason: "test stuck delivery",
          deadLetteredAt: "2026-06-22T00:01:00.000Z",
        },
      },
      {
        path: "/live-query-subscriptions/remove-connection",
        authorization: "Bearer executor-secret",
        body: {
          deploymentId,
          projectId: "project_sync",
          connectionId,
        },
      },
    ]);
  });

  it("skips stale live query delivery rows for active WebSocket connections", async () => {
    const harness = await createSyncHarness([], () => ({ user: "Ada" }));
    harnesses.push(harness);
    await activateDeployment(harness, "sync-stale-delivery-deployment");

    const ws = await openSync(harness, "sync-stale-delivery-deployment", "stale-delivery-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 15,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);

    const env = await harness.mf.getBindings<Env>();
    const connection = env.CONNECTIONS.getByName(
      "connection:sync-stale-delivery-deployment:stale-delivery-session",
    );
    const firstDelivery = nextJsonMessage(ws);
    await connection.fetch("https://flarex.internal/deliver/live-query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveries: [
          {
            deploymentId: "sync-stale-delivery-deployment",
            connectionId: "connection:sync-stale-delivery-deployment:stale-delivery-session",
            queryId: 15,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Grace" },
            previousResultHash: '{"user":"Ada"}',
            resultHash: '{"user":"Grace"}',
          },
        ],
      }),
    });
    await firstDelivery;

    const stale = await connection.fetch("https://flarex.internal/deliver/live-query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveries: [
          {
            deploymentId: "sync-stale-delivery-deployment",
            connectionId: "connection:sync-stale-delivery-deployment:stale-delivery-session",
            queryId: 15,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Lin" },
            previousResultHash: '{"user":"Ada"}',
            resultHash: '{"user":"Lin"}',
          },
        ],
      }),
    });

    expect(stale.status).toBe(200);
    const staleBody: unknown = await stale.json();
    expect(staleBody).toEqual({
      delivered: 0,
      skipped: 1,
      staleSkipped: 1,
      skipReasons: { stale: 1 },
    });
    const valid = nextJsonMessage(ws);
    await connection.fetch("https://flarex.internal/deliver/live-query", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        deliveries: [
          {
            deploymentId: "sync-stale-delivery-deployment",
            connectionId: "connection:sync-stale-delivery-deployment:stale-delivery-session",
            queryId: 15,
            functionPath: "users:get",
            argsJson: { id: "1:ada" },
            resultJson: { user: "Lin" },
            previousResultHash: '{"user":"Grace"}',
            resultHash: '{"user":"Lin"}',
          },
        ],
      }),
    });
    await expect(valid).resolves.toMatchObject({
      type: "Transition",
      modifications: [{ type: "QueryUpdated", value: { user: "Lin" } }],
    });
    ws.close();
  });

  it("coalesces concurrent invalidations for one query", async () => {
    let currentName = "Ada";
    let blockRerun = false;
    let releaseRerun!: () => void;
    const rerunGate = new Promise<void>(resolve => {
      releaseRerun = resolve;
    });
    let invocationCount = 0;
    const runtimeCalls: unknown[] = [];
    const harness = await createSyncHarness(runtimeCalls, async () => {
      invocationCount += 1;
      if (blockRerun && invocationCount === 2) await rerunGate;
      return { user: currentName };
    });
    harnesses.push(harness);
    await activateDeployment(harness, "sync-coalesce-deployment");

    const ws = await openSync(harness, "sync-coalesce-deployment", "coalesce-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 11,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);

    const env = await harness.mf.getBindings<Env>();
    const connection = env.CONNECTIONS.getByName(
      "connection:sync-coalesce-deployment:coalesce-session",
    );
    blockRerun = true;
    currentName = "Grace";
    const firstInvalidation = connection.fetch("https://flarex.internal/invalidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queryId: 11, invalidatedTs: 1 }),
    });
    await waitFor(() => invocationCount === 2);
    currentName = "Lin";
    const secondInvalidation = await connection.fetch("https://flarex.internal/invalidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queryId: 11, invalidatedTs: 2 }),
    });
    await expect(secondInvalidation.json()).resolves.toEqual({
      invalidated: true,
      queued: true,
    });
    const transitions = collectJsonMessages(ws, 2);
    releaseRerun();
    await firstInvalidation;

    const [firstTransition, secondTransition] = await transitions;
    expect(firstTransition).toMatchObject({
      type: "Transition",
      modifications: [{ type: "QueryUpdated", value: { user: "Lin" } }],
    });
    expect(secondTransition).toMatchObject({
      type: "Transition",
      modifications: [],
    });
    expect(invocationCount).toBe(3);
    ws.close();
  });

  it("executes mutations over sync and refreshes same-partition queries", async () => {
    let currentName = "Ada";
    const runtimeCalls: unknown[] = [];
    const harness = await createSyncHarness(runtimeCalls, async payload => {
      if (payload.request.kind === "mutation") {
        currentName = (payload.request.args as { name: string }).name;
        return { ok: true };
      }
      return { user: currentName };
    });
    harnesses.push(harness);
    await activateDeployment(harness, "sync-mutation-deployment");

    const ws = await openSync(harness, "sync-mutation-deployment");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 12,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await nextJsonMessage(ws);

    const messages = collectJsonMessages(ws, 2);
    ws.send(JSON.stringify({
      type: "Mutation",
      requestId: 21,
      udfPath: "users:update",
      args: [{ name: "Grace" }],
      partitionKey: "user:ada",
    }));

    await expect(messages).resolves.toEqual([
      expect.objectContaining({
        type: "MutationResponse",
        requestId: 21,
        success: true,
        result: { ok: true },
        logLines: [],
      }),
      expect.objectContaining({
        type: "Transition",
        modifications: [
          expect.objectContaining({
            type: "QueryUpdated",
            queryId: 12,
            value: { user: "Grace" },
          }),
        ],
      }),
    ]);
    expect(runtimeCalls).toEqual([
      expect.objectContaining({ request: expect.objectContaining({ kind: "query" }) }),
      expect.objectContaining({ request: expect.objectContaining({ kind: "mutation" }) }),
      expect.objectContaining({ request: expect.objectContaining({ kind: "query" }) }),
    ]);
    ws.close();
  });

  it("executes create-root mutations over sync without caller partition keys", async () => {
    let currentName = "pending";
    const runtimeCalls: unknown[] = [];
    const harness = await createSyncHarness(
      runtimeCalls,
      undefined,
      async payload => {
        if (payload.request.kind === "mutation") {
          currentName = (payload.request.args as { name: string }).name;
          return {
            value: { userId: "1:created" },
            committedTs: 5,
            writes: [
              {
                tableId: 1,
                id: "1:created",
                prevTs: null,
                ts: 5,
                value: { name: currentName },
              },
            ],
          };
        }
        return {
          value: { user: currentName },
          readSet: { documents: [{ tableId: 1, id: "1:created" }] },
          readTs: 3,
        };
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, "sync-create-root-deployment");

    const ws = await openSync(harness, "sync-create-root-deployment");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 13,
          udfPath: "users:get",
          args: [{ id: "1:created" }],
          partitionKey: "1:created",
        },
      ],
    }));
    await nextJsonMessage(ws);

    const messages = collectJsonMessages(ws, 2);
    ws.send(JSON.stringify({
      type: "Mutation",
      requestId: 23,
      udfPath: "users:create",
      args: [{ name: "Ada" }],
    }));

    await expect(messages).resolves.toEqual([
      expect.objectContaining({
        type: "MutationResponse",
        requestId: 23,
        success: true,
        result: { userId: "1:created" },
        ts: 5,
        logLines: [],
      }),
      expect.objectContaining({
        type: "Transition",
        modifications: [
          expect.objectContaining({
            type: "QueryUpdated",
            queryId: 13,
            value: { user: "Ada" },
          }),
        ],
      }),
    ]);
    expect(runtimeCalls).toEqual([
      expect.objectContaining({
        request: expect.objectContaining({
          path: "users:get",
          kind: "query",
          partitionKey: "1:created",
        }),
      }),
      expect.objectContaining({
        request: {
          path: "users:create",
          kind: "mutation",
          args: { name: "Ada" },
        },
      }),
      expect.objectContaining({
        request: expect.objectContaining({
          path: "users:get",
          kind: "query",
          partitionKey: "1:created",
        }),
      }),
    ]);
    ws.close();
  });

  it("returns a mutation failure when an existing-root partitionKey is missing", async () => {
    const harness = await createSyncHarness([]);
    harnesses.push(harness);
    await activateDeployment(harness, "sync-mutation-failure-deployment");

    const ws = await openSync(harness, "sync-mutation-failure-deployment");
    const response = nextJsonMessage(ws);
    ws.send(JSON.stringify({
      type: "Mutation",
      requestId: 22,
      udfPath: "users:update",
      args: [{ userId: "1:ada", name: "Grace" }],
    }));

    await expect(response).resolves.toEqual({
      type: "MutationResponse",
      requestId: 22,
      success: false,
      result: "Mutation.partitionKey is required until Flarex routing inference is implemented.",
      logLines: [],
    });
    ws.close();
  });

  it("executes sync mutations sequentially per connection", async () => {
    let releaseFirst!: () => void;
    const firstMutationGate = new Promise<void>(resolve => {
      releaseFirst = resolve;
    });
    const mutationOrder: number[] = [];
    const harness = await createSyncHarness([], async payload => {
      if (payload.request.kind !== "mutation") return null;
      const requestId = (payload.request.args as { requestId: number }).requestId;
      mutationOrder.push(requestId);
      if (requestId === 1) await firstMutationGate;
      return { requestId };
    });
    harnesses.push(harness);
    await activateDeployment(harness, "sync-mutation-queue-deployment");

    const ws = await openSync(harness, "sync-mutation-queue-deployment");
    const messages = collectJsonMessages(ws, 2);
    ws.send(JSON.stringify({
      type: "Mutation",
      requestId: 1,
      udfPath: "users:update",
      args: [{ requestId: 1 }],
      partitionKey: "user:ada",
    }));
    ws.send(JSON.stringify({
      type: "Mutation",
      requestId: 2,
      udfPath: "users:update",
      args: [{ requestId: 2 }],
      partitionKey: "user:ada",
    }));
    await waitFor(() => mutationOrder.length === 1);
    releaseFirst();

    await expect(messages).resolves.toEqual([
      expect.objectContaining({ type: "MutationResponse", requestId: 1 }),
      expect.objectContaining({ type: "MutationResponse", requestId: 2 }),
    ]);
    expect(mutationOrder).toEqual([1, 2]);
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

  it("fails closed when executor query responses include read sets without read timestamps", async () => {
    const harness = await createSyncHarness(
      [],
      undefined,
      async () => ({
        value: { user: "Ada" },
        readSet: { documents: [{ tableId: 1, id: "1:ada" }] },
      }),
    );
    harnesses.push(harness);
    await activateDeployment(harness, "sync-query-readts-failure-deployment");

    const ws = await openSync(harness, "sync-query-readts-failure-deployment");
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
          partitionKey: "user:ada",
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
          errorMessage: "Query response with readSet must include readTs.",
          logLines: [],
          errorData: null,
          journal: null,
        },
      ],
    });
    ws.close();
  });

  it("fails closed when query reruns omit read metadata after a prior registration", async () => {
    let invocationCount = 0;
    const deploymentId = "sync-query-readset-rerun-failure-deployment";
    const harness = await createSyncHarness(
      [],
      undefined,
      async () => {
        invocationCount += 1;
        if (invocationCount === 1) {
          return {
            value: { user: "Ada" },
            readSet: { documents: [{ tableId: 1, id: "1:ada" }] },
            readTs: 3,
          };
        }
        return { value: { user: "Grace" } };
      },
    );
    harnesses.push(harness);
    await activateDeployment(harness, deploymentId);

    const ws = await openSync(harness, deploymentId, "query-readset-rerun-failure-session");
    ws.send(JSON.stringify({
      type: "ModifyQuerySet",
      baseVersion: 0,
      newVersion: 1,
      modifications: [
        {
          type: "Add",
          queryId: 2,
          udfPath: "users:get",
          args: [{ id: "1:ada" }],
          partitionKey: "user:ada",
        },
      ],
    }));
    await expect(nextJsonMessage(ws)).resolves.toMatchObject({
      type: "Transition",
      modifications: [{ type: "QueryUpdated", queryId: 2, value: { user: "Ada" } }],
    });

    const env = await harness.mf.getBindings<Env>();
    const connection = env.CONNECTIONS.getByName(
      `connection:${deploymentId}:query-readset-rerun-failure-session`,
    );
    const transition = nextJsonMessage(ws);
    const invalidation = await connection.fetch("https://flarex.internal/invalidate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ queryId: 2, invalidatedTs: 4 }),
    });

    expect(invalidation.status).toBe(200);
    await expect(invalidation.json()).resolves.toEqual({ invalidated: true });
    await expect(transition).resolves.toMatchObject({
      type: "Transition",
      startVersion: { querySet: 1, ts: 3, identity: 0 },
      endVersion: { querySet: 1, ts: 4, identity: 0 },
      modifications: [
        {
          type: "QueryFailed",
          queryId: 2,
          errorMessage: "Query response must include readSet.",
          logLines: [],
          errorData: null,
          journal: null,
        },
      ],
    });
    expect(invocationCount).toBe(2);
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
  valueForRequest: (payload: {
    request: {
      path: string;
      kind?: "query" | "mutation";
      args: unknown;
      partitionKey?: string;
    };
  }) => Json | Promise<Json> =
    payload => ({
      result: payload.request.path,
      args: payload.request.args as Json,
    }),
  responseForRequest?: (payload: {
    request: {
      path: string;
      kind?: "query" | "mutation";
      args: unknown;
      partitionKey?: string;
    };
  }) => InvokeResponse | Promise<InvokeResponse>,
  options: BackendHarnessOptions = {},
): Promise<BackendHarness> {
  return createBackendHarness({
    bindings: {
      FLAREX_ARTIFACT_RUNTIME_TOKEN: "sync-secret",
      FLAREX_PROJECT_ID: "project_sync",
      ...options.bindings,
    },
    r2Buckets: ["ARTIFACTS"],
    serviceBindings: {
      FLAREX_ARTIFACT_RUNTIME: createExecutionArtifactRuntimeService({
        capabilityToken: "sync-secret",
        materializer: {
          materialize: async () => ({
            invoke: async payload => {
              runtimeCalls.push(payload);
              if (responseForRequest !== undefined) {
                return responseForRequest(payload);
              }
              return {
                value: await valueForRequest(payload),
                readSet: { documents: [{ tableId: 1, id: "1:ada" }] },
                readTs: 3,
              };
            },
          }),
        },
      }),
      ...options.serviceBindings,
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
  sessionId?: string,
): Promise<MiniflareWebSocket> {
  const headers: Record<string, string> = { Upgrade: "websocket" };
  if (sessionId !== undefined) headers["x-flarex-session"] = sessionId;
  const response = await harness.mf.dispatchFetch(
    `http://flarex.test/deployments/${deploymentId}/sync`,
    { headers },
  );
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  expect(ws).toBeDefined();
  ws!.accept();
  return ws! as unknown as MiniflareWebSocket;
}

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("Timed out waiting for condition.");
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}

function deploymentScanCursorDeploymentId(value: unknown): string | undefined {
  const cursor = jsonRecord(value).cursor;
  if (cursor === undefined) return undefined;
  const deploymentId = jsonRecord(cursor).deploymentId;
  if (typeof deploymentId === "string") return deploymentId;
  return undefined;
}

function cleanupDeploymentId(value: unknown): string | undefined {
  const deploymentId = jsonRecord(value).deploymentId;
  if (typeof deploymentId === "string") return deploymentId;
  return undefined;
}

function isSkippedResponse(value: unknown): boolean {
  return jsonRecord(value).skipped === true;
}

function deliveryDrainSkipped(value: unknown): boolean {
  const record = jsonRecord(value);
  return record.delivered === 0 && record.skipped === 1;
}

function jsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  throw new Error("Expected JSON object.");
}

function nextJsonMessage(ws: MiniflareWebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message.")), 5000);
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

function nextClose(ws: MiniflareWebSocket): Promise<{ code?: number; reason?: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket close.")), 5000);
    ws.addEventListener("close", event => {
      clearTimeout(timeout);
      resolve(event);
    }, { once: true });
    ws.addEventListener("error", event => {
      clearTimeout(timeout);
      reject(event);
    }, { once: true });
  });
}

function collectJsonMessages(ws: MiniflareWebSocket, count: number): Promise<unknown[]> {
  return new Promise((resolve, reject) => {
    const messages: unknown[] = [];
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket messages.")), 5000);
    ws.addEventListener("message", event => {
      messages.push(JSON.parse(String(event.data)));
      if (messages.length === count) {
        clearTimeout(timeout);
        resolve(messages);
      }
    });
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
  const finish = await response.json() as FinishPushResponse;
  expect(finish.result).toBe("activated");
  return finish.push;
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
        {
          path: "users:create",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              name: { fieldType: { type: "string" }, optional: false },
            },
          },
          returns: null,
          partition: {
            type: "partitionCreateRoot",
            table: "users",
            partitionField: "_id",
          },
        },
        {
          path: "users:update",
          kind: "mutation",
          args: {
            type: "object",
            value: {
              userId: { fieldType: { type: "id", tableName: "users" }, optional: false },
              name: { fieldType: { type: "string" }, optional: false },
            },
          },
          returns: null,
          partition: {
            type: "partition",
            table: "users",
            selector: "byId",
            partitionField: "_id",
            argField: "userId",
          },
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

function deliveryMaintenanceRequests(
  requests: Array<{ path: string; authorization: string | null; body: unknown }>,
): Array<{ path: string; authorization: string | null; body: unknown }> {
  return requests.filter(
    request =>
      request.path === "/maintenance/live-queries/claim" ||
      request.path === "/maintenance/live-queries/ack",
  );
}
