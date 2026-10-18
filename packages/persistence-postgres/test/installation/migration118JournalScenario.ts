import { readFile, writeFile } from "node:fs/promises";
import { expect } from "vitest";
import type { FlarexSqlClient } from "../../src";
import { makeDrizzleCopyFixture, writeJournalThrough } from "../support/migrationFixtureSupport";
import {
  insertLegacySessionTestScope,
  insertTransactionSessionFixture,
  transactionSessionFixture,
  transactionSessionIdAt,
} from "../execution/session/support/sessionStorage";

type MigratingClient = Pick<FlarexSqlClient, "query"> & Readonly<{ migrate: () => Promise<void> }>;

export async function withMigration118Folder(run: (folder: string, enableCurrent: () => Promise<void>) => Promise<void>) {
  const fixture = await makeDrizzleCopyFixture("flarex-journal", "118", "0118_admitted_operation_journal.sql");
  try {
    await writeJournalThrough(fixture.temporaryJournal, fixture.temporaryJournal, 118);
    const full = await readFile(fixture.temporaryJournal, "utf8");
    await writeJournalThrough(fixture.temporaryJournal, fixture.temporaryJournal, 117);
    await run(fixture.migrationsFolder, () => writeFile(fixture.temporaryJournal, full, "utf8"));
  } finally {
    await fixture.cleanup();
  }
}

export async function assertMigration118JournalCutover(previous: MigratingClient, current: MigratingClient,
  migrationsSchema: string): Promise<void> {
  if (!/^[a-z_][a-z_0-9]*$/.test(migrationsSchema)) throw new Error("Invalid migrations schema");
  const session = transactionSessionFixture(transactionSessionIdAt(118));
  await insertLegacySessionTestScope(previous);
  await insertTransactionSessionFixture(previous, session);
  const before = await previous.query<{ sessionCount: string; formatCheck: string }>(`select
    (select count(*)::text from fx_system_tx_session where session_id = $1) as "sessionCount",
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_format_check'
      and conrelid = 'fx_system_tx_journal'::regclass) as "formatCheck"`, [session.sessionId]);
  expect(before.rows).toHaveLength(1);
  expect(before.rows[0]?.formatCheck).toContain("flarex.session-journal-v2");
  await expect(current.migrate()).rejects.toMatchObject({
    _tag: "InstallationLifecycleError",
    reason: "resourceFailure",
    cause: { cause: {
      code: "P0001",
      message: expect.stringMatching(/session journal replacement requires fresh isolated data/),
    } },
  });
  expect((await previous.query<{ sessionCount: string; formatCheck: string }>(`select
    (select count(*)::text from fx_system_tx_session where session_id = $1) as "sessionCount",
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_format_check'
      and conrelid = 'fx_system_tx_journal'::regclass) as "formatCheck"`, [session.sessionId])).rows).toEqual(before.rows);
  expect((await previous.query<{ count: string }>(`select count(*)::text as count from
    "${migrationsSchema}".__drizzle_migrations`)).rows).toEqual([{ count: "118" }]);

  await previous.query(`delete from fx_system_tx_session where session_id = $1`, [session.sessionId]);
  await current.migrate();
  const upgraded = await current.query<{ formatCheck: string; requestCheck: string;
    outcomeCheck: string; eventCheck: string }>(`select
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_format_check'
      and conrelid = 'fx_system_tx_journal'::regclass) as "formatCheck",
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_receipt_request_check'
      and conrelid = 'fx_system_tx_journal_receipt'::regclass) as "requestCheck",
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_receipt_outcome_check'
      and conrelid = 'fx_system_tx_journal_receipt'::regclass) as "outcomeCheck",
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_event_payload_check'
      and conrelid = 'fx_system_tx_journal_write_event'::regclass) as "eventCheck"`);
  expect(upgraded.rows[0]?.formatCheck).toContain("flarex.session-journal");
  expect(upgraded.rows[0]?.formatCheck).not.toContain("-v2");
  expect(upgraded.rows[0]?.requestCheck).toContain("= 2");
  expect(upgraded.rows[0]?.outcomeCheck).toContain("= 2");
  expect(upgraded.rows[0]?.eventCheck).toContain("= 2");
  expect((await current.query<{ count: string }>(`select count(*)::text as count from
    "${migrationsSchema}".__drizzle_migrations`)).rows).toEqual([{ count: "119" }]);
}
