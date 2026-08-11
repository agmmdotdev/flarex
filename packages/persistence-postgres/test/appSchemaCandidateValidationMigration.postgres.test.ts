import { describe, expect, it } from "vitest";

import { createPostgresPersistence } from "../src/postgres";
import {
  injectAppSchemaCandidateValidationMigrationFailure,
  makeAppSchemaCandidateValidationMigrationFixture,
  restoreAppSchemaCandidateValidationMigration,
  writeAppSchemaCandidateValidationJournalThrough,
} from "./appSchemaCandidateValidationMigrationSupport";
import { postgresUrl, withTemporaryPostgresSchema } from "./postgresHelpers";

const describePostgres = postgresUrl === null ? describe.skip : describe;

describePostgres("M03-A candidate-validation migration - PostgreSQL", () => {
  it("upgrades atomically in a non-public schema, rolls back, and replays", async () => {
    const fixture = await makeAppSchemaCandidateValidationMigrationFixture(
      "postgres",
    );
    try {
      await writeAppSchemaCandidateValidationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        56,
      );
      await withTemporaryPostgresSchema(async databaseOptions => {
        const persistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await persistence.migrate();
          await seedHistory(persistence, false, "000000000011");
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ tables: 0, indexes: 0, receipts: 57, revisions: 2 });

          await writeAppSchemaCandidateValidationJournalThrough(
            fixture.currentJournal,
            fixture.temporaryJournal,
            57,
          );
          await injectAppSchemaCandidateValidationMigrationFailure(
            fixture.migrationPath,
          );
          await expect(persistence.migrate()).rejects.toThrow();
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ tables: 0, indexes: 0, receipts: 57, revisions: 2 });

          await restoreAppSchemaCandidateValidationMigration(
            fixture.migrationPath,
            fixture.currentMigrationsFolder,
          );
          await expect(persistence.migrate()).resolves.toBeUndefined();
          await expect(persistence.migrate()).resolves.toBeUndefined();
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ tables: 1, indexes: 1, receipts: 58, revisions: 2 });
          const schema = await persistence.query<{ name: string }>(
            "select current_schema() as name",
          );
          expect(schema.rows[0]?.name).not.toBe("public");
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  }, 480_000);

  it("refuses duplicate first revisions and rolls the migration back", async () => {
    const fixture = await makeAppSchemaCandidateValidationMigrationFixture(
      "postgres-duplicate-root",
    );
    try {
      await writeAppSchemaCandidateValidationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        56,
      );
      await withTemporaryPostgresSchema(async databaseOptions => {
        const persistence = await createPostgresPersistence({
          ...databaseOptions,
          migrationsFolder: fixture.migrationsFolder,
        });
        try {
          await persistence.migrate();
          await seedHistory(persistence, true, "000000000012");
          await writeAppSchemaCandidateValidationJournalThrough(
            fixture.currentJournal,
            fixture.temporaryJournal,
            57,
          );
          await expect(persistence.migrate()).rejects.toThrow();
          expect(await inventory(persistence, databaseOptions.migrationsSchema))
            .toEqual({ tables: 0, indexes: 0, receipts: 57, revisions: 2 });
        } finally {
          await persistence.close();
        }
      });
    } finally {
      await fixture.cleanup();
    }
  }, 480_000);
});

async function inventory(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  migrationsSchema: string,
) {
  const quotedSchema = `"${migrationsSchema.replaceAll('"', '""')}"`;
  const result = await persistence.query<{
    tables: number;
    indexes: number;
    receipts: number;
    revisions: number;
  }>(`
    select
      (select count(*)::int
         from information_schema.tables
        where table_schema = current_schema()
          and table_name = 'fx_system_app_schema_candidate_validation') as tables,
      (select count(*)::int
         from pg_indexes
        where schemaname = current_schema()
          and indexname = 'fx_app_row_rev_first_identity_unique') as indexes,
      (select count(*)::int from fx_app_row_rev) as revisions,
      (select count(*)::int from ${quotedSchema}.__drizzle_migrations) as receipts
  `);
  return result.rows[0];
}

async function seedHistory(
  persistence: Awaited<ReturnType<typeof createPostgresPersistence>>,
  duplicateRoot: boolean,
  scopeSuffix: string,
) {
  const scopeId = `scope_87000000-0000-4000-8000-${scopeSuffix}`;
  const epoch = `epoch_88000000-0000-4000-8000-${scopeSuffix}`;
  await persistence.query(
    `insert into fx_system_scope_clock
      (scope_id, storage_generation, storage_generation_fence,
       last_commit_seq, last_outbox_seq, epoch)
     values ($1, 'flarexdb_v1', 1, 2, 0, $2)`,
    [scopeId, epoch],
  );
  await persistence.query(
    `insert into fx_app_row_rev
      (scope_uuid, table_id, row_id, commit_seq, prev_commit_seq,
       write_epoch_uuid, schema_version_id, creation_time,
       value_codec_version, is_tombstone, value_json, value_bytes,
       value_sha256)
     select scope_uuid, 1, decode('00000000000000000000000000000001', 'hex'),
       commit_seq, prev_commit_seq, epoch_uuid, 'schema_migration_fixture',
       1750000000000, 1, true, null, null, null
     from fx_system_scope_clock
     cross join (values (1::bigint, null::bigint), (2::bigint, $2::bigint))
       as revision(commit_seq, prev_commit_seq)
     where scope_id = $1`,
    [scopeId, duplicateRoot ? null : 1],
  );
}
