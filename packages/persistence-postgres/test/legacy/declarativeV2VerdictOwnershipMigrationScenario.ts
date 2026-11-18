import { expect, it } from "vitest";
import type { FlarexPersistence } from "../../src";
import {
  makeDrizzleCopyFixture, writeJournalThrough, injectMigrationFailure, restoreMigrationFile,
  type DrizzleCopyFixture,
} from "../support/migrationFixtureSupport";

type WithPersistence = (migrationsFolder: string, run: (
  persistence: Pick<FlarexPersistence, "query" | "migrate">,
  migrationsSchema: string,
) => Promise<void>) => Promise<void>;

/** Both drivers prove the exact 0042 -> 0043 ownership transition, before retirement. */
export function registerVerdictOwnershipMigrationTests(withPersistence: WithPersistence) {
  it("replaces empty dormant V1 verdict ownership atomically and replays 0043", async () => {
    await withFixture("upgrade", withPersistence, async (persistence, receipts, fixture) => {
      const oldForeignKey = await persistence.query<{ target: string }>(`
        select confrelid::regclass::text as target from pg_constraint
        where connamespace = current_schema()::regnamespace and conname = 'fx_dv2_verdict_attempt_fk'
      `);
      expect(oldForeignKey.rows[0]?.target).toBe("fx_system_declarative_v2_verifier_attempt");
      await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 43);
      await injectMigrationFailure(fixture.migrationPath, "fx_fsv04_deliberate_missing_table");
      await expect(persistence.migrate()).rejects.toMatchObject({
        _tag: "InstallationLifecycleError", reason: "resourceFailure",
        cause: { cause: { code: "42P01", message: expect.stringContaining("fx_fsv04_deliberate_missing_table") } },
      });
      const rolledBack = await persistence.query<{ revision_column: string; receipts: string }>(`
        select
          (select count(*)::text from information_schema.columns
            where table_schema = current_schema() and table_name = 'fx_system_declarative_v2_verdict'
              and column_name = 'revision_id') as revision_column,
          (select count(*)::text from ${receipts}) as receipts
      `);
      expect(rolledBack.rows).toEqual([{ revision_column: "0", receipts: "43" }]);
      await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
      await persistence.migrate();
      await persistence.migrate();
      const upgraded = await persistence.query<{
        revision_column: string; attempt_target: string; revision_target: string; receipts: string;
      }>(`
        select
          (select count(*)::text from information_schema.columns
            where table_schema = current_schema() and table_name = 'fx_system_declarative_v2_verdict'
              and column_name = 'revision_id') as revision_column,
          (select confrelid::regclass::text from pg_constraint
            where connamespace = current_schema()::regnamespace and conname = 'fx_dv2_verdict_attempt_fk') as attempt_target,
          (select confrelid::regclass::text from pg_constraint
            where connamespace = current_schema()::regnamespace and conname = 'fx_dv2_verdict_revision_fk') as revision_target,
          (select count(*)::text from ${receipts}) as receipts
      `);
      expect(upgraded.rows).toEqual([{
        revision_column: "1", attempt_target: "fx_system_declarative_v2_verifier_attempt_v2",
        revision_target: "fx_system_application_revision_v1", receipts: "44",
      }]);
    });
  }, 60_000);

  it("refuses nonempty dormant V1 verdict ownership without a receipt or partial replacement", async () => {
    await withFixture("legacy", withPersistence, async (persistence, receipts, fixture) => {
      // Deliberately isolate the populated-verdict migration guard from old FK admission.
      await persistence.query("alter table fx_system_declarative_v2_verdict drop constraint fx_dv2_verdict_attempt_fk");
      await persistence.query("alter table fx_system_declarative_v2_verdict drop constraint fx_dv2_verdict_candidate_fk");
      await persistence.query(`insert into fx_system_declarative_v2_verdict
        (scope_id, attempt_sha256, candidate_sha256, verdict_sha256, verdict, failure_code,
         frame_codec_version, frame_byte_length, frame_sha256, frame_bytes)
        values ('scope_legacy_fsv04', decode(repeat('11', 32), 'hex'), decode(repeat('22', 32), 'hex'),
          decode(repeat('33', 32), 'hex'), 'ready', null, 1, 1, decode(repeat('33', 32), 'hex'), decode('00', 'hex'))`);
      await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 43);
      await expect(persistence.migrate()).rejects.toMatchObject({
        _tag: "InstallationLifecycleError", reason: "resourceFailure",
        cause: { cause: { code: "P0001", message: "migration 0043 cannot replace legacy declarative V2 verdict rows" } },
      });
      const unchanged = await persistence.query<{ rows: string; revision_column: string; receipts: string }>(`
        select
          (select count(*)::text from fx_system_declarative_v2_verdict) as rows,
          (select count(*)::text from information_schema.columns
            where table_schema = current_schema() and table_name = 'fx_system_declarative_v2_verdict'
              and column_name = 'revision_id') as revision_column,
          (select count(*)::text from ${receipts}) as receipts
      `);
      expect(unchanged.rows).toEqual([{ rows: "1", revision_column: "0", receipts: "43" }]);
    });
  }, 60_000);
}

async function withFixture(label: string, withPersistence: WithPersistence, run: (
  persistence: Pick<FlarexPersistence, "query" | "migrate">, receipts: string, fixture: DrizzleCopyFixture,
) => Promise<void>) {
  const fixture = await makeDrizzleCopyFixture("flarex-verdict-ownership", label, "0043_clever_grim_reaper.sql");
  let failed = false;
  let primaryCause: unknown;
  try {
    await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 42);
    await withPersistence(fixture.migrationsFolder, async (persistence, migrationsSchema) => {
      await persistence.migrate();
      await run(persistence, `"${migrationsSchema.replaceAll('"', '""')}".__drizzle_migrations`, fixture);
    });
  } catch (cause) {
    failed = true;
    primaryCause = cause;
    throw cause;
  } finally {
    try { await fixture.cleanup(); } catch (cleanupCause) {
      if (failed) throw new AggregateError([primaryCause, cleanupCause], "Verdict ownership proof and fixture cleanup failed");
      throw cleanupCause;
    }
  }
}
