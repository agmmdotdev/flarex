import { describe, expect, it } from "vitest";

import {
  DeploymentMetadataAlreadyExistsError,
  DeploymentPackageMetadataAlreadyExistsError,
  InvokeSessionMetadataAlreadyExistsError,
  FlarexDocumentIdFormatError,
  sql,
} from "../src";
import { deployments } from "../src/schema";
import { createPGlitePersistence } from "../src/pglite";

describe("createPGlitePersistence", () => {
  it("checks connectivity", async () => {
    const persistence = await createPGlitePersistence();

    await expect(persistence.check()).resolves.toEqual({ status: "ok" });
  });

  it("runs Drizzle Kit migrations idempotently", async () => {
    const persistence = await createPGlitePersistence();

    await expect(persistence.migrate()).resolves.toBeUndefined();
    await expect(persistence.migrate()).resolves.toBeUndefined();

    const tables = await persistence.query<{ table_name: string }>(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
        order by table_name
      `,
    );

    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "commits",
      "deployment_packages",
      "deployments",
      "documents",
      "indexes",
      "invoke_sessions",
      "leases",
      "outbox",
      "persistence_globals",
      "read_only",
    ]);

    const migrationTables = await persistence.query<{
      table_schema: string;
      table_name: string;
    }>(
      `
        select table_schema, table_name
        from information_schema.tables
        where table_name = '__drizzle_migrations'
      `,
    );

    expect(migrationTables.rows).toEqual([
      {
        table_schema: "drizzle",
        table_name: "__drizzle_migrations",
      },
    ]);
  });

  it("rolls back failed transactions", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    await expect(
      persistence.getDeploymentMetadata("missing"),
    ).resolves.toBeNull();
  });

  it("updates deployment activation metadata", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    await expect(
      persistence.updateDeploymentMetadataActivation({
        deploymentId: "missing",
        activePackageId: "package_missing",
        activeSchemaVersion: 1,
      }),
    ).resolves.toBeNull();
  });

  it("rejects duplicate deployment metadata clearly", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    const created = await persistence.insertDeploymentPackageMetadata({
      deploymentId: "deployment_package",
      packageId: "package_a",
      sourcePackageHash: "a".repeat(64),
      executionModule: "_flarex/execution.js",
      sourcePackageJson: {
        modules: [],
        functions: [],
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
        modules: [],
        functions: [],
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
    });
  });

  it("returns null for missing deployment package metadata", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    await expect(
      persistence.getDeploymentPackageMetadata("deployment_package", "missing"),
    ).resolves.toBeNull();
  });

  it("rejects duplicate deployment package metadata clearly", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    });
  });

  it("returns null for missing invoke session metadata", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    await expect(
      persistence.getInvokeSessionMetadata("deployment_invoke", "missing"),
    ).resolves.toBeNull();
  });

  it("rejects duplicate invoke session metadata clearly", async () => {
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

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
    const persistence = await createPGlitePersistence();
    await persistence.migrate();

    await expect(
      persistence.insertDocumentRevision({
        deploymentId: "deployment_docs_bad_id",
        id: "bad",
        ts: 10,
        value: null,
      }),
    ).rejects.toThrow(FlarexDocumentIdFormatError);
  });
});
