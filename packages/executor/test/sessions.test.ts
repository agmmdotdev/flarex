import { describe, expect, it } from "vitest";
import type { ArtifactSourcePackage } from "flarex/artifacts";
import {
  FlarexDocumentIdFormatError,
  InvokeSessionMetadataAlreadyExistsError,
  InvokeSessionOccConflictError,
  type DocumentRevisionRecord,
} from "@flarex/persistence-postgres";

import {
  createFlarexExecutor,
  FlarexInsertIdTableMismatchError,
  InvokePatchDocumentNotFoundError,
  InvokePatchValueError,
  InvokeSessionNotActiveError,
  InvokeSessionNotFoundError,
  InvokeSessionProjectMismatchError,
  InvokeSyscallNotAllowedError,
  InvokeSyscallNotImplementedError,
} from "../src";
import {
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
