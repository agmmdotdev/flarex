import { describe, expect, it } from "vitest";

import { DeploymentMetadataAlreadyExistsError, sql } from "../src";
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
      "deployments",
      "documents",
      "indexes",
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
});
