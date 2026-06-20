import { describe, expect, it } from "vitest";
import type { ArtifactSourcePackage } from "flarex/artifacts";
import {
  FlarexDocumentIdFormatError,
  InvokeSessionMetadataAlreadyExistsError,
  type DocumentRevisionRecord,
} from "@flarex/persistence-postgres";

import {
  createFlarexExecutor,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeFinishNotImplementedError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
} from "../src";
import { invokeSessionMetadata, memoryPersistence } from "./helpers/persistence";

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

  it("rejects mutation session finish until write commit exists", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [
        activeSession({ functionKind: "mutation" }),
      ]),
    });

    await expect(
      executor.finishInvokeSession({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        value: null,
      }),
    ).rejects.toThrow(InvokeFinishNotImplementedError);
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

  it("keeps query syscalls behind the pending Postgres transaction layer", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [activeSession()]),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "query", request: { table: "messages" } },
      }),
    ).rejects.toThrow(InvokeSyscallNotImplementedError);
  });

  it("allows mutation write syscalls through validation before the pending transaction layer", async () => {
    const executor = createFlarexExecutor({
      persistence: memoryPersistence([], [], [
        activeSession({ functionKind: "mutation" }),
      ]),
    });

    await expect(
      executor.invokeSyscall({
        deploymentId: "deployment_session",
        projectId: "project_session",
        sessionId: "session_active",
        syscall: { op: "insert", table: "messages", value: { text: "hello" } },
      }),
    ).rejects.toThrow(InvokeSyscallNotImplementedError);
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
      indexes: [],
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
