import { describe, it } from "vitest";
import { createPostgresPersistence } from "../../src/database/postgres";
import { bootstrapInstallationMigrations } from "../../src/database/postgresInstallationMaintenance";
import { Effect } from "effect";
import { postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";
import { assertMigration149InsertionOrder, withMigration149Folder } from "./migration149InsertionOrderScenario";

describe.skipIf(postgresUrl === null)("insertion-generation migration 0149 on ordinary-role PostgreSQL", () => {
  it("preserves populated history and extends the real row publisher without backfill", async () => {
    await withMigration149Folder((folder, enableCurrent) => withTemporaryPostgresSchema(async options => {
      const previous = await createPostgresPersistence({ ...options, migrationsFolder: folder });
      try {
        const [location] = (await previous.query<{ schema_name: string }>("select current_schema() schema_name")).rows;
        if (location === undefined) throw new Error("Missing predecessor namespace");
        // Exact predecessor bootstrap does not issue current serving capabilities.
        await Effect.runPromise(bootstrapInstallationMigrations(previous.pool.options, location.schema_name,
          { migrationsFolder: folder, migrationsSchema: options.migrationsSchema }));
        await previous.query("update fx_system_installation set state='active' where singleton_id=1");
        await enableCurrent();
        const current = await createPostgresPersistence({ ...options, migrationsFolder: folder });
        try { await assertMigration149InsertionOrder(previous, current); }
        finally { await current.close(); }
      } finally { await previous.close(); }
    }));
  }, 120_000);
});
