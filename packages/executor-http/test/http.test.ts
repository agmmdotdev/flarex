import { describe, expect, it } from "vitest";
import {
  DeploymentNotFoundError,
  DeploymentPackageNotActivatedError,
  DeploymentProjectMismatchError,
  FlarexDocumentIdFormatError,
  FlarexInsertIdTableMismatchError,
  FunctionKindMismatchError,
  FunctionNotFoundError,
  FunctionNotInvokableError,
  InvokeFinishNotImplementedError,
  InvokeSessionNotFoundError,
  InvokeSessionDocumentWriteAlreadyExistsError,
  InvokeSessionInsertConflictError,
  InvokeSessionOccConflictError,
  InvokeSyscallNotImplementedError,
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
} from "@flarex/executor";

import { createFlarexHttpApp } from "../src";

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
      }),
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
      },
    ]);
    await expect(response.json()).resolves.toEqual({
      sessionId: "session_active",
      beginTs: 1781913600123,
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
      message: "op must be get, query, insert, patch, or delete.",
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
    async runMaintenanceSweep() {
      return {
        deployments: [],
        nextDeploymentCursor: null,
        hasMoreDeployments: false,
      };
    },
    async runInvokeWithRetries(input) {
      return {
        value: await input.runAttempt({
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
        }),
        attempts: 1,
      };
    },
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
}): BeginInvokeSessionResult {
  return {
    sessionId: input.sessionId,
    beginTs: input.beginTs,
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
