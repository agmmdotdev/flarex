import { newTestPGlite } from "../../support/pgliteSearchExtensions";
import { expect, it } from "vitest";
import type { FlarexPersistence } from "../../../src";
import { createPGlitePersistence } from "../../../src/database/pglite";
import { createPostgresPersistence } from "../../../src/database/postgres";
import { injectMigrationFailure, makeDrizzleCopyFixture, restoreMigrationFile, writeJournalThrough, type DrizzleCopyFixture } from "../../support/migrationFixtureSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "../../support/postgresHelpers";
import {
  insertLegacySessionTestScope,
} from "../../execution/session/support/sessionStorage";

async function verify(persistence: Pick<FlarexPersistence, "query" | "migrate">, fixture: DrizzleCopyFixture,journalSchema = "drizzle") {
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 103);
  await persistence.migrate();
  await insertLegacySessionTestScope(persistence);
  // Historical 0103 shape deliberately excludes the new columns.
  await persistence.query(`insert into fx_system_unique_constraint_build
    (scope_id,unique_constraint_definition_id,storage_generation,storage_generation_fence,epoch,start_commit_seq,lifecycle,covered_through_commit_seq,attempt_fence)
    select scope_id,1,storage_generation,storage_generation_fence,epoch,0,'enabled',0,1 from fx_system_scope_clock`);
  const before = (await persistence.query("select to_jsonb(b)::text build from fx_system_unique_constraint_build b")).rows;
  const journalTable = `"${journalSchema.replaceAll('"','""')}".__drizzle_migrations`;
  const receipt = (await persistence.query(`select hash,created_at::text from ${journalTable} order by created_at`)).rows;
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 136);
  await injectMigrationFailure(fixture.migrationPath, "unique_maintenance_deliberate_missing_table");
  await expect(persistence.migrate()).rejects.toMatchObject({
    _tag: "InstallationLifecycleError",reason: "resourceFailure",
    cause: { message: expect.stringContaining("unique_maintenance_deliberate_missing_table"),
      cause: { code: "42P01",message: expect.stringContaining("unique_maintenance_deliberate_missing_table") } },
  });
  expect((await persistence.query("select to_jsonb(b)::text build from fx_system_unique_constraint_build b")).rows).toEqual(before);
  expect((await persistence.query(`select hash,created_at::text from ${journalTable} order by created_at`)).rows).toEqual(receipt);
  expect((await persistence.query("select column_name from information_schema.columns where table_schema=current_schema() and table_name='fx_system_unique_constraint_build' and column_name like 'maintenance_%'")).rows).toEqual([]);
  await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 141);
  await persistence.migrate();
  await persistence.migrate();
  expect((await persistence.query("select (to_jsonb(b)-'maintenance_activation_sequence')::text build from fx_system_unique_constraint_build b")).rows).toEqual(before);
  expect((await persistence.query("select maintenance_activation_sequence from fx_system_unique_constraint_build")).rows)
    .toEqual([{ maintenance_activation_sequence: null }]);
  expect((await persistence.query("select column_name from information_schema.columns where table_schema=current_schema() and table_name='fx_system_unique_constraint_build' and column_name in ('maintenance_bytes','maintenance_sha256')")).rows).toEqual([]);
  expect((await persistence.query("select count(*)::integer as count from fx_system_unique_maintenance_obligation")).rows).toEqual([{ count: 0 }]);
  expect((await persistence.query(`select created_at::text as "createdAt" from ${journalTable} order by created_at desc limit 1`)).rows)
    .toEqual([{ createdAt: "1791590400000" }]);
  await expect(persistence.query("update fx_system_unique_constraint_build set maintenance_activation_sequence=1")).rejects.toBeDefined();
}

async function verifyUnsupportedPopulatedSource(persistence: Pick<FlarexPersistence, "query" | "migrate">, fixture: DrizzleCopyFixture,
  journalSchema = "drizzle") {
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 104);
  await persistence.migrate();
  await insertLegacySessionTestScope(persistence);
  // Historical durable bytes deliberately have a valid digest but no genuine
  // canonical activation/control provenance. Cutover must preserve them.
  await persistence.query(`insert into fx_system_unique_constraint_build
    (scope_id,unique_constraint_definition_id,storage_generation,storage_generation_fence,epoch,start_commit_seq,lifecycle,
      covered_through_commit_seq,attempt_fence,maintenance_activation_sequence,maintenance_bytes,maintenance_sha256)
    select scope_id,1,storage_generation,storage_generation_fence,epoch,0,'enabled',0,1,1,
      convert_to('{}','UTF8'),sha256(convert_to('{}','UTF8')) from fx_system_scope_clock`);
  const before = (await persistence.query("select to_jsonb(b)::text build from fx_system_unique_constraint_build b")).rows;
  const journalTable = `"${journalSchema.replaceAll('"','""')}".__drizzle_migrations`;
  const receipt = (await persistence.query(`select hash,created_at::text from ${journalTable} order by created_at`)).rows;
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 141);
  for (let retry = 0; retry < 2; retry += 1) {
    await expect(persistence.migrate()).rejects.toMatchObject({
      _tag: "InstallationLifecycleError",reason: "resourceFailure",
      cause: { cause: { code: "55000",message: "Typed maintenance conversion is incomplete" } },
    });
    expect((await persistence.query("select to_jsonb(b)::text build from fx_system_unique_constraint_build b")).rows).toEqual(before);
    expect((await persistence.query(`select hash,created_at::text from ${journalTable} order by created_at`)).rows).toEqual(receipt);
    expect((await persistence.query("select column_name from information_schema.columns where table_schema=current_schema() and table_name='fx_system_unique_constraint_build' and column_name in ('maintenance_bytes','maintenance_sha256') order by column_name")).rows)
      .toEqual([{ column_name: "maintenance_bytes" }, { column_name: "maintenance_sha256" }]);
  }
}

it("preserves unmaintained unique builds through typed cutover rollback and replay (PGlite)", async () => {
  const fixture = await makeDrizzleCopyFixture("flarex-unique-maintenance", "pglite", "0136_typed_maintenance_obligations.sql");
  const db = newTestPGlite();
  try { await verify(await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder }), fixture); }
  finally { await db.close(); await fixture.cleanup(); }
}, 30_000);

it("retains unsupported populated legacy evidence across refused cutover retries (PGlite)", async () => {
  const fixture = await makeDrizzleCopyFixture("flarex-unique-maintenance-refusal", "pglite", "0136_typed_maintenance_obligations.sql");
  const db = newTestPGlite();
  try { await verifyUnsupportedPopulatedSource(await createPGlitePersistence({ db, migrationsFolder: fixture.migrationsFolder }), fixture); }
  finally { await db.close(); await fixture.cleanup(); }
}, 30_000);

it.skipIf(postgresUrl === null)("retains unsupported populated legacy evidence across refused cutover retries (PostgreSQL)", async () => {
  const fixture = await makeDrizzleCopyFixture("flarex-unique-maintenance-refusal", "postgres", "0136_typed_maintenance_obligations.sql");
  try {
    await withTemporaryPostgresSchema(async options => {
      const persistence = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
      try {
        expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
        await verifyUnsupportedPopulatedSource(persistence, fixture,options.migrationsSchema);
      } finally { await persistence.close(); }
    });
  } finally { await fixture.cleanup(); }
}, 30_000);

it.skipIf(postgresUrl === null)("preserves unmaintained unique builds through typed cutover rollback and replay (PostgreSQL)", async () => {
  const fixture = await makeDrizzleCopyFixture("flarex-unique-maintenance", "postgres", "0136_typed_maintenance_obligations.sql");
  try {
    await withTemporaryPostgresSchema(async options => {
      const persistence = await createPostgresPersistence({ ...options, migrationsFolder: fixture.migrationsFolder });
      try {
        expect((await persistence.query<{ superuser: boolean }>("select rolsuper as superuser from pg_roles where rolname=current_user")).rows[0]?.superuser).toBe(false);
        await verify(persistence, fixture,options.migrationsSchema);
      } finally { await persistence.close(); }
    });
  } finally { await fixture.cleanup(); }
}, 30_000);
