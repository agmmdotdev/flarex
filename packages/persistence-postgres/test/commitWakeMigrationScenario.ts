import { expect } from "vitest";

import type { FlarexPersistence } from "../src";
import {
  WAKE_EPOCH_A,
  WAKE_EPOCH_B,
  WAKE_OWNER_A,
  WAKE_SCOPE_A,
} from "./commitWakeOutboxTestSupport";
import {
  injectMigrationFailure,
  restoreMigrationFile,
  writeJournalThrough,
  type DrizzleCopyFixture,
} from "./migrationFixtureSupport";

/** Exercises the exact 0091 -> 0092 replacement in either database driver. */
export async function verifyCommitWakeMigration(
  persistence: Pick<FlarexPersistence, "query" | "exec" | "migrate">,
  fixture: DrizzleCopyFixture,
  migrationsSchema: string,
): Promise<void> {
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 91);
  await persistence.migrate();
  // Historical SQL is local to this migration witness, never a dual-schema helper.
  await persistence.exec(`
    insert into fx_system_scope_clock
      (scope_id, storage_generation, last_commit_seq, last_outbox_seq, epoch)
    values ('scope_${WAKE_SCOPE_A}', 'flarexdb_v1', 4, 19, 'epoch_${WAKE_EPOCH_B}');
    insert into fx_system_outbox
      (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind)
    values ('${WAKE_SCOPE_A}', 8, '${WAKE_EPOCH_A}', 1,
      'deployment_sync_commit_wake_v1');
    insert into fx_system_outbox
      (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
       delivery_state, next_attempt_at, attempt_count, claim_fence,
       claim_owner, claimed_at, claim_expires_at,
       last_failure_code, last_failure_summary, last_failed_at)
    values ('${WAKE_SCOPE_A}', 13, '${WAKE_EPOCH_A}', 2,
      'deployment_sync_commit_wake_v1', 'claimed', null, 3, 3,
      '${WAKE_OWNER_A}', now(), now() + interval '1 minute',
      'claim_lease_expired', 'retained claim evidence', now());
    insert into fx_system_outbox
      (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
       delivery_state, next_attempt_at, attempt_count, claim_fence, delivered_at)
    values ('${WAKE_SCOPE_A}', 17, '${WAKE_EPOCH_A}', 3,
      'deployment_sync_commit_wake_v1', 'delivered', null, 1, 1, now());
    insert into fx_system_outbox
      (scope_uuid, outbox_seq, epoch_uuid, commit_seq, event_kind,
       delivery_state, next_attempt_at, attempt_count, claim_fence,
       dead_lettered_at, last_failure_code, last_failure_summary, last_failed_at)
    values ('${WAKE_SCOPE_A}', 19, '${WAKE_EPOCH_A}', 4,
      'deployment_sync_commit_wake_v1', 'dead_lettered', null, 2, 2, now(),
      'terminal_delivery', 'retained terminal evidence', now());
    insert into outbox (deployment_id, ts, sequence, event)
    values ('legacy-commit-wake', 1, 0, '{"kind":"legacy"}'::jsonb)
  `);
  const original = await persistence.query(`
    select to_jsonb(w) as wake from fx_system_outbox w order by commit_seq
  `);
  const expected = await persistence.query(`
    select to_jsonb(w) - 'outbox_seq' - 'event_kind' - 'attempt_count' as wake
    from fx_system_outbox w order by commit_seq
  `);
  const expectedClock = await persistence.query(`
    select to_jsonb(c) - 'last_outbox_seq' as clock from fx_system_scope_clock c
  `);
  const legacy = await persistence.query("select to_jsonb(o) as legacy from outbox o");
  const receiptsTable = `"${migrationsSchema.replaceAll('"', '""')}".__drizzle_migrations`;

  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 92);
  await injectMigrationFailure(fixture.migrationPath, "fx_commit_wake_deliberate_missing_table");
  await expect(persistence.migrate()).rejects.toThrow(/fx_commit_wake_deliberate_missing_table/);
  expect((await persistence.query(`
    select to_jsonb(w) as wake from fx_system_outbox w order by commit_seq
  `)).rows).toEqual(original.rows);
  expect((await persistence.query(`
    select count(*)::int as count from information_schema.tables
    where table_schema = current_schema() and table_name = 'fx_system_commit_wake'
  `)).rows).toEqual([{ count: 0 }]);
  expect((await persistence.query(`select count(*)::int as count from ${receiptsTable}`)).rows)
    .toEqual([{ count: 92 }]);

  await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
  await persistence.migrate();
  await persistence.migrate();
  expect((await persistence.query(`
    select to_jsonb(w) as wake from fx_system_commit_wake w order by commit_seq
  `)).rows).toEqual(expected.rows);
  expect((await persistence.query(`
    select to_jsonb(c) as clock from fx_system_scope_clock c
  `)).rows).toEqual(expectedClock.rows);
  expect((await persistence.query("select to_jsonb(o) as legacy from outbox o")).rows)
    .toEqual(legacy.rows);
  expect((await persistence.query(`select count(*)::int as count from ${receiptsTable}`)).rows)
    .toEqual([{ count: 93 }]);
  expect((await persistence.query(`
    select count(*)::int as count from information_schema.tables
    where table_schema = current_schema() and table_name = 'fx_system_outbox'
  `)).rows).toEqual([{ count: 0 }]);
  expect((await persistence.query(`
    select table_name, column_name from information_schema.columns
    where table_schema = current_schema() and (
      (table_name = 'fx_system_commit_wake'
        and column_name in ('outbox_seq', 'event_kind', 'attempt_count'))
      or (table_name = 'fx_system_scope_clock' and column_name = 'last_outbox_seq')
    )
  `)).rows).toEqual([]);
}
