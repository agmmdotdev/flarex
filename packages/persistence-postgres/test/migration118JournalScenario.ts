import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";
import type { FlarexSqlClient } from "../src";
import { insertSessionTestScope, insertTransactionSessionFixture,
  transactionSessionFixture, transactionSessionIdAt } from "./sessionAuthorityTestSupport";

type MigratingClient = Pick<FlarexSqlClient, "query"> & Readonly<{ migrate: () => Promise<void> }>;

export async function withMigration118Folder(run: (folder: string, enableCurrent: () => Promise<void>) => Promise<void>) {
  const root = await mkdtemp(resolve(tmpdir(), "flarex-journal-118-"));
  const folder = resolve(root, "drizzle");
  const source = resolve(dirname(fileURLToPath(import.meta.url)), "../drizzle");
  try {
    await cp(source, folder, { recursive: true });
    const journalPath = resolve(folder, "meta/_journal.json");
    const full = await readFile(journalPath, "utf8");
    const parsed: unknown = JSON.parse(full);
    if (typeof parsed !== "object" || parsed === null || !Array.isArray(Reflect.get(parsed, "entries")))
      throw new Error("Missing Drizzle journal");
    const entries: unknown[] = Reflect.get(parsed, "entries");
    await writeFile(journalPath, `${JSON.stringify({ ...parsed, entries: entries.filter(entry =>
      typeof entry === "object" && entry !== null && typeof Reflect.get(entry, "idx") === "number" &&
      Reflect.get(entry, "idx") < 118) }, null, 2)}\n`, "utf8");
    await run(folder, () => writeFile(journalPath, full, "utf8"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export async function assertMigration118JournalCutover(previous: MigratingClient, current: MigratingClient,
  migrationsSchema: string): Promise<void> {
  if (!/^[a-z_][a-z_0-9]*$/.test(migrationsSchema)) throw new Error("Invalid migrations schema");
  const session = transactionSessionFixture(transactionSessionIdAt(118));
  await insertSessionTestScope(previous);
  await insertTransactionSessionFixture(previous, session);
  const before = await previous.query<{ sessionCount: string; formatCheck: string }>(`select
    (select count(*)::text from fx_system_tx_session where session_id = $1) as "sessionCount",
    (select pg_get_constraintdef(oid) from pg_constraint where conname = 'fx_system_tx_journal_format_check'
      and conrelid = 'fx_system_tx_journal'::regclass) as "formatCheck"`, [session.sessionId]);
  expect(before.rows).toHaveLength(1);
  expect(before.rows[0]?.formatCheck).toContain("flarex.session-journal-v2");
  await expect(current.migrate()).rejects.toThrow(/session journal replacement requires fresh isolated data/);
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
