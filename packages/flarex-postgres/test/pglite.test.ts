import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";

describe("createPGlitePersistence", () => {
  it("checks connectivity", async () => {
    const persistence = await createPGlitePersistence();

    await expect(persistence.check()).resolves.toEqual({ status: "ok" });
  });

  it("runs Convex-style generic persistence migrations once", async () => {
    const persistence = await createPGlitePersistence();

    await expect(persistence.migrate()).resolves.toMatchObject({
      applied: [{ version: 1, name: "convex_style_multitenant_persistence" }],
    });
    await expect(persistence.migrate()).resolves.toEqual({ applied: [] });

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
      "flarex_schema_migrations",
      "indexes",
      "leases",
      "outbox",
      "persistence_globals",
      "read_only",
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
});
