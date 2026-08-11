import { describe, expect, it } from "vitest";

import { createPGlitePersistence } from "../src/pglite";
import {
  injectAppSchemaCandidateValidationMigrationFailure,
  makeAppSchemaCandidateValidationMigrationFixture,
  restoreAppSchemaCandidateValidationMigration,
  writeAppSchemaCandidateValidationJournalThrough,
} from "./appSchemaCandidateValidationMigrationSupport";

describe("M03-A candidate-validation migration - PGlite", () => {
  it("upgrades atomically, rolls back a failed migration, and replays", async () => {
    const fixture = await makeAppSchemaCandidateValidationMigrationFixture(
      "pglite",
    );
    try {
      await writeAppSchemaCandidateValidationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        56,
      );
      const previous = await createPGlitePersistence({
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      await seedHistory(previous, false, "valid");
      expect(await inventory(previous)).toEqual({
        tables: 0, indexes: 0, receipts: 57, revisions: 2,
      });

      await writeAppSchemaCandidateValidationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        57,
      );
      await injectAppSchemaCandidateValidationMigrationFailure(
        fixture.migrationPath,
      );
      await expect(previous.migrate()).rejects.toThrow();
      expect(await inventory(previous)).toEqual({
        tables: 0, indexes: 0, receipts: 57, revisions: 2,
      });

      await restoreAppSchemaCandidateValidationMigration(
        fixture.migrationPath,
        fixture.currentMigrationsFolder,
      );
      await expect(previous.migrate()).resolves.toBeUndefined();
      await expect(previous.migrate()).resolves.toBeUndefined();
      expect(await inventory(previous)).toEqual({
        tables: 1, indexes: 1, receipts: 58, revisions: 2,
      });
    } finally {
      await fixture.cleanup();
    }
  }, 180_000);

  it("refuses duplicate first revisions and rolls the migration back", async () => {
    const fixture = await makeAppSchemaCandidateValidationMigrationFixture(
      "pglite-duplicate-root",
    );
    try {
      await writeAppSchemaCandidateValidationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        56,
      );
      const previous = await createPGlitePersistence({
        migrationsFolder: fixture.migrationsFolder,
      });
      await previous.migrate();
      await seedHistory(previous, true, "duplicate");
      await writeAppSchemaCandidateValidationJournalThrough(
        fixture.currentJournal,
        fixture.temporaryJournal,
        57,
      );
      await expect(previous.migrate()).rejects.toThrow();
      expect(await inventory(previous)).toEqual({
        tables: 0, indexes: 0, receipts: 57, revisions: 2,
      });
    } finally {
      await fixture.cleanup();
    }
  }, 180_000);
});

async function inventory(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
) {
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
      (select count(*)::int from drizzle.__drizzle_migrations) as receipts
  `);
  return result.rows[0];
}

async function seedHistory(
  persistence: Awaited<ReturnType<typeof createPGlitePersistence>>,
  duplicateRoot: boolean,
  suffix: string,
) {
  const scopeId = `scope_85000000-0000-4000-8000-${suffix === "valid" ? "000000000001" : "000000000002"}`;
  const epoch = `epoch_86000000-0000-4000-8000-${suffix === "valid" ? "000000000001" : "000000000002"}`;
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
