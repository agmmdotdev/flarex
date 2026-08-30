import { describe, expect, it } from "vitest";
import { executionIdentityFingerprint } from "flarex-protocol/auth";

import {
  DeploymentMetadataAlreadyExistsError,
  DeploymentPackageMetadataAlreadyExistsError,
  InvokeSessionMetadataAlreadyExistsError,
  FlarexDocumentIdFormatError,
  InvokeSessionDocumentValidationError,
  InvokeSessionDocumentWriteAlreadyExistsError,
  InvokeSessionDocumentWriteConflictError,
  InvokeSessionDocumentWriteCorruptionError,
  InvokeSessionDeleteTargetError,
  InvokeSessionInsertConflictError,
  InvokeSessionIndexOccConflictError,
  InvokeSessionOccConflictError,
  InvokeSessionPatchTargetError,
  InvokeSessionReplaceTargetError,
  InvokeSessionTableOccConflictError,
  indexBoundsForExpressions,
  sql,
  upsertLiveQuerySubscription,
} from "../src";
import { deployments } from "../src/schema";
import { createMigratedPGlitePersistence } from "./pgliteTestFixture";

const anonymousIdentityFingerprint = executionIdentityFingerprint({ kind: "anonymous" });

describe("createPGlitePersistence runtime", () => {
  it("rolls back failed transactions", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.transaction(async (tx) => {
        await tx.query(
          "insert into deployments (deployment_id, project_id) values ($1, $2)",
          ["deployment_a", "project_a"],
        );
        throw new Error("rollback");
      }),
    ).rejects.toThrow("rollback");

    const rows = await persistence.query(
      "select deployment_id from deployments where deployment_id = $1",
      ["deployment_a"],
    );
    expect(rows.rows).toEqual([]);
  });

  it("executes Drizzle raw SQL on persistence and transaction clients", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.execute(sql`
      insert into deployments (deployment_id, project_id)
      values ('deployment_c', 'project_c')
    `);

    await persistence.transaction(async (tx) => {
      await tx.execute(sql`
        insert into deployments (deployment_id, project_id)
        values ('deployment_d', 'project_d')
      `);
    });

    await expect(
      persistence.execute<{ deployment_id: string }>(sql`
        select deployment_id
        from deployments
        order by deployment_id
      `),
    ).resolves.toMatchObject({
      rows: [
        { deployment_id: "deployment_c" },
        { deployment_id: "deployment_d" },
      ],
    });
  });

  it("exposes Drizzle for typed metadata access", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.drizzle.insert(deployments).values({
      deploymentId: "deployment_b",
      projectId: "project_b",
    });

    await expect(
      persistence.drizzle.select().from(deployments),
    ).resolves.toMatchObject([
      {
        deploymentId: "deployment_b",
        projectId: "project_b",
        activeSchemaVersion: 0,
      },
    ]);
  });

  it("inserts and reads deployment metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const created = await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_meta",
      projectId: "project_meta",
      activePackageId: "package_meta",
      activeSchemaVersion: 2,
    });

    expect(created).toMatchObject({
      deploymentId: "deployment_meta",
      projectId: "project_meta",
      activePackageId: "package_meta",
      activeSchemaVersion: 2,
    });
    expect(created.createdAt).toBeInstanceOf(Date);

    await expect(
      persistence.getDeploymentMetadata("deployment_meta"),
    ).resolves.toMatchObject({
      deploymentId: "deployment_meta",
      projectId: "project_meta",
      activePackageId: "package_meta",
      activeSchemaVersion: 2,
    });
  });

  it("returns null for missing deployment metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.getDeploymentMetadata("missing"),
    ).resolves.toBeNull();
  });

  it("lists deployment metadata in stable cursor batches", async () => {
    const persistence = await createMigratedPGlitePersistence();

    for (const deploymentId of [
      "deployment_b",
      "deployment_a",
      "deployment_c",
    ]) {
      await persistence.insertDeploymentMetadata({
        deploymentId,
        projectId: `project_${deploymentId}`,
      });
    }
    await persistence.query(
      `
        update deployments
        set created_at = case deployment_id
          when 'deployment_b' then $1::timestamptz
          when 'deployment_a' then $1::timestamptz
          else $2::timestamptz
        end
      `,
      ["2026-06-19T00:00:00.000Z", "2026-06-19T01:00:00.000Z"],
    );

    const first = await persistence.listDeploymentMetadata({ limit: 2 });
    expect(first.deployments.map((deployment) => deployment.deploymentId)).toEqual([
      "deployment_a",
      "deployment_b",
    ]);
    expect(first).toMatchObject({
      nextCursor: {
        deploymentId: "deployment_b",
        createdAt: new Date("2026-06-19T00:00:00.000Z"),
      },
      hasMore: true,
    });
    expect(first.nextCursor).not.toBeNull();

    await expect(
      persistence.listDeploymentMetadata({
        limit: 2,
        cursor: first.nextCursor!,
      }),
    ).resolves.toMatchObject({
      deployments: [
        {
          deploymentId: "deployment_c",
          createdAt: new Date("2026-06-19T01:00:00.000Z"),
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("updates deployment activation metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_activate",
      projectId: "project_activate",
    });

    await expect(
      persistence.updateDeploymentMetadataActivation({
        deploymentId: "deployment_activate",
        activePackageId: "package_activate",
        activeSchemaVersion: 3,
      }),
    ).resolves.toMatchObject({
      deploymentId: "deployment_activate",
      projectId: "project_activate",
      activePackageId: "package_activate",
      activeSchemaVersion: 3,
    });
  });

  it("returns null when updating activation for missing deployment metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.updateDeploymentMetadataActivation({
        deploymentId: "missing",
        activePackageId: "package_missing",
        activeSchemaVersion: 1,
      }),
    ).resolves.toBeNull();
  });

  it("rejects duplicate deployment metadata clearly", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_dup",
      projectId: "project_dup",
    });

    await expect(
      persistence.insertDeploymentMetadata({
        deploymentId: "deployment_dup",
        projectId: "project_dup",
      }),
    ).rejects.toThrow(DeploymentMetadataAlreadyExistsError);
  });

  it("inserts and reads deployment package metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const created = await persistence.insertDeploymentPackageMetadata({
      deploymentId: "deployment_package",
      packageId: "package_a",
      sourcePackageHash: "a".repeat(64),
      executionModule: "_flarex/execution.js",
      sourcePackageJson: {
        modules: [
          { path: "flarex/auth.config.ts", environment: "isolate", sha256: "b".repeat(64) },
        ],
        functions: [],
        authConfig: {
          providers: [
            {
              domain: "https://issuer.example.com",
              applicationID: "flarex-app",
            },
          ],
        },
        authConfigModule: "flarex/auth.config.ts",
        execution: "_flarex/execution.js",
      },
      analysisJson: { functions: [] },
    });

    expect(created).toMatchObject({
      deploymentId: "deployment_package",
      packageId: "package_a",
      sourcePackageHash: "a".repeat(64),
      executionModule: "_flarex/execution.js",
      sourcePackageJson: {
        modules: [
          { path: "flarex/auth.config.ts", environment: "isolate", sha256: "b".repeat(64) },
        ],
        functions: [],
        authConfig: {
          providers: [
            {
              domain: "https://issuer.example.com",
              applicationID: "flarex-app",
            },
          ],
        },
        authConfigModule: "flarex/auth.config.ts",
        execution: "_flarex/execution.js",
      },
      analysisJson: { functions: [] },
    });
    expect(created.createdAt).toBeInstanceOf(Date);

    await expect(
      persistence.getDeploymentPackageMetadata("deployment_package", "package_a"),
    ).resolves.toMatchObject({
      deploymentId: "deployment_package",
      packageId: "package_a",
      sourcePackageJson: {
        authConfig: {
          providers: [
            {
              domain: "https://issuer.example.com",
              applicationID: "flarex-app",
            },
          ],
        },
        authConfigModule: "flarex/auth.config.ts",
      },
    });
  });

  it("returns null for missing deployment package metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.getDeploymentPackageMetadata("deployment_package", "missing"),
    ).resolves.toBeNull();
  });

  it("rejects duplicate deployment package metadata clearly", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const input = {
      deploymentId: "deployment_package_dup",
      packageId: "package_dup",
      sourcePackageHash: "b".repeat(64),
      executionModule: "_flarex/execution.js",
      sourcePackageJson: {
        modules: [],
        functions: [],
        execution: "_flarex/execution.js",
      },
    };

    await persistence.insertDeploymentPackageMetadata(input);

    await expect(
      persistence.insertDeploymentPackageMetadata(input),
    ).rejects.toThrow(DeploymentPackageMetadataAlreadyExistsError);
  });

  it("inserts and reads invoke session metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const created = await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_invoke",
      sessionId: "session_a",
      projectId: "project_invoke",
      packageId: "package_invoke",
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
      identityJson: { kind: "anonymous" },
      idempotencyKey: "idem_a",
      beginTs: 42,
      schemaVersion: 7,
      executionModule: "_flarex/execution.js",
    });

    expect(created).toMatchObject({
      deploymentId: "deployment_invoke",
      sessionId: "session_a",
      projectId: "project_invoke",
      packageId: "package_invoke",
      functionPath: "messages:list",
      functionKind: "query",
      partitionKey: "team:1",
      scopeJson: {
        kind: "partition",
        partitionKey: "team:1",
      },
      argsJson: { teamId: "team:1" },
      idempotencyKey: "idem_a",
      state: "active",
      beginTs: 42,
      schemaVersion: 7,
      executionModule: "_flarex/execution.js",
      finishedAt: null,
    });
    expect(created.createdAt).toBeInstanceOf(Date);

    await expect(
      persistence.getInvokeSessionMetadata("deployment_invoke", "session_a"),
    ).resolves.toMatchObject({
      deploymentId: "deployment_invoke",
      sessionId: "session_a",
      state: "active",
      identityJson: { kind: "anonymous" },
    });

    const userIdentity = {
      kind: "user" as const,
      user: {
        tokenIdentifier: "issuer|user_1",
        subject: "user_1",
        issuer: "issuer",
        email: "user@example.test",
      },
    };
    const explicit = await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_invoke",
      sessionId: "session_user",
      projectId: "project_invoke",
      packageId: "package_invoke",
      functionPath: "messages:list",
      functionKind: "query",
      partitionKey: "team:1",
      scopeJson: {
        kind: "partition",
        partitionKey: "team:1",
      },
      argsJson: { teamId: "team:1" },
      identityJson: userIdentity,
      beginTs: 43,
      schemaVersion: 7,
      executionModule: "_flarex/execution.js",
    });

    expect(explicit.identityJson).toEqual(userIdentity);
    await expect(
      persistence.getInvokeSessionMetadata("deployment_invoke", "session_user"),
    ).resolves.toMatchObject({
      sessionId: "session_user",
      identityJson: userIdentity,
    });
  });

  it("returns null for missing invoke session metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.getInvokeSessionMetadata("deployment_invoke", "missing"),
    ).resolves.toBeNull();
  });

  it("marks invoke session metadata as finished", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_invoke_finish",
      sessionId: "session_finish",
      projectId: "project_invoke",
      packageId: "package_invoke",
      functionPath: "messages:list",
      functionKind: "query",
      partitionKey: "team:1",
      scopeJson: {
        kind: "partition",
        partitionKey: "team:1",
      },
      argsJson: { teamId: "team:1" },
      beginTs: 44,
      schemaVersion: 7,
      executionModule: "_flarex/execution.js",
    });

    const finishedAt = new Date("2026-06-20T00:00:00.000Z");
    await expect(
      persistence.finishInvokeSessionMetadata({
        deploymentId: "deployment_invoke_finish",
        sessionId: "session_finish",
        finishedAt,
      }),
    ).resolves.toMatchObject({
      deploymentId: "deployment_invoke_finish",
      sessionId: "session_finish",
      state: "finished",
      finishedAt,
    });
  });

  it("aborts only stale active invoke session metadata", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const baseInput = {
      deploymentId: "deployment_invoke_stale",
      projectId: "project_invoke",
      packageId: "package_invoke",
      functionPath: "messages:list",
      functionKind: "query" as const,
      partitionKey: "team:1",
      scopeJson: {
        kind: "partition",
        partitionKey: "team:1",
      },
      argsJson: { teamId: "team:1" },
      beginTs: 44,
      schemaVersion: 7,
      executionModule: "_flarex/execution.js",
    };
    await persistence.insertInvokeSessionMetadata({
      ...baseInput,
      sessionId: "session_old_active",
    });
    await persistence.insertInvokeSessionMetadata({
      ...baseInput,
      sessionId: "session_recent_active",
    });
    await persistence.insertInvokeSessionMetadata({
      ...baseInput,
      sessionId: "session_old_finished",
      state: "finished",
    });

    await persistence.query(
      `
        update invoke_sessions
        set created_at = $1
        where deployment_id = $2 and session_id in ($3, $4)
      `,
      [
        new Date("2026-06-19T00:00:00.000Z"),
        "deployment_invoke_stale",
        "session_old_active",
        "session_old_finished",
      ],
    );

    const finishedAt = new Date("2026-06-20T00:00:00.000Z");
    await expect(
      persistence.abortStaleInvokeSessionsMetadata({
        deploymentId: "deployment_invoke_stale",
        olderThan: new Date("2026-06-19T12:00:00.000Z"),
        finishedAt,
      }),
    ).resolves.toMatchObject({
      sessions: [
        {
          deploymentId: "deployment_invoke_stale",
          sessionId: "session_old_active",
          state: "aborted",
          finishedAt,
        },
      ],
      hasMore: false,
    });

    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_invoke_stale",
        "session_recent_active",
      ),
    ).resolves.toMatchObject({ state: "active", finishedAt: null });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_invoke_stale",
        "session_old_finished",
      ),
    ).resolves.toMatchObject({ state: "finished" });
  });

  it("aborts stale invoke session metadata in oldest-first batches", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const baseInput = {
      deploymentId: "deployment_invoke_stale_batch",
      projectId: "project_invoke",
      packageId: "package_invoke",
      functionPath: "messages:list",
      functionKind: "query" as const,
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 44,
      schemaVersion: 7,
      executionModule: "_flarex/execution.js",
    };
    for (const sessionId of ["session_b", "session_a", "session_c"]) {
      await persistence.insertInvokeSessionMetadata({
        ...baseInput,
        sessionId,
      });
    }
    await persistence.query(
      `
        update invoke_sessions
        set created_at = case session_id
          when 'session_b' then $1::timestamptz
          when 'session_a' then $2::timestamptz
          else $3::timestamptz
        end
        where deployment_id = $4
      `,
      [
        "2026-06-19T00:00:00.000Z",
        "2026-06-19T00:00:00.000Z",
        "2026-06-19T01:00:00.000Z",
        "deployment_invoke_stale_batch",
      ],
    );

    await expect(
      persistence.abortStaleInvokeSessionsMetadata({
        deploymentId: "deployment_invoke_stale_batch",
        olderThan: new Date("2026-06-19T12:00:00.000Z"),
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        limit: 2,
      }),
    ).resolves.toMatchObject({
      sessions: [
        { sessionId: "session_a", state: "aborted" },
        { sessionId: "session_b", state: "aborted" },
      ],
      hasMore: true,
    });
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_invoke_stale_batch",
        "session_c",
      ),
    ).resolves.toMatchObject({ state: "active" });
  });

  it("rejects duplicate invoke session metadata clearly", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const input = {
      deploymentId: "deployment_invoke_dup",
      sessionId: "session_dup",
      projectId: "project_invoke",
      packageId: "package_invoke",
      functionPath: "messages:send",
      functionKind: "mutation" as const,
      partitionKey: "team:1",
      scopeJson: {
        kind: "partition",
        partitionKey: "team:1",
      },
      argsJson: { teamId: "team:1" },
      beginTs: 43,
      schemaVersion: 7,
      executionModule: "_flarex/execution.js",
    };

    await persistence.insertInvokeSessionMetadata(input);

    await expect(
      persistence.insertInvokeSessionMetadata(input),
    ).rejects.toThrow(InvokeSessionMetadataAlreadyExistsError);
  });

  it("inserts and reads document revisions at a timestamp", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_docs",
      id: "1:message",
      ts: 10,
      value: { text: "old" },
    });
    await persistence.insertDocumentRevision({
      deploymentId: "deployment_docs",
      id: "1:message",
      ts: 20,
      value: { text: "new" },
      prevTs: 10,
    });

    await expect(
      persistence.getDocumentRevisionAtTs("deployment_docs", "1:message", 15),
    ).resolves.toMatchObject({
      deploymentId: "deployment_docs",
      id: "1:message",
      tableId: 1,
      documentId: "message",
      ts: 10,
      value: { text: "old" },
      deleted: false,
      prevTs: null,
    });
    await expect(
      persistence.getDocumentRevisionAtTs("deployment_docs", "1:message", 20),
    ).resolves.toMatchObject({
      id: "1:message",
      ts: 20,
      value: { text: "new" },
      prevTs: 10,
    });
  });

  it("returns deleted document revisions so callers can record the read", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_docs_deleted",
      id: "2:lesson",
      ts: 10,
      value: { title: "Intro" },
    });
    await persistence.insertDocumentRevision({
      deploymentId: "deployment_docs_deleted",
      id: "2:lesson",
      ts: 20,
      value: null,
      deleted: true,
      prevTs: 10,
    });

    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_docs_deleted",
        "2:lesson",
        30,
      ),
    ).resolves.toMatchObject({
      id: "2:lesson",
      ts: 20,
      value: null,
      deleted: true,
      prevTs: 10,
    });
  });

  it("rejects malformed document ids in document persistence helpers", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.insertDocumentRevision({
        deploymentId: "deployment_docs_bad_id",
        id: "bad",
        ts: 10,
        value: null,
      }),
    ).rejects.toThrow(FlarexDocumentIdFormatError);
  });

  it("dedupes and lists invoke session document reads", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_reads",
      sessionId: "session_reads",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_reads",
      sessionId: "session_reads",
      tableId: 1,
      documentId: "1:message",
      observedTs: 20,
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_reads",
      sessionId: "session_reads",
      tableId: 2,
      documentId: "2:lesson",
      observedTs: null,
    });

    await expect(
      persistence.listInvokeSessionDocumentReads(
        "deployment_reads",
        "session_reads",
      ),
    ).resolves.toMatchObject([
      {
        deploymentId: "deployment_reads",
        sessionId: "session_reads",
        tableId: 1,
        documentId: "1:message",
        observedTs: 10,
      },
      {
        deploymentId: "deployment_reads",
        sessionId: "session_reads",
        tableId: 2,
        documentId: "2:lesson",
        observedTs: null,
      },
    ]);
  });

  it("lists latest visible documents in a table at a snapshot", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_table_scan",
      id: "1:a",
      ts: 10,
      value: { text: "first" },
    });
    await persistence.insertDocumentRevision({
      deploymentId: "deployment_table_scan",
      id: "1:a",
      ts: 20,
      value: { text: "updated" },
      prevTs: 10,
    });
    await persistence.insertDocumentRevision({
      deploymentId: "deployment_table_scan",
      id: "1:b",
      ts: 15,
      value: { text: "second" },
    });
    await persistence.insertDocumentRevision({
      deploymentId: "deployment_table_scan",
      id: "1:c",
      ts: 15,
      value: { text: "deleted" },
    });
    await persistence.insertDocumentRevision({
      deploymentId: "deployment_table_scan",
      id: "1:c",
      ts: 25,
      value: null,
      deleted: true,
      prevTs: 15,
    });

    await expect(
      persistence.listDocumentsInTableAtTs("deployment_table_scan", 1, 30),
    ).resolves.toMatchObject([
      { id: "1:a", ts: 20, value: { text: "updated" } },
      { id: "1:b", ts: 15, value: { text: "second" } },
    ]);
    await expect(
      persistence.listDocumentsInTableAtTs("deployment_table_scan", 1, 30, 1),
    ).resolves.toMatchObject([
      { id: "1:a", ts: 20, value: { text: "updated" } },
    ]);
  });

  it("dedupes and lists invoke session table reads", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertInvokeSessionTableRead({
      deploymentId: "deployment_table_reads",
      sessionId: "session_reads",
      tableId: 1,
      observedTs: 10,
    });
    await persistence.insertInvokeSessionTableRead({
      deploymentId: "deployment_table_reads",
      sessionId: "session_reads",
      tableId: 1,
      observedTs: 20,
    });
    await persistence.insertInvokeSessionTableRead({
      deploymentId: "deployment_table_reads",
      sessionId: "session_reads",
      tableId: 2,
      observedTs: 10,
    });

    await expect(
      persistence.listInvokeSessionTableReads(
        "deployment_table_reads",
        "session_reads",
      ),
    ).resolves.toMatchObject([
      {
        deploymentId: "deployment_table_reads",
        sessionId: "session_reads",
        tableId: 1,
        observedTs: 10,
      },
      {
        deploymentId: "deployment_table_reads",
        sessionId: "session_reads",
        tableId: 2,
        observedTs: 10,
      },
    ]);
  });

  it("stages and lists invoke session document writes", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const first = await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes",
      sessionId: "session_writes",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "hello" },
    });

    expect(first).toMatchObject({
      deploymentId: "deployment_writes",
      sessionId: "session_writes",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "hello" },
    });
    expect(first.stagedAt).toBeInstanceOf(Date);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes",
      sessionId: "session_writes",
      tableId: 2,
      documentId: "2:lesson",
      op: "insert",
      valueJson: { title: "Intro" },
    });

    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes",
        "session_writes",
      ),
    ).resolves.toMatchObject([
      {
        tableId: 1,
        documentId: "1:message",
        op: "insert",
        valueJson: { text: "hello" },
      },
      {
        tableId: 2,
        documentId: "2:lesson",
        op: "insert",
        valueJson: { title: "Intro" },
      },
    ]);
  });

  it("rejects duplicate invoke session document inserts clearly", async () => {
    const persistence = await createMigratedPGlitePersistence();

    const input = {
      deploymentId: "deployment_writes_dup",
      sessionId: "session_writes",
      tableId: 1,
      documentId: "1:message",
      op: "insert" as const,
      valueJson: { text: "hello" },
    };

    await persistence.stageInvokeSessionDocumentWrite(input);

    await expect(
      persistence.stageInvokeSessionDocumentWrite(input),
    ).rejects.toThrow(InvokeSessionDocumentWriteAlreadyExistsError);
  });

  it("rejects invalid staged write values before changing storage", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const identity = {
      deploymentId: "deployment_invalid_writes",
      sessionId: "session_invalid_writes",
      tableId: 1,
      documentId: "1:message",
    };

    await expect(
      persistence.stageInvokeSessionDocumentWrite({
        ...identity,
        op: "patch",
        valueJson: null,
      }),
    ).rejects.toMatchObject({
      name: InvokeSessionDocumentWriteCorruptionError.name,
      reason: "patchValueNotObject",
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        identity.deploymentId,
        identity.sessionId,
      ),
    ).resolves.toEqual([]);

    await persistence.stageInvokeSessionDocumentWrite({
      ...identity,
      op: "patch",
      valueJson: { count: 1 },
    });
    await expect(
      persistence.stageInvokeSessionDocumentWrite({
        ...identity,
        op: "replace",
        valueJson: { nested: Number.POSITIVE_INFINITY },
      }),
    ).rejects.toMatchObject({
      name: InvokeSessionDocumentWriteCorruptionError.name,
      reason: "valueNotJson",
    });
    await expect(
      persistence.stageInvokeSessionDocumentWrite({
        ...identity,
        op: "delete",
        valueJson: { unexpected: true },
      }),
    ).rejects.toMatchObject({
      name: InvokeSessionDocumentWriteCorruptionError.name,
      reason: "deleteValuePresent",
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        identity.deploymentId,
        identity.sessionId,
      ),
    ).resolves.toMatchObject([
      { op: "patch", valueJson: { count: 1 } },
    ]);
  });

  it("coalesces repeated staged writes for one document", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_patch",
      tableId: 1,
      documentId: "1:message",
      op: "patch",
      valueJson: { text: "hello", count: 1 },
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_patch",
      tableId: 1,
      documentId: "1:message",
      op: "patch",
      valueJson: { count: 2 },
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes_coalesce",
        "session_patch",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:message",
        op: "patch",
        valueJson: { text: "hello", count: 2 },
      },
    ]);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_insert",
      tableId: 1,
      documentId: "1:new",
      op: "insert",
      valueJson: { text: "draft", count: 0 },
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_insert",
      tableId: 1,
      documentId: "1:new",
      op: "patch",
      valueJson: { count: 1 },
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes_coalesce",
        "session_insert",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:new",
        op: "insert",
        valueJson: { text: "draft", count: 1 },
      },
    ]);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_insert_delete",
      tableId: 1,
      documentId: "1:gone",
      op: "insert",
      valueJson: { text: "temporary" },
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_insert_delete",
      tableId: 1,
      documentId: "1:gone",
      op: "delete",
      valueJson: null,
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes_coalesce",
        "session_insert_delete",
      ),
    ).resolves.toEqual([]);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_patch_delete",
      tableId: 1,
      documentId: "1:old",
      op: "patch",
      valueJson: { text: "updated" },
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_patch_delete",
      tableId: 1,
      documentId: "1:old",
      op: "delete",
      valueJson: null,
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes_coalesce",
        "session_patch_delete",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:old",
        op: "delete",
        valueJson: null,
      },
    ]);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_insert_replace",
      tableId: 1,
      documentId: "1:insert_replace",
      op: "insert",
      valueJson: { text: "draft", count: 0 },
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_insert_replace",
      tableId: 1,
      documentId: "1:insert_replace",
      op: "replace",
      valueJson: { text: "final" },
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes_coalesce",
        "session_insert_replace",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:insert_replace",
        op: "insert",
        valueJson: { text: "final" },
      },
    ]);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_patch_replace",
      tableId: 1,
      documentId: "1:patch_replace",
      op: "patch",
      valueJson: { count: 1 },
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_patch_replace",
      tableId: 1,
      documentId: "1:patch_replace",
      op: "replace",
      valueJson: { text: "final" },
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes_coalesce",
        "session_patch_replace",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:patch_replace",
        op: "replace",
        valueJson: { text: "final" },
      },
    ]);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_replace_patch",
      tableId: 1,
      documentId: "1:replace_patch",
      op: "replace",
      valueJson: { text: "first", keep: true },
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_replace_patch",
      tableId: 1,
      documentId: "1:replace_patch",
      op: "patch",
      valueJson: { text: "second" },
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes_coalesce",
        "session_replace_patch",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:replace_patch",
        op: "replace",
        valueJson: { text: "second", keep: true },
      },
    ]);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_replace_delete",
      tableId: 1,
      documentId: "1:replace_delete",
      op: "replace",
      valueJson: { text: "temporary" },
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_replace_delete",
      tableId: 1,
      documentId: "1:replace_delete",
      op: "delete",
      valueJson: null,
    });
    await expect(
      persistence.listInvokeSessionDocumentWrites(
        "deployment_writes_coalesce",
        "session_replace_delete",
      ),
    ).resolves.toMatchObject([
      {
        documentId: "1:replace_delete",
        op: "delete",
        valueJson: null,
      },
    ]);

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_writes_coalesce",
      sessionId: "session_delete_patch",
      tableId: 1,
      documentId: "1:deleted",
      op: "delete",
      valueJson: null,
    });
    await expect(
      persistence.stageInvokeSessionDocumentWrite({
        deploymentId: "deployment_writes_coalesce",
        sessionId: "session_delete_patch",
        tableId: 1,
        documentId: "1:deleted",
        op: "patch",
        valueJson: { text: "bad" },
      }),
    ).rejects.toThrow(InvokeSessionDocumentWriteConflictError);
    await expect(
      persistence.stageInvokeSessionDocumentWrite({
        deploymentId: "deployment_writes_coalesce",
        sessionId: "session_delete_patch",
        tableId: 1,
        documentId: "1:deleted",
        op: "replace",
        valueJson: { text: "bad" },
      }),
    ).rejects.toThrow(InvokeSessionDocumentWriteConflictError);
  });

  it("commits staged invoke session inserts atomically", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_commit",
      sessionId: "session_commit",
      projectId: "project_commit",
      packageId: "package_commit",
      functionPath: "messages:send",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 100,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_commit",
      sessionId: "session_commit",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "hello" },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_commit",
        sessionId: "session_commit",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 100,
      }),
    ).resolves.toEqual({
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
    await expect(
      persistence.getDocumentRevisionAtTs("deployment_commit", "1:message", 101),
    ).resolves.toMatchObject({
      id: "1:message",
      ts: 101,
      value: { text: "hello" },
    });
    await expect(
      persistence.getInvokeSessionMetadata("deployment_commit", "session_commit"),
    ).resolves.toMatchObject({
      state: "finished",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    await expect(
      persistence.query<{ ts: number; source: string }>(
        "select ts, source from commits where deployment_id = $1",
        ["deployment_commit"],
      ),
    ).resolves.toMatchObject({
      rows: [{ ts: 101, source: "invoke:messages:send" }],
    });
    await expect(
      persistence.listOutboxEvents({
        deploymentId: "deployment_commit",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [
        {
          deploymentId: "deployment_commit",
          ts: 101,
          sequence: 0,
          deliveredAt: null,
          event: {
            type: "commit",
            deploymentId: "deployment_commit",
            commitTs: 101,
            source: "invoke:messages:send",
            changedTableIds: [1],
            changedDocumentIds: ["1:message"],
            writeSummary: {
              writes: [
                {
                  tableId: 1,
                  id: "1:message",
                  prevTs: null,
                  ts: 101,
                  value: { text: "hello" },
                },
              ],
            },
          },
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("maintains enabled index entries for staged inserts", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_insert",
      sessionId: "session_insert",
      beginTs: 100,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_insert",
      sessionId: "session_insert",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "hello", count: 1 },
    });

    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_insert",
      sessionId: "session_insert",
      source: "invoke:messages:send",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
      minimumTs: 100,
    });

    await expect(
      persistence.query<{ ts: number; deleted: boolean; rows: number }>(
        `
        select ts, deleted, count(*)::int as rows
        from indexes
        where deployment_id = $1
        group by ts, deleted
        order by ts, deleted
        `,
        ["deployment_index_insert"],
      ),
    ).resolves.toMatchObject({
      rows: [{ ts: 101, deleted: false, rows: 1 }],
    });
  });

  it("lists documents through maintained index entries at a snapshot", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_query",
      sessionId: "session_insert",
      beginTs: 100,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_query",
      sessionId: "session_insert",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "hello", count: 1 },
    });
    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_query",
      sessionId: "session_insert",
      source: "invoke:messages:send",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
      minimumTs: 100,
    });

    const bounds = indexBoundsForExpressions(["text"], [
      { op: "eq", field: "text", value: "hello" },
    ]);
    await expect(
      persistence.listDocumentsInIndexAtTs({
        deploymentId: "deployment_index_query",
        indexId: 1,
        ts: 101,
        ...bounds,
      }),
    ).resolves.toMatchObject({
      documents: [
        {
          document: {
            id: "1:message",
            value: { text: "hello", count: 1 },
          },
        },
      ],
      isDone: true,
    });
  });

  it("rejects mutation commits when an index read range changed", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const bounds = indexBoundsForExpressions(["text"], [
      { op: "eq", field: "text", value: "new" },
    ]);

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_occ",
      sessionId: "session_read",
      beginTs: 101,
    });
    await persistence.insertInvokeSessionIndexRead({
      deploymentId: "deployment_index_occ",
      sessionId: "session_read",
      indexId: 1,
      ...bounds,
      observedTs: 101,
    });

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_occ",
      sessionId: "session_concurrent",
      beginTs: 101,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_occ",
      sessionId: "session_concurrent",
      tableId: 1,
      documentId: "1:concurrent",
      op: "insert",
      valueJson: { text: "new", count: 1 },
    });
    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_occ",
      sessionId: "session_concurrent",
      source: "invoke:messages:send",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
      minimumTs: 101,
    });

    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_occ",
      sessionId: "session_read",
      tableId: 1,
      documentId: "1:other",
      op: "insert",
      valueJson: { text: "other", count: 1 },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_index_occ",
        sessionId: "session_read",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 101,
      }),
    ).rejects.toThrow(InvokeSessionIndexOccConflictError);
    await expect(
      persistence.getDocumentRevisionAtTs("deployment_index_occ", "1:other", 103),
    ).resolves.toBeNull();
  });

  it("checks changed index entries with timestamp and key range predicates", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const helloBounds = indexBoundsForExpressions(["text"], [
      { op: "eq", field: "text", value: "hello" },
    ]);
    const otherBounds = indexBoundsForExpressions(["text"], [
      { op: "eq", field: "text", value: "other" },
    ]);

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_freshness",
      sessionId: "session_insert_hello",
      beginTs: 100,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_freshness",
      sessionId: "session_insert_hello",
      tableId: 1,
      documentId: "1:hello",
      op: "insert",
      valueJson: { text: "hello", count: 1 },
    });
    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_freshness",
      sessionId: "session_insert_hello",
      source: "invoke:messages:send",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
      minimumTs: 100,
    });

    await expect(
      persistence.hasIndexEntryAfterTs({
        deploymentId: "deployment_index_freshness",
        indexId: 1,
        afterTs: 100,
        ...helloBounds,
      }),
    ).resolves.toBe(true);
    await expect(
      persistence.hasIndexEntryAfterTs({
        deploymentId: "deployment_index_freshness",
        indexId: 1,
        afterTs: 100,
        ...otherBounds,
      }),
    ).resolves.toBe(false);

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_freshness",
      sessionId: "session_delete_hello",
      beginTs: 101,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_freshness",
      sessionId: "session_delete_hello",
      tableId: 1,
      documentId: "1:hello",
      op: "delete",
      valueJson: null,
    });
    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_freshness",
      sessionId: "session_delete_hello",
      source: "invoke:messages:delete",
      finishedAt: new Date("2026-06-20T00:01:00.000Z"),
      minimumTs: 101,
    });

    await expect(
      persistence.hasIndexEntryAfterTs({
        deploymentId: "deployment_index_freshness",
        indexId: 1,
        afterTs: 101,
        ...helloBounds,
      }),
    ).resolves.toBe(true);

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_freshness",
      sessionId: "session_insert_patch",
      beginTs: 102,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_freshness",
      sessionId: "session_insert_patch",
      tableId: 1,
      documentId: "1:patch",
      op: "insert",
      valueJson: { text: "hello", count: 1 },
    });
    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_freshness",
      sessionId: "session_insert_patch",
      source: "invoke:messages:send",
      finishedAt: new Date("2026-06-20T00:02:00.000Z"),
      minimumTs: 102,
    });
    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_freshness",
      sessionId: "session_patch_same_key",
      beginTs: 103,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_freshness",
      sessionId: "session_patch_same_key",
      tableId: 1,
      documentId: "1:patch",
      op: "patch",
      valueJson: { count: 2 },
    });
    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_freshness",
      sessionId: "session_patch_same_key",
      source: "invoke:messages:patch",
      finishedAt: new Date("2026-06-20T00:03:00.000Z"),
      minimumTs: 103,
    });

    await expect(
      persistence.hasIndexEntryAfterTs({
        deploymentId: "deployment_index_freshness",
        indexId: 1,
        afterTs: 103,
        ...helloBounds,
      }),
    ).resolves.toBe(false);
  });

  it("maintains enabled index tombstones and replacement entries for staged patches", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_patch",
      sessionId: "session_insert",
      beginTs: 100,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_patch",
      sessionId: "session_insert",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "old", count: 1 },
    });
    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_patch",
      sessionId: "session_insert",
      source: "invoke:messages:send",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
      minimumTs: 100,
    });

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_patch",
      sessionId: "session_patch",
      beginTs: 101,
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_index_patch",
      sessionId: "session_patch",
      tableId: 1,
      documentId: "1:message",
      observedTs: 101,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_patch",
      sessionId: "session_patch",
      tableId: 1,
      documentId: "1:message",
      op: "patch",
      valueJson: { text: "new" },
    });

    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_patch",
      sessionId: "session_patch",
      source: "invoke:messages:update",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
      minimumTs: 101,
    });

    await expect(
      persistence.query<{ ts: number; deleted: boolean; rows: number }>(
        `
        select ts, deleted, count(*)::int as rows
        from indexes
        where deployment_id = $1
        group by ts, deleted
        order by ts, deleted
        `,
        ["deployment_index_patch"],
      ),
    ).resolves.toMatchObject({
      rows: [
        { ts: 101, deleted: false, rows: 1 },
        { ts: 102, deleted: false, rows: 1 },
        { ts: 102, deleted: true, rows: 1 },
      ],
    });
  });

  it("maintains enabled index tombstones for staged deletes", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_delete",
      sessionId: "session_insert",
      beginTs: 100,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_delete",
      sessionId: "session_insert",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "old", count: 1 },
    });
    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_delete",
      sessionId: "session_insert",
      source: "invoke:messages:send",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
      minimumTs: 100,
    });

    await insertIndexedPackageAndSession(persistence, {
      deploymentId: "deployment_index_delete",
      sessionId: "session_delete",
      beginTs: 101,
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_index_delete",
      sessionId: "session_delete",
      tableId: 1,
      documentId: "1:message",
      observedTs: 101,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_index_delete",
      sessionId: "session_delete",
      tableId: 1,
      documentId: "1:message",
      op: "delete",
      valueJson: null,
    });

    await persistence.commitInvokeSessionWrites({
      deploymentId: "deployment_index_delete",
      sessionId: "session_delete",
      source: "invoke:messages:delete",
      finishedAt: new Date("2026-06-20T00:00:00.000Z"),
      minimumTs: 101,
    });

    await expect(
      persistence.query<{ ts: number; deleted: boolean; rows: number }>(
        `
        select ts, deleted, count(*)::int as rows
        from indexes
        where deployment_id = $1
        group by ts, deleted
        order by ts, deleted
        `,
        ["deployment_index_delete"],
      ),
    ).resolves.toMatchObject({
      rows: [
        { ts: 101, deleted: false, rows: 1 },
        { ts: 102, deleted: true, rows: 1 },
      ],
    });
  });

  it("commits staged invoke session patches after read validation", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_patch_commit",
      id: "1:message",
      ts: 10,
      value: { text: "old", count: 1 },
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_patch_commit",
      sessionId: "session_patch",
      projectId: "project_patch",
      packageId: "package_patch",
      functionPath: "messages:update",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_patch_commit",
      sessionId: "session_patch",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_patch_commit",
      sessionId: "session_patch",
      tableId: 1,
      documentId: "1:message",
      op: "patch",
      valueJson: { count: 2 },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_patch_commit",
        sessionId: "session_patch",
        source: "invoke:messages:update",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).resolves.toEqual({
      committedTs: 16,
      writes: [
        {
          tableId: 1,
          id: "1:message",
          prevTs: 10,
          ts: 16,
          value: { text: "old", count: 2 },
        },
      ],
    });
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_patch_commit",
        "1:message",
        16,
      ),
    ).resolves.toMatchObject({
      id: "1:message",
      ts: 16,
      prevTs: 10,
      value: { text: "old", count: 2 },
    });
  });

  it("commits staged invoke session replacements after read validation", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_replace_commit",
      id: "1:message",
      ts: 10,
      value: { text: "old", count: 1, removed: true },
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_replace_commit",
      sessionId: "session_replace",
      projectId: "project_replace",
      packageId: "package_replace",
      functionPath: "messages:replace",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_replace_commit",
      sessionId: "session_replace",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_replace_commit",
      sessionId: "session_replace",
      tableId: 1,
      documentId: "1:message",
      op: "replace",
      valueJson: { text: "new", count: 2 },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_replace_commit",
        sessionId: "session_replace",
        source: "invoke:messages:replace",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).resolves.toEqual({
      committedTs: 16,
      writes: [
        {
          tableId: 1,
          id: "1:message",
          prevTs: 10,
          ts: 16,
          value: { text: "new", count: 2 },
        },
      ],
    });
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_replace_commit",
        "1:message",
        16,
      ),
    ).resolves.toMatchObject({
      id: "1:message",
      ts: 16,
      prevTs: 10,
      value: { text: "new", count: 2 },
    });
  });

  it("rolls back staged replace commits when the target is missing", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_replace_missing",
      sessionId: "session_replace",
      projectId: "project_replace",
      packageId: "package_replace",
      functionPath: "messages:replace",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_replace_missing",
      sessionId: "session_replace",
      tableId: 1,
      documentId: "1:message",
      op: "replace",
      valueJson: { text: "new" },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_replace_missing",
        sessionId: "session_replace",
        source: "invoke:messages:replace",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).rejects.toThrow(InvokeSessionReplaceTargetError);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_replace_missing",
        "session_replace",
      ),
    ).resolves.toMatchObject({
      state: "active",
      finishedAt: null,
    });
  });

  it("validates staged inserts against package schema before commit", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await insertValidatedPackageAndSession(persistence, {
      deploymentId: "deployment_validate_insert",
      sessionId: "session_validate",
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_validate_insert",
      sessionId: "session_validate",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "hello", count: 1 },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_validate_insert",
        sessionId: "session_validate",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 100,
      }),
    ).resolves.toMatchObject({
      committedTs: 101,
      writes: [
        {
          tableId: 1,
          id: "1:message",
          value: { text: "hello", count: 1 },
        },
      ],
    });
  });

  it("rejects staged inserts that fail package schema validation", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await insertValidatedPackageAndSession(persistence, {
      deploymentId: "deployment_validate_bad_insert",
      sessionId: "session_validate",
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_validate_bad_insert",
      sessionId: "session_validate",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: 123, count: 1 },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_validate_bad_insert",
        sessionId: "session_validate",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 100,
      }),
    ).rejects.toThrow(InvokeSessionDocumentValidationError);
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_validate_bad_insert",
        "1:message",
        101,
      ),
    ).resolves.toBeNull();
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_validate_bad_insert",
        "session_validate",
      ),
    ).resolves.toMatchObject({ state: "active", finishedAt: null });
  });

  it("validates staged patches against the merged final document", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_validate_patch",
      id: "1:message",
      ts: 10,
      value: { text: "old", count: 1 },
    });
    await insertValidatedPackageAndSession(persistence, {
      deploymentId: "deployment_validate_patch",
      sessionId: "session_validate",
      beginTs: 15,
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_validate_patch",
      sessionId: "session_validate",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_validate_patch",
      sessionId: "session_validate",
      tableId: 1,
      documentId: "1:message",
      op: "patch",
      valueJson: { count: 2 },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_validate_patch",
        sessionId: "session_validate",
        source: "invoke:messages:update",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).resolves.toMatchObject({
      committedTs: 16,
      writes: [{ id: "1:message", value: { text: "old", count: 2 } }],
    });
  });

  it("rejects staged patches when the merged final document is invalid", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_validate_bad_patch",
      id: "1:message",
      ts: 10,
      value: { text: "old", count: 1 },
    });
    await insertValidatedPackageAndSession(persistence, {
      deploymentId: "deployment_validate_bad_patch",
      sessionId: "session_validate",
      beginTs: 15,
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_validate_bad_patch",
      sessionId: "session_validate",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_validate_bad_patch",
      sessionId: "session_validate",
      tableId: 1,
      documentId: "1:message",
      op: "patch",
      valueJson: { count: "bad" },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_validate_bad_patch",
        sessionId: "session_validate",
        source: "invoke:messages:update",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).rejects.toThrow(InvokeSessionDocumentValidationError);
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_validate_bad_patch",
        "1:message",
        16,
      ),
    ).resolves.toMatchObject({
      ts: 10,
      value: { text: "old", count: 1 },
    });
  });

  it("rolls back staged patch commits when the target is not an object", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_patch_non_object",
      id: "1:message",
      ts: 10,
      value: "old",
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_patch_non_object",
      sessionId: "session_patch",
      projectId: "project_patch",
      packageId: "package_patch",
      functionPath: "messages:update",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_patch_non_object",
      sessionId: "session_patch",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_patch_non_object",
      sessionId: "session_patch",
      tableId: 1,
      documentId: "1:message",
      op: "patch",
      valueJson: { count: 2 },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_patch_non_object",
        sessionId: "session_patch",
        source: "invoke:messages:update",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).rejects.toThrow(InvokeSessionPatchTargetError);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_patch_non_object",
        "session_patch",
      ),
    ).resolves.toMatchObject({
      state: "active",
      finishedAt: null,
    });
    await expect(
      persistence.query<{ count: number }>(
        "select count(*)::int as count from commits where deployment_id = $1",
        ["deployment_patch_non_object"],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
    await expect(
      persistence.listOutboxEvents({
        deploymentId: "deployment_patch_non_object",
        limit: 10,
      }),
    ).resolves.toMatchObject({ events: [] });
  });

  it("lists and marks undelivered outbox events", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertOutboxEvent({
      deploymentId: "deployment_outbox_delivery",
      ts: 10,
      sequence: 0,
      event: {
        type: "commit",
        deploymentId: "deployment_outbox_delivery",
        commitTs: 10,
        source: "invoke:messages:create",
        changedTableIds: [1],
        changedDocumentIds: ["1:message_a"],
        writeSummary: { writes: [] },
      },
    });
    await persistence.insertOutboxEvent({
      deploymentId: "deployment_outbox_delivery",
      ts: 11,
      sequence: 0,
      event: {
        type: "commit",
        deploymentId: "deployment_outbox_delivery",
        commitTs: 11,
        source: "invoke:messages:update",
        changedTableIds: [1],
        changedDocumentIds: ["1:message_b"],
        writeSummary: { writes: [] },
      },
    });

    const undelivered = await persistence.listUndeliveredOutboxEvents({
      deploymentId: "deployment_outbox_delivery",
      limit: 10,
    });
    expect(undelivered.events.map((event) => event.ts)).toEqual([10, 11]);

    await expect(
      persistence.markOutboxEventsDelivered({
        deploymentId: "deployment_outbox_delivery",
        events: [{ ts: 10, sequence: 0 }],
        deliveredAt: new Date("2026-06-20T01:00:00.000Z"),
      }),
    ).resolves.toEqual({ delivered: 1 });

    await expect(
      persistence.listUndeliveredOutboxEvents({
        deploymentId: "deployment_outbox_delivery",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 11, sequence: 0, deliveredAt: null }],
      nextCursor: null,
      hasMore: false,
    });
    await expect(
      persistence.listOutboxEvents({
        deploymentId: "deployment_outbox_delivery",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      events: [
        {
          ts: 10,
          sequence: 0,
          deliveredAt: new Date("2026-06-20T01:00:00.000Z"),
        },
        { ts: 11, sequence: 0, deliveredAt: null },
      ],
    });
  });

  it("pages undelivered outbox events and ignores already delivered marks", async () => {
    const persistence = await createMigratedPGlitePersistence();

    for (const ts of [10, 11, 12]) {
      await persistence.insertOutboxEvent({
        deploymentId: "deployment_outbox_page",
        ts,
        sequence: 0,
        event: {
          type: "commit",
          deploymentId: "deployment_outbox_page",
          commitTs: ts,
          source: "invoke:messages:create",
          changedTableIds: [1],
          changedDocumentIds: [`1:message_${ts}`],
          writeSummary: { writes: [] },
        },
      });
    }

    const first = await persistence.listUndeliveredOutboxEvents({
      deploymentId: "deployment_outbox_page",
      limit: 2,
    });
    expect(first.events.map((event) => event.ts)).toEqual([10, 11]);
    expect(first.nextCursor).toEqual({ ts: 11, sequence: 0 });
    expect(first.hasMore).toBe(true);

    await expect(
      persistence.listUndeliveredOutboxEvents({
        deploymentId: "deployment_outbox_page",
        cursor: first.nextCursor!,
        limit: 2,
      }),
    ).resolves.toMatchObject({
      events: [{ ts: 12, sequence: 0 }],
      nextCursor: null,
      hasMore: false,
    });

    await persistence.markOutboxEventsDelivered({
      deploymentId: "deployment_outbox_page",
      events: [
        { ts: 10, sequence: 0 },
        { ts: 999, sequence: 0 },
      ],
      deliveredAt: new Date("2026-06-20T01:00:00.000Z"),
    });
    await expect(
      persistence.markOutboxEventsDelivered({
        deploymentId: "deployment_outbox_page",
        events: [{ ts: 10, sequence: 0 }],
        deliveredAt: new Date("2026-06-20T02:00:00.000Z"),
      }),
    ).resolves.toEqual({ delivered: 0 });
  });

  it("applies durable freshness commits idempotently", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.applyFreshnessCommit({
        eventKey: {
          deploymentId: "deployment_freshness",
          ts: 10,
          sequence: 0,
        },
        commitTs: 10,
        documentIds: ["1:message"],
        tableIds: [1],
        processedAt: new Date("2026-06-20T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      applied: true,
      documentVersions: [
        {
          deploymentId: "deployment_freshness",
          documentId: "1:message",
          version: 10,
          outboxTs: 10,
          outboxSequence: 0,
        },
      ],
      tableVersions: [
        {
          deploymentId: "deployment_freshness",
          tableId: 1,
          version: 10,
          outboxTs: 10,
          outboxSequence: 0,
        },
      ],
    });
    await expect(
      persistence.getFreshnessProcessedEvent({
        deploymentId: "deployment_freshness",
        ts: 10,
        sequence: 0,
      }),
    ).resolves.toMatchObject({
      processedAt: new Date("2026-06-20T00:00:00.000Z"),
    });

    await expect(
      persistence.applyFreshnessCommit({
        eventKey: {
          deploymentId: "deployment_freshness",
          ts: 10,
          sequence: 0,
        },
        commitTs: 10,
        documentIds: ["1:message"],
        tableIds: [1],
      }),
    ).resolves.toEqual({
      applied: false,
      documentVersions: [],
      tableVersions: [],
    });
  });

  it("does not regress durable freshness versions", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.applyFreshnessCommit({
      eventKey: {
        deploymentId: "deployment_freshness_ordering",
        ts: 20,
        sequence: 0,
      },
      commitTs: 20,
      documentIds: ["1:message"],
      tableIds: [1],
    });
    await persistence.applyFreshnessCommit({
      eventKey: {
        deploymentId: "deployment_freshness_ordering",
        ts: 10,
        sequence: 0,
      },
      commitTs: 10,
      documentIds: ["1:message"],
      tableIds: [1],
    });

    await expect(
      persistence.getDocumentFreshnessVersion(
        "deployment_freshness_ordering",
        "1:message",
      ),
    ).resolves.toMatchObject({
      version: 20,
      outboxTs: 20,
      outboxSequence: 0,
    });
    await expect(
      persistence.getTableFreshnessVersion("deployment_freshness_ordering", 1),
    ).resolves.toMatchObject({
      version: 20,
      outboxTs: 20,
      outboxSequence: 0,
    });
  });

  it("upserts and lists live query subscriptions", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.upsertLiveQuerySubscription({
        deploymentId: "deployment_live_queries",
        connectionId: "connection_a",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: { teamId: "team_a" },
        identityJson: {
          kind: "user",
          user: {
            tokenIdentifier: "issuer|user_a",
            subject: "user_a",
            issuer: "issuer",
          },
        },
        partitionKey: "team_a",
        beginTs: 10,
        readSetJson: {
          documents: [{ tableId: 1, id: "1:message", observedTs: 10 }],
        },
        resultJson: [{ _id: "1:message", text: "hello" }],
        resultHash: "hash_a",
        updatedAt: new Date("2026-06-20T00:00:00.000Z"),
      }),
    ).resolves.toMatchObject({
      deploymentId: "deployment_live_queries",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      identityJson: {
        kind: "user",
        user: {
          tokenIdentifier: "issuer|user_a",
          subject: "user_a",
          issuer: "issuer",
        },
      },
      partitionKey: "team_a",
      beginTs: 10,
      readSetJson: {
        documents: [{ tableId: 1, id: "1:message", observedTs: 10 }],
      },
      resultJson: [{ _id: "1:message", text: "hello" }],
      resultHash: "hash_a",
      updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    });

    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_queries",
      connectionId: "connection_a",
      queryId: 2,
      functionPath: "messages:count",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 11,
      readSetJson: { tables: [{ tableId: 1, observedTs: 11 }] },
      resultJson: 1,
      resultHash: "hash_b",
      updatedAt: new Date("2026-06-20T00:00:01.000Z"),
    });
    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_queries",
      connectionId: "connection_b",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_b" },
      partitionKey: "team_b",
      beginTs: 12,
      readSetJson: { tables: [{ tableId: 2, observedTs: 12 }] },
      resultJson: [],
      resultHash: "hash_c",
      updatedAt: new Date("2026-06-20T00:00:02.000Z"),
    });

    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_queries",
        connectionId: "connection_a",
      }),
    ).resolves.toMatchObject([
      {
        connectionId: "connection_a",
        queryId: 1,
        resultHash: "hash_a",
        partitionKey: "team_a",
      },
      {
        connectionId: "connection_a",
        queryId: 2,
        resultHash: "hash_b",
        partitionKey: "team_a",
      },
    ]);

    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_queries",
      }),
    ).resolves.toMatchObject([
      { connectionId: "connection_a", queryId: 1, partitionKey: "team_a" },
      { connectionId: "connection_a", queryId: 2, partitionKey: "team_a" },
      { connectionId: "connection_b", queryId: 1, partitionKey: "team_b" },
    ]);
  });

  it("uses transaction time for an implicit live query subscription update timestamp", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const key = {
      deploymentId: "deployment_live_query_database_time",
      connectionId: "connection_database_time",
      queryId: 1,
    } as const;

    await persistence.upsertLiveQuerySubscription({
      ...key,
      functionPath: "messages:list",
      argsJson: {},
      beginTs: 10,
      readSetJson: {},
      resultJson: [],
      resultHash: "hash_before_database_time",
      updatedAt: new Date("2000-01-01T00:00:00.000Z"),
    });

    await persistence.drizzle.transaction(async (tx) => {
      const timestampResult = await tx.execute<{ transaction_now_ms: string }>(sql`
        select floor(extract(epoch from current_timestamp) * 1000)::text
          as transaction_now_ms
      `);
      const transactionNowMs = Number(
        timestampResult.rows[0]?.transaction_now_ms,
      );
      expect(Number.isSafeInteger(transactionNowMs)).toBe(true);

      await new Promise<void>(resolve => setTimeout(resolve, 25));

      const updated = await upsertLiveQuerySubscription(tx, {
        ...key,
        functionPath: "messages:list",
        argsJson: {},
        beginTs: 11,
        readSetJson: {},
        resultJson: [{ text: "updated" }],
        resultHash: "hash_after_database_time",
      });

      expect(updated.updatedAt.getTime()).toBe(transactionNowMs);
    });
  });

  it("preserves JSON null in live query jsonb columns", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_query_json_null",
      connectionId: "connection_json_null",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      beginTs: 10,
      readSetJson: {},
      resultJson: [],
      resultHash: "hash_before_null",
    });
    await expect(
      persistence.upsertLiveQuerySubscription({
        deploymentId: "deployment_live_query_json_null",
        connectionId: "connection_json_null",
        queryId: 1,
        functionPath: "messages:list",
        argsJson: null,
        beginTs: 11,
        readSetJson: {},
        resultJson: null,
        resultHash: "hash_null",
      }),
    ).resolves.toMatchObject({
      argsJson: null,
      resultJson: null,
      resultHash: "hash_null",
    });
    await expect(
      persistence.upsertLiveQuerySubscription({
        deploymentId: "deployment_live_query_json_null",
        connectionId: "connection_json_null",
        queryId: 2,
        functionPath: "messages:count",
        argsJson: null,
        beginTs: 12,
        readSetJson: {},
        resultJson: null,
        resultHash: "hash_inserted_null",
      }),
    ).resolves.toMatchObject({
      argsJson: null,
      resultJson: null,
      resultHash: "hash_inserted_null",
    });

    await expect(
      persistence.insertLiveQueryDelivery({
        deploymentId: "deployment_live_query_json_null",
        deliveryId: "delivery_json_null",
        connectionId: "connection_json_null",
        queryId: 1,
        payloadJson: null,
      }),
    ).resolves.toMatchObject({ payloadJson: null });
    await expect(
      persistence.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_live_query_json_null",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [{ deliveryId: "delivery_json_null", payloadJson: null }],
      hasMore: false,
    });
  });

  it("tracks active live query subscriptions through connection leases", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const activeAt = new Date("2026-06-20T00:00:30.000Z");

    await persistence.upsertLiveQueryConnectionLease({
      deploymentId: "deployment_live_query_leases",
      connectionId: "connection_active",
      lastSeenAt: new Date("2026-06-20T00:00:00.000Z"),
      expiresAt: new Date("2026-06-20T00:01:00.000Z"),
    });
    await persistence.upsertLiveQueryConnectionLease({
      deploymentId: "deployment_live_query_leases",
      connectionId: "connection_expired",
      lastSeenAt: new Date("2026-06-20T00:00:00.000Z"),
      expiresAt: new Date("2026-06-20T00:00:10.000Z"),
    });
    await persistence.upsertLiveQueryConnectionLease({
      deploymentId: "deployment_live_query_leases",
      connectionId: "connection_closed",
      lastSeenAt: new Date("2026-06-20T00:00:00.000Z"),
      expiresAt: new Date("2026-06-20T00:01:00.000Z"),
    });
    await persistence.closeLiveQueryConnection({
      deploymentId: "deployment_live_query_leases",
      connectionId: "connection_closed",
      closedAt: new Date("2026-06-20T00:00:20.000Z"),
    });

    for (const connectionId of [
      "connection_active",
      "connection_expired",
      "connection_closed",
    ]) {
      await persistence.upsertLiveQuerySubscription({
        deploymentId: "deployment_live_query_leases",
        connectionId,
        queryId: 1,
        functionPath: "messages:list",
        argsJson: { connectionId },
        partitionKey: "team_a",
        beginTs: 10,
        readSetJson: { tables: [{ tableId: 1, observedTs: 10 }] },
        resultJson: [connectionId],
        resultHash: connectionId,
      });
    }

    await expect(
      persistence.listActiveLiveQuerySubscriptions({
        deploymentId: "deployment_live_query_leases",
        activeAt,
      }),
    ).resolves.toMatchObject([
      {
        connectionId: "connection_active",
        queryId: 1,
      },
    ]);

    await expect(
      persistence.deleteExpiredLiveQuerySubscriptions({
        deploymentId: "deployment_live_query_leases",
        expiredAt: activeAt,
      }),
    ).resolves.toEqual({ deleted: 2, deletedConnections: 2 });
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_query_leases",
      }),
    ).resolves.toMatchObject([
      {
        connectionId: "connection_active",
        queryId: 1,
      },
    ]);
    await expect(
      persistence.query<{ count: number }>(
        `
          select count(*)::int as count
          from live_query_connections
          where deployment_id = $1
        `,
        ["deployment_live_query_leases"],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 1 }] });
  });

  it("lists deployments with expired live query connection leases", async () => {
    const persistence = await createMigratedPGlitePersistence();
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_expired_a",
      projectId: "project_a",
    });
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_expired_b",
      projectId: "project_b",
    });

    await persistence.upsertLiveQueryConnectionLease({
      deploymentId: "deployment_expired_a",
      connectionId: "connection_expired_a",
      lastSeenAt: new Date("2026-06-20T00:00:00.000Z"),
      expiresAt: new Date("2026-06-20T00:00:10.000Z"),
    });
    await persistence.upsertLiveQueryConnectionLease({
      deploymentId: "deployment_expired_b",
      connectionId: "connection_closed_b",
      lastSeenAt: new Date("2026-06-20T00:00:00.000Z"),
      expiresAt: new Date("2026-06-20T00:05:00.000Z"),
    });
    await persistence.closeLiveQueryConnection({
      deploymentId: "deployment_expired_b",
      connectionId: "connection_closed_b",
      closedAt: new Date("2026-06-20T00:00:20.000Z"),
    });
    await persistence.upsertLiveQueryConnectionLease({
      deploymentId: "deployment_expired_b",
      connectionId: "connection_active_b",
      lastSeenAt: new Date("2026-06-20T00:00:00.000Z"),
      expiresAt: new Date("2026-06-20T00:05:00.000Z"),
    });

    const first = await persistence.listExpiredLiveQueryConnectionDeployments({
      expiredAt: new Date("2026-06-20T00:01:00.000Z"),
      limit: 1,
    });
    expect(first).toMatchObject({
      deployments: [
        {
          deploymentId: "deployment_expired_a",
          projectId: "project_a",
          oldestExpiredAt: new Date("2026-06-20T00:00:10.000Z"),
          expiredConnections: 1,
        },
      ],
      hasMore: true,
    });

    expect(first.nextCursor).not.toBeNull();
    const nextCursor = first.nextCursor;
    if (nextCursor === null) {
      throw new Error("Expected expired connection deployment scan to return a cursor.");
    }

    await expect(
      persistence.listExpiredLiveQueryConnectionDeployments({
        expiredAt: new Date("2026-06-20T00:01:00.000Z"),
        cursor: nextCursor,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deployments: [
        {
          deploymentId: "deployment_expired_b",
          projectId: "project_b",
          oldestExpiredAt: new Date("2026-06-20T00:00:20.000Z"),
          expiredConnections: 1,
        },
      ],
      hasMore: false,
    });
  });

  it("uses deployment id as expired live query connection deployment cursor tie breaker", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_tie_a",
      projectId: "project_a",
    });
    await persistence.insertDeploymentMetadata({
      deploymentId: "deployment_tie_b",
      projectId: "project_b",
    });
    for (const deploymentId of ["deployment_tie_a", "deployment_tie_b"]) {
      await persistence.upsertLiveQueryConnectionLease({
        deploymentId,
        connectionId: "connection_tie",
        lastSeenAt: new Date("2026-06-20T00:00:00.000Z"),
        expiresAt: new Date("2026-06-20T00:00:10.000Z"),
      });
    }

    const first = await persistence.listExpiredLiveQueryConnectionDeployments({
      expiredAt: new Date("2026-06-20T00:01:00.000Z"),
      limit: 1,
    });
    expect(first.deployments.map((deployment) => deployment.deploymentId)).toEqual([
      "deployment_tie_a",
    ]);
    expect(first.nextCursor).not.toBeNull();
    const nextCursor = first.nextCursor;
    if (nextCursor === null) {
      throw new Error("Expected tied expired connection deployment scan to return a cursor.");
    }

    const second = await persistence.listExpiredLiveQueryConnectionDeployments({
      expiredAt: new Date("2026-06-20T00:01:00.000Z"),
      cursor: nextCursor,
      limit: 1,
    });
    expect(second.deployments.map((deployment) => deployment.deploymentId)).toEqual([
      "deployment_tie_b",
    ]);
    expect(second.hasMore).toBe(false);
  });

  it("replaces and deletes live query subscriptions by key", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_query_replace",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 10,
      readSetJson: { tables: [{ tableId: 1, observedTs: 10 }] },
      resultJson: ["old"],
      resultHash: "hash_old",
      updatedAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_query_replace",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_b",
      beginTs: 20,
      readSetJson: { tables: [{ tableId: 1, observedTs: 20 }] },
      resultJson: ["new"],
      resultHash: "hash_new",
      updatedAt: new Date("2026-06-20T00:01:00.000Z"),
    });

    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_query_replace",
      }),
    ).resolves.toMatchObject([
      {
        connectionId: "connection_a",
        queryId: 1,
        beginTs: 20,
        readSetJson: { tables: [{ tableId: 1, observedTs: 20 }] },
        resultJson: ["new"],
        resultHash: "hash_new",
        partitionKey: "team_b",
        updatedAt: new Date("2026-06-20T00:01:00.000Z"),
      },
    ]);

    await expect(
      persistence.deleteLiveQuerySubscription({
        deploymentId: "deployment_live_query_replace",
        connectionId: "connection_a",
        queryId: 1,
      }),
    ).resolves.toEqual({ deleted: 1 });
    await expect(
      persistence.deleteLiveQuerySubscription({
        deploymentId: "deployment_live_query_replace",
        connectionId: "connection_a",
        queryId: 1,
      }),
    ).resolves.toEqual({ deleted: 0 });
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_query_replace",
      }),
    ).resolves.toEqual([]);
  });

  it("deletes all live query subscriptions for a connection", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_query_connection_delete",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 10,
      readSetJson: { documents: [{ tableId: 1, id: "1:message", observedTs: 10 }] },
      resultJson: ["first"],
      resultHash: "hash_first",
    });
    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_query_connection_delete",
      connectionId: "connection_a",
      queryId: 2,
      functionPath: "messages:count",
      argsJson: { teamId: "team_a" },
      partitionKey: "team_a",
      beginTs: 10,
      readSetJson: { tables: [{ tableId: 1, observedTs: 10 }] },
      resultJson: 1,
      resultHash: "hash_count",
    });
    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_query_connection_delete",
      connectionId: "connection_b",
      queryId: 1,
      functionPath: "messages:list",
      argsJson: { teamId: "team_b" },
      partitionKey: "team_b",
      beginTs: 10,
      readSetJson: { documents: [{ tableId: 1, id: "1:other", observedTs: 10 }] },
      resultJson: ["other"],
      resultHash: "hash_other",
    });

    await expect(
      persistence.deleteLiveQuerySubscriptionsForConnection({
        deploymentId: "deployment_live_query_connection_delete",
        connectionId: "connection_a",
      }),
    ).resolves.toEqual({ deleted: 2 });
    await expect(
      persistence.deleteLiveQuerySubscriptionsForConnection({
        deploymentId: "deployment_live_query_connection_delete",
        connectionId: "connection_a",
      }),
    ).resolves.toEqual({ deleted: 0 });
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_query_connection_delete",
      }),
    ).resolves.toMatchObject([
      {
        connectionId: "connection_b",
        queryId: 1,
        resultHash: "hash_other",
      },
    ]);
  });

  it("round-trips JSON null live query args and results", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await expect(
      persistence.upsertLiveQuerySubscription({
        deploymentId: "deployment_live_query_null",
        connectionId: "connection_a",
        queryId: 1,
        functionPath: "messages:maybe",
        argsJson: null,
        partitionKey: "team_a",
        beginTs: 10,
        readSetJson: {
          documents: [{ tableId: 1, id: "1:message", observedTs: null }],
        },
        resultJson: null,
        resultHash: "null",
      }),
    ).resolves.toMatchObject({
      argsJson: null,
      resultJson: null,
    });

    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_query_null",
      }),
    ).resolves.toMatchObject([
      {
        argsJson: null,
        resultJson: null,
      },
    ]);

    await expect(
      persistence.query<{ count: number }>(
        `
          select count(*)::int as count
          from live_query_subscriptions
          where deployment_id = $1
            and args_json is null
            and result_json is null
        `,
        ["deployment_live_query_null"],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("records live query rerun results with durable delivery rows", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const createdAt = new Date("2026-06-20T00:10:00.000Z");

    await expect(
      persistence.recordLiveQueryRerunResult({
        deploymentId: "deployment_live_query_delivery",
        connectionId: "connection_a",
        queryId: 1,
        functionPath: "messages:get",
        argsJson: { id: "1:message" },
        partitionKey: "team_a",
        beginTs: 20,
        readSetJson: {
          documents: [{ tableId: 1, id: "1:message", observedTs: 20 }],
        },
        resultJson: { _id: "1:message", text: "fresh" },
        resultHash: "fresh_hash",
        updatedAt: createdAt,
        delivery: {
          deploymentId: "deployment_live_query_delivery",
          deliveryId: "delivery_1",
          connectionId: "connection_a",
          queryId: 1,
          payloadJson: {
            deploymentId: "deployment_live_query_delivery",
            connectionId: "connection_a",
            queryId: 1,
            functionPath: "messages:get",
            argsJson: { id: "1:message" },
            resultJson: { _id: "1:message", text: "fresh" },
            previousResultHash: "old_hash",
            resultHash: "fresh_hash",
          },
          createdAt,
        },
      }),
    ).resolves.toMatchObject({
      subscription: {
        deploymentId: "deployment_live_query_delivery",
        connectionId: "connection_a",
        queryId: 1,
        resultHash: "fresh_hash",
      },
      delivery: {
        deploymentId: "deployment_live_query_delivery",
        deliveryId: "delivery_1",
        connectionId: "connection_a",
        queryId: 1,
        payloadJson: {
          resultJson: { _id: "1:message", text: "fresh" },
          previousResultHash: "old_hash",
          resultHash: "fresh_hash",
        },
        deliveredAt: null,
        createdAt,
      },
    });

    await expect(
      persistence.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_live_query_delivery",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [{ deliveryId: "delivery_1", deliveredAt: null }],
      nextCursor: null,
      hasMore: false,
    });

    await expect(
      persistence.markLiveQueryDeliveriesDelivered({
        deploymentId: "deployment_live_query_delivery",
        deliveryIds: ["delivery_1"],
        deliveredAt: new Date("2026-06-20T00:11:00.000Z"),
      }),
    ).resolves.toEqual({ delivered: 1 });
    await expect(
      persistence.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_live_query_delivery",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });
  });

  it("records live query rerun failures by removing the subscription and keeping a delivery row", async () => {
    const persistence = await createMigratedPGlitePersistence();
    const createdAt = new Date("2026-06-20T00:20:00.000Z");

    await persistence.upsertLiveQuerySubscription({
      deploymentId: "deployment_live_query_failure",
      connectionId: "connection_a",
      queryId: 1,
      functionPath: "messages:uniqueByText",
      argsJson: { teamId: "team_a", text: "dupe" },
      partitionKey: "team_a",
      beginTs: 10,
      readSetJson: { tables: [{ tableId: 1, observedTs: 10 }] },
      resultJson: { _id: "1:old", teamId: "team_a", text: "dupe" },
      resultHash: "old_hash",
      updatedAt: new Date("2026-06-20T00:10:00.000Z"),
    });

    await expect(
      persistence.recordLiveQueryRerunFailure({
        deploymentId: "deployment_live_query_failure",
        connectionId: "connection_a",
        queryId: 1,
        delivery: {
          deliveryId: "delivery_failed_1",
          payloadJson: {
            kind: "failed",
            deploymentId: "deployment_live_query_failure",
            connectionId: "connection_a",
            queryId: 1,
            functionPath: "messages:uniqueByText",
            argsJson: { teamId: "team_a", text: "dupe" },
            identityFingerprint: anonymousIdentityFingerprint,
            previousResultHash: "old_hash",
            errorMessage: "Query returned more than one document.",
            errorData: null,
          },
          createdAt,
        },
      }),
    ).resolves.toMatchObject({
      deleted: 1,
      delivery: {
        deploymentId: "deployment_live_query_failure",
        deliveryId: "delivery_failed_1",
        payloadJson: {
          kind: "failed",
          previousResultHash: "old_hash",
          errorMessage: "Query returned more than one document.",
          errorData: null,
        },
        deliveredAt: null,
        createdAt,
      },
    });
    await expect(
      persistence.listLiveQuerySubscriptions({
        deploymentId: "deployment_live_query_failure",
      }),
    ).resolves.toEqual([]);
    await expect(
      persistence.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_live_query_failure",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId: "delivery_failed_1",
          payloadJson: {
            kind: "failed",
            previousResultHash: "old_hash",
            errorData: null,
          },
        },
      ],
      hasMore: false,
    });
  });

  it("leases live query deliveries during claim and reclaims expired leases", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_delivery_lease",
      deliveryId: "delivery_lease",
      connectionId: "connection_lease",
      queryId: 1,
      payloadJson: { resultJson: "fresh" },
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    });

    await expect(
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_delivery_lease",
        limit: 10,
        claimedAt: new Date("2026-06-20T00:01:00.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
        claimOwner: "delivery:deployment_delivery_lease",
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId: "delivery_lease",
          claimedAt: new Date("2026-06-20T00:01:00.000Z"),
          claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
          claimOwner: "delivery:deployment_delivery_lease",
        },
      ],
      hasMore: false,
    });

    await expect(
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_delivery_lease",
        limit: 10,
        claimedAt: new Date("2026-06-20T00:01:30.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:02:30.000Z"),
        claimOwner: "delivery:other",
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });

    await expect(
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_delivery_lease",
        limit: 10,
        claimedAt: new Date("2026-06-20T00:02:00.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:03:00.000Z"),
        claimOwner: "delivery:other",
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId: "delivery_lease",
          claimedAt: new Date("2026-06-20T00:02:00.000Z"),
          claimExpiresAt: new Date("2026-06-20T00:03:00.000Z"),
          claimOwner: "delivery:other",
        },
      ],
      hasMore: false,
    });

    await expect(
      persistence.recordLiveQueryDeliveryFailure({
        deploymentId: "deployment_delivery_lease",
        deliveryIds: ["delivery_lease"],
        stage: "fanout",
        error: "stale DeliveryDO failed late",
        failedAt: new Date("2026-06-20T00:02:05.000Z"),
        claimOwner: "delivery:deployment_delivery_lease",
      }),
    ).resolves.toEqual({ failed: 0 });

    await expect(
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_delivery_lease",
        limit: 10,
        claimedAt: new Date("2026-06-20T00:02:06.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:03:06.000Z"),
        claimOwner: "delivery:third",
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });

    await persistence.recordLiveQueryDeliveryFailure({
      deploymentId: "deployment_delivery_lease",
      deliveryIds: ["delivery_lease"],
      stage: "fanout",
      error: "ConnectionDO failed",
      failedAt: new Date("2026-06-20T00:02:10.000Z"),
      claimOwner: "delivery:other",
    });

    await expect(
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_delivery_lease",
        limit: 10,
        claimedAt: new Date("2026-06-20T00:02:11.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:03:11.000Z"),
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId: "delivery_lease",
          attemptCount: 1,
          claimedAt: new Date("2026-06-20T00:02:11.000Z"),
          claimExpiresAt: new Date("2026-06-20T00:03:11.000Z"),
          claimOwner: null,
        },
      ],
      hasMore: false,
    });
  });

  it("returns a concrete cursor for live query delivery claim pages with more rows", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_claim_cursor",
      deliveryId: "delivery_cursor_a",
      connectionId: "connection_cursor",
      queryId: 1,
      payloadJson: { resultJson: "a" },
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_claim_cursor",
      deliveryId: "delivery_cursor_b",
      connectionId: "connection_cursor",
      queryId: 2,
      payloadJson: { resultJson: "b" },
      createdAt: new Date("2026-06-20T00:00:01.000Z"),
    });

    const first = await persistence.claimLiveQueryDeliveries({
      deploymentId: "deployment_claim_cursor",
      limit: 1,
      claimedAt: new Date("2026-06-20T00:01:00.000Z"),
      claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
      claimOwner: "delivery:cursor",
    });
    expect(first).toEqual({
      deliveries: [
        expect.objectContaining({
          deliveryId: "delivery_cursor_a",
          claimedAt: new Date("2026-06-20T00:01:00.000Z"),
          claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
          claimOwner: "delivery:cursor",
        }),
      ],
      nextCursor: {
        createdAt: new Date("2026-06-20T00:00:00.000Z"),
        deliveryId: "delivery_cursor_a",
      },
      hasMore: true,
    });
    if (!first.hasMore) {
      throw new Error("Expected first delivery claim page to have more rows.");
    }

    await expect(
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_claim_cursor",
        cursor: first.nextCursor,
        limit: 10,
        claimedAt: new Date("2026-06-20T00:01:10.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:02:10.000Z"),
        claimOwner: "delivery:cursor",
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId: "delivery_cursor_b",
          claimedAt: new Date("2026-06-20T00:01:10.000Z"),
          claimExpiresAt: new Date("2026-06-20T00:02:10.000Z"),
          claimOwner: "delivery:cursor",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("does not return the same live query delivery to concurrent claimers", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_concurrent_claim",
      deliveryId: "delivery_concurrent",
      connectionId: "connection_concurrent",
      queryId: 1,
      payloadJson: { resultJson: "fresh" },
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    });

    const [first, second] = await Promise.all([
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_concurrent_claim",
        limit: 10,
        claimedAt: new Date("2026-06-20T00:01:00.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
        claimOwner: "delivery:first",
      }),
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_concurrent_claim",
        limit: 10,
        claimedAt: new Date("2026-06-20T00:01:00.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:02:00.000Z"),
        claimOwner: "delivery:second",
      }),
    ]);

    const claimed = [...first.deliveries, ...second.deliveries];
    expect(claimed).toHaveLength(1);
    const winner = claimed[0]!;
    expect(winner.claimOwner).not.toBeNull();
    const loserOwner =
      winner.claimOwner === "delivery:first" ? "delivery:second" : "delivery:first";

    await expect(
      persistence.markLiveQueryDeliveriesDelivered({
        deploymentId: "deployment_concurrent_claim",
        deliveryIds: ["delivery_concurrent"],
        deliveredAt: new Date("2026-06-20T00:01:10.000Z"),
        claimOwner: loserOwner,
      }),
    ).resolves.toEqual({ delivered: 0 });

    await expect(
      persistence.claimLiveQueryDeliveries({
        deploymentId: "deployment_concurrent_claim",
        limit: 10,
        claimedAt: new Date("2026-06-20T00:01:11.000Z"),
        claimExpiresAt: new Date("2026-06-20T00:02:11.000Z"),
        claimOwner: "delivery:third",
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });

    await expect(
      persistence.markLiveQueryDeliveriesDelivered({
        deploymentId: "deployment_concurrent_claim",
        deliveryIds: ["delivery_concurrent"],
        deliveredAt: new Date("2026-06-20T00:01:20.000Z"),
        claimOwner: winner.claimOwner!,
      }),
    ).resolves.toEqual({ delivered: 1 });
  });

  it("lists deployments with pending live query deliveries", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_pending_b",
      deliveryId: "delivery_b1",
      connectionId: "connection_b",
      queryId: 1,
      payloadJson: { resultJson: "b1" },
      createdAt: new Date("2026-06-20T00:00:20.000Z"),
    });
    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_pending_a",
      deliveryId: "delivery_a1",
      connectionId: "connection_a",
      queryId: 1,
      payloadJson: { resultJson: "a1" },
      createdAt: new Date("2026-06-20T00:00:10.000Z"),
    });
    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_pending_a",
      deliveryId: "delivery_a2",
      connectionId: "connection_a",
      queryId: 1,
      payloadJson: { resultJson: "a2" },
      createdAt: new Date("2026-06-20T00:00:30.000Z"),
    });
    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_delivered",
      deliveryId: "delivery_delivered",
      connectionId: "connection_delivered",
      queryId: 1,
      payloadJson: { resultJson: "delivered" },
      createdAt: new Date("2026-06-20T00:00:05.000Z"),
    });
    await persistence.markLiveQueryDeliveriesDelivered({
      deploymentId: "deployment_delivered",
      deliveryIds: ["delivery_delivered"],
      deliveredAt: new Date("2026-06-20T00:01:00.000Z"),
    });

    const first = await persistence.listPendingLiveQueryDeliveryDeployments({
      limit: 1,
    });
    expect(first).toEqual({
      deployments: [
        {
          deploymentId: "deployment_pending_a",
          oldestCreatedAt: new Date("2026-06-20T00:00:10.000Z"),
          pending: 2,
        },
      ],
      nextCursor: {
        oldestCreatedAt: new Date("2026-06-20T00:00:10.000Z"),
        deploymentId: "deployment_pending_a",
      },
      hasMore: true,
    });

    await expect(
      persistence.listPendingLiveQueryDeliveryDeployments({
        cursor: first.nextCursor!,
        limit: 10,
      }),
    ).resolves.toEqual({
      deployments: [
        {
          deploymentId: "deployment_pending_b",
          oldestCreatedAt: new Date("2026-06-20T00:00:20.000Z"),
          pending: 1,
        },
      ],
      nextCursor: null,
      hasMore: false,
    });
  });

  it("records live query delivery failures without acking the row", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_delivery_failure",
      deliveryId: "delivery_failed",
      connectionId: "connection_failed",
      queryId: 1,
      payloadJson: { resultJson: "fresh" },
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    });

    await expect(
      persistence.recordLiveQueryDeliveryFailure({
        deploymentId: "deployment_delivery_failure",
        deliveryIds: ["delivery_failed"],
        stage: "fanout",
        error: "ConnectionDO failed",
        failedAt: new Date("2026-06-20T00:01:00.000Z"),
      }),
    ).resolves.toEqual({ failed: 1 });

    await expect(
      persistence.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_delivery_failure",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deliveryId: "delivery_failed",
          deliveredAt: null,
          attemptCount: 1,
          lastAttemptedAt: new Date("2026-06-20T00:01:00.000Z"),
          lastErrorStage: "fanout",
          lastError: "ConnectionDO failed",
          deadLetteredAt: null,
        },
      ],
      hasMore: false,
    });
  });

  it("lists stuck live query delivery candidates", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_stuck_a",
      deliveryId: "delivery_a",
      connectionId: "connection_a",
      queryId: 1,
      payloadJson: { resultJson: "a" },
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_stuck_b",
      deliveryId: "delivery_b",
      connectionId: "connection_b",
      queryId: 1,
      payloadJson: { resultJson: "b" },
      createdAt: new Date("2026-06-20T00:00:01.000Z"),
    });
    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_fresh_failure",
      deliveryId: "delivery_fresh",
      connectionId: "connection_fresh",
      queryId: 1,
      payloadJson: { resultJson: "fresh" },
      createdAt: new Date("2026-06-20T00:00:02.000Z"),
    });
    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_active_lease",
      deliveryId: "delivery_active_lease",
      connectionId: "connection_active_lease",
      queryId: 1,
      payloadJson: { resultJson: "active" },
      createdAt: new Date("2026-06-20T00:00:03.000Z"),
    });
    await persistence.recordLiveQueryDeliveryFailure({
      deploymentId: "deployment_stuck_b",
      deliveryIds: ["delivery_b"],
      stage: "fanout",
      error: "old b",
      failedAt: new Date("2026-06-20T00:01:00.000Z"),
    });
    await persistence.recordLiveQueryDeliveryFailure({
      deploymentId: "deployment_stuck_a",
      deliveryIds: ["delivery_a"],
      stage: "ack",
      error: "old a",
      failedAt: new Date("2026-06-20T00:01:00.000Z"),
    });
    await persistence.recordLiveQueryDeliveryFailure({
      deploymentId: "deployment_fresh_failure",
      deliveryIds: ["delivery_fresh"],
      stage: "fanout",
      error: "fresh",
      failedAt: new Date("2026-06-20T00:10:00.000Z"),
    });
    await persistence.recordLiveQueryDeliveryFailure({
      deploymentId: "deployment_active_lease",
      deliveryIds: ["delivery_active_lease"],
      stage: "fanout",
      error: "old but actively leased",
      failedAt: new Date("2026-06-20T00:01:00.000Z"),
    });
    await persistence.claimLiveQueryDeliveries({
      deploymentId: "deployment_active_lease",
      limit: 10,
      claimedAt: new Date("2026-06-20T00:04:30.000Z"),
      claimExpiresAt: new Date("2026-06-20T00:06:00.000Z"),
      claimOwner: "delivery:active",
    });

    const first = await persistence.listStuckLiveQueryDeliveries({
      olderThan: new Date("2026-06-20T00:05:00.000Z"),
      limit: 1,
    });
    expect(first).toMatchObject({
      deliveries: [
        {
          deploymentId: "deployment_stuck_a",
          deliveryId: "delivery_a",
          attemptCount: 1,
          lastErrorStage: "ack",
        },
      ],
      hasMore: true,
      nextCursor: {
        lastAttemptedAt: new Date("2026-06-20T00:01:00.000Z"),
        deploymentId: "deployment_stuck_a",
        deliveryId: "delivery_a",
      },
    });

    await expect(
      persistence.listStuckLiveQueryDeliveries({
        olderThan: new Date("2026-06-20T00:05:00.000Z"),
        cursor: first.nextCursor!,
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deploymentId: "deployment_stuck_b",
          deliveryId: "delivery_b",
          attemptCount: 1,
          lastErrorStage: "fanout",
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    await expect(
      persistence.listStuckLiveQueryDeliveries({
        olderThan: new Date("2026-06-20T00:06:00.000Z"),
        deploymentId: "deployment_active_lease",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [
        {
          deploymentId: "deployment_active_lease",
          deliveryId: "delivery_active_lease",
        },
      ],
      hasMore: false,
    });
  });

  it("marks live query deliveries dead-lettered", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertLiveQueryDelivery({
      deploymentId: "deployment_dead_letter",
      deliveryId: "delivery_dead",
      connectionId: "connection_dead",
      queryId: 1,
      payloadJson: { resultJson: "dead" },
      createdAt: new Date("2026-06-20T00:00:00.000Z"),
    });
    await persistence.recordLiveQueryDeliveryFailure({
      deploymentId: "deployment_dead_letter",
      deliveryIds: ["delivery_dead"],
      stage: "fanout",
      error: "stuck",
      failedAt: new Date("2026-06-20T00:01:00.000Z"),
    });

    await expect(
      persistence.markLiveQueryDeliveriesDeadLettered({
        deploymentId: "deployment_dead_letter",
        deliveryIds: ["delivery_dead"],
        reason: "connection permanently stale",
        deadLetteredAt: new Date("2026-06-20T00:05:00.000Z"),
      }),
    ).resolves.toMatchObject({
      deadLettered: 1,
      deliveries: [
        {
          deliveryId: "delivery_dead",
          deadLetteredAt: new Date("2026-06-20T00:05:00.000Z"),
          deadLetterReason: "connection permanently stale",
        },
      ],
    });

    await expect(
      persistence.listUndeliveredLiveQueryDeliveries({
        deploymentId: "deployment_dead_letter",
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });
    await expect(
      persistence.listStuckLiveQueryDeliveries({
        deploymentId: "deployment_dead_letter",
        olderThan: new Date("2026-06-20T00:10:00.000Z"),
        limit: 10,
      }),
    ).resolves.toMatchObject({
      deliveries: [],
      hasMore: false,
    });
  });

  it("commits staged invoke session deletes after read validation", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_delete_commit",
      id: "1:message",
      ts: 10,
      value: { text: "old" },
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_delete_commit",
      sessionId: "session_delete",
      projectId: "project_delete",
      packageId: "package_delete",
      functionPath: "messages:delete",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_delete_commit",
      sessionId: "session_delete",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_delete_commit",
      sessionId: "session_delete",
      tableId: 1,
      documentId: "1:message",
      op: "delete",
      valueJson: null,
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_delete_commit",
        sessionId: "session_delete",
        source: "invoke:messages:delete",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).resolves.toEqual({
      committedTs: 16,
      writes: [
        {
          tableId: 1,
          id: "1:message",
          prevTs: 10,
          ts: 16,
          value: null,
        },
      ],
    });
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_delete_commit",
        "1:message",
        16,
      ),
    ).resolves.toMatchObject({
      id: "1:message",
      ts: 16,
      prevTs: 10,
      deleted: true,
      value: null,
    });
  });

  it("rolls back staged delete commits when the target is missing", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_delete_missing",
      sessionId: "session_delete",
      projectId: "project_delete",
      packageId: "package_delete",
      functionPath: "messages:delete",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_delete_missing",
      sessionId: "session_delete",
      tableId: 1,
      documentId: "1:message",
      op: "delete",
      valueJson: null,
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_delete_missing",
        sessionId: "session_delete",
        source: "invoke:messages:delete",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).rejects.toThrow(InvokeSessionDeleteTargetError);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_delete_missing",
        "session_delete",
      ),
    ).resolves.toMatchObject({
      state: "active",
      finishedAt: null,
    });
    await expect(
      persistence.query<{ count: number }>(
        "select count(*)::int as count from commits where deployment_id = $1",
        ["deployment_delete_missing"],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("rejects staged delete commits when the target changed", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_delete_occ",
      id: "1:message",
      ts: 10,
      value: { text: "old" },
    });
    await persistence.insertDocumentRevision({
      deploymentId: "deployment_delete_occ",
      id: "1:message",
      ts: 20,
      value: { text: "new" },
      prevTs: 10,
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_delete_occ",
      sessionId: "session_delete",
      projectId: "project_delete",
      packageId: "package_delete",
      functionPath: "messages:delete",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_delete_occ",
      sessionId: "session_delete",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_delete_occ",
      sessionId: "session_delete",
      tableId: 1,
      documentId: "1:message",
      op: "delete",
      valueJson: null,
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_delete_occ",
        sessionId: "session_delete",
        source: "invoke:messages:delete",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).rejects.toThrow(InvokeSessionOccConflictError);
    await expect(
      persistence.getDocumentRevisionAtTs(
        "deployment_delete_occ",
        "1:message",
        21,
      ),
    ).resolves.toMatchObject({
      ts: 20,
      deleted: false,
      value: { text: "new" },
    });
  });

  it("rolls back staged invoke insert commits on document id conflict", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_commit_conflict",
      id: "1:message",
      ts: 50,
      value: { text: "existing" },
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_commit_conflict",
      sessionId: "session_commit",
      projectId: "project_commit",
      packageId: "package_commit",
      functionPath: "messages:send",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 100,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_commit_conflict",
      sessionId: "session_commit",
      tableId: 1,
      documentId: "1:message",
      op: "insert",
      valueJson: { text: "new" },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_commit_conflict",
        sessionId: "session_commit",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 100,
      }),
    ).rejects.toThrow(InvokeSessionInsertConflictError);
    await expect(
      persistence.getInvokeSessionMetadata(
        "deployment_commit_conflict",
        "session_commit",
      ),
    ).resolves.toMatchObject({
      state: "active",
      finishedAt: null,
    });
    await expect(
      persistence.query<{ count: number }>(
        "select count(*)::int as count from commits where deployment_id = $1",
        ["deployment_commit_conflict"],
      ),
    ).resolves.toMatchObject({ rows: [{ count: 0 }] });
  });

  it("rejects mutation commits when a read document changed", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_occ",
      id: "1:message",
      ts: 10,
      value: { text: "old" },
    });
    await persistence.insertDocumentRevision({
      deploymentId: "deployment_occ",
      id: "1:message",
      ts: 20,
      value: { text: "new" },
      prevTs: 10,
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_occ",
      sessionId: "session_occ",
      projectId: "project_occ",
      packageId: "package_occ",
      functionPath: "messages:send",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_occ",
      sessionId: "session_occ",
      tableId: 1,
      documentId: "1:message",
      observedTs: 10,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_occ",
      sessionId: "session_occ",
      tableId: 1,
      documentId: "1:other",
      op: "insert",
      valueJson: { text: "other" },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_occ",
        sessionId: "session_occ",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).rejects.toThrow(InvokeSessionOccConflictError);
    await expect(
      persistence.getInvokeSessionMetadata("deployment_occ", "session_occ"),
    ).resolves.toMatchObject({
      state: "active",
      finishedAt: null,
    });
    await expect(
      persistence.getDocumentRevisionAtTs("deployment_occ", "1:other", 100),
    ).resolves.toBeNull();
  });

  it("rejects mutation commits when a missing read document appears", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_occ_missing",
      id: "1:message",
      ts: 20,
      value: { text: "new" },
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_occ_missing",
      sessionId: "session_occ",
      projectId: "project_occ",
      packageId: "package_occ",
      functionPath: "messages:send",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.insertInvokeSessionDocumentRead({
      deploymentId: "deployment_occ_missing",
      sessionId: "session_occ",
      tableId: 1,
      documentId: "1:message",
      observedTs: null,
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_occ_missing",
        sessionId: "session_occ",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).rejects.toThrow(InvokeSessionOccConflictError);
  });

  it("rejects mutation commits when a table read changed", async () => {
    const persistence = await createMigratedPGlitePersistence();

    await persistence.insertDocumentRevision({
      deploymentId: "deployment_table_occ",
      id: "1:message",
      ts: 20,
      value: { text: "new" },
    });
    await persistence.insertInvokeSessionMetadata({
      deploymentId: "deployment_table_occ",
      sessionId: "session_occ",
      projectId: "project_occ",
      packageId: "package_occ",
      functionPath: "messages:send",
      functionKind: "mutation",
      partitionKey: "team:1",
      scopeJson: { kind: "partition", partitionKey: "team:1" },
      argsJson: { teamId: "team:1" },
      beginTs: 15,
      schemaVersion: 1,
      executionModule: "_flarex/execution.js",
    });
    await persistence.insertInvokeSessionTableRead({
      deploymentId: "deployment_table_occ",
      sessionId: "session_occ",
      tableId: 1,
      observedTs: 15,
    });
    await persistence.stageInvokeSessionDocumentWrite({
      deploymentId: "deployment_table_occ",
      sessionId: "session_occ",
      tableId: 2,
      documentId: "2:other",
      op: "insert",
      valueJson: { text: "other" },
    });

    await expect(
      persistence.commitInvokeSessionWrites({
        deploymentId: "deployment_table_occ",
        sessionId: "session_occ",
        source: "invoke:messages:send",
        finishedAt: new Date("2026-06-20T00:00:00.000Z"),
        minimumTs: 15,
      }),
    ).rejects.toThrow(InvokeSessionTableOccConflictError);
    await expect(
      persistence.getDocumentRevisionAtTs("deployment_table_occ", "2:other", 30),
    ).resolves.toBeNull();
  });
});

type TestPersistence = Awaited<ReturnType<typeof createMigratedPGlitePersistence>>;

async function insertValidatedPackageAndSession(
  persistence: TestPersistence,
  input: {
    deploymentId: string;
    sessionId: string;
    beginTs?: number;
  },
): Promise<void> {
  await persistence.insertDeploymentPackageMetadata({
    deploymentId: input.deploymentId,
    packageId: "package_validated",
    sourcePackageHash: "a".repeat(64),
    executionModule: "_flarex/execution.js",
    sourcePackageJson: {
      modules: [],
      functions: [],
      execution: "_flarex/execution.js",
    },
    analysisJson: {
      schema: {
        version: 1,
        tables: [
          {
            tableId: 1,
            name: "messages",
            placement: { kind: "partitionBy", field: "_id" },
            validator: {
              type: "object",
              value: {
                text: {
                  fieldType: { type: "string" },
                  optional: false,
                },
                count: {
                  fieldType: { type: "number" },
                  optional: false,
                },
              },
            },
          },
        ],
        indexes: [],
      },
    },
  });
  await persistence.insertInvokeSessionMetadata({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    projectId: "project_validate",
    packageId: "package_validated",
    functionPath: "messages:send",
    functionKind: "mutation",
    partitionKey: "team:1",
    scopeJson: { kind: "partition", partitionKey: "team:1" },
    argsJson: { teamId: "team:1" },
    beginTs: input.beginTs ?? 100,
    schemaVersion: 1,
    executionModule: "_flarex/execution.js",
  });
}
async function insertIndexedPackageAndSession(
  persistence: TestPersistence,
  input: {
    deploymentId: string;
    sessionId: string;
    beginTs?: number;
  },
): Promise<void> {
  await persistence.insertDeploymentPackageMetadata({
    deploymentId: input.deploymentId,
    packageId: `package_indexed_${input.sessionId}`,
    sourcePackageHash: "c".repeat(64),
    executionModule: "_flarex/execution.js",
    sourcePackageJson: {
      modules: [],
      functions: [],
      execution: "_flarex/execution.js",
    },
    analysisJson: {
      schema: {
        version: 1,
        tables: [
          {
            tableId: 1,
            name: "messages",
            placement: { kind: "partitionBy", field: "_id" },
          },
        ],
        indexes: [
          {
            indexId: 1,
            tableId: 1,
            name: "by_text",
            fields: ["text"],
            state: "enabled",
          },
          {
            indexId: 2,
            tableId: 1,
            name: "by_count_staged",
            fields: ["count"],
            state: "staged",
          },
        ],
      },
    },
  });
  await persistence.insertInvokeSessionMetadata({
    deploymentId: input.deploymentId,
    sessionId: input.sessionId,
    projectId: "project_indexed",
    packageId: `package_indexed_${input.sessionId}`,
    functionPath: "messages:send",
    functionKind: "mutation",
    partitionKey: "team:1",
    scopeJson: { kind: "partition", partitionKey: "team:1" },
    argsJson: { teamId: "team:1" },
    beginTs: input.beginTs ?? 100,
    schemaVersion: 1,
    executionModule: "_flarex/execution.js",
  });
}
