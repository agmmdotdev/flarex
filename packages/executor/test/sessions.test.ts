import { describe, expect, it } from "vitest";
import { createMemoryFreshnessMirrorStore } from "@flarex/freshness";
import type { ArtifactSourcePackage } from "flarex/artifacts";
import {
  FlarexDocumentIdFormatError,
  InvokeSessionDocumentWriteCorruptionError,
  InvokeSessionMetadataAlreadyExistsError,
  InvokeSessionOccConflictError,
  type DocumentRevisionRecord,
  type InvokeSessionDocumentWriteRecord,
  type PersistenceJson,
} from "@flarex/persistence-postgres";

import {
  createFlarexExecutor,
  DeploymentNotFoundError,
  DeploymentProjectMismatchError,
  FlarexInsertIdTableMismatchError,
  InvokeDeleteDocumentNotFoundError,
  InvokePatchDocumentNotFoundError,
  InvokePatchValueError,
  InvokeQueryRequestError,
  InvokeReplaceDocumentNotFoundError,
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
    let clockReads = 0;
    let getTimeReads = 0;
    class ConfiguredBeginDate extends Date {
      override getTime(): number {
        getTimeReads += 1;
        return super.getTime();
      }
    }
    const beginDate = new ConfiguredBeginDate("2026-06-20T00:00:00.123Z");
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          return beginDate;
        },
      },
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
        identity: {
          kind: "user",
          user: {
            tokenIdentifier: "issuer|user_1",
            subject: "user_1",
            issuer: "issuer",
            email: "user@example.test",
            role: "admin",
          },
        },
      }),
    ).resolves.toEqual({
      sessionId: "session_fixed",
      beginTs: 1781913600123,
      identity: {
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user_1",
          subject: "user_1",
          issuer: "issuer",
          email: "user@example.test",
          role: "admin",
        },
      },
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
      identityJson: {
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user_1",
          subject: "user_1",
          issuer: "issuer",
          email: "user@example.test",
          role: "admin",
        },
      },
      idempotencyKey: "idem_1",
      state: "active",
      beginTs: 1781913600123,
      schemaVersion: 5,
      executionModule: "_flarex/execution.js",
    });
    expect(clockReads).toBe(1);
    expect(getTimeReads).toBe(1);
  });

  it("does not read session time before preparation and id allocation succeed", async () => {
    let preparationClockReads = 0;
    let preparationIdReads = 0;
    const missingDeploymentExecutor = createFlarexExecutor({
      clock: {
        now: () => {
          preparationClockReads += 1;
          return new Date("2026-06-20T00:00:00.123Z");
        },
      },
      ids: {
        nextId: () => {
          preparationIdReads += 1;
          return "must_not_allocate";
        },
      },
      persistence: memoryPersistence(),
    });

    await expect(missingDeploymentExecutor.beginInvokeSession({
      deploymentId: "deployment_missing",
      projectId: "project_session",
      path: "messages:list",
      kind: "query",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    })).rejects.toThrow(DeploymentNotFoundError);
    expect(preparationIdReads).toBe(0);
    expect(preparationClockReads).toBe(0);

    const idFailure = new Error("session id unavailable");
    let allocationClockReads = 0;
    const persistence = memoryPersistence();
    const idFailureExecutor = createFlarexExecutor({
      clock: {
        now: () => {
          allocationClockReads += 1;
          return new Date("2026-06-20T00:00:00.123Z");
        },
      },
      ids: {
        nextId: () => {
          throw idFailure;
        },
      },
      persistence,
    });
    const registered = await idFailureExecutor.registerDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sourcePackage: sourcePackage(),
      analysisJson: analysisJson(),
    });
    await idFailureExecutor.activateDeploymentPackage({
      deploymentId: "deployment_session",
      projectId: "project_session",
      packageId: registered.package.packageId,
      schemaVersion: 5,
    });

    await expect(idFailureExecutor.beginInvokeSession({
      deploymentId: "deployment_session",
      projectId: "project_session",
      path: "messages:list",
      kind: "query",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    })).rejects.toBe(idFailure);
    expect(allocationClockReads).toBe(0);
  });

  it("preserves configured begin clock and Date failures by identity", async () => {
    const clockFailure = new Error("session clock unavailable");
    const clockFailureExecutor = createFlarexExecutor({
      clock: {
        now: () => {
          throw clockFailure;
        },
      },
      ids: { nextId: () => "session_clock_failure" },
      persistence: memoryPersistence([activeDeployment()], [activePackage()]),
    });

    await expect(clockFailureExecutor.beginInvokeSession({
      deploymentId: "deployment_session",
      projectId: "project_session",
      path: "messages:list",
      kind: "query",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    })).rejects.toBe(clockFailure);

    const getTimeFailure = new Error("session Date cannot be observed");
    class ThrowingBeginDate extends Date {
      override getTime(): number {
        throw getTimeFailure;
      }
    }
    const getTimeFailureExecutor = createFlarexExecutor({
      clock: { now: () => new ThrowingBeginDate(15) },
      ids: { nextId: () => "session_get_time_failure" },
      persistence: memoryPersistence([activeDeployment()], [activePackage()]),
    });

    await expect(getTimeFailureExecutor.beginInvokeSession({
      deploymentId: "deployment_session",
      projectId: "project_session",
      path: "messages:list",
      kind: "query",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
    })).rejects.toBe(getTimeFailure);
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
    const basePersistence = memoryPersistence(
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
    const clockObserver = createSessionClockObserver(() => nowMs);
    const triggerCalls: unknown[] = [];
    const persistence = observeSessionClockPersistence(
      basePersistence,
      clockObserver,
    );
    const executor = createFlarexExecutor({
      clock: clockObserver.clock,
      ids: { nextId: () => `session_retry_${++nextSession}` },
      persistence,
      liveQueryInvalidation: {
        notifyTrigger: input => {
          triggerCalls.push(input);
        },
      },
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
            persistence: basePersistence,
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
    expect(triggerCalls).toEqual([
      expect.objectContaining({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_retry_2",
        committedTs: 21,
        writes: [
          expect.objectContaining({
            tableId: 1,
            id: "1:team",
            ts: 21,
          }),
        ],
      }),
    ]);
    expect(clockObserver.events()).toEqual([
      { operation: "begin", milliseconds: 15 },
      { operation: "finish", milliseconds: 20 },
      { operation: "abort", milliseconds: 20 },
      { operation: "begin", milliseconds: 20 },
      { operation: "finish", milliseconds: 20 },
    ]);
  });

  it("returns a retry-exhausted error after repeated OCC conflicts", async () => {
    const basePersistence = memoryPersistence(
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
    const clockObserver = createSessionClockObserver(() => nowMs);
    const commitFailures: unknown[] = [];
    const observedPersistence = observeSessionClockPersistence(
      basePersistence,
      clockObserver,
    );
    const persistence = {
      ...observedPersistence,
      async commitInvokeSessionWrites(
        input: Parameters<typeof basePersistence.commitInvokeSessionWrites>[0],
      ) {
        try {
          return await observedPersistence.commitInvokeSessionWrites(input);
        } catch (error) {
          commitFailures.push(error);
          throw error;
        }
      },
    };
    const executor = createFlarexExecutor({
      clock: clockObserver.clock,
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
    let exhaustedError: unknown;
    try {
      await executor.runInvokeWithRetries({
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
            persistence: basePersistence,
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
      });
    } catch (error) {
      exhaustedError = error;
    }

    expect(exhaustedError).toBeInstanceOf(InvokeRetryExhaustedError);
    if (!(exhaustedError instanceof InvokeRetryExhaustedError)) {
      throw exhaustedError;
    }
    expect(exhaustedError.lastError).toBe(commitFailures.at(-1));

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
    expect(clockObserver.events()).toEqual([
      { operation: "begin", milliseconds: 15 },
      { operation: "finish", milliseconds: 20 },
      { operation: "abort", milliseconds: 20 },
      { operation: "begin", milliseconds: 20 },
      { operation: "finish", milliseconds: 25 },
      { operation: "abort", milliseconds: 25 },
    ]);
  });

  it("does not read finish time before query read collection succeeds", async () => {
    const finishFailure = new Error("query read collection failed");
    const basePersistence = memoryPersistence(
      [activeDeployment()],
      [activePackage()],
    );
    const clockObserver = createSessionClockObserver(() => 15);
    const observedPersistence = observeSessionClockPersistence(
      basePersistence,
      clockObserver,
    );
    const persistence = {
      ...observedPersistence,
      async listInvokeSessionDocumentReads() {
        throw finishFailure;
      },
    };
    const executor = createFlarexExecutor({
      clock: clockObserver.clock,
      ids: { nextId: () => "session_pre_finish_failure" },
      persistence,
    });

    await expect(executor.runInvokeWithRetries({
      deploymentId: "deployment_session",
      projectId: "project_session",
      path: "messages:list",
      kind: "query",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
      runAttempt: async () => "ok",
    })).rejects.toBe(finishFailure);
    expect(clockObserver.events()).toEqual([
      { operation: "begin", milliseconds: 15 },
      { operation: "abort", milliseconds: 15 },
    ]);
  });

  it("preserves an OCC finish failure when the abort clock also fails", async () => {
    const occFailure = new InvokeSessionOccConflictError(
      "deployment_session",
      "1:team",
      10,
      20,
    );
    const abortClockFailure = new Error("abort clock failed");
    const basePersistence = memoryPersistence(
      [activeDeployment()],
      [activePackage()],
    );
    const persistence = {
      ...basePersistence,
      async commitInvokeSessionWrites(): Promise<never> {
        throw occFailure;
      },
    };
    let clockReads = 0;
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          if (clockReads === 3) throw abortClockFailure;
          return new Date(15);
        },
      },
      ids: { nextId: () => "session_occ_abort_clock_failure" },
      persistence,
    });

    let exhaustedError: unknown;
    try {
      await executor.runInvokeWithRetries({
        deploymentId: "deployment_session",
        projectId: "project_session",
        path: "messages:send",
        kind: "mutation",
        args: { teamId: "1:team", text: "hello" },
        partitionKey: "1:team",
        maxAttempts: 1,
        runAttempt: async () => "ok",
      });
    } catch (error) {
      exhaustedError = error;
    }

    expect(exhaustedError).toBeInstanceOf(InvokeRetryExhaustedError);
    if (!(exhaustedError instanceof InvokeRetryExhaustedError)) {
      throw exhaustedError;
    }
    expect(exhaustedError.lastError).toBe(occFailure);
    expect(clockReads).toBe(3);
  });

  it("preserves the attempt failure when the abort clock also fails", async () => {
    const attemptFailure = new Error("attempt failed");
    const abortClockFailure = new Error("abort clock failed");
    let clockReads = 0;
    const persistence = memoryPersistence();
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          if (clockReads === 2) throw abortClockFailure;
          return new Date(15);
        },
      },
      ids: { nextId: () => "session_abort_clock_failure" },
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

    await expect(executor.runInvokeWithRetries({
      deploymentId: "deployment_session",
      projectId: "project_session",
      path: "messages:list",
      kind: "query",
      args: { teamId: "team:1" },
      partitionKey: "team:1",
      runAttempt: async () => {
        throw attemptFailure;
      },
    })).rejects.toBe(attemptFailure);
    expect(clockReads).toBe(2);
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
    const basePersistence = memoryPersistence([], [], [activeSession()], [], [
      documentRead({ documentId: "1:message", observedTs: 10 }),
      documentRead({ tableId: 2, documentId: "2:lesson", observedTs: null }),
    ]);
    const finishedAt = new Date("2026-06-20T00:00:00.000Z");
    const events: string[] = [];
    let observedFinishedAt: Date | undefined;
    const persistence = {
      ...basePersistence,
      async listInvokeSessionDocumentReads(
        ...input: Parameters<typeof basePersistence.listInvokeSessionDocumentReads>
      ) {
        events.push("list-document-reads");
        return await basePersistence.listInvokeSessionDocumentReads(...input);
      },
      async listInvokeSessionTableReads(
        ...input: Parameters<typeof basePersistence.listInvokeSessionTableReads>
      ) {
        events.push("list-table-reads");
        return await basePersistence.listInvokeSessionTableReads(...input);
      },
      async listInvokeSessionIndexReads(
        ...input: Parameters<typeof basePersistence.listInvokeSessionIndexReads>
      ) {
        events.push("list-index-reads");
        return await basePersistence.listInvokeSessionIndexReads(...input);
      },
      async finishInvokeSessionMetadata(
        input: Parameters<typeof basePersistence.finishInvokeSessionMetadata>[0],
      ) {
        events.push("finish-metadata");
        observedFinishedAt = input.finishedAt;
        return await basePersistence.finishInvokeSessionMetadata(input);
      },
    };
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          events.push("clock");
          return finishedAt;
        },
      },
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
      readTs: 1781913600123,
      readSet: {
        documents: [
          { tableId: 1, id: "1:message", observedTs: 10 },
          { tableId: 2, id: "2:lesson", observedTs: null },
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
    expect(observedFinishedAt).toBe(finishedAt);
    expect(events).toEqual([
      "list-document-reads",
      "list-table-reads",
      "list-index-reads",
      "clock",
      "finish-metadata",
    ]);
  });

  it("finishes mutation sessions by committing staged inserts", async () => {
    const basePersistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 100 })],
    );
    const finishedAt = new Date("2026-06-20T00:00:00.000Z");
    let clockReads = 0;
    let observedFinishedAt: Date | undefined;
    const persistence = {
      ...basePersistence,
      async commitInvokeSessionWrites(
        input: Parameters<typeof basePersistence.commitInvokeSessionWrites>[0],
      ) {
        observedFinishedAt = input.finishedAt;
        return await basePersistence.commitInvokeSessionWrites(input);
      },
    };
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          return finishedAt;
        },
      },
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
    await expect(
      persistence.listOutboxEvents({
        deploymentId: "deployment_session",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [
        {
          deploymentId: "deployment_session",
          ts: 101,
          sequence: 0,
          deliveredAt: null,
          event: {
            type: "commit",
            deploymentId: "deployment_session",
            commitTs: 101,
            source: "invoke:messages:list",
            changedTableIds: [1],
            changedDocumentIds: ["1:team_insert"],
            writeSummary: {
              writes: [
                {
                  tableId: 1,
                  id: "1:team_insert",
                  prevTs: null,
                  ts: 101,
                  value: { name: "Team" },
                },
              ],
            },
          },
        },
      ],
    });
    expect(observedFinishedAt).toBe(finishedAt);
    expect(clockReads).toBe(1);
  });

  it("marks live query subscriptions stale and notifies after successful mutation commit", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 100 })],
    );
    const freshnessStore = createMemoryFreshnessMirrorStore();
    const triggerCalls: unknown[] = [];
    const executor = createFlarexExecutor({
      clock: { now: () => new Date("2026-06-20T00:00:00.000Z") },
      persistence,
      liveQueryInvalidation: {
        freshnessStore,
        notifyTrigger: input => {
          triggerCalls.push(input);
        },
      },
    });

    await executor.recordLiveQuerySubscription({
      deploymentId: "deployment_session",
      projectId: "project_session",
      connectionId: "connection:deployment_session:session_1",
      queryId: 1,
      functionPath: "teams:list",
      argsJson: {},
      beginTs: 100,
      readSet: { tables: [{ tableId: 1, observedTs: 100 }] },
      resultJson: [],
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
    ).resolves.toMatchObject({
      value: "ok",
      committedTs: 101,
      writes: [{ tableId: 1, id: "1:team_insert", ts: 101 }],
    });

    expect(freshnessStore.getDocumentVersion(
      "deployment_session",
      "1:team_insert",
    )).toMatchObject({ version: 101 });
    expect(freshnessStore.getTableVersion("deployment_session", 1)).toMatchObject({
      version: 101,
    });
    await expect(
      executor.findStaleLiveQuerySubscriptions({
        deploymentId: "deployment_session",
        freshnessStore,
      }),
    ).resolves.toMatchObject({
      stale: [
        {
          subscription: {
            deploymentId: "deployment_session",
            connectionId: "connection:deployment_session:session_1",
            queryId: 1,
          },
          freshness: {
            status: "stale",
            stale: [
              {
                kind: "table",
                id: "1",
                observedTs: 100,
                version: 101,
              },
            ],
          },
        },
      ],
    });
    expect(triggerCalls).toEqual([
      {
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        functionPath: "messages:list",
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
      },
    ]);
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

  it("does not notify live query invalidation when mutation commit fails OCC", async () => {
    const freshnessStore = createMemoryFreshnessMirrorStore();
    const triggerCalls: unknown[] = [];
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
      liveQueryInvalidation: {
        freshnessStore,
        notifyTrigger: input => {
          triggerCalls.push(input);
        },
      },
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

    expect(triggerCalls).toEqual([]);
    expect(freshnessStore.getDocumentVersion(
      "deployment_session",
      "1:team_insert",
    )).toBeNull();
    expect(freshnessStore.getTableVersion("deployment_session", 1)).toBeNull();
  });

  it("reports live query trigger failures without failing committed mutations", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 100 })],
    );
    const errors: Array<{ committedTs: number; error: unknown }> = [];
    const executor = createFlarexExecutor({
      persistence,
      liveQueryInvalidation: {
        notifyTrigger: () => {
          throw new Error("backend trigger unavailable");
        },
        onError: input => {
          errors.push({ committedTs: input.committedTs, error: input.error });
        },
      },
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
    ).resolves.toMatchObject({
      value: "ok",
      committedTs: 101,
    });
    expect(errors).toHaveLength(1);
    expect(errors[0]?.committedTs).toBe(101);
    expect(errors[0]?.error).toBeInstanceOf(Error);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject({ state: "finished" });
  });

  it("reports async live query trigger failures without failing committed mutations", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 100 })],
    );
    const triggerError = new Error("backend trigger rejected");
    const errorReports: Array<{ committedTs: number; error: unknown }> = [];
    const executor = createFlarexExecutor({
      persistence,
      liveQueryInvalidation: {
        notifyTrigger: async () => {
          throw triggerError;
        },
        onError: input => {
          errorReports.push({
            committedTs: input.committedTs,
            error: input.error,
          });
        },
      },
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
    ).resolves.toMatchObject({
      value: "ok",
      committedTs: 101,
    });
    await waitForReport(
      errorReports,
      1_000,
      "async live query invalidation error was not reported",
    );
    expect(errorReports).toHaveLength(1);
    expect(errorReports[0]?.committedTs).toBe(101);
    expect(errorReports[0]?.error).toBe(triggerError);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject({ state: "finished" });
  });

  it("rejects finishing inactive sessions", async () => {
    let clockReads = 0;
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          return new Date("2026-06-20T00:00:00.000Z");
        },
      },
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
    expect(clockReads).toBe(0);
  });

  it("aborts active sessions without committing staged work", async () => {
    const basePersistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation" })],
    );
    const finishedAt = new Date("2026-06-20T00:00:00.000Z");
    let clockReads = 0;
    let observedFinishedAt: Date | undefined;
    const persistence = {
      ...basePersistence,
      async abortInvokeSessionMetadata(
        input: Parameters<typeof basePersistence.abortInvokeSessionMetadata>[0],
      ) {
        observedFinishedAt = input.finishedAt;
        return await basePersistence.abortInvokeSessionMetadata(input);
      },
    };
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          return finishedAt;
        },
      },
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
    expect(observedFinishedAt).toBe(finishedAt);
    expect(clockReads).toBe(1);
  });

  it("aborts stale active sessions for a deployment", async () => {
    const basePersistence = memoryPersistence(
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
    const finishedAt = new Date("2026-06-20T01:00:00.000Z");
    let clockReads = 0;
    let observedFinishedAt: Date | undefined;
    const persistence = {
      ...basePersistence,
      async abortStaleInvokeSessionsMetadata(
        input: Parameters<
          typeof basePersistence.abortStaleInvokeSessionsMetadata
        >[0],
      ) {
        observedFinishedAt = input.finishedAt;
        return await basePersistence.abortStaleInvokeSessionsMetadata(input);
      },
    };
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          return finishedAt;
        },
      },
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
    expect(observedFinishedAt).toBe(finishedAt);
    expect(clockReads).toBe(1);
  });

  it("rejects stale session aborts for the wrong project", async () => {
    let clockReads = 0;
    const executor = createFlarexExecutor({
      clock: {
        now: () => {
          clockReads += 1;
          return new Date("2026-06-20T00:00:00.000Z");
        },
      },
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
    expect(clockReads).toBe(0);
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

  it("fails closed when a staged patch row contains non-JSON data", async () => {
    const corruptWrite = {
      deploymentId: "deployment_session",
      sessionId: "session_active",
      tableId: 1,
      documentId: "1:team_patch",
      op: "patch",
      valueJson: { nested: Number.POSITIVE_INFINITY },
      stagedAt: new Date("2026-06-19T00:00:00.000Z"),
    } satisfies InvokeSessionDocumentWriteRecord;
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
      [],
      [corruptWrite],
    );
    const executor = createFlarexExecutor({ persistence });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:team_patch" },
      }),
    ).rejects.toMatchObject({
      name: InvokeSessionDocumentWriteCorruptionError.name,
      reason: "valueNotJson",
    });
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_session",
        "1:team_patch",
        15,
      ),
    ).resolves.toMatchObject({ value: { name: "Old", count: 1 } });
    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toEqual([]);
  });

  it("does not let a later staged write hide stored corruption", async () => {
    const corruptWrite = {
      deploymentId: "deployment_session",
      sessionId: "session_active",
      tableId: 1,
      documentId: "1:team_patch",
      op: "patch",
      valueJson: { nested: Number.POSITIVE_INFINITY },
      stagedAt: new Date("2026-06-19T00:00:00.000Z"),
    } satisfies InvokeSessionDocumentWriteRecord;
    const persistence = memoryPersistence([], [], [], [], [], [corruptWrite]);

    await expect(
      persistence.stageInvokeSessionDocumentWrite({
        deploymentId: corruptWrite.deploymentId,
        sessionId: corruptWrite.sessionId,
        tableId: corruptWrite.tableId,
        documentId: corruptWrite.documentId,
        op: "replace",
        valueJson: { replacement: true },
      }),
    ).rejects.toMatchObject({
      name: InvokeSessionDocumentWriteCorruptionError.name,
      reason: "valueNotJson",
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        corruptWrite.deploymentId,
        corruptWrite.sessionId,
      ),
    ).rejects.toMatchObject({
      name: InvokeSessionDocumentWriteCorruptionError.name,
      reason: "valueNotJson",
    });
  });

  it("validates a later staged write before changing memory state", async () => {
    const initialWrite = {
      deploymentId: "deployment_session",
      sessionId: "session_active",
      tableId: 1,
      documentId: "1:team_insert",
      op: "insert",
      valueJson: { draft: true },
      stagedAt: new Date("2026-06-19T00:00:00.000Z"),
    } satisfies InvokeSessionDocumentWriteRecord;
    const persistence = memoryPersistence([], [], [], [], [], [initialWrite]);

    await expect(
      persistence.stageInvokeSessionDocumentWrite({
        deploymentId: initialWrite.deploymentId,
        sessionId: initialWrite.sessionId,
        tableId: initialWrite.tableId,
        documentId: initialWrite.documentId,
        op: "delete",
        valueJson: { unexpected: true },
      }),
    ).rejects.toMatchObject({
      name: InvokeSessionDocumentWriteCorruptionError.name,
      reason: "deleteValuePresent",
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        initialWrite.deploymentId,
        initialWrite.sessionId,
      ),
    ).resolves.toMatchObject([
      { op: "insert", valueJson: { draft: true } },
    ]);
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

  it("stages replace syscalls with document reads during mutation sessions", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_replace",
          documentId: "team_replace",
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
          op: "replace",
          id: "1:team_replace",
          value: { name: "New" },
        },
      }),
    ).resolves.toEqual({
      value: null,
      readSet: { documents: [{ tableId: 1, id: "1:team_replace" }] },
    });
    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: "1:team_replace",
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
        documentId: "1:team_replace",
        op: "replace",
        valueJson: { name: "New" },
      },
    ]);
  });

  it("reads staged replacements inside the same mutation session", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_replace",
          documentId: "team_replace",
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
        op: "replace",
        id: "1:team_replace",
        value: { name: "New" },
      },
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "get", id: "1:team_replace" },
      }),
    ).resolves.toEqual({
      value: { _id: "1:team_replace", name: "New" },
      readSet: { documents: [{ tableId: 1, id: "1:team_replace" }] },
    });
  });

  it("coalesces replace then patch inside one mutation session", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_replace",
          documentId: "team_replace",
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
        op: "replace",
        id: "1:team_replace",
        value: { name: "New", keep: true },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "patch",
        id: "1:team_replace",
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
    ).resolves.toMatchObject({
      writes: [
        {
          id: "1:team_replace",
          prevTs: 10,
          value: { name: "New", keep: true, count: 2 },
        },
      ],
    });
  });

  it("coalesces insert then replace as one insert", async () => {
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
        value: { name: "Draft" },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "replace",
        id: "1:team_insert",
        value: { name: "Final" },
      },
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
        valueJson: { name: "Final" },
      },
    ]);
  });

  it("coalesces replace then delete as one delete", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_replace",
          documentId: "team_replace",
          ts: 10,
          value: { name: "Old" },
        }),
      ],
    );
    const executor = createFlarexExecutor({ persistence });

    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "replace",
        id: "1:team_replace",
        value: { name: "New" },
      },
    });
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: { op: "delete", id: "1:team_replace" },
    });

    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_session",
        "session_active",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:team_replace",
        op: "delete",
        valueJson: null,
      },
    ]);
  });

  it("commits mutation replace syscalls after OCC validation", async () => {
    const persistence = memoryPersistence(
      [],
      [activePackage()],
      [activeSession({ functionKind: "mutation", beginTs: 15 })],
      [
        documentRevision({
          id: "1:team_replace",
          documentId: "team_replace",
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
        op: "replace",
        id: "1:team_replace",
        value: { name: "New" },
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
          id: "1:team_replace",
          prevTs: 10,
          ts: 16,
          value: { name: "New" },
        },
      ],
    });
  });

  it("rejects replace syscalls for missing documents", async () => {
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
          op: "replace",
          id: "1:missing",
          value: { count: 2 },
        },
      }),
    ).rejects.toThrow(InvokeReplaceDocumentNotFoundError);
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
        documentRevision({
          id: "1:e",
          documentId: "e",
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
    await executor.invokeSyscall({
      deploymentId: "deployment_session",
      projectId: "project_session",
      sessionId: "session_active",
      syscall: {
        op: "replace",
        id: "1:e",
        value: { name: "Target", count: 5 },
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
          { _id: "1:e", name: "Target", count: 5 },
        ],
        isDone: true,
        continueCursor: expect.any(String),
      },
      readSet: {
        documents: [
          { tableId: 1, id: "1:b", observedTs: 10 },
          { tableId: 1, id: "1:c", observedTs: null },
          { tableId: 1, id: "1:e", observedTs: 10 },
        ],
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

function activeDeployment() {
  return deploymentMetadata({
    deploymentId: "deployment_session",
    projectId: "project_session",
    activePackageId: "package_active",
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

type SessionClockOperation = "begin" | "finish" | "abort";

interface SessionClockObserver {
  readonly clock: { readonly now: () => Date };
  readonly observe: (date: Date, operation: Exclude<SessionClockOperation, "begin">) => void;
  readonly events: () => ReadonlyArray<{
    readonly operation: SessionClockOperation | undefined;
    readonly milliseconds: number;
  }>;
}

function createSessionClockObserver(
  readMilliseconds: () => number,
): SessionClockObserver {
  const observations: Array<{
    date?: Date;
    operation?: SessionClockOperation;
    readonly milliseconds: number;
  }> = [];

  const observe = (date: Date, operation: SessionClockOperation): void => {
    const observation = observations.find(candidate => candidate.date === date);
    if (observation === undefined) {
      throw new Error(`Unrecognized session ${operation} clock value.`);
    }
    if (
      observation.operation !== undefined &&
      observation.operation !== operation
    ) {
      throw new Error(
        `Session clock value was observed by ${observation.operation} and ${operation}.`,
      );
    }
    observation.operation = operation;
  };

  return {
    clock: {
      now: () => {
        const milliseconds = readMilliseconds();
        const observation: {
          date?: Date;
          operation?: SessionClockOperation;
          readonly milliseconds: number;
        } = { milliseconds };
        class ObservedSessionDate extends Date {
          override getTime(): number {
            if (observation.operation === undefined) {
              observation.operation = "begin";
            }
            return super.getTime();
          }
        }
        const date = new ObservedSessionDate(milliseconds);
        observation.date = date;
        observations.push(observation);
        return date;
      },
    },
    observe,
    events: () => observations.map(observation => ({
      operation: observation.operation,
      milliseconds: observation.milliseconds,
    })),
  };
}

function observeSessionClockPersistence(
  basePersistence: ReturnType<typeof memoryPersistence>,
  observer: SessionClockObserver,
): ReturnType<typeof memoryPersistence> {
  return {
    ...basePersistence,
    async finishInvokeSessionMetadata(
      input: Parameters<typeof basePersistence.finishInvokeSessionMetadata>[0],
    ) {
      observer.observe(input.finishedAt, "finish");
      return await basePersistence.finishInvokeSessionMetadata(input);
    },
    async commitInvokeSessionWrites(
      input: Parameters<typeof basePersistence.commitInvokeSessionWrites>[0],
    ) {
      observer.observe(input.finishedAt, "finish");
      return await basePersistence.commitInvokeSessionWrites(input);
    },
    async abortInvokeSessionMetadata(
      input: Parameters<typeof basePersistence.abortInvokeSessionMetadata>[0],
    ) {
      observer.observe(input.finishedAt, "abort");
      return await basePersistence.abortInvokeSessionMetadata(input);
    },
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

async function waitForReport(
  reports: unknown[],
  timeoutMs: number,
  message: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (reports.length === 0) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      throw new Error(message);
    }
    await delay(Math.min(remainingMs, 10));
  }
  await delay(0);
}

async function delay(timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}
