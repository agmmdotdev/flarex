import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import {
  DeploymentNotFoundError,
  DeploymentPackageNotActivatedError,
  DeploymentProjectMismatchError,
  FlarexDocumentIdFormatError,
  FlarexInsertIdTableMismatchError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
  FunctionVisibilityMismatchError,
  InvokeFinishNotImplementedError,
  InvokeSessionNotFoundError,
  InvokeSessionDocumentWriteAlreadyExistsError,
  InvokeSessionInsertConflictError,
  InvokeSessionOccConflictError,
  InvokeSyscallNotImplementedError,
  LiveQuerySubscriptionRerunError,
  LiveQueryDeliveryPolicyError,
  PartitionValidationError,
  type FlarexExecutor,
  type AbortInvokeSessionInput,
  type AbortStaleInvokeSessionsInput,
  type BeginInvokeSessionInput,
  type BeginInvokeSessionResult,
  type FinishInvokeSessionInput,
  type InvokeSyscallInput,
  type InvokeSyscallResult,
  type PrepareInvokeInput,
  type PrepareInvokeResult,
  type RunInvokeSessionMaintenanceInput,
  type RerunStaleLiveQuerySubscriptionsInput,
  type RunLiveQueryDeliveryBatchInput,
  type RunInvokeWithRetriesInput,
  type RunInvokeWithRetriesResult,
  type RunMutationInvokeWithRetriesInput,
  type RunMutationInvokeWithRetriesResult,
  type RunQueryInvokeWithRetriesInput,
  type RunQueryInvokeWithRetriesResult,
  type RunLiveQuerySubscriptionWithInvokeInput,
} from "@flarex/executor";

import {
  createFlarexBackendLiveQueryDelivery,
  createFlarexBackendLiveQueryTriggerNotifier,
  createFlarexBackendLiveQueryWakeNotifier,
  createFlarexHttpApp,
  decodeBeginInvokeSessionBody,
  decodeInvokeAbortBody,
  decodeInvokeAbortStaleBody,
  decodeInvokeFinishBody,
  decodeInvokeSessionMaintenanceBody,
  decodeInvokeSyscallBody,
  decodeLiveQueryAckMaintenanceBody,
  decodeLiveQueryClaimMaintenanceBody,
  decodeLiveQueryConnectionCleanupBody,
  decodeLiveQueryConnectionTouchBody,
  decodeLiveQueryDeadLetterMaintenanceBody,
  decodeLiveQueryDeadLetterStuckMaintenanceBody,
  decodeLiveQueryDeliveryMaintenanceBody,
  decodeLiveQueryExpiredConnectionDeploymentsMaintenanceBody,
  decodeLiveQueryFailureMaintenanceBody,
  decodeLiveQueryPendingDeploymentsMaintenanceBody,
  decodeLiveQueryRerunMaintenanceBody,
  decodeLiveQueryStuckDeliveriesMaintenanceBody,
  decodeLiveQuerySubscriptionRecordBody,
  decodeLiveQuerySubscriptionRemoveBody,
  decodeLiveQuerySubscriptionRemoveConnectionBody,
  decodePrepareInvokeBody,
  deliverFlarexBackendLiveQueryEffect,
  ExecutorHttpBodyValidationError,
  FlarexBackendLiveQueryFetchError,
  FlarexBackendLiveQueryResponseError,
  notifyFlarexBackendLiveQueryTriggerEffect,
  notifyFlarexBackendLiveQueryWakeEffect,
} from "../src";

describe("executor HTTP invoke body decoders", () => {
  it("decodes invoke lifecycle bodies through typed Effect boundaries", async () => {
    await expect(Effect.runPromise(decodePrepareInvokeBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      path: "messages:list",
      kind: "query",
      visibility: "public",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      path: "messages:list",
      kind: "query",
      visibility: "public",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    });

    await expect(Effect.runPromise(decodeBeginInvokeSessionBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      path: "messages:list",
      kind: "mutation",
      args: null,
      idempotencyKey: "idem_1",
      identity: {
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user_1",
          subject: "user_1",
          issuer: "issuer",
        },
      },
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      path: "messages:list",
      kind: "mutation",
      args: null,
      idempotencyKey: "idem_1",
      identity: {
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user_1",
          subject: "user_1",
          issuer: "issuer",
        },
      },
    });

    await expect(Effect.runPromise(decodeBeginInvokeSessionBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      path: "messages:list",
      kind: "mutation",
      args: null,
      identity: { kind: "user" },
    }))).rejects.toMatchObject({
      body: {
        error: "bad_request",
        message: "Execution identity must be anonymous or include a valid user identity.",
      },
    });

    await expect(Effect.runPromise(decodeInvokeSyscallBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      op: "replace",
      id: "1:message",
      value: { text: "updated" },
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      syscall: {
        op: "replace",
        id: "1:message",
        value: { text: "updated" },
      },
    });

    await expect(Effect.runPromise(decodeInvokeFinishBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      value: { ok: true },
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      value: { ok: true },
    });

    await expect(Effect.runPromise(decodeInvokeAbortBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
    });

    await expect(Effect.runPromise(decodeInvokeAbortStaleBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      olderThan: "2026-06-20T00:00:00.000Z",
      maxSessions: 10,
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      olderThan: new Date("2026-06-20T00:00:00.000Z"),
      limit: 10,
    });

    await expect(Effect.runPromise(decodeInvokeSessionMaintenanceBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      staleAfterMs: 60000,
      maxSessions: 10,
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      staleAfterMs: 60000,
      maxSessions: 10,
    });
  });

  it("returns typed invoke body validation failures", async () => {
    const failure = await Effect.runPromise(
      decodeInvokeFinishBody({
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        value: undefined,
      }).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(ExecutorHttpBodyValidationError);
    expect(failure.body).toEqual({
      error: "bad_request",
      message: "value must be a JSON value.",
    });
  });
});

describe("executor HTTP live query body decoders", () => {
  it("decodes live query and maintenance bodies through typed Effect boundaries", async () => {
    await expect(Effect.runPromise(decodeLiveQueryRerunMaintenanceBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      limit: 2,
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      limit: 2,
    });

    await expect(Effect.runPromise(decodeLiveQueryDeliveryMaintenanceBody({
      deploymentId: "deployment_active",
      limit: 5,
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      limit: 5,
    });

    await expect(Effect.runPromise(decodeLiveQuerySubscriptionRecordBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      connectionId: "connection_a",
      queryId: 7,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: null,
      beginTs: 12,
      readSet: { documents: [{ tableId: 1, id: "1:message", observedTs: 12 }] },
      resultJson: ["fresh"],
      updatedAt: "2026-06-21T00:00:00.000Z",
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      connectionId: "connection_a",
      queryId: 7,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: null,
      beginTs: 12,
      readSet: { documents: [{ tableId: 1, id: "1:message", observedTs: 12 }] },
      resultJson: ["fresh"],
      updatedAt: new Date("2026-06-21T00:00:00.000Z"),
    });

    await expect(Effect.runPromise(decodeLiveQuerySubscriptionRemoveBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      connectionId: "connection_a",
      queryId: 7,
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      connectionId: "connection_a",
      queryId: 7,
    });

    await expect(Effect.runPromise(decodeLiveQueryConnectionTouchBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      connectionId: "connection_a",
      leaseDurationMs: 45000,
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      connectionId: "connection_a",
      leaseDurationMs: 45000,
    });

    await expect(Effect.runPromise(decodeLiveQuerySubscriptionRemoveConnectionBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      connectionId: "connection_a",
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      connectionId: "connection_a",
    });

    await expect(Effect.runPromise(decodeLiveQueryConnectionCleanupBody({
      deploymentId: "deployment_active",
      projectId: "project_active",
      expiredAt: "2026-06-23T00:02:00.000Z",
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      expiredAt: new Date("2026-06-23T00:02:00.000Z"),
    });

    await expect(Effect.runPromise(decodeLiveQueryClaimMaintenanceBody({
      deploymentId: "deployment_active",
      limit: 2,
      leaseDurationMs: 30000,
      claimOwner: "delivery-worker",
      cursor: {
        createdAt: "2026-06-21T00:00:00.000Z",
        deliveryId: "delivery_1",
      },
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      limit: 2,
      leaseDurationMs: 30000,
      claimOwner: "delivery-worker",
      cursor: {
        createdAt: new Date("2026-06-21T00:00:00.000Z"),
        deliveryId: "delivery_1",
      },
    });

    await expect(Effect.runPromise(decodeLiveQueryAckMaintenanceBody({
      deploymentId: "deployment_active",
      deliveryIds: ["delivery_1"],
      deliveredAt: "2026-06-21T00:00:01.000Z",
      claimOwner: "delivery-worker",
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      deliveryIds: ["delivery_1"],
      deliveredAt: new Date("2026-06-21T00:00:01.000Z"),
      claimOwner: "delivery-worker",
    });

    await expect(Effect.runPromise(decodeLiveQueryFailureMaintenanceBody({
      deploymentId: "deployment_active",
      deliveryIds: ["delivery_1"],
      stage: "fanout",
      error: "ConnectionDO failed",
      failedAt: "2026-06-21T00:00:02.000Z",
    }))).resolves.toEqual({
      deploymentId: "deployment_active",
      deliveryIds: ["delivery_1"],
      stage: "fanout",
      error: "ConnectionDO failed",
      failedAt: new Date("2026-06-21T00:00:02.000Z"),
    });

    await expect(Effect.runPromise(decodeLiveQueryDeadLetterMaintenanceBody({
      deploymentId: "deployment_dead",
      deliveryIds: ["delivery_dead"],
      reason: "force reconnect",
      deadLetteredAt: "2026-06-21T00:10:00.000Z",
    }))).resolves.toEqual({
      deploymentId: "deployment_dead",
      deliveryIds: ["delivery_dead"],
      reason: "force reconnect",
      deadLetteredAt: new Date("2026-06-21T00:10:00.000Z"),
    });

    await expect(Effect.runPromise(decodeLiveQueryDeadLetterStuckMaintenanceBody({
      deploymentId: "deployment_stuck",
      olderThan: "2026-06-21T00:05:00.000Z",
      minAttempts: 3,
      limit: 10,
      reason: "force reconnect",
      deadLetteredAt: "2026-06-21T00:10:00.000Z",
      cursor: {
        lastAttemptedAt: "2026-06-20T00:00:00.000Z",
        deploymentId: "deployment_before",
        deliveryId: "delivery_before",
      },
    }))).resolves.toEqual({
      deploymentId: "deployment_stuck",
      olderThan: new Date("2026-06-21T00:05:00.000Z"),
      minAttempts: 3,
      limit: 10,
      reason: "force reconnect",
      deadLetteredAt: new Date("2026-06-21T00:10:00.000Z"),
      cursor: {
        lastAttemptedAt: new Date("2026-06-20T00:00:00.000Z"),
        deploymentId: "deployment_before",
        deliveryId: "delivery_before",
      },
    });

    await expect(Effect.runPromise(decodeLiveQueryPendingDeploymentsMaintenanceBody({
      limit: 2,
      cursor: {
        oldestCreatedAt: "2026-06-20T00:00:00.000Z",
        deploymentId: "deployment_before",
      },
    }))).resolves.toEqual({
      limit: 2,
      cursor: {
        oldestCreatedAt: new Date("2026-06-20T00:00:00.000Z"),
        deploymentId: "deployment_before",
      },
    });

    await expect(Effect.runPromise(decodeLiveQueryExpiredConnectionDeploymentsMaintenanceBody({
      expiredAt: "2026-06-23T00:02:00.000Z",
      limit: 5,
      cursor: {
        oldestExpiredAt: "2026-06-23T00:00:00.000Z",
        deploymentId: "deployment_before",
      },
    }))).resolves.toEqual({
      expiredAt: new Date("2026-06-23T00:02:00.000Z"),
      limit: 5,
      cursor: {
        oldestExpiredAt: new Date("2026-06-23T00:00:00.000Z"),
        deploymentId: "deployment_before",
      },
    });

    await expect(Effect.runPromise(decodeLiveQueryStuckDeliveriesMaintenanceBody({
      deploymentId: "deployment_stuck",
      olderThan: "2026-06-21T00:05:00.000Z",
      minAttempts: 2,
      limit: 1,
      cursor: {
        lastAttemptedAt: "2026-06-20T00:00:00.000Z",
        deploymentId: "deployment_before",
        deliveryId: "delivery_before",
      },
    }))).resolves.toEqual({
      deploymentId: "deployment_stuck",
      olderThan: new Date("2026-06-21T00:05:00.000Z"),
      minAttempts: 2,
      limit: 1,
      cursor: {
        lastAttemptedAt: new Date("2026-06-20T00:00:00.000Z"),
        deploymentId: "deployment_before",
        deliveryId: "delivery_before",
      },
    });
  });

  it("returns typed live query body validation failures", async () => {
    const failure = await Effect.runPromise(
      decodeLiveQueryClaimMaintenanceBody({
        deploymentId: "deployment_active",
        limit: 0,
      }).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(ExecutorHttpBodyValidationError);
    expect(failure.body).toEqual({
      error: "bad_request",
      message: "limit must be a positive integer.",
    });
  });
});

describe("createFlarexHttpApp", () => {
  it("maps health requests to the executor core", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async health() {
          return {
            service: "executor",
            status: "ok",
            persistence: { status: "ok" },
            time: "2026-06-19T00:00:00.000Z",
          };
        },
      }),
    });

    const response = await app.handle(new Request("https://executor.test/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      service: "executor",
      status: "ok",
      persistence: { status: "ok" },
      time: "2026-06-19T00:00:00.000Z",
    });
  });

  it("maps invoke prepare requests to the executor core", async () => {
    const calls: PrepareInvokeInput[] = [];
    const app = createFlarexHttpApp({
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

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/prepare", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        visibility: "internal",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        visibility: "internal",
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

  it("rejects malformed invoke prepare JSON before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async prepareInvoke() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      new Request("https://executor.test/invoke/prepare", {
        method: "POST",
        body: "{",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "Request body must be valid JSON.",
    });
  });

  it("validates invoke prepare request fields before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async prepareInvoke() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/prepare", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "action",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "kind must be query or mutation.",
    });
  });

  it("rejects non-POST invoke prepare requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/invoke/prepare"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/invoke/prepare only supports POST",
    });
  });

  it("maps invoke start requests to the executor core", async () => {
    const calls: BeginInvokeSessionInput[] = [];
    const app = createFlarexHttpApp({
      capabilityToken: "executor-secret",
      executor: fakeExecutor({
        async beginInvokeSession(input) {
          calls.push(input);
          return beginInvokeSessionResult({
            sessionId: "session_active",
            beginTs: 1781913600123,
            path: input.path,
            kind: input.kind ?? "query",
            schemaVersion: 12,
            executionModule: "_flarex/execution.js",
          });
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/start", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
        idempotencyKey: "idem_1",
        identity: {
          kind: "user",
          user: {
            tokenIdentifier: "issuer|user_1",
            subject: "user_1",
            issuer: "issuer",
          },
        },
      }, { authorization: "Bearer executor-secret" }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
        idempotencyKey: "idem_1",
        identity: {
          kind: "user",
          user: {
            tokenIdentifier: "issuer|user_1",
            subject: "user_1",
            issuer: "issuer",
          },
        },
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      sessionId: "session_active",
      beginTs: 1781913600123,
      identity: { kind: "anonymous" },
      schemaVersion: 12,
      function: {
        path: "messages:list",
        kind: "query",
      },
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

  it("rejects identity-bearing invoke start requests without a configured capability token", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async beginInvokeSession() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/start", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        identity: {
          kind: "user",
          user: {
            tokenIdentifier: "issuer|user_1",
            subject: "user_1",
            issuer: "issuer",
          },
        },
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "trusted_identity_requires_capability_token",
      message:
        "Execution identity on executor start requires a configured capability token.",
    });
  });

  it("requires the configured capability token for invoke routes", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      capabilityToken: "executor-secret",
      executor: fakeExecutor({
        async beginInvokeSession(input) {
          called = true;
          return beginInvokeSessionResult({
            sessionId: "session_authorized",
            beginTs: 1781913600123,
            path: input.path,
            kind: input.kind ?? "query",
            schemaVersion: 12,
            executionModule: "_flarex/execution.js",
          });
        },
      }),
    });

    const unauthorized = await app.handle(
      jsonRequest("https://executor.test/invoke/start", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    );
    expect(called).toBe(false);
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Unauthorized Flarex executor request.",
    });

    const authorized = await app.handle(
      jsonRequest(
        "https://executor.test/invoke/start",
        {
          deploymentId: "deployment_active",
          projectId: "project_active",
          path: "messages:list",
          kind: "query",
          args: { teamId: "team:1" },
          partitionKey: "team:1",
        },
        { authorization: "Bearer executor-secret" },
      ),
    );
    expect(authorized.status).toBe(200);
  });

  it("rejects unauthorized invoke requests before parsing malformed JSON", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      capabilityToken: "executor-secret",
      executor: fakeExecutor({
        async beginInvokeSession() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      new Request("https://executor.test/invoke/start", {
        method: "POST",
        body: "{",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Unauthorized Flarex executor request.",
    });
  });

  it("rejects unauthorized live query maintenance before config and body parsing", async () => {
    const app = createFlarexHttpApp({
      capabilityToken: "executor-secret",
      executor: fakeExecutor(),
    });

    const rerun = await app.handle(
      new Request("https://executor.test/maintenance/live-queries/rerun", {
        method: "POST",
        body: "{",
      }),
    );
    const delivery = await app.handle(
      new Request("https://executor.test/maintenance/live-queries/deliver", {
        method: "POST",
        body: "{",
      }),
    );

    expect(rerun.status).toBe(401);
    await expect(rerun.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Unauthorized Flarex executor request.",
    });
    expect(delivery.status).toBe(401);
    await expect(delivery.json()).resolves.toEqual({
      error: "unauthorized",
      message: "Unauthorized Flarex executor request.",
    });
  });

  it("validates invoke start idempotency keys before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async beginInvokeSession() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/start", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
        idempotencyKey: "",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "idempotencyKey must be a non-empty string.",
    });
  });

  it("rejects non-POST invoke start requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/invoke/start"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/invoke/start only supports POST",
    });
  });

  it("maps invoke syscall requests to the executor core", async () => {
    const calls: InvokeSyscallInput[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async invokeSyscall(input) {
          calls.push(input);
          return {
            value: { _id: input.syscall.op === "get" ? "1:message" : null },
            readSet: { documents: [{ tableId: 1, id: "1:message" }] },
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/syscall", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        op: "get",
        id: "1:message",
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        syscall: {
          op: "get",
          id: "1:message",
        },
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      value: { _id: "1:message" },
      readSet: { documents: [{ tableId: 1, id: "1:message" }] },
    });

    const replace = await app.handle(
      jsonRequest("https://executor.test/invoke/syscall", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        op: "replace",
        id: "1:message",
        value: { text: "replaced" },
      }),
    );

    expect(replace.status).toBe(200);
    expect(calls[1]).toEqual({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      syscall: {
        op: "replace",
        id: "1:message",
        value: { text: "replaced" },
      },
    });
  });

  it("validates invoke syscall requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async invokeSyscall() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/syscall", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        op: "unknown",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "op must be get, query, insert, patch, replace, or delete.",
    });
  });

  it("rejects non-POST invoke syscall requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/invoke/syscall"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/invoke/syscall only supports POST",
    });
  });

  it("maps invoke finish requests to the executor core", async () => {
    const calls: FinishInvokeSessionInput[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async finishInvokeSession(input) {
          calls.push(input);
          return {
            value: input.value,
            readSet: { documents: [{ tableId: 1, id: "1:message" }] },
            readTs: 1781913600123,
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/finish", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        value: [{ _id: "1:message", text: "hello" }],
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        value: [{ _id: "1:message", text: "hello" }],
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      value: [{ _id: "1:message", text: "hello" }],
      readSet: { documents: [{ tableId: 1, id: "1:message" }] },
      readTs: 1781913600123,
    });
  });

  it("validates invoke finish requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async finishInvokeSession() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/finish", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        value: undefined,
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "value must be a JSON value.",
    });
  });

  it("rejects non-POST invoke finish requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/invoke/finish"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/invoke/finish only supports POST",
    });
  });

  it("maps invoke abort requests to the executor core", async () => {
    const calls: AbortInvokeSessionInput[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async abortInvokeSession(input) {
          calls.push(input);
          return { aborted: true };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/abort", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
      },
    ]);
    await expect(response.json()).resolves.toEqual({ aborted: true });
  });

  it("validates invoke abort requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async abortInvokeSession() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/abort", {
        deploymentId: "deployment_active",
        projectId: "project_active",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "sessionId must be a non-empty string.",
    });
  });

  it("rejects non-POST invoke abort requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/invoke/abort"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/invoke/abort only supports POST",
    });
  });

  it("maps stale invoke abort requests to the executor core", async () => {
    const calls: AbortStaleInvokeSessionsInput[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async abortStaleInvokeSessions(input) {
          calls.push(input);
          return {
            aborted: 2,
            sessions: ["session_a", "session_b"],
            hasMore: true,
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/abort-stale", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        olderThan: "2026-06-20T00:00:00.000Z",
        maxSessions: 2,
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        olderThan: new Date("2026-06-20T00:00:00.000Z"),
        limit: 2,
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      aborted: 2,
      sessions: ["session_a", "session_b"],
      hasMore: true,
    });
  });

  it("validates stale invoke abort requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async abortStaleInvokeSessions() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/abort-stale", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        olderThan: "bad-date",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "olderThan must be an ISO timestamp string.",
    });
  });

  it("rejects non-POST stale invoke abort requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/invoke/abort-stale"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/invoke/abort-stale only supports POST",
    });
  });

  it("maps invoke session maintenance requests to the executor core", async () => {
    const calls: RunInvokeSessionMaintenanceInput[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async runInvokeSessionMaintenance(input) {
          calls.push(input);
          return { staleAborted: 1, sessions: ["session_old"], hasMore: true };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/invoke-sessions", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        staleAfterMs: 1800000,
        maxSessions: 1,
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        staleAfterMs: 1800000,
        maxSessions: 1,
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      staleAborted: 1,
      sessions: ["session_old"],
      hasMore: true,
    });
  });

  it("validates invoke session maintenance requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async runInvokeSessionMaintenance() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/invoke-sessions", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        staleAfterMs: 0,
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "staleAfterMs must be a positive integer.",
    });
  });

  it("rejects non-POST invoke session maintenance requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/maintenance/invoke-sessions"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/maintenance/invoke-sessions only supports POST",
    });
  });

  it("maps live query rerun maintenance requests to the executor core", async () => {
    const freshnessStore = testFreshnessStore();
    const executeQuery: RunLiveQuerySubscriptionWithInvokeInput["executeQuery"] =
      async () => null;
    const calls: Array<{
      deploymentId: string;
      projectId?: string;
      freshnessStore: unknown;
      executeQuery: unknown;
    }> = [];
    const rerunCalls: Array<{
      deploymentId: string;
      limit?: number;
      freshnessStore: unknown;
      deliverChanges: unknown;
    }> = [];
    const delivered: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async rerunStaleLiveQuerySubscriptions(input) {
          rerunCalls.push({
            deploymentId: input.deploymentId,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
            freshnessStore: input.freshnessStore,
            deliverChanges: input.deliverChanges,
          });
          await input.runQuery(liveQuerySubscription());
          await input.deliverChanges?.([
            {
              kind: "updated",
              deploymentId: "deployment_active",
              connectionId: "connection_a",
              queryId: 1,
              functionPath: "messages:list",
              argsJson: { teamId: "team_a" },
              resultJson: ["fresh"],
              previousResultHash: "old_hash",
              resultHash: "new_hash",
            },
          ]);
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
            freshnessStore,
            executeQuery: input.executeQuery,
            ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
          });
          return {
            value: null,
            beginTs: 1,
            readSet: {},
          };
        },
      }),
      liveQueryRerun: {
        freshnessStore,
        executeQuery,
        deliverChanges: async changes => {
          delivered.push(...changes);
        },
      },
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/rerun", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        limit: 2,
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        freshnessStore,
        executeQuery,
      },
    ]);
    expect(rerunCalls).toEqual([
      {
        deploymentId: "deployment_active",
        limit: 2,
        freshnessStore,
        deliverChanges: expect.any(Function),
      },
    ]);
    expect(delivered).toEqual([
      {
        kind: "updated",
        deploymentId: "deployment_active",
        connectionId: "connection_a",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: { teamId: "team_a" },
        resultJson: ["fresh"],
        previousResultHash: "old_hash",
        resultHash: "new_hash",
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      scanned: { fresh: [], stale: [], unsupported: [] },
      changed: [],
      unchanged: [],
      changes: [],
      unsupported: [],
      hasMoreStale: false,
    });
  });

  it("notifies the backend delivery wake route after changed live query reruns", async () => {
    const notifyCalls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async rerunStaleLiveQuerySubscriptions(input) {
          return {
            scanned: { fresh: [], stale: [], unsupported: [] },
            changed: [
              {
                status: "updated",
                subscription: liveQuerySubscription({
                  deploymentId: input.deploymentId,
                  connectionId: "connection_a",
                  queryId: 1,
                }),
                previousResultHash: '"old"',
                resultHash: '"new"',
                changed: true,
                delivery: null,
              },
            ],
            unchanged: [],
            changes: [
              {
                kind: "updated",
                deploymentId: input.deploymentId,
                connectionId: "connection_a",
                queryId: 1,
                functionPath: "messages:list",
                argsJson: {},
                resultJson: "new",
                previousResultHash: '"old"',
                resultHash: '"new"',
              },
            ],
            unsupported: [],
            hasMoreStale: false,
          };
        },
      }),
      liveQueryRerun: {
        freshnessStore: testFreshnessStore(),
        executeQuery: async () => null,
        notifyDelivery: async input => {
          notifyCalls.push(input);
        },
      },
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/rerun", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        limit: 2,
      }),
    );

    expect(response.status).toBe(200);
    expect(notifyCalls).toEqual([
      {
        deploymentId: "deployment_active",
        limit: 2,
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      changed: [
        {
          subscription: {
            deploymentId: "deployment_active",
            connectionId: "connection_a",
            queryId: 1,
          },
          changed: true,
        },
      ],
      hasMoreStale: false,
    });
  });

  it("requires live query rerun maintenance configuration", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async rerunStaleLiveQuerySubscriptions() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/rerun", {
        deploymentId: "deployment_active",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "not_implemented",
      message: "Live query rerun maintenance is not configured.",
    });
  });

  it("validates live query rerun maintenance requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async rerunStaleLiveQuerySubscriptions() {
          called = true;
          throw new Error("should not be called");
        },
      }),
      liveQueryRerun: {
        freshnessStore: testFreshnessStore(),
        executeQuery: async () => null,
      },
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/rerun", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        limit: 0,
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "limit must be a positive integer.",
    });
  });

  it("requires project id for live query rerun maintenance requests", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async rerunStaleLiveQuerySubscriptions() {
          called = true;
          throw new Error("should not be called");
        },
      }),
      liveQueryRerun: {
        freshnessStore: testFreshnessStore(),
        executeQuery: async () => null,
      },
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/rerun", {
        deploymentId: "deployment_active",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "projectId must be a non-empty string.",
    });
  });

  it("maps live query rerun bridge errors to bad requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async rerunStaleLiveQuerySubscriptions(input) {
          await input.runQuery(liveQuerySubscription({ partitionKey: null }));
          throw new Error("should not reach");
        },
        async runLiveQuerySubscriptionWithInvoke() {
          throw new LiveQuerySubscriptionRerunError(
            "deployment_active/connection_a/1 is missing partitionKey",
          );
        },
      }),
      liveQueryRerun: {
        freshnessStore: testFreshnessStore(),
        executeQuery: async () => null,
      },
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/rerun", {
        deploymentId: "deployment_active",
        projectId: "project_active",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "LiveQuerySubscriptionRerunError",
      message:
        "Cannot rerun live query subscription: deployment_active/connection_a/1 is missing partitionKey",
    });
  });

  it("rejects non-POST live query rerun maintenance requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
      liveQueryRerun: {
        freshnessStore: testFreshnessStore(),
        executeQuery: async () => null,
      },
    });

    const response = await app.handle(
      new Request("https://executor.test/maintenance/live-queries/rerun"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/maintenance/live-queries/rerun only supports POST",
    });
  });

  it("maps live query subscription record requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async recordLiveQuerySubscription(input) {
          calls.push(input);
          return {
            subscription: liveQuerySubscription({
              deploymentId: input.deploymentId,
              connectionId: input.connectionId,
              queryId: input.queryId,
              functionPath: input.functionPath,
              argsJson: input.argsJson,
              partitionKey: input.partitionKey ?? null,
              beginTs: input.beginTs,
              readSetJson: input.readSet as unknown as Record<string, unknown>,
              resultJson: input.resultJson,
            }),
            resultHash: "\"fresh\"",
          };
        },
      }),
      capabilityToken: "executor-secret",
    });

    const response = await app.handle(
      jsonRequest(
        "https://executor.test/live-query-subscriptions/record",
        {
          deploymentId: "deployment_active",
          projectId: "project_active",
          connectionId: "connection_a",
          queryId: 7,
          functionPath: "messages:list",
          argsJson: { teamId: "team_a" },
          partitionKey: "team_a",
          beginTs: 12,
          readSet: { documents: [{ tableId: 1, id: "1:message", observedTs: 12 }] },
          resultJson: ["fresh"],
        },
        { authorization: "Bearer executor-secret" },
      ),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
        queryId: 7,
        functionPath: "messages:list",
        argsJson: { teamId: "team_a" },
        partitionKey: "team_a",
        beginTs: 12,
        readSet: { documents: [{ tableId: 1, id: "1:message", observedTs: 12 }] },
        resultJson: ["fresh"],
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      subscription: {
        deploymentId: "deployment_active",
        connectionId: "connection_a",
        queryId: 7,
      },
      resultHash: "\"fresh\"",
    });
  });

  it("maps live query subscription remove requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async removeLiveQuerySubscription(input) {
          calls.push(input);
          return { deleted: 1 };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/live-query-subscriptions/remove", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
        queryId: 7,
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
        queryId: 7,
      },
    ]);
    await expect(response.json()).resolves.toEqual({ deleted: 1 });
  });

  it("maps live query connection touch requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async touchLiveQueryConnection(input) {
          calls.push(input);
          return {
            connection: {
              deploymentId: input.deploymentId,
              connectionId: input.connectionId,
              lastSeenAt: new Date("2026-06-23T00:00:00.000Z"),
              expiresAt: new Date("2026-06-23T00:01:00.000Z"),
              closedAt: null,
              createdAt: new Date("2026-06-23T00:00:00.000Z"),
              updatedAt: new Date("2026-06-23T00:00:00.000Z"),
            },
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/live-query-connections/touch", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
        leaseDurationMs: 45000,
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
        leaseDurationMs: 45000,
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      connection: {
        deploymentId: "deployment_active",
        connectionId: "connection_a",
        closedAt: null,
      },
    });
  });

  it("maps live query subscription remove-connection requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async removeLiveQuerySubscriptionsForConnection(input) {
          calls.push(input);
          return { deleted: 2 };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/live-query-subscriptions/remove-connection", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
      },
    ]);
    await expect(response.json()).resolves.toEqual({ deleted: 2 });
  });

  it("maps live query expired connection cleanup requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async removeExpiredLiveQuerySubscriptions(input) {
          calls.push(input);
          return { deleted: 3, deletedConnections: 2 };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest(
        "https://executor.test/maintenance/live-queries/connections/cleanup",
        {
          deploymentId: "deployment_active",
          projectId: "project_active",
          expiredAt: "2026-06-23T00:02:00.000Z",
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        projectId: "project_active",
        expiredAt: new Date("2026-06-23T00:02:00.000Z"),
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      deleted: 3,
      deletedConnections: 2,
    });
  });

  it("maps expired live query connection deployment scans to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async listExpiredLiveQueryConnectionDeployments(input) {
          calls.push(input);
          return {
            deployments: [
              {
                deploymentId: "deployment_expired",
                projectId: "project_expired",
                oldestExpiredAt: new Date("2026-06-23T00:01:00.000Z"),
                expiredConnections: 2,
              },
            ],
            nextCursor: {
              oldestExpiredAt: new Date("2026-06-23T00:01:00.000Z"),
              deploymentId: "deployment_expired",
            },
            hasMore: true,
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest(
        "https://executor.test/maintenance/live-queries/expired-connection-deployments",
        {
          expiredAt: "2026-06-23T00:02:00.000Z",
          limit: 5,
          cursor: {
            oldestExpiredAt: "2026-06-23T00:00:00.000Z",
            deploymentId: "deployment_before",
          },
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        expiredAt: new Date("2026-06-23T00:02:00.000Z"),
        limit: 5,
        cursor: {
          oldestExpiredAt: new Date("2026-06-23T00:00:00.000Z"),
          deploymentId: "deployment_before",
        },
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      deployments: [
        {
          deploymentId: "deployment_expired",
          projectId: "project_expired",
          oldestExpiredAt: "2026-06-23T00:01:00.000Z",
          expiredConnections: 2,
        },
      ],
      nextCursor: {
        oldestExpiredAt: "2026-06-23T00:01:00.000Z",
        deploymentId: "deployment_expired",
      },
      hasMore: true,
    });
  });

  it("validates live query subscription record requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async recordLiveQuerySubscription() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/live-query-subscriptions/record", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
        queryId: -1,
        functionPath: "messages:list",
        argsJson: {},
        beginTs: 12,
        readSet: {},
        resultJson: null,
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "queryId must be a non-negative integer.",
    });
  });

  it("validates live query subscription read-set shape before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async recordLiveQuerySubscription() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/live-query-subscriptions/record", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        connectionId: "connection_a",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: {},
        beginTs: 12,
        readSet: { documents: "bad" },
        resultJson: null,
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "readSet.documents must be an array.",
    });
  });

  it("rejects non-POST live query subscription record requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/live-query-subscriptions/record"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/live-query-subscriptions/record only supports POST",
    });
  });

  it("maps live query delivery maintenance requests to the executor core", async () => {
    const delivered: unknown[] = [];
    const deliveryHandler: RunLiveQueryDeliveryBatchInput["deliver"] = async (
      deliveries,
    ) => {
      delivered.push(...deliveries.map((delivery) => delivery.payloadJson));
    };
    const calls: Array<{
      deploymentId: string;
      limit?: number;
      deliver: unknown;
    }> = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async runLiveQueryDeliveryBatch(input) {
          calls.push({
            deploymentId: input.deploymentId,
            ...(input.limit === undefined ? {} : { limit: input.limit }),
            deliver: input.deliver,
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
              claimedAt: null,
              claimExpiresAt: null,
              claimOwner: null,
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
            deliveries: [
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
                deliveredAt: new Date("2026-06-21T00:00:01.000Z"),
                claimedAt: null,
                claimExpiresAt: null,
                claimOwner: null,
                attemptCount: 0,
                lastAttemptedAt: null,
                lastErrorStage: null,
                lastError: null,
                deadLetteredAt: null,
                deadLetterReason: null,
                createdAt: new Date("2026-06-21T00:00:00.000Z"),
              },
            ],
            delivered: 1,
            nextCursor: null,
            hasMore: false,
            summary: {
              claimed: 1,
              delivered: 1,
              acked: 1,
              pending: 0,
              hasMore: false,
            },
          };
        },
      }),
      liveQueryDelivery: {
        deliver: deliveryHandler,
      },
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/deliver", {
        deploymentId: "deployment_active",
        limit: 5,
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        limit: 5,
        deliver: deliveryHandler,
      },
    ]);
    expect(delivered).toEqual([
      {
        deploymentId: "deployment_active",
        connectionId: "connection_a",
        queryId: 1,
        resultJson: ["fresh"],
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      deliveries: [
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
          deliveredAt: "2026-06-21T00:00:01.000Z",
          claimedAt: null,
          claimExpiresAt: null,
          claimOwner: null,
          attemptCount: 0,
          lastAttemptedAt: null,
          lastErrorStage: null,
          lastError: null,
          deadLetteredAt: null,
          deadLetterReason: null,
          createdAt: "2026-06-21T00:00:00.000Z",
        },
      ],
      delivered: 1,
      nextCursor: null,
      hasMore: false,
      summary: {
        claimed: 1,
        delivered: 1,
        acked: 1,
        pending: 0,
        hasMore: false,
      },
    });
  });

  it("maps live query delivery claim requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async claimLiveQueryDeliveryBatch(input) {
          calls.push(input);
          return {
            deliveries: [
              {
                deploymentId: input.deploymentId,
                deliveryId: "delivery_1",
                connectionId: "connection:deployment_active:session_1",
                queryId: 1,
                payloadJson: {
                  deploymentId: input.deploymentId,
                  connectionId: "connection:deployment_active:session_1",
                  queryId: 1,
                  resultJson: ["fresh"],
                },
                deliveredAt: null,
                claimedAt: new Date("2026-06-21T00:00:00.000Z"),
                claimExpiresAt: new Date("2026-06-21T00:00:30.000Z"),
                claimOwner: "delivery:deployment_active",
                attemptCount: 0,
                lastAttemptedAt: null,
                lastErrorStage: null,
                lastError: null,
                deadLetteredAt: null,
                deadLetterReason: null,
                createdAt: new Date("2026-06-21T00:00:00.000Z"),
              },
            ],
            nextCursor: null,
            hasMore: false,
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/claim", {
        deploymentId: "deployment_active",
        limit: 2,
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([{ deploymentId: "deployment_active", limit: 2 }]);
    await expect(response.json()).resolves.toEqual({
      deliveries: [
        {
          deploymentId: "deployment_active",
          deliveryId: "delivery_1",
          connectionId: "connection:deployment_active:session_1",
          queryId: 1,
          payloadJson: {
            deploymentId: "deployment_active",
            connectionId: "connection:deployment_active:session_1",
            queryId: 1,
            resultJson: ["fresh"],
          },
          deliveredAt: null,
          claimedAt: "2026-06-21T00:00:00.000Z",
          claimExpiresAt: "2026-06-21T00:00:30.000Z",
          claimOwner: "delivery:deployment_active",
          attemptCount: 0,
          lastAttemptedAt: null,
          lastErrorStage: null,
          lastError: null,
          deadLetteredAt: null,
          deadLetterReason: null,
          createdAt: "2026-06-21T00:00:00.000Z",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("maps live query delivery ack requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async ackLiveQueryDeliveries(input) {
          calls.push(input);
          return { delivered: input.deliveryIds.length };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/ack", {
        deploymentId: "deployment_active",
        deliveryIds: ["delivery_1", "delivery_2"],
        deliveredAt: "2026-06-21T00:00:01.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        deliveryIds: ["delivery_1", "delivery_2"],
        deliveredAt: new Date("2026-06-21T00:00:01.000Z"),
      },
    ]);
    await expect(response.json()).resolves.toEqual({ delivered: 2 });
  });

  it("maps live query delivery failure requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async recordLiveQueryDeliveryFailure(input) {
          calls.push(input);
          return { failed: input.deliveryIds.length };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/failure", {
        deploymentId: "deployment_active",
        deliveryIds: ["delivery_1", "delivery_2"],
        stage: "fanout",
        error: "ConnectionDO failed",
        failedAt: "2026-06-21T00:00:02.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_active",
        deliveryIds: ["delivery_1", "delivery_2"],
        stage: "fanout",
        error: "ConnectionDO failed",
        failedAt: new Date("2026-06-21T00:00:02.000Z"),
      },
    ]);
    await expect(response.json()).resolves.toEqual({ failed: 2 });
  });

  it("maps live query pending deployment requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async listPendingLiveQueryDeliveryDeployments(input) {
          calls.push(input);
          return {
            deployments: [
              {
                deploymentId: "deployment_pending",
                oldestCreatedAt: new Date("2026-06-21T00:00:00.000Z"),
                pending: 3,
              },
            ],
            nextCursor: {
              deploymentId: "deployment_pending",
              oldestCreatedAt: new Date("2026-06-21T00:00:00.000Z"),
            },
            hasMore: true,
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/pending-deployments", {
        limit: 2,
        cursor: {
          deploymentId: "deployment_before",
          oldestCreatedAt: "2026-06-20T00:00:00.000Z",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        limit: 2,
        cursor: {
          deploymentId: "deployment_before",
          oldestCreatedAt: new Date("2026-06-20T00:00:00.000Z"),
        },
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      deployments: [
        {
          deploymentId: "deployment_pending",
          oldestCreatedAt: "2026-06-21T00:00:00.000Z",
          pending: 3,
        },
      ],
      nextCursor: {
        deploymentId: "deployment_pending",
        oldestCreatedAt: "2026-06-21T00:00:00.000Z",
      },
      hasMore: true,
    });
  });

  it("maps stuck live query delivery requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async listStuckLiveQueryDeliveries(input) {
          calls.push(input);
          return {
            deliveries: [
              {
                deploymentId: "deployment_stuck",
                deliveryId: "delivery_stuck",
                connectionId: "connection_stuck",
                queryId: 1,
                payloadJson: { resultJson: "fresh" },
                deliveredAt: null,
                claimedAt: null,
                claimExpiresAt: null,
                claimOwner: null,
                attemptCount: 2,
                lastAttemptedAt: new Date("2026-06-21T00:00:00.000Z"),
                lastErrorStage: "fanout",
                lastError: "ConnectionDO failed",
                deadLetteredAt: null,
                deadLetterReason: null,
                createdAt: new Date("2026-06-21T00:00:00.000Z"),
              },
            ],
            nextCursor: {
              lastAttemptedAt: new Date("2026-06-21T00:00:00.000Z"),
              deploymentId: "deployment_stuck",
              deliveryId: "delivery_stuck",
            },
            hasMore: true,
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/stuck-deliveries", {
        deploymentId: "deployment_stuck",
        olderThan: "2026-06-21T00:05:00.000Z",
        minAttempts: 2,
        limit: 1,
        cursor: {
          lastAttemptedAt: "2026-06-20T00:00:00.000Z",
          deploymentId: "deployment_before",
          deliveryId: "delivery_before",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_stuck",
        olderThan: new Date("2026-06-21T00:05:00.000Z"),
        minAttempts: 2,
        limit: 1,
        cursor: {
          lastAttemptedAt: new Date("2026-06-20T00:00:00.000Z"),
          deploymentId: "deployment_before",
          deliveryId: "delivery_before",
        },
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      deliveries: [
        {
          deploymentId: "deployment_stuck",
          deliveryId: "delivery_stuck",
          connectionId: "connection_stuck",
          queryId: 1,
          payloadJson: { resultJson: "fresh" },
          deliveredAt: null,
          claimedAt: null,
          claimExpiresAt: null,
          claimOwner: null,
          attemptCount: 2,
          lastAttemptedAt: "2026-06-21T00:00:00.000Z",
          lastErrorStage: "fanout",
          lastError: "ConnectionDO failed",
          deadLetteredAt: null,
          deadLetterReason: null,
          createdAt: "2026-06-21T00:00:00.000Z",
        },
      ],
      nextCursor: {
        lastAttemptedAt: "2026-06-21T00:00:00.000Z",
        deploymentId: "deployment_stuck",
        deliveryId: "delivery_stuck",
      },
      hasMore: true,
    });
  });

  it("maps live query dead-letter requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async markLiveQueryDeliveriesDeadLettered(input) {
          calls.push(input);
          return {
            deadLettered: input.deliveryIds.length,
            deliveries: [
              {
                deploymentId: input.deploymentId,
                deliveryId: input.deliveryIds[0]!,
                connectionId: "connection_dead",
                queryId: 1,
                payloadJson: { resultJson: "dead" },
                deliveredAt: null,
                claimedAt: null,
                claimExpiresAt: null,
                claimOwner: null,
                attemptCount: 3,
                lastAttemptedAt: new Date("2026-06-21T00:00:00.000Z"),
                lastErrorStage: "fanout",
                lastError: "ConnectionDO failed",
                deadLetteredAt: input.deadLetteredAt,
                deadLetterReason: input.reason,
                createdAt: new Date("2026-06-21T00:00:00.000Z"),
              },
            ],
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/dead-letter", {
        deploymentId: "deployment_dead",
        deliveryIds: ["delivery_dead"],
        reason: "force reconnect",
        deadLetteredAt: "2026-06-21T00:10:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_dead",
        deliveryIds: ["delivery_dead"],
        reason: "force reconnect",
        deadLetteredAt: new Date("2026-06-21T00:10:00.000Z"),
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      deadLettered: 1,
      deliveries: [
        {
          deploymentId: "deployment_dead",
          deliveryId: "delivery_dead",
          connectionId: "connection_dead",
          deadLetteredAt: "2026-06-21T00:10:00.000Z",
          deadLetterReason: "force reconnect",
        },
      ],
    });
  });

  it("maps stuck live query dead-letter policy requests to the executor core", async () => {
    const calls: unknown[] = [];
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async deadLetterStuckLiveQueryDeliveries(input) {
          calls.push(input);
          return {
            scanned: [],
            deadLettered: [
              {
                deploymentId: "deployment_stuck",
                deliveryId: "delivery_stuck",
                connectionId: "connection_stuck",
                queryId: 1,
                payloadJson: { resultJson: "fresh" },
                deliveredAt: null,
                claimedAt: null,
                claimExpiresAt: null,
                claimOwner: null,
                attemptCount: 3,
                lastAttemptedAt: new Date("2026-06-21T00:00:00.000Z"),
                lastErrorStage: "fanout",
                lastError: "ConnectionDO failed",
                deadLetteredAt: new Date("2026-06-21T00:10:00.000Z"),
                deadLetterReason: "force reconnect",
                createdAt: new Date("2026-06-21T00:00:00.000Z"),
              },
            ],
            reconnectConnectionIds: ["connection_stuck"],
            nextCursor: null,
            hasMore: false,
            summary: {
              scanned: 0,
              deadLettered: 1,
              reconnectTargets: 1,
              hasMore: false,
            },
          };
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/dead-letter-stuck", {
        deploymentId: "deployment_stuck",
        olderThan: "2026-06-21T00:05:00.000Z",
        minAttempts: 3,
        limit: 10,
        reason: "force reconnect",
        deadLetteredAt: "2026-06-21T00:10:00.000Z",
      }),
    );

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      {
        deploymentId: "deployment_stuck",
        olderThan: new Date("2026-06-21T00:05:00.000Z"),
        minAttempts: 3,
        limit: 10,
        reason: "force reconnect",
        deadLetteredAt: new Date("2026-06-21T00:10:00.000Z"),
      },
    ]);
    await expect(response.json()).resolves.toMatchObject({
      deadLettered: [
        {
          deliveryId: "delivery_stuck",
          deadLetteredAt: "2026-06-21T00:10:00.000Z",
          deadLetterReason: "force reconnect",
        },
      ],
      reconnectConnectionIds: ["connection_stuck"],
      hasMore: false,
      summary: {
        scanned: 0,
        deadLettered: 1,
        reconnectTargets: 1,
        hasMore: false,
      },
    });
  });

  it("validates live query delivery claim and ack requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async claimLiveQueryDeliveryBatch() {
          called = true;
          throw new Error("should not be called");
        },
        async ackLiveQueryDeliveries() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const claim = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/claim", {
        deploymentId: "deployment_active",
        limit: 0,
      }),
    );
    const ack = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/ack", {
        deploymentId: "deployment_active",
        deliveryIds: [""],
      }),
    );

    expect(called).toBe(false);
    expect(claim.status).toBe(400);
    await expect(claim.json()).resolves.toEqual({
      error: "bad_request",
      message: "limit must be a positive integer.",
    });
    expect(ack.status).toBe(400);
    await expect(ack.json()).resolves.toEqual({
      error: "bad_request",
      message: "deliveryIds must be an array of non-empty strings.",
    });
  });

  it("validates live query delivery failure requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async recordLiveQueryDeliveryFailure() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/failure", {
        deploymentId: "deployment_active",
        deliveryIds: ["delivery_1"],
        stage: "claim",
        error: "bad",
        failedAt: "2026-06-21T00:00:02.000Z",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "stage must be fanout or ack.",
    });
  });

  it("validates stuck live query delivery requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async listStuckLiveQueryDeliveries() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/stuck-deliveries", {
        olderThan: "not-a-date",
        limit: 10,
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "olderThan must be an ISO timestamp string.",
    });
  });

  it("validates live query dead-letter requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async markLiveQueryDeliveriesDeadLettered() {
          called = true;
          throw new Error("should not be called");
        },
        async deadLetterStuckLiveQueryDeliveries() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const explicit = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/dead-letter", {
        deploymentId: "deployment_dead",
        deliveryIds: [""],
        reason: "force reconnect",
        deadLetteredAt: "2026-06-21T00:10:00.000Z",
      }),
    );
    const policy = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/dead-letter-stuck", {
        olderThan: "2026-06-21T00:05:00.000Z",
        reason: "",
      }),
    );

    expect(called).toBe(false);
    expect(explicit.status).toBe(400);
    await expect(explicit.json()).resolves.toEqual({
      error: "bad_request",
      message: "deliveryIds must be an array of non-empty strings.",
    });
    expect(policy.status).toBe(400);
    await expect(policy.json()).resolves.toEqual({
      error: "bad_request",
      message: "reason must be a non-empty string.",
    });
  });

  it("validates live query pending deployment requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async listPendingLiveQueryDeliveryDeployments() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/pending-deployments", {
        limit: 0,
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "limit must be a positive integer.",
    });
  });

  it("validates expired live query connection deployment scan requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async listExpiredLiveQueryConnectionDeployments() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const invalidLimit = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/expired-connection-deployments", {
        limit: 0,
      }),
    );
    const invalidCursorDate = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/expired-connection-deployments", {
        cursor: {
          oldestExpiredAt: "not a date",
          deploymentId: "deployment_a",
        },
      }),
    );
    const missingCursorDeployment = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/expired-connection-deployments", {
        cursor: {
          oldestExpiredAt: "2026-06-23T00:00:00.000Z",
        },
      }),
    );

    expect(called).toBe(false);
    expect(invalidLimit.status).toBe(400);
    await expect(invalidLimit.json()).resolves.toEqual({
      error: "bad_request",
      message: "limit must be a positive integer.",
    });
    expect(invalidCursorDate.status).toBe(400);
    await expect(invalidCursorDate.json()).resolves.toEqual({
      error: "bad_request",
      message: "cursor.oldestExpiredAt must be an ISO timestamp string.",
    });
    expect(missingCursorDeployment.status).toBe(400);
    await expect(missingCursorDeployment.json()).resolves.toEqual({
      error: "bad_request",
      message: "cursor.deploymentId must be a non-empty string.",
    });
  });

  it("posts live query deliveries to the Flarex backend callback endpoint", async () => {
    const requests: Array<{ url: string; headers: Record<string, string | null>; body: unknown }> = [];
    const deliver = createFlarexBackendLiveQueryDelivery({
      backendUrl: "https://backend.test/base",
      capabilityToken: "delivery-token",
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          url: request.url,
          headers: {
            authorization: request.headers.get("authorization"),
            contentType: request.headers.get("content-type"),
          },
          body: await request.json(),
        });
        return Response.json({ delivered: 1, skipped: 0, connections: 1 });
      },
    });

    await deliver([
      {
        deploymentId: "deployment_active",
        deliveryId: "delivery_1",
        connectionId: "connection:deployment_active:session_1",
        queryId: 1,
        payloadJson: {
          deploymentId: "deployment_active",
          connectionId: "connection:deployment_active:session_1",
          queryId: 1,
          functionPath: "messages:list",
          argsJson: { teamId: "team_a" },
          resultJson: ["fresh"],
          previousResultHash: "old",
          resultHash: "fresh",
        },
        deliveredAt: null,
        claimedAt: null,
        claimExpiresAt: null,
        claimOwner: null,
        attemptCount: 0,
        lastAttemptedAt: null,
        lastErrorStage: null,
        lastError: null,
        deadLetteredAt: null,
        deadLetterReason: null,
        createdAt: new Date("2026-06-21T00:00:00.000Z"),
      },
    ]);

    expect(requests).toEqual([
      {
        url: "https://backend.test/base/deployments/deployment_active/sync/deliver-live-query",
        headers: {
          authorization: "Bearer delivery-token",
          contentType: "application/json",
        },
        body: {
          deliveries: [
            {
              deploymentId: "deployment_active",
              connectionId: "connection:deployment_active:session_1",
              queryId: 1,
              functionPath: "messages:list",
              argsJson: { teamId: "team_a" },
              resultJson: ["fresh"],
              previousResultHash: "old",
              resultHash: "fresh",
            },
          ],
        },
      },
    ]);
  });

  it("posts live query wake notifications to the Flarex backend DeliveryDO route", async () => {
    const requests: Array<{ url: string; headers: Record<string, string | null>; body: unknown }> = [];
    const notifyDelivery = createFlarexBackendLiveQueryWakeNotifier({
      backendUrl: "https://backend.test/base",
      capabilityToken: "delivery-token",
      limit: 10,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          url: request.url,
          headers: {
            authorization: request.headers.get("authorization"),
            contentType: request.headers.get("content-type"),
          },
          body: await request.json(),
        });
        return Response.json({
          deploymentId: "deployment_active",
          batches: 1,
          claimed: 1,
          acked: 1,
          delivered: 1,
          skipped: 0,
          hasMore: false,
        });
      },
    });

    await notifyDelivery({
      deploymentId: "deployment_active",
      maxBatches: 2,
    });

    expect(requests).toEqual([
      {
        url: "https://backend.test/base/deployments/deployment_active/sync/wake-delivery",
        headers: {
          authorization: "Bearer delivery-token",
          contentType: "application/json",
        },
        body: {
          limit: 10,
          maxBatches: 2,
        },
      },
    ]);
  });

  it("posts live query trigger notifications to the Flarex backend scheduler route", async () => {
    const requests: Array<{ url: string; headers: Record<string, string | null>; body: unknown }> = [];
    const notifyTrigger = createFlarexBackendLiveQueryTriggerNotifier({
      backendUrl: "https://backend.test/base",
      capabilityToken: "delivery-token",
      limit: 5,
      deliveryLimit: 10,
      maxBatches: 2,
      fetch: async (input, init) => {
        const request = new Request(input, init);
        requests.push({
          url: request.url,
          headers: {
            authorization: request.headers.get("authorization"),
            contentType: request.headers.get("content-type"),
          },
          body: await request.json(),
        });
        return Response.json({
          deploymentId: "deployment_active",
          changed: 1,
          unchanged: 0,
          unsupported: 0,
          hasMoreStale: false,
        });
      },
    });

    await notifyTrigger({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      functionPath: "messages:send",
      committedTs: 101,
      writes: [
        {
          tableId: 1,
          id: "1:message",
          prevTs: null,
          ts: 101,
          value: { text: "hello" },
        },
      ],
    });

    expect(requests).toEqual([
      {
        url: "https://backend.test/base/scheduler/live-query-subscriptions/trigger",
        headers: {
          authorization: "Bearer delivery-token",
          contentType: "application/json",
        },
        body: {
          deploymentId: "deployment_active",
          projectId: "project_active",
          limit: 5,
          deliveryLimit: 10,
          maxBatches: 2,
        },
      },
    ]);
  });

  it("fails live query delivery callbacks when the backend rejects fanout", async () => {
    const deliver = createFlarexBackendLiveQueryDelivery({
      backendUrl: "https://backend.test",
      fetch: async () => Response.json({ error: "fanout failed" }, { status: 502 }),
    });

    await expect(deliver([
      {
        deploymentId: "deployment_active",
        deliveryId: "delivery_1",
        connectionId: "connection:deployment_active:session_1",
        queryId: 1,
        payloadJson: {
          deploymentId: "deployment_active",
          connectionId: "connection:deployment_active:session_1",
          queryId: 1,
          functionPath: "messages:list",
          argsJson: { teamId: "team_a" },
          resultJson: ["fresh"],
          previousResultHash: "old",
          resultHash: "fresh",
        },
        deliveredAt: null,
        claimedAt: null,
        claimExpiresAt: null,
        claimOwner: null,
        attemptCount: 0,
        lastAttemptedAt: null,
        lastErrorStage: null,
        lastError: null,
        deadLetteredAt: null,
        deadLetterReason: null,
        createdAt: new Date("2026-06-21T00:00:00.000Z"),
      },
    ])).rejects.toThrow(
      'Flarex backend live query delivery failed for deployment_active: 502 {"error":"fanout failed"}',
    );
  });

  it("exposes typed backend live query delivery failures before compatibility mapping", async () => {
    const failure = await Effect.runPromise(
      deliverFlarexBackendLiveQueryEffect(
        {
          backendUrl: "https://backend.test",
          fetch: async () => Response.json({ error: "fanout failed" }, { status: 502 }),
        },
        [
          {
            deploymentId: "deployment_active",
            deliveryId: "delivery_1",
            connectionId: "connection:deployment_active:session_1",
            queryId: 1,
            payloadJson: {
              deploymentId: "deployment_active",
              connectionId: "connection:deployment_active:session_1",
              queryId: 1,
              functionPath: "messages:list",
              argsJson: { teamId: "team_a" },
              resultJson: ["fresh"],
              previousResultHash: "old",
              resultHash: "fresh",
            },
            deliveredAt: null,
            claimedAt: null,
            claimExpiresAt: null,
            claimOwner: null,
            attemptCount: 0,
            lastAttemptedAt: null,
            lastErrorStage: null,
            lastError: null,
            deadLetteredAt: null,
            deadLetterReason: null,
            createdAt: new Date("2026-06-21T00:00:00.000Z"),
          },
        ],
      ).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(FlarexBackendLiveQueryResponseError);
    expect(failure).toMatchObject({
      operation: "delivery",
      deploymentId: "deployment_active",
      status: 502,
      body: '{"error":"fanout failed"}',
      message:
        'Flarex backend live query delivery failed for deployment_active: 502 {"error":"fanout failed"}',
    });
  });

  it("exposes typed backend live query wake failures before compatibility mapping", async () => {
    const failure = await Effect.runPromise(
      notifyFlarexBackendLiveQueryWakeEffect(
        {
          backendUrl: "https://backend.test",
          fetch: async () => Response.json({ error: "wake failed" }, { status: 503 }),
        },
        {
          deploymentId: "deployment_active",
        },
      ).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(FlarexBackendLiveQueryResponseError);
    expect(failure).toMatchObject({
      operation: "wake",
      deploymentId: "deployment_active",
      status: 503,
      body: '{"error":"wake failed"}',
      message:
        'Flarex backend live query wake failed for deployment_active: 503 {"error":"wake failed"}',
    });
  });

  it("exposes typed backend live query transport failures before compatibility mapping", async () => {
    const unavailable = new Error("backend unavailable");
    const failure = await Effect.runPromise(
      notifyFlarexBackendLiveQueryTriggerEffect(
        {
          backendUrl: "https://backend.test",
          fetch: async () => {
            throw unavailable;
          },
        },
        {
          deploymentId: "deployment_active",
          projectId: "project_active",
        },
      ).pipe(Effect.flip),
    );

    expect(failure).toBeInstanceOf(FlarexBackendLiveQueryFetchError);
    expect(failure).toMatchObject({
      operation: "trigger",
      deploymentId: "deployment_active",
      message:
        "Flarex backend live query trigger failed for deployment_active: backend unavailable",
      cause: unavailable,
    });
  });

  it("preserves compatibility wrapper fetch rejection messages", async () => {
    const unavailable = new Error("backend unavailable");
    const notifyTrigger = createFlarexBackendLiveQueryTriggerNotifier({
      backendUrl: "https://backend.test",
      fetch: async () => {
        throw unavailable;
      },
    });

    await expect(notifyTrigger({
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      functionPath: "messages:send",
      committedTs: 101,
      writes: [],
    })).rejects.toBe(unavailable);
  });

  it("fails live query trigger notifications when the backend rejects scheduling", async () => {
    const notifyTrigger = createFlarexBackendLiveQueryTriggerNotifier({
      backendUrl: "https://backend.test",
      fetch: async () => Response.json({ error: "trigger failed" }, { status: 502 }),
    });

    await expect(
      notifyTrigger({
        deploymentId: "deployment_active",
        projectId: "project_active",
        sessionId: "session_active",
        functionPath: "messages:send",
        committedTs: 101,
        writes: [],
      }),
    ).rejects.toThrow(
      'Flarex backend live query trigger failed for deployment_active: 502 {"error":"trigger failed"}',
    );
  });

  it("requires live query delivery maintenance configuration", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async runLiveQueryDeliveryBatch() {
          called = true;
          throw new Error("should not be called");
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/deliver", {
        deploymentId: "deployment_active",
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: "not_implemented",
      message: "Live query delivery maintenance is not configured.",
    });
  });

  it("validates live query delivery maintenance requests before calling the executor", async () => {
    let called = false;
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async runLiveQueryDeliveryBatch() {
          called = true;
          throw new Error("should not be called");
        },
      }),
      liveQueryDelivery: {
        deliver: async () => undefined,
      },
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/deliver", {
        deploymentId: "deployment_active",
        limit: 0,
      }),
    );

    expect(called).toBe(false);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "bad_request",
      message: "limit must be a positive integer.",
    });
  });

  it("maps live query delivery policy errors to bad requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async runLiveQueryDeliveryBatch() {
          throw new LiveQueryDeliveryPolicyError(
            "limit must be a positive integer.",
          );
        },
      }),
      liveQueryDelivery: {
        deliver: async () => undefined,
      },
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/maintenance/live-queries/deliver", {
        deploymentId: "deployment_active",
        limit: 1,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "LiveQueryDeliveryPolicyError",
      message:
        "Invalid live query delivery policy: limit must be a positive integer.",
    });
  });

  it("rejects non-POST live query delivery maintenance requests", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
      liveQueryDelivery: {
        deliver: async () => undefined,
      },
    });

    const response = await app.handle(
      new Request("https://executor.test/maintenance/live-queries/deliver"),
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toEqual({
      error: "method_not_allowed",
      message: "/maintenance/live-queries/deliver only supports POST",
    });
  });

  it("returns a JSON 404 for unknown routes", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor(),
    });

    const response = await app.handle(
      new Request("https://executor.test/unknown"),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: "not_found",
      message: "No Flarex executor adapter route for GET /unknown",
    });
  });

  it("maps known executor errors to stable statuses", async () => {
    await expect(expectPrepareError(new DeploymentNotFoundError("missing")))
      .resolves.toMatchObject({
        status: 404,
        body: { error: "DeploymentNotFoundError" },
      });
    await expect(
      expectPrepareError(
        new FunctionNotFoundError("deployment_active", "messages:missing"),
      ),
    ).resolves.toMatchObject({
      status: 404,
      body: { error: "FunctionNotFoundError" },
    });
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
      body: { error: "DeploymentProjectMismatchError" },
    });
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
      body: { error: "FunctionKindMismatchError" },
    });
    await expect(
      expectPrepareError(
        new FunctionVisibilityMismatchError(
          "deployment_active",
          "messages:internalList",
          "public",
          "internal",
        ),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: "FunctionVisibilityMismatchError" },
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
      body: { error: "FunctionNotInvokableError" },
    });
    await expect(
      expectPrepareError(
        new PartitionValidationError(
          "partitionKey must match args.teamId for messages:list.",
        ),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: "PartitionValidationError" },
    });
    await expect(
      expectPrepareError(new DeploymentPackageNotActivatedError("deployment_active")),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: "DeploymentPackageNotActivatedError" },
    });
  });

  it("maps invoke start executor errors to stable statuses", async () => {
    const app = createFlarexHttpApp({
      executor: fakeExecutor({
        async beginInvokeSession() {
          throw new PartitionValidationError(
            "partitionKey must match args.teamId for messages:list.",
          );
        },
      }),
    });

    const response = await app.handle(
      jsonRequest("https://executor.test/invoke/start", {
        deploymentId: "deployment_active",
        projectId: "project_active",
        path: "messages:list",
        args: { teamId: "team:1" },
        partitionKey: "team:wrong",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "PartitionValidationError",
    });
  });

  it("maps invoke syscall executor errors to stable statuses", async () => {
    await expect(expectSyscallError(new InvokeSessionNotFoundError("d", "s")))
      .resolves.toMatchObject({
        status: 404,
        body: { error: "InvokeSessionNotFoundError" },
      });
    await expect(expectSyscallError(new InvokeSyscallNotImplementedError("get")))
      .resolves.toMatchObject({
        status: 501,
        body: { error: "InvokeSyscallNotImplementedError" },
      });
    await expect(expectSyscallError(new FlarexDocumentIdFormatError("bad")))
      .resolves.toMatchObject({
        status: 400,
        body: { error: "FlarexDocumentIdFormatError" },
      });
    await expect(
      expectSyscallError(new FlarexInsertIdTableMismatchError("2:bad", 1)),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: "FlarexInsertIdTableMismatchError" },
    });
    await expect(
      expectSyscallError(
        new InvokeSessionDocumentWriteAlreadyExistsError("d", "s", "1:id"),
      ),
    ).resolves.toMatchObject({
      status: 400,
      body: { error: "InvokeSessionDocumentWriteAlreadyExistsError" },
    });
  });

  it("maps invoke finish executor errors to stable statuses", async () => {
    await expect(expectFinishError(new InvokeSessionNotFoundError("d", "s")))
      .resolves.toMatchObject({
        status: 404,
        body: { error: "InvokeSessionNotFoundError" },
      });
    await expect(expectFinishError(new InvokeFinishNotImplementedError("mutation")))
      .resolves.toMatchObject({
        status: 501,
        body: { error: "InvokeFinishNotImplementedError" },
      });
    await expect(
      expectFinishError(new InvokeSessionInsertConflictError("d", "1:id")),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: "InvokeSessionInsertConflictError" },
    });
    await expect(
      expectFinishError(new InvokeSessionOccConflictError("d", "1:id", 10, 20)),
    ).resolves.toMatchObject({
      status: 409,
      body: { error: "InvokeSessionOccConflictError" },
    });
  });
});

function fakeExecutor(
  overrides: Partial<FlarexExecutor> = {},
): FlarexExecutor {
  async function runInvokeWithRetriesFake(
    input: RunQueryInvokeWithRetriesInput,
  ): Promise<RunQueryInvokeWithRetriesResult>;
  async function runInvokeWithRetriesFake(
    input: RunMutationInvokeWithRetriesInput,
  ): Promise<RunMutationInvokeWithRetriesResult>;
  async function runInvokeWithRetriesFake(
    input: RunInvokeWithRetriesInput,
  ): Promise<RunInvokeWithRetriesResult>;
  async function runInvokeWithRetriesFake(
    input: RunInvokeWithRetriesInput,
  ): Promise<RunInvokeWithRetriesResult> {
    const value = await input.runAttempt({
      attempt: 1,
      maxAttempts: input.maxAttempts ?? 1,
      session: beginInvokeSessionResult({
        sessionId: "session_active",
        beginTs: 1781913600123,
        path: input.path,
        kind: input.kind ?? "query",
        schemaVersion: 12,
        executionModule: "_flarex/execution.js",
      }),
      syscall: async () => invokeSyscallResult(null),
    });
    if (input.kind === "mutation") {
      return {
        value,
        committedTs: 1781913600124,
        writes: [],
        attempts: 1,
        beginTs: 1781913600123,
      };
    }
    return {
      value,
      readSet: {},
      readTs: 1781913600123,
      attempts: 1,
      beginTs: 1781913600123,
    };
  }

  return {
    async activateDeploymentPackage() {
      throw new Error("activateDeploymentPackage is not implemented by test fake");
    },
    async ensureDeployment() {
      throw new Error("ensureDeployment is not implemented by test fake");
    },
    async getActiveFunction() {
      throw new Error("getActiveFunction is not implemented by test fake");
    },
    async getActiveDeploymentPackage() {
      throw new Error(
        "getActiveDeploymentPackage is not implemented by test fake",
      );
    },
    async beginInvokeSession() {
      return beginInvokeSessionResult({
        sessionId: "session_active",
        beginTs: 1781913600123,
        path: "messages:list",
        kind: "query",
        schemaVersion: 12,
        executionModule: "_flarex/execution.js",
      });
    },
    async finishInvokeSession(input) {
      return {
        value: input.value,
        readSet: {},
        readTs: 1781913600123,
      };
    },
    async abortInvokeSession() {
      return { aborted: true };
    },
    async abortStaleInvokeSessions() {
      return { aborted: 0, sessions: [], hasMore: false };
    },
    async runInvokeSessionMaintenance() {
      return { staleAborted: 0, sessions: [], hasMore: false };
    },
    async listMaintenanceDeployments() {
      return { deployments: [], nextCursor: null, hasMore: false };
    },
    async listUndeliveredOutboxEvents() {
      return { events: [], nextCursor: null, hasMore: false };
    },
    async markOutboxEventsDelivered() {
      return { delivered: 0 };
    },
    async runOutboxDeliveryBatch() {
      return { events: [], delivered: 0, nextCursor: null, hasMore: false };
    },
    async listUndeliveredLiveQueryDeliveries() {
      return { deliveries: [], nextCursor: null, hasMore: false };
    },
    async markLiveQueryDeliveriesDelivered() {
      return { delivered: 0 };
    },
    async claimLiveQueryDeliveryBatch() {
      return { deliveries: [], nextCursor: null, hasMore: false };
    },
    async ackLiveQueryDeliveries() {
      return { delivered: 0 };
    },
    async runLiveQueryDeliveryBatch() {
      return {
        deliveries: [],
        delivered: 0,
        nextCursor: null,
        hasMore: false,
        summary: {
          claimed: 0,
          delivered: 0,
          acked: 0,
          pending: 0,
          hasMore: false,
        },
      };
    },
    async listPendingLiveQueryDeliveryDeployments() {
      return { deployments: [], nextCursor: null, hasMore: false };
    },
    async listStuckLiveQueryDeliveries() {
      return { deliveries: [], nextCursor: null, hasMore: false };
    },
    async markLiveQueryDeliveriesDeadLettered() {
      return { deadLettered: 0, deliveries: [] };
    },
    async deadLetterStuckLiveQueryDeliveries() {
      return {
        scanned: [],
        deadLettered: [],
        reconnectConnectionIds: [],
        nextCursor: null,
        hasMore: false,
        summary: {
          scanned: 0,
          deadLettered: 0,
          reconnectTargets: 0,
          hasMore: false,
        },
      };
    },
    async recordLiveQueryDeliveryFailure() {
      return { failed: 0 };
    },
    async touchLiveQueryConnection() {
      throw new Error(
        "touchLiveQueryConnection is not implemented by test fake",
      );
    },
    async recordLiveQuerySubscription() {
      throw new Error(
        "recordLiveQuerySubscription is not implemented by test fake",
      );
    },
    async removeLiveQuerySubscription() {
      throw new Error(
        "removeLiveQuerySubscription is not implemented by test fake",
      );
    },
    async removeLiveQuerySubscriptionsForConnection() {
      throw new Error(
        "removeLiveQuerySubscriptionsForConnection is not implemented by test fake",
      );
    },
    async removeExpiredLiveQuerySubscriptions() {
      throw new Error(
        "removeExpiredLiveQuerySubscriptions is not implemented by test fake",
      );
    },
    async listExpiredLiveQueryConnectionDeployments() {
      throw new Error(
        "listExpiredLiveQueryConnectionDeployments is not implemented by test fake",
      );
    },
    async findStaleLiveQuerySubscriptions() {
      throw new Error(
        "findStaleLiveQuerySubscriptions is not implemented by test fake",
      );
    },
    async rerunLiveQuerySubscription() {
      throw new Error(
        "rerunLiveQuerySubscription is not implemented by test fake",
      );
    },
    async rerunStaleLiveQuerySubscriptions() {
      throw new Error(
        "rerunStaleLiveQuerySubscriptions is not implemented by test fake",
      );
    },
    async runLiveQuerySubscriptionWithInvoke() {
      throw new Error(
        "runLiveQuerySubscriptionWithInvoke is not implemented by test fake",
      );
    },
    async runMaintenanceSweep() {
      return {
        deployments: [],
        nextDeploymentCursor: null,
        hasMoreDeployments: false,
      };
    },
    runInvokeWithRetries: runInvokeWithRetriesFake,
    async invokeSyscall() {
      return invokeSyscallResult(null);
    },
    async prepareInvoke(input) {
      return preparedInvokeResult({
        deploymentId: input.deploymentId,
        packageId: "package_active",
        path: input.path,
        kind: input.kind ?? "query",
        schemaVersion: 12,
        executionModule: "_flarex/execution.js",
      });
    },
    async registerDeploymentPackage() {
      throw new Error("registerDeploymentPackage is not implemented by test fake");
    },
    async health() {
      return {
        service: "executor",
        status: "ok",
        persistence: { status: "ok" },
        time: "2026-06-19T00:00:00.000Z",
      };
    },
    ...overrides,
  };
}

function invokeSyscallResult(value: unknown): InvokeSyscallResult {
  return { value: value as InvokeSyscallResult["value"] };
}

function beginInvokeSessionResult(input: {
  sessionId: string;
  beginTs: number;
  path: string;
  kind: "query" | "mutation";
  schemaVersion: number;
  executionModule: string;
  identity?: BeginInvokeSessionResult["identity"];
}): BeginInvokeSessionResult {
  return {
    sessionId: input.sessionId,
    beginTs: input.beginTs,
    identity: input.identity ?? { kind: "anonymous" },
    schemaVersion: input.schemaVersion,
    function: {
      path: input.path,
      kind: input.kind,
    },
    scope: {
      kind: "partition",
      table: "teams",
      selector: "byId",
      partitionField: "_id",
      argField: "teamId",
      partitionKey: "team:1",
    },
    executionModule: input.executionModule,
  };
}

function preparedInvokeResult(input: {
  deploymentId: string;
  packageId: string;
  path: string;
  kind: "query" | "mutation";
  schemaVersion: number;
  executionModule: string;
}): PrepareInvokeResult {
  return {
    deployment: {
      deploymentId: input.deploymentId,
      projectId: "project_active",
      activePackageId: input.packageId,
      activeSchemaVersion: input.schemaVersion,
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
    },
    package: {
      deploymentId: input.deploymentId,
      packageId: input.packageId,
      sourcePackageHash: "a".repeat(64),
      executionModule: input.executionModule,
      sourcePackageJson: {},
      analysisJson: null,
      createdAt: new Date("2026-06-19T00:00:00.000Z"),
    },
    function: {
      path: input.path,
      kind: input.kind,
    },
    schema: {
      version: input.schemaVersion,
      tables: [],
      indexes: [],
    },
    scope: {
      kind: "partition",
      table: "teams",
      selector: "byId",
      partitionField: "_id",
      argField: "teamId",
      partitionKey: "team:1",
    },
    executionModule: input.executionModule,
  };
}

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function liveQuerySubscription(
  overrides: Partial<Parameters<RerunStaleLiveQuerySubscriptionsInput["runQuery"]>[0]> = {},
): Parameters<RerunStaleLiveQuerySubscriptionsInput["runQuery"]>[0] {
  return {
    deploymentId: "deployment_active",
    connectionId: "connection_a",
    queryId: 1,
    functionPath: "messages:list",
    argsJson: { teamId: "team_a" },
    partitionKey: "team_a",
    beginTs: 10,
    readSetJson: { documents: [{ tableId: 1, id: "1:message", observedTs: 10 }] },
    resultJson: null,
    resultHash: "null",
    createdAt: new Date("2026-06-19T00:00:00.000Z"),
    updatedAt: new Date("2026-06-19T00:00:00.000Z"),
    ...overrides,
  };
}

function testFreshnessStore(): RerunStaleLiveQuerySubscriptionsInput["freshnessStore"] {
  return {
    async applyCommitFreshness() {
      return {
        applied: true,
        documentVersions: [],
        tableVersions: [],
      };
    },
    getDocumentVersion() {
      return null;
    },
    getTableVersion() {
      return null;
    },
  };
}

async function expectPrepareError(error: Error): Promise<{
  status: number;
  body: unknown;
}> {
  const app = createFlarexHttpApp({
    executor: fakeExecutor({
      async prepareInvoke() {
        throw error;
      },
    }),
  });
  const response = await app.handle(
    jsonRequest("https://executor.test/invoke/prepare", {
      deploymentId: "deployment_active",
      projectId: "project_active",
      path: "messages:list",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    }),
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function expectSyscallError(error: Error): Promise<{
  status: number;
  body: unknown;
}> {
  const app = createFlarexHttpApp({
    executor: fakeExecutor({
      async invokeSyscall() {
        throw error;
      },
    }),
  });
  const response = await app.handle(
    jsonRequest("https://executor.test/invoke/syscall", {
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      op: "get",
      id: "1:message",
    }),
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}

async function expectFinishError(error: Error): Promise<{
  status: number;
  body: unknown;
}> {
  const app = createFlarexHttpApp({
    executor: fakeExecutor({
      async finishInvokeSession() {
        throw error;
      },
    }),
  });
  const response = await app.handle(
    jsonRequest("https://executor.test/invoke/finish", {
      deploymentId: "deployment_active",
      projectId: "project_active",
      sessionId: "session_active",
      value: null,
    }),
  );

  return {
    status: response.status,
    body: await response.json(),
  };
}
