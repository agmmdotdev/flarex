import { expect } from "vitest";
import type { FlarexPersistence } from "../src";
import {
  injectMigrationFailure, restoreMigrationFile, writeJournalThrough, type DrizzleCopyFixture,
} from "./migrationFixtureSupport";
import {
  insertOpenTransactionJournalFixture, insertSessionTestScope, insertTransactionSessionFixture,
  transactionSessionFixture, transactionSessionIdAt,
} from "./sessionAuthorityTestSupport";

/** Exact development checkpoint upgrade; historical columns exist only inside this witness. */
export async function verifyJournalEvidenceMigration(
  persistence: Pick<FlarexPersistence, "query" | "exec" | "migrate">,
  fixture: DrizzleCopyFixture, migrationsSchema: string,
): Promise<void> {
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 92);
  await persistence.migrate();
  await insertSessionTestScope(persistence);
  const states = ["open", "failed", "relation_conflicted", "sealed"] as const;
  for (const [index, state] of states.entries()) {
    const session = transactionSessionFixture(transactionSessionIdAt(9300 + index));
    await insertTransactionSessionFixture(persistence, session);
    await insertOpenTransactionJournalFixture(persistence, session);
    if (state === "sealed") {
      await persistence.query(`
        update fx_system_tx_journal set state = 'sealed', last_syscall_sequence = 7,
          sealed_final_syscall_sequence = 7, sealed_journal_bytes = decode('0102','hex'),
          sealed_journal_sha256 = decode(repeat('31',32),'hex'),
          sealed_result_value_codec_version = 1, sealed_result_semantic_bytes = 1,
          sealed_result_bytes = decode('0304','hex'),
          sealed_result_sha256 = decode(repeat('32',32),'hex'), sealed_at = updated_at
        where session_id = $1
      `, [session.sessionId]);
    } else if (state !== "open") {
      await persistence.query(`
        update fx_system_tx_journal set state = $2, failure_dimension = $3 where session_id = $1
      `, [session.sessionId, state, state === "failed" ? "writeOperations" : null]);
    }
    await persistence.query(`
      insert into fx_system_tx_journal_write_event
        (scope_uuid, session_id, attempt_fence, syscall_sequence, write_kind,
         event_codec_version, event_json, event_bytes, event_sha256, created_at)
      values ($1, $2, 1, 1, 'delete', 1, '{"historical":true}', decode('0506','hex'),
        decode(repeat('33',32),'hex'), '2030-01-01'::timestamptz)
    `, [session.scopeUuid, session.sessionId]);
  }
  const originalRoots = await persistence.query("select to_jsonb(r) as root from fx_system_tx_journal r order by session_id");
  const originalEvents = await persistence.query("select to_jsonb(e) as event from fx_system_tx_journal_write_event e order by session_id");
  const expectedRoots = await persistence.query("select to_jsonb(r) - 'sealed_final_syscall_sequence' as root from fx_system_tx_journal r order by session_id");
  const expectedEvents = await persistence.query("select to_jsonb(e) - 'event_json' as event from fx_system_tx_journal_write_event e order by session_id");
  const receipts = '"' + migrationsSchema.replaceAll('"', '""') + '".__drizzle_migrations';
  await writeJournalThrough(fixture.currentJournal, fixture.temporaryJournal, 93);
  await injectMigrationFailure(fixture.migrationPath, "fx_journal_evidence_deliberate_missing_table");
  await expect(persistence.migrate()).rejects.toThrow(/fx_journal_evidence_deliberate_missing_table/);
  expect((await persistence.query("select to_jsonb(r) as root from fx_system_tx_journal r order by session_id")).rows).toEqual(originalRoots.rows);
  expect((await persistence.query("select to_jsonb(e) as event from fx_system_tx_journal_write_event e order by session_id")).rows).toEqual(originalEvents.rows);
  expect((await persistence.query("select count(*)::int as count from " + receipts)).rows).toEqual([{ count: 93 }]);
  await restoreMigrationFile(fixture.migrationPath, fixture.currentMigrationsFolder);
  await persistence.migrate();
  await persistence.migrate();
  expect((await persistence.query("select to_jsonb(r) as root from fx_system_tx_journal r order by session_id")).rows).toEqual(expectedRoots.rows);
  expect((await persistence.query("select to_jsonb(e) as event from fx_system_tx_journal_write_event e order by session_id")).rows).toEqual(expectedEvents.rows);
  expect((await persistence.query("select count(*)::int as count from " + receipts)).rows).toEqual([{ count: 94 }]);
  expect((await persistence.query(`
    select column_name from information_schema.columns where table_schema = current_schema()
      and ((table_name = 'fx_system_tx_journal' and column_name = 'sealed_final_syscall_sequence')
        or (table_name = 'fx_system_tx_journal_write_event' and column_name = 'event_json'))
  `)).rows).toEqual([]);
}
