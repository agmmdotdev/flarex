import { describe, expect, it } from "vitest";

import {
  DeploymentNotFoundError,
  DeploymentPackageNotActivatedError,
  DeploymentProjectMismatchError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
  PartitionValidationError,
  createFlarexExecutor,
  type PrepareInvokeInput,
} from "@flarex/executor";

import type { RunLiveQuerySubscriptionWithInvokeInput } from "@flarex/executor";
import {
  createFlarexBackendLiveQueryTriggerNotifier,
  createFlarexNitroHandler,
} from "../src/index";
import {
  expectPrepareError,
  fakeExecutor,
  healthyPersistence,
  jsonRequest,
  preparedInvokeResult,
  testFreshnessStore,
} from "./helpers";

describe("createFlarexNitroHandler", () => {
  it("maps health requests to the executor core", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
        persistence: healthyPersistence(),
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/health"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "executor",
      status: "ok",
      persistence: { status: "ok" },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("returns a JSON 404 for unknown adapter routes", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        persistence: healthyPersistence(),
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/unknown"),
    });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "No Flarex executor adapter route for GET /unknown",
    });
  });

  it("serializes degraded executor health without failing the route", async () => {
    const handler = createFlarexNitroHandler({
      executor: createFlarexExecutor({
        clock: { now: () => new Date("2026-06-19T00:00:00.000Z") },
        persistence: {
          ...healthyPersistence(),
          async check() {
            throw new Error("database unavailable");
          },
        },
      }),
    });

    const response = await handler({
      request: new Request("https://executor.test/health"),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "executor",
      status: "degraded",
      persistence: {
        status: "error",
        message: "database unavailable",
      },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("maps invoke prepare requests to the executor core", async () => {
    const calls: PrepareInvokeInput[] = [];
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor({
        async prepareInvoke(input) {
          calls.push(input);
          return preparedInvokeResult({
            deploymentId: input.deploymentId,
            packageId: "package_active",
            path: input.path,
            kind: input.kind ?? "query",
            schemaVersion: 12,
            executionModule: "_flarex/execution.js",
          });
        },
      }),
    });

    const response = await handler({
      request: jsonRequest("https://executor.test/invoke/prepare", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      deploymentId: "deployment_active",
      packageId: "package_active",
      path: "messages:list",
      kind: "query",
      schemaVersion: 12,
      scope: {
        kind: "partition",
        table: "teams",
        selector: "byId",
        partitionField: "_id",
        argField: "teamId",
        partitionKey: "team:1",
      },
      executionModule: "_flarex/execution.js",
    });
  });

  it("maps live query rerun maintenance requests through the Nitro handler", async () => {
    const freshnessStore = testFreshnessStore();
    const executeQuery: RunLiveQuerySubscriptionWithInvokeInput["executeQuery"] =
      async () => null;
    const calls: Array<{ deploymentId: string; projectId?: string }> = [];
    const rerunCalls: Array<{ deploymentId: string; limit?: number }> = [];
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor({
        async rerunStaleLiveQuerySubscriptions(input) {
          rerunCalls.push({
            deploymentId: input.deploymentId,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          });
          expect(input.freshnessStore).toBe(freshnessStore);
          await input.runQuery({
            deploymentId: "deployment_active",
            connectionId: "connection_a",
            queryId: 1,
            functionPath: "messages:list",
            argsJson: { teamId: "team_a" },
            partitionKey: "team_a",
            beginTs: 10,
            readSetJson: {},
            resultJson: null,
            resultHash: "null",
            createdAt: new Date("2026-06-19T00:00:00.000Z"),
            updatedAt: new Date("2026-06-19T00:00:00.000Z"),
          });
          return {
            scanned: { fresh: [], stale: [], unsupported: [] },
            changed: [],
            unchanged: [],
            changes: [],
            unsupported: [],
            hasMoreStale: false,
          };
        },
        async runLiveQuerySubscriptionWithInvoke(input) {
          calls.push({
            deploymentId: input.subscription.deploymentId,
            ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          });
          expect(input.executeQuery).toBe(executeQuery);
          return { value: null, beginTs: 1, readSet: {} };
        },
      }),
      liveQueryRerun: {
        freshnessStore,
        executeQuery,
      },
    });

    const response = await handler({
      request: jsonRequest(
        "https://executor.test/maintenance/live-queries/rerun",
        {
          deploymentId: "deployment_active",
          projectId: "project_active",
          limit: 3,
        },
      ),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      { deploymentId: "deployment_active", projectId: "project_active" },
    ]);
    expect(rerunCalls).toEqual([{ deploymentId: "deployment_active", limit: 3 }]);
    await expect(response.json()).resolves.toEqual({
      scanned: { fresh: [], stale: [], unsupported: [] },
      changed: [],
      unchanged: [],
      changes: [],
      unsupported: [],
      hasMoreStale: false,
    });
  });

  it("maps live query delivery maintenance requests through the Nitro handler", async () => {
    const delivered: unknown[] = [];
    const calls: Array<{ deploymentId: string; limit?: number }> = [];
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor({
        async runLiveQueryDeliveryBatch(input) {
          calls.push({
            deploymentId: input.deploymentId,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
          });
          await input.deliver([
            {
              deploymentId: "deployment_active",
              deliveryId: "delivery_1",
              connectionId: "connection_a",
              queryId: 1,
              payloadJson: {
                deploymentId: "deployment_active",
                connectionId: "connection_a",
                queryId: 1,
                resultJson: ["fresh"],
              },
              deliveredAt: null,
              attemptCount: 0,
              lastAttemptedAt: null,
              lastErrorStage: null,
              lastError: null,
              deadLetteredAt: null,
              deadLetterReason: null,
              createdAt: new Date("2026-06-21T00:00:00.000Z"),
            },
          ]);
          return {
            deliveries: [],
            delivered: 1,
            nextCursor: null,
            hasMore: false,
          };
        },
      }),
      liveQueryDelivery: {
        deliver: async deliveries => {
          delivered.push(...deliveries.map((delivery) => delivery.payloadJson));
        },
      },
    });

    const response = await handler({
      request: jsonRequest(
        "https://executor.test/maintenance/live-queries/deliver",
        {
          deploymentId: "deployment_active",
          limit: 2,
        },
      ),
    });

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ deploymentId: "deployment_active", limit: 2 }]);
    expect(delivered).toEqual([
      {
        deploymentId: "deployment_active",
        connectionId: "connection_a",
        queryId: 1,
        resultJson: ["fresh"],
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      deliveries: [],
      delivered: 1,
      nextCursor: null,
      hasMore: false,
    });
  });

  it("exports the backend live query trigger notifier for Nitro hosts", async () => {
    const requests: Array<{
      url: string;
      authorization: string | null;
      body: unknown;
    }> = [];
    const notifyTrigger = createFlarexBackendLiveQueryTriggerNotifier({
      backendUrl: "https://backend.test/base",
      capabilityToken: "delivery-token",
      limit: 4,
      deliveryLimit: 8,
      maxBatches: 2,
      fetch: async (request, init) => {
        const url = request instanceof Request ? request.url : String(request);
        const headers = new Headers(init?.headers);
        requests.push({
          url,
          authorization: headers.get("authorization"),
          body: init?.body === undefined ? null : JSON.parse(String(init.body)),
        });
        return Response.json({ ok: true });
      },
    });

    await notifyTrigger({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      functionPath: "messages:send",
      committedTs: 101,
      writes: [],
    });

    expect(requests).toEqual([
      {
        url: "https://backend.test/base/scheduler/live-query-subscriptions/trigger",
        authorization: "Bearer delivery-token",
        body: {
          deploymentId: "deployment_active",
          projectId: "project_active",
          limit: 4,
          deliveryLimit: 8,
          maxBatches: 2,
        },
      },
    ]);
  });

  it("maps live query delivery claim and ack through the Nitro handler", async () => {
    const calls: unknown[] = [];
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor({
        async claimLiveQueryDeliveryBatch(input) {
          calls.push({ type: "claim", input });
          return { deliveries: [], nextCursor: null, hasMore: false };
        },
        async ackLiveQueryDeliveries(input) {
          calls.push({ type: "ack", input });
          return { delivered: input.deliveryIds.length };
        },
      }),
    });

    const claim = await handler({
      request: jsonRequest(
        "https://executor.test/maintenance/live-queries/claim",
        {
          deploymentId: "deployment_active",
          limit: 2,
        },
      ),
    });
    const ack = await handler({
      request: jsonRequest(
        "https://executor.test/maintenance/live-queries/ack",
        {
          deploymentId: "deployment_active",
          deliveryIds: ["delivery_1"],
        },
      ),
    });

    expect(claim.status).toBe(200);
    await expect(claim.json()).resolves.toEqual({
      deliveries: [],
      nextCursor: null,
      hasMore: false,
    });
    expect(ack.status).toBe(200);
    await expect(ack.json()).resolves.toEqual({ delivered: 1 });
    expect(calls).toEqual([
      { type: "claim", input: { deploymentId: "deployment_active", limit: 2 } },
      {
        type: "ack",
        input: {
          deploymentId: "deployment_active",
          deliveryIds: ["delivery_1"],
        },
      },
    ]);
  });

  it("rejects malformed invoke prepare JSON", async () => {
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor(),
    });

    const response = await handler({
      request: new Request("https://executor.test/invoke/prepare", {
        method: "POST",
        body: "{",
      }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "Request body must be valid JSON.",
    });
  });

  it("validates invoke prepare request fields before calling the executor", async () => {
    let called = false;
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor({
        async prepareInvoke() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await handler({
      request: jsonRequest("https://executor.test/invoke/prepare", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "action",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    });

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "kind must be query or mutation.",
    });
  });

  it("validates invoke prepare args before calling the executor", async () => {
    let called = false;
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor({
        async prepareInvoke() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await handler({
      request: jsonRequest("https://executor.test/invoke/prepare", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
      }),
    });

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "args must be a JSON value.",
    });
  });

  it("rejects non-POST invoke prepare requests", async () => {
    const handler = createFlarexNitroHandler({
      executor: fakeExecutor(),
    });

    const response = await handler({
      request: new Request("https://executor.test/invoke/prepare"),
    });

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/invoke/prepare only supports POST",
    });
  });

  it("maps executor not found errors to 404", async () => {
    await expect(
      expectPrepareError(new DeploymentNotFoundError("deployment_missing")),
    ).resolves.toMatchObject({
      status: 404,
      body: {
        error: "DeploymentNotFoundError",
      },
    });

    await expect(
      expectPrepareError(
        new FunctionNotFoundError("deployment_active", "messages:missing"),
      ),
    ).resolves.toMatchObject({
      status: 404,
      body: {
        error: "FunctionNotFoundError",
      },
    });
  });

  it("maps executor project mismatch errors to 403", async () => {
    await expect(
      expectPrepareError(
        new DeploymentProjectMismatchError(
          "deployment_active",
          "project_requested",
          "project_actual",
        ),
      ),
    ).resolves.toMatchObject({
      status: 403,
      body: {
        error: "DeploymentProjectMismatchError",
      },
    });
  });

  it("maps executor bad invoke shape errors to 400", async () => {
    await expect(
      expectPrepareError(
        new FunctionKindMismatchError(
          "deployment_active",
          "messages:list",
          "mutation",
          "query",
        ),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: "FunctionKindMismatchError",
      },
    });

    await expect(
      expectPrepareError(
        new FunctionNotInvokableError(
          "deployment_active",
          "messages:archive",
          "action",
        ),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: "FunctionNotInvokableError",
      },
    });

    await expect(
      expectPrepareError(
        new PartitionValidationError(
          "partitionKey must match args.teamId for messages:list.",
        ),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: {
        error: "PartitionValidationError",
      },
    });
  });

  it("maps inactive deployment errors to 409", async () => {
    await expect(
      expectPrepareError(
        new DeploymentPackageNotActivatedError("deployment_active"),
      ),
    ).resolves.toMatchObject({
      status: 409,
      body: {
        error: "DeploymentPackageNotActivatedError",
      },
    });
  });
});
