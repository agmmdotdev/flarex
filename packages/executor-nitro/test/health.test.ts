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
import { createFlarexNitroHandler } from "../src/index";
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
