import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { createPostgresPersistence } from "../../src/database/postgres";
import { bootstrapInstallationMigrations } from "../../src/database/postgresInstallationMaintenance";
import { createProtectedFileScopedPostgresFixture, postgresUrl, withTemporaryPostgresSchema } from "../support/postgresHelpers";
import { assertMigration154CurrentReader, assertMigration154SnapshotIndexCuts, withMigration154Folder } from "./migration154SnapshotIndexCutsScenario";

describe.skipIf(postgresUrl === null || !process.env.FLAREX_POSTGRES_PROVISIONING_DATABASE_URL)(
  "snapshot-index tuple-cut migration 0154 on ordinary-role PostgreSQL", () => {
    it("upgrades real predecessor history and grants the replacement to a restricted runtime login", async () => {
      await withMigration154Folder((folder, enableCurrent) => withTemporaryPostgresSchema(async options => {
        const previous = await createPostgresPersistence({ ...options, migrationsFolder: folder });
        try {
          const [location] = (await previous.query<{ schema_name: string }>("select current_schema() schema_name")).rows;
          if (location === undefined) throw new Error("Missing predecessor namespace");
          await Effect.runPromise(bootstrapInstallationMigrations(previous.pool.options, location.schema_name,
            { migrationsFolder: folder, migrationsSchema: options.migrationsSchema }));
          await previous.query("update fx_system_installation set state='active' where singleton_id=1");
          await enableCurrent();
          const current = await createPostgresPersistence({ ...options, migrationsFolder: folder });
          try {
            const timing = await assertMigration154SnapshotIndexCuts(previous, current);
            const runtime = await createProtectedFileScopedPostgresFixture("managed", {
              persistence: current, schemaName: location.schema_name, migrationsSchema: options.migrationsSchema,
              installationTiming: { baseMigration: timing },
            });
            try {
              expect((await runtime.persistence.query(`select r.rolsuper,r.rolbypassrls,
                r.oid<>p.proowner nonowner from pg_roles r,pg_proc p
                where r.rolname=current_user and p.oid=to_regprocedure(
                  'fx_read_snapshot_index_page(uuid,integer,bigint,bytea,bytea,bytea,bytea,boolean,bytea,bytea,boolean,integer)')`)).rows)
                .toEqual([{ rolsuper: false, rolbypassrls: false, nonowner: true }]);
              await assertMigration154CurrentReader(runtime.persistence);
            } finally { await runtime.dispose(); }
          } finally { await current.close(); }
        } finally { await previous.close(); }
      }));
    }, 180_000);
  });
