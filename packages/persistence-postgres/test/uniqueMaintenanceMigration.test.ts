import { PGlite } from "@electric-sql/pglite";
import { expect, it } from "vitest";
import type { FlarexPersistence } from "../src";
import { createPGlitePersistence } from "../src/pglite";
import { createPostgresPersistence } from "../src/postgres";
import { injectMigrationFailure, makeDrizzleCopyFixture, restoreMigrationFile, writeJournalThrough, type DrizzleCopyFixture } from "./migrationFixtureSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";
import { insertSessionTestScope } from "./sessionAuthorityTestSupport";

async function verify(persistence: Pick<FlarexPersistence, "query" | "migrate">, fixture: DrizzleCopyFixture) {
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 103);
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  // Historical 0103 shape deliberately excludes the new columns.
  await persistence.query(`insert into fx_system_unique_constraint_build
    (scope_id,unique_constraint_definition_id,storage_generation,storage_generation_fence,epoch,start_commit_seq,lifecycle,covered_through_commit_seq,attempt_fence)
    select scope_id,1,storage_generation,storage_generation_fence,epoch,0,'enabled',0,1 from fx_system_scope_clock`);
  const before = (await persistence.query("select to_jsonb(b)::text build from fx_system_unique_constraint_build b")).rows;
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 104);
  await injectMigrationFailure(fixture.migrationPath, "unique_maintenance_deliberate_missing_table");
  await expect(persistence.migrate()).rejects.toThrow(/unique_maintenance_deliberate_missing_table/);
  expect((await persistence.query("select to_jsonb(b)::text build from fx_system_unique_constraint_build b")).rows).toEqual(before);
  expect((await persistence.query("select column_name from information_schema.columns where table_schema=current_schema() and table_name='fx_system_unique_constraint_build' and column_name like 'maintenance_%'")).rows).toEqual([]);
  await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
  await persistence.migrate();
  await persistence.migrate();
  expect((await persistence.query("select (to_jsonb(b)-'maintenance_activation_sequence'-'maintenance_bytes'-'maintenance_sha256')::text build from fx_system_unique_constraint_build b")).rows).toEqual(before);
  expect((await persistence.query("select maintenance_activation_sequence,maintenance_bytes,maintenance_sha256 from fx_system_unique_constraint_build")).rows)
    .toEqual([{ maintenance_activation_sequence: null, maintenance_bytes: null, maintenance_sha256: null }]);
  await expect(persistence.query("update fx_system_unique_constraint_build set maintenance_activation_sequence=1")).rejects.toBeDefined();
}

it("preserves existing unique builds without granting maintenance through migration rollback and replay (PGlite)", async () => {
  const fixture = await makeDrizzleCopyFixture("flarex-unique-maintenance", "pglite", "0104_unique_maintenance.sql");
  const db = new PGlite();
  try { await verify(await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder }), fixture); }
  finally { await db.close(); await fixture.cleanup(); }
}, 30_000);

it.skipIf(postgresUrl === null)("preserves existing unique builds without granting maintenance through migration rollback and replay (PostgreSQL)", async () => {
  const fixture = await makeDrizzleCopyFixture("flarex-unique-maintenance", "postgres", "0104_unique_maintenance.sql");
  try {
    await withTemporaryPostgresSchema(async options => {
      const persistence = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
      try {
        expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
        await verify(persistence, fixture);
      } finally { await persistence.close(); }
    });
  } finally { await fixture.cleanup(); }
}, 30_000);
