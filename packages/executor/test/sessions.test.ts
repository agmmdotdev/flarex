import { describe, expect, it } from "vitest";
import type { ArtifactSourcePackage } from "flarex/artifacts";
import {
  FlarexDocumentIdFormatError,
  InvokeSessionMetadataAlreadyExistsError,
  InvokeSessionOccConflictError,
  type DocumentRevisionRecord,
  type PersistenceJson,
} from "@flarex/persistence-postgres";

import {
  createFlarexExecutor,
  DeploymentProjectMismatchError,
  FlarexInsertIdTableMismatchError,
  InvokeDeleteDocumentNotFoundError,
  InvokePatchDocumentNotFoundError,
  InvokePatchValueError,
  InvokeQueryRequestError,
  InvokeRetryExhaustedError,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSyscallNotAllowedError,
} from "../src";
import {
  deploymentMetadata,
  deploymentPackageMetadata,
  invokeSessionMetadata,
  memoryPersistence,
} from "./helpers/persistence";

describe("executor invoke sessions", () => {
  it("begins an invoke session from prepared invoke metadata", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.123Z") },
      ids: { nextId: () => "session_fixed" },
      persistence,
    });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      packageId: registered.package.packageId,
      schemaVersion: 5,
    });

    await expect(
      executor.beginInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        path: "messages:list",
        kind: "query",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
        idempotencyKey: "idem_1",
      }),
    ).resolves.toEqual({
      sessionId: "session_fixed",
      beginTs: 1781913600123,
      schemaVersion: 5,
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

    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_fixed",
      ),
    ).resolves.toMatchObject({
      deploymentId: "deployment_session",
      sessionId: "session_fixed",
      projectId: "project_session",
      packageId: registered.package.packageId,
      functionPath: "messages:list",
      functionKind: "query",
      partitionKey: "team:1",
      scopeJson: {
        kind: "partition",
        partitionKey: "team:1",
      },
      argsJson: { teamId: "team:1" },
      idempotencyKey: "idem_1",
      state: "active",
      beginTs: 1781913600123,
      schemaVersion: 5,
      executionModule: "_flarex/execution.js",
    });
  });

  it("surfaces duplicate generated session ids", async () => {
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.123Z") },
      ids: { nextId: () => "session_duplicate" },
      persistence,
    });

    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      packageId: registered.package.packageId,
      schemaVersion: 5,
    });

    await executor.beginInvokeSession({
      deploymentId: "deployment_session",
      projectId: "project_session",
      path: "messages:list",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    });

    await expect(
      executor.beginInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        path: "messages:list",
        args: { teamId: "team:1" },
        partitionKey: "team:1",
      }),
    ).rejects.toThrow(InvokeSessionMetadataAlreadyExistsError);
  });

  it("retries mutation attempts after commit-time OCC conflicts", async () => {
    const persistence = memoryPersistence(
      [],
      [],
      [],
      [
        documentRevision({
          id: "1:team",
          documentId: "team",
          ts: 10,
          value: { name: "old", count: 0 },
        }),
      ],
    );
    let nowMs = 15;
    let nextSession = 0;
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(nowMs) },
      ids: { nextId: () => `session_retry_${++nextSession}` },
      persistence,
    });
    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      packageId: registered.package.packageId,
      schemaVersion: 5,
    });

    const observedAttempts: Array<{ attempt: number; value: unknown }> = [];
    const result = await executor.runInvokeWithRetries({
      deploymentId: "deployment_session",
      projectId: "project_session",
      path: "messages:send",
      kind: "mutation",
      args: { teamId: "1:team", text: "hello" },
      partitionKey: "1:team",
      maxAttempts: 2,
      runAttempt: async (attempt) => {
        const team = await attempt.syscall({ op: "get", id: "1:team" });
        observedAttempts.push({ attempt: attempt.attempt, value: team.value });

        if (attempt.attempt === 1) {
          await commitConcurrentTeamPatch({
            persistence,
            packageId: registered.package.packageId,
            sessionId: "session_concurrent",
            minimumTs: nowMs,
            value: { name: "new", count: 1 },
          });
          nowMs = 20;
        }

        await attempt.syscall({
          op: "patch",
          id: "1:team",
          value: { count: 2 },
        });
        return { ok: true, attempt: attempt.attempt };
      },
    });

    expect(result).toMatchObject({
      value: { ok: true, attempt: 2 },
      attempts: 2,
      committedTs: 21,
      writes: [
        {
          tableId: 1,
          id: "1:team",
          prevTs: 16,
          ts: 21,
          value: { name: "new", count: 2 },
        },
      ],
    });
    expect(observedAttempts).toEqual([
      {
        attempt: 1,
        value: { _id: "1:team", name: "old", count: 0 },
      },
      {
        attempt: 2,
        value: { _id: "1:team", name: "new", count: 1 },
      },
    ]);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_retry_1",
      ),
    ).resolves.toMatchObject({ state: "aborted" });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_retry_2",
      ),
    ).resolves.toMatchObject({ state: "finished" });
  });

  it("returns a retry-exhausted error after repeated OCC conflicts", async () => {
    const persistence = memoryPersistence(
      [],
      [],
      [],
      [
        documentRevision({
          id: "1:team",
          documentId: "team",
          ts: 10,
          value: { name: "old", count: 0 },
        }),
      ],
    );
    let nowMs = 15;
    let nextSession = 0;
    const executor = createFlarexExecutor({
      clock: { now: () => new Date(nowMs) },
      ids: { nextId: () => `session_retry_${++nextSession}` },
      persistence,
    });
    const registered = await executor.registerDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await executor.activateDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      packageId: registered.package.packageId,
      schemaVersion: 5,
    });

    const attempts: number[] = [];
    await expect(
      executor.runInvokeWithRetries({
        deploymentId: "deployment_session",
        projectId: "project_session",
        path: "messages:send",
        kind: "mutation",
        args: { teamId: "1:team", text: "hello" },
        partitionKey: "1:team",
        maxAttempts: 2,
        runAttempt: async (attempt) => {
          attempts.push(attempt.attempt);
          await attempt.syscall({ op: "get", id: "1:team" });
          const concurrent = await commitConcurrentTeamPatch({
            persistence,
            packageId: registered.package.packageId,
            sessionId: `session_concurrent_${attempt.attempt}`,
            minimumTs: nowMs,
            value: { name: "concurrent", count: attempt.attempt },
          });
          nowMs = concurrent.committedTs + 4;
          await attempt.syscall({
            op: "patch",
            id: "1:team",
            value: { count: 100 + attempt.attempt },
          });
          return { ok: true };
        },
      }),
    ).rejects.toThrow(InvokeRetryExhaustedError);

    expect(attempts).toEqual([1, 2]);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_retry_1",
      ),
    ).resolves.toMatchObject({ state: "aborted" });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_retry_2",
      ),
    ).resolves.toMatchObject({ state: "aborted" });
  });

  it("rejects syscalls for missing sessions", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_missing",
        syscall: { op: "get", id: "1:message" },
      }),
    ).rejects.toThrow(InvokeSessionNotFoundError);
  });

  it("rejects syscalls for sessions owned by another project", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [
        activeSession({ projectId: "project_actual" }),
      ]),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_requested",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:message" },
      }),
    ).rejects.toThrow(InvokeSessionProjectMismatchError);
  });

  it("rejects syscalls for inactive sessions", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [
        activeSession({ state: "finished" }),
      ]),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:message" },
      }),
    ).rejects.toThrow(InvokeSessionNotActiveError);
  });

  it("rejects write syscalls during query sessions", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [activeSession()]),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "insert", table: "messages", value: { text: "hello" } },
      }),
    ).rejects.toThrow(InvokeSyscallNotAllowedError);
  });

  it("reads a document revision at the session begin timestamp", async () => {
    const persistence = memoryPersistence([], [], [activeSession({ beginTs: 15 })], [
      documentRevision({
        ts: 10,
        value: { text: "old" },
      }),
      documentRevision({
        ts: 20,
        value: { text: "new" },
        prevTs: 10,
      }),
    ]);
    const executor = createFlarexExecutor({
      persistence,
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:message" },
      }),
    ).resolves.toEqual({
      value: { _id: "1:message", text: "old" },
      readSet: {
        documents: [{ tableId: 1, id: "1:message" }],
      },
    });
    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        deploymentId: "deployment_session",
        sessionId: "session_active",
        tableId: 1,
        documentId: "1:message",
        observedTs: 10,
      },
    ]);
  });

  it("returns null and a document read for missing document revisions", async () => {
    const persistence = memoryPersistence([], [], [activeSession()]);
    const executor = createFlarexExecutor({
      persistence,
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:missing" },
      }),
    ).resolves.toEqual({
      value: null,
      readSet: {
        documents: [{ tableId: 1, id: "1:missing" }],
      },
    });
    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: "1:missing",
        observedTs: null,
      },
    ]);
  });

  it("returns null for deleted document revisions", async () => {
    const persistence = memoryPersistence([], [], [activeSession()], [
      documentRevision({
        ts: 10,
        value: { text: "old" },
      }),
      documentRevision({
        ts: 20,
        value: null,
        deleted: true,
        prevTs: 10,
      }),
    ]);
    const executor = createFlarexExecutor({
      persistence,
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:message" },
      }),
    ).resolves.toEqual({
      value: null,
      readSet: {
        documents: [{ tableId: 1, id: "1:message" }],
      },
    });
    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: "1:message",
        observedTs: 20,
      },
    ]);
  });

  it("dedupes persisted document reads for repeated get syscalls", async () => {
    const persistence = memoryPersistence([], [], [activeSession()], [
      documentRevision({
        ts: 10,
        value: { text: "old" },
      }),
    ]);
    const executor = createFlarexExecutor({
      persistence,
    });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: { op: "get", id: "1:message" },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: { op: "get", id: "1:message" },
    });

    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toHaveLength(1);
  });

  it("finishes query sessions with accumulated document reads", async () => {
    const persistence = memoryPersistence([], [], [activeSession()], [], [
      documentRead({ documentId: "1:message", observedTs: 10 }),
      documentRead({ tableId: 2, documentId: "2:lesson", observedTs: null }),
    ]);
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: [{ _id: "1:message", text: "old" }],
      }),
    ).resolves.toEqual({
      value: [{ _id: "1:message", text: "old" }],
      readSet: {
        documents: [
          { tableId: 1, id: "1:message" },
          { tableId: 2, id: "2:lesson" },
        ],
      },
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject({
      state: "finished",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
  });

  it("finishes mutation sessions by committing staged inserts", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 100 })],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "insert",
        table: "teams",
        id: "1:team_insert",
        value: { name: "Team" },
      },
    });

    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: "ok",
      }),
    ).resolves.toEqual({
      value: "ok",
      committedTs: 101,
      writes: [
        {
          tableId: 1,
          id: "1:team_insert",
          prevTs: null,
          ts: 101,
          value: { name: "Team" },
        },
      ],
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject({
      state: "finished",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
  });

  it("rejects mutation finish when an observed document changed", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:read",
          documentId: "read",
          ts: 10,
          value: { text: "old" },
        }),
        documentRevision({
          id: "1:read",
          documentId: "read",
          ts: 20,
          value: { text: "new" },
          prevTs: 10,
        }),
      ],
      [documentRead({ documentId: "1:read", observedTs: 10 })],
    );
    const executor = createFlarexExecutor({
      persistence,
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "insert",
        table: "teams",
        id: "1:team_insert",
        value: { name: "Team" },
      },
    });

    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: null,
      }),
    ).rejects.toThrow(InvokeSessionOccConflictError);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject({
      state: "active",
      finishedAt: null,
    });
  });

  it("rejects finishing inactive sessions", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [
        activeSession({ state: "finished" }),
      ]),
    });

    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: null,
      }),
    ).rejects.toThrow(InvokeSessionNotActiveError);
  });

  it("aborts active sessions without committing staged work", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation" })],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "insert",
        table: "teams",
        id: "1:team_abort",
        value: { name: "Team" },
      },
    });

    await expect(
      executor.abortInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
      }),
    ).resolves.toEqual({ aborted: true });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject({
      state: "aborted",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    await expect(
      persistence.getDocumentRevisionAtTs("deployment_session", "1:team_abort", 1),
    ).resolves.toBeNull();
  });

  it("aborts stale active sessions for a deployment", async () => {
    const persistence = memoryPersistence(
      [
        deploymentMetadata({
          deploymentId: "deployment_session",
          projectId: "project_session",
        }),
      ],
      [],
      [
        {
          ...activeSession({ sessionId: "session_old" }),
          createdAt: new Date("2026-06-19T00:00:00.000Z"),
        },
        {
          ...activeSession({ sessionId: "session_recent" }),
          createdAt: new Date("2026-06-20T00:00:00.000Z"),
        },
        {
          ...activeSession({
            sessionId: "session_finished",
            state: "finished",
          }),
          createdAt: new Date("2026-06-19T00:00:00.000Z"),
        },
      ],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T01:00:00.000Z") },
      persistence,
    });

    await expect(
      executor.abortStaleInvokeSessions({
        deploymentId: "deployment_session",
        projectId: "project_session",
        olderThan: new Date("2026-06-19T12:00:00.000Z"),
      }),
    ).resolves.toEqual({
      aborted: 1,
      sessions: ["session_old"],
      hasMore: false,
    });
    await expect(
      persistence.getInvokeSessionMetadata("deployment_session", "session_old"),
    ).resolves.toMatchObject({
      state: "aborted",
      finishedAt: new Date("2026-06-20T01:00:00.000Z"),
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_recent",
      ),
    ).resolves.toMatchObject({ state: "active", finishedAt: null });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_finished",
      ),
    ).resolves.toMatchObject({ state: "finished" });
  });

  it("rejects stale session aborts for the wrong project", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([
        deploymentMetadata({
          deploymentId: "deployment_session",
          projectId: "project_actual",
        }),
      ]),
    });

    await expect(
      executor.abortStaleInvokeSessions({
        deploymentId: "deployment_session",
        projectId: "project_requested",
        olderThan: new Date("2026-06-19T12:00:00.000Z"),
      }),
    ).rejects.toThrow(DeploymentProjectMismatchError);
  });

  it("rejects syscalls after abort", async () => {
    const persistence = memoryPersistence([], [], [activeSession()]);
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await executor.abortInvokeSession({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:message" },
      }),
    ).rejects.toThrow(InvokeSessionNotActiveError);
  });

  it("rejects malformed document ids before persistence lookup", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [activeSession()]),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "bad" },
      }),
    ).rejects.toThrow(FlarexDocumentIdFormatError);
  });

  it("runs table query syscalls at the session snapshot", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ beginTs: 15 })],
      [
        documentRevision({
          id: "1:a",
          documentId: "a",
          ts: 10,
          value: { name: "First" },
        }),
        documentRevision({
          id: "1:b",
          documentId: "b",
          ts: 20,
          value: { name: "Too new" },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "query", request: { table: "teams" } },
      }),
    ).resolves.toEqual({
      value: {
        page: [{ _id: "1:a", name: "First" }],
        isDone: true,
        continueCursor: "1:a",
      },
      readSet: { tables: [{ tableId: 1 }] },
    });
    await expect(
      persistence.listInvokeSessionTableReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      { tableId: 1, observedTs: 15 },
    ]);
  });

  it("rejects malformed query syscall requests", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [activeSession()]),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "query", request: { table: "" } },
      }),
    ).rejects.toThrow(InvokeQueryRequestError);
  });

  it("stages insert syscalls during mutation sessions", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation" })],
    );
    const executor = createFlarexExecutor({
      persistence,
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "insert",
          table: "teams",
          id: "1:team_insert",
          value: { name: "Team" },
        },
      }),
    ).resolves.toEqual({ value: "1:team_insert" });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        deploymentId: "deployment_session",
        sessionId: "session_active",
        tableId: 1,
        documentId: "1:team_insert",
        op: "insert",
        valueJson: { name: "Team" },
      },
    ]);
  });

  it("reads staged inserts inside the same mutation session", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
    );
    const executor = createFlarexExecutor({ persistence });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "insert",
        table: "teams",
        id: "1:team_insert",
        value: { name: "Team" },
      },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:team_insert" },
      }),
    ).resolves.toEqual({
      value: { _id: "1:team_insert", name: "Team" },
      readSet: { documents: [{ tableId: 1, id: "1:team_insert" }] },
    });
    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toEqual([]);
  });

  it("coalesces insert then patch inside one mutation session", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "insert",
        table: "teams",
        id: "1:team_insert",
        value: { name: "Draft", count: 0 },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:team_insert",
        value: { name: "Final", count: 1 },
      },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:team_insert" },
      }),
    ).resolves.toEqual({
      value: { _id: "1:team_insert", name: "Final", count: 1 },
      readSet: { documents: [{ tableId: 1, id: "1:team_insert" }] },
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:team_insert",
        op: "insert",
        valueJson: { name: "Final", count: 1 },
      },
    ]);
    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: "1:team_insert",
      }),
    ).resolves.toMatchObject({
      value: "1:team_insert",
      writes: [
        {
          id: "1:team_insert",
          prevTs: null,
          value: { name: "Final", count: 1 },
        },
      ],
    });
  });

  it("generates ids for insert syscalls without caller supplied ids", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation" })],
    );
    const executor = createFlarexExecutor({ persistence });

    const result = await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: { op: "insert", table: "teams", value: { name: "Team" } },
    });

    expect(result.value).toEqual(expect.stringMatching(/^1:.+/));
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: result.value,
        op: "insert",
        valueJson: { name: "Team" },
      },
    ]);
  });

  it("stages patch syscalls with document reads during mutation sessions", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_patch",
          documentId: "team_patch",
          ts: 10,
          value: { name: "Old", count: 1 },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "patch",
          id: "1:team_patch",
          value: { count: 2 },
        },
      }),
    ).resolves.toEqual({
      value: null,
      readSet: { documents: [{ tableId: 1, id: "1:team_patch" }] },
    });
    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: "1:team_patch",
        observedTs: 10,
      },
    ]);
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: "1:team_patch",
        op: "patch",
        valueJson: { count: 2 },
      },
    ]);
  });

  it("reads staged patches inside the same mutation session", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_patch",
          documentId: "team_patch",
          ts: 10,
          value: { name: "Old", count: 1 },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:team_patch",
        value: { count: 2 },
      },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:team_patch" },
      }),
    ).resolves.toEqual({
      value: { _id: "1:team_patch", name: "Old", count: 2 },
      readSet: { documents: [{ tableId: 1, id: "1:team_patch" }] },
    });
  });

  it("coalesces repeated patches inside one mutation session", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_patch",
          documentId: "team_patch",
          ts: 10,
          value: { name: "Old", count: 1, keep: true },
        }),
      ],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:team_patch",
        value: { name: "First" },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:team_patch",
        value: { count: 2 },
      },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:team_patch" },
      }),
    ).resolves.toEqual({
      value: { _id: "1:team_patch", name: "First", count: 2, keep: true },
      readSet: { documents: [{ tableId: 1, id: "1:team_patch" }] },
    });
    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: null,
      }),
    ).resolves.toMatchObject({
      writes: [
        {
          id: "1:team_patch",
          prevTs: 10,
          value: { name: "First", count: 2, keep: true },
        },
      ],
    });
  });

  it("commits mutation patch syscalls after OCC validation", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_patch",
          documentId: "team_patch",
          ts: 10,
          value: { name: "Old", count: 1 },
        }),
      ],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:team_patch",
        value: { count: 2 },
      },
    });

    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: null,
      }),
    ).resolves.toEqual({
      value: null,
      committedTs: 16,
      writes: [
        {
          tableId: 1,
          id: "1:team_patch",
          prevTs: 10,
          ts: 16,
          value: { name: "Old", count: 2 },
        },
      ],
    });
  });

  it("rejects patch syscalls for missing documents", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [],
        [activePackage()],
        [activeSession({ functionKind: "mutation" })],
      ),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "patch",
          id: "1:missing",
          value: { count: 2 },
        },
      }),
    ).rejects.toThrow(InvokePatchDocumentNotFoundError);
  });

  it("rejects non-object patch values", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [],
        [activePackage()],
        [activeSession({ functionKind: "mutation" })],
      ),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "patch",
          id: "1:team_patch",
          value: ["bad"],
        },
      }),
    ).rejects.toThrow(InvokePatchValueError);
  });

  it("stages delete syscalls with document reads during mutation sessions", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_delete",
          documentId: "team_delete",
          ts: 10,
          value: { name: "Team" },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "delete",
          id: "1:team_delete",
        },
      }),
    ).resolves.toEqual({
      value: null,
      readSet: { documents: [{ tableId: 1, id: "1:team_delete" }] },
    });
    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: "1:team_delete",
        observedTs: 10,
      },
    ]);
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: "1:team_delete",
        op: "delete",
        valueJson: null,
      },
    ]);
  });

  it("hides staged deletes inside the same mutation session", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_delete",
          documentId: "team_delete",
          ts: 10,
          value: { name: "Team" },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "delete",
        id: "1:team_delete",
      },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:team_delete" },
      }),
    ).resolves.toEqual({
      value: null,
      readSet: { documents: [{ tableId: 1, id: "1:team_delete" }] },
    });
  });

  it("coalesces insert then delete into no committed write", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "insert",
        table: "teams",
        id: "1:temporary",
        value: { name: "Temporary" },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: { op: "delete", id: "1:temporary" },
    });

    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toEqual([]);
    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:temporary" },
      }),
    ).resolves.toEqual({
      value: null,
      readSet: { documents: [{ tableId: 1, id: "1:temporary" }] },
    });
    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: null,
      }),
    ).resolves.toMatchObject({
      writes: [],
    });
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_session",
        "1:temporary",
        20,
      ),
    ).resolves.toBeNull();
  });

  it("rejects patch after a staged delete", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_delete",
          documentId: "team_delete",
          ts: 10,
          value: { name: "Team" },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: { op: "delete", id: "1:team_delete" },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "patch",
          id: "1:team_delete",
          value: { name: "Bad" },
        },
      }),
    ).rejects.toThrow(InvokePatchDocumentNotFoundError);
  });

  it("commits mutation delete syscalls after OCC validation", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_delete",
          documentId: "team_delete",
          ts: 10,
          value: { name: "Team" },
        }),
      ],
    );
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
    });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "delete",
        id: "1:team_delete",
      },
    });

    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: null,
      }),
    ).resolves.toEqual({
      value: null,
      committedTs: 16,
      writes: [
        {
          tableId: 1,
          id: "1:team_delete",
          prevTs: 10,
          ts: 16,
          value: null,
        },
      ],
    });
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_session",
        "1:team_delete",
        16,
      ),
    ).resolves.toMatchObject({
      deleted: true,
      prevTs: 10,
      value: null,
    });
  });

  it("rejects delete syscalls for missing documents", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [],
        [activePackage()],
        [activeSession({ functionKind: "mutation" })],
      ),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "delete",
          id: "1:missing",
        },
      }),
    ).rejects.toThrow(InvokeDeleteDocumentNotFoundError);
  });

  it("rejects insert ids that do not match the table", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence(
        [],
        [activePackage()],
        [activeSession({ functionKind: "mutation" })],
      ),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "insert",
          table: "teams",
          id: "2:wrong_table",
          value: { name: "Team" },
        },
      }),
    ).rejects.toThrow(FlarexInsertIdTableMismatchError);
  });

  it("overlays staged writes onto table query results", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:a",
          documentId: "a",
          ts: 10,
          value: { name: "First", count: 1 },
        }),
        documentRevision({
          id: "1:b",
          documentId: "b",
          ts: 10,
          value: { name: "Second", count: 1 },
        }),
        documentRevision({
          id: "1:future",
          documentId: "future",
          ts: 20,
          value: { name: "Too new", count: 1 },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "insert",
        table: "teams",
        id: "1:c",
        value: { name: "Third", count: 1 },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:a",
        value: { count: 2 },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: { op: "delete", id: "1:b" },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "query", request: { table: "teams" } },
      }),
    ).resolves.toEqual({
      value: {
        page: [
          { _id: "1:a", name: "First", count: 2 },
          { _id: "1:c", name: "Third", count: 1 },
        ],
        isDone: true,
        continueCursor: "1:c",
      },
      readSet: { tables: [{ tableId: 1 }] },
    });
  });

  it("overlays staged writes onto indexed query results", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:a",
          documentId: "a",
          ts: 10,
          value: { name: "Target", count: 1 },
        }),
        documentRevision({
          id: "1:b",
          documentId: "b",
          ts: 10,
          value: { name: "Old", count: 1 },
        }),
        documentRevision({
          id: "1:d",
          documentId: "d",
          ts: 10,
          value: { name: "Target", count: 1 },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "delete",
        id: "1:a",
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:b",
        value: { name: "Target", count: 2 },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "insert",
        table: "teams",
        id: "1:c",
        value: { name: "Target", count: 3 },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:d",
        value: { name: "Other", count: 4 },
      },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: {
          op: "query",
          request: {
            table: "teams",
            index: "by_name",
            range: {
              expressions: [{ op: "eq", field: "name", value: "Target" }],
            },
          },
        },
      }),
    ).resolves.toEqual({
      value: {
        page: [
          { _id: "1:b", name: "Target", count: 2 },
          { _id: "1:c", name: "Target", count: 3 },
        ],
        isDone: true,
        continueCursor: expect.any(String),
      },
      readSet: {
        indexes: [
          {
            indexId: 1,
            lower: expect.any(String),
            upper: expect.any(String),
          },
        ],
      },
    });
  });
});

function sourcePackage(): ArtifactSourcePackage {
  return {
    modules: [
      {
        path: "messages.js",
        environment: "isolate",
        sha256: "a".repeat(64),
      },
    ],
    functions: ["messages.js"],
    execution: "_flarex/execution.js",
  };
}

function analysisJson(): Record<string, unknown> {
  return {
    schema: {
      version: 5,
      tables: [
        {
          tableId: 1,
          name: "teams",
          placement: { kind: "partitionBy", field: "_id" },
        },
      ],
      indexes: [
        {
          indexId: 1,
          tableId: 1,
          name: "by_name",
          fields: ["name"],
        },
      ],
    },
    functions: {
      functions: [
        {
          path: "messages:list",
          kind: "query",
          route: { type: "args", field: "teamId" },
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
        {
          path: "messages:send",
          kind: "mutation",
          route: { type: "args", field: "teamId" },
          partition: {
            type: "partition",
            table: "teams",
            selector: "byId",
            partitionField: "_id",
            argField: "teamId",
          },
        },
      ],
    },
  };
}

function activeSession(
  overrides: Partial<Parameters<typeof invokeSessionMetadata>[0]> = {},
) {
  return invokeSessionMetadata({
    deploymentId: "deployment_session",
    sessionId: "session_active",
    projectId: "project_session",
    packageId: "package_active",
    functionPath: "messages:list",
    functionKind: "query",
    partitionKey: "team:1",
    scopeJson: {
      kind: "partition",
      table: "teams",
      selector: "byId",
      partitionField: "_id",
      argField: "teamId",
      partitionKey: "team:1",
    },
    argsJson: { teamId: "team:1" },
    beginTs: 1781913600123,
    schemaVersion: 5,
    executionModule: "_flarex/execution.js",
    ...overrides,
  });
}

function activePackage() {
  return deploymentPackageMetadata({
    deploymentId: "deployment_session",
    packageId: "package_active",
    sourcePackageHash: "a".repeat(64),
    executionModule: "_flarex/execution.js",
    sourcePackageJson: sourcePackage(),
    analysisJson: analysisJson(),
  });
}

function documentRevision(
  overrides: Partial<DocumentRevisionRecord> = {},
): DocumentRevisionRecord {
  return {
    deploymentId: "deployment_session",
    id: "1:message",
    tableId: 1,
    documentId: "message",
    ts: 10,
    value: { text: "old" },
    deleted: false,
    prevTs: null,
    ...overrides,
  };
}

function documentRead(overrides: {
  tableId?: number;
  documentId: string;
  observedTs?: number | null;
}) {
  return {
    deploymentId: "deployment_session",
    sessionId: "session_active",
    tableId: overrides.tableId ?? 1,
    documentId: overrides.documentId,
    observedTs: overrides.observedTs ?? null,
    readAt: new Date("2026-06-19T00:00:00.000Z"),
  };
}

async function commitConcurrentTeamPatch(input: {
  persistence: ReturnType<typeof memoryPersistence>;
  packageId: string;
  sessionId: string;
  minimumTs: number;
  value: PersistenceJson;
}) {
  await input.persistence.insertInvokeSessionMetadata({
    deploymentId: "deployment_session",
    sessionId: input.sessionId,
    projectId: "project_session",
    packageId: input.packageId,
    functionPath: "messages:send",
    functionKind: "mutation",
    partitionKey: "1:team",
    scopeJson: {
      kind: "partition",
      table: "teams",
      selector: "byId",
      partitionField: "_id",
      argField: "teamId",
      partitionKey: "1:team",
    },
    argsJson: { teamId: "1:team", text: "concurrent" },
    beginTs: input.minimumTs,
    schemaVersion: 5,
    executionModule: "_flarex/execution.js",
  });
  await input.persistence.insertInvokeSessionDocumentRead({
    deploymentId: "deployment_session",
    sessionId: input.sessionId,
    tableId: 1,
    documentId: "1:team",
    observedTs: input.minimumTs <= 15 ? 10 : input.minimumTs - 4,
  });
  await input.persistence.stageInvokeSessionDocumentWrite({
    deploymentId: "deployment_session",
    sessionId: input.sessionId,
    tableId: 1,
    documentId: "1:team",
    op: "patch",
    valueJson: input.value,
  });
  return await input.persistence.commitInvokeSessionWrites({
    deploymentId: "deployment_session",
    sessionId: input.sessionId,
    source: "invoke:messages:send",
    finishedAt: new Date(input.minimumTs),
    minimumTs: input.minimumTs,
  });
}
