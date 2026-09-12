import { eq } from "drizzle-orm";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  fxSystemTransactionJournals,
  fxSystemTransactionJournalLatestReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalWriteEvents,
} from "../src/schema";
import type { PointMutationSessionAnchorV1 } from "../src/transactionSessionActivation";
import type {
  PinnedPointTableV1,
  SessionJournalPointOperationV1,
  SessionJournalStorePersistenceV1,
} from "../src/sessionJournalStore";
import { runSessionJournalPointOperation } from "./effectTestRuntime";

/** Real database triggers witness rollback after receipt overwrite and before root CAS. */
export async function sessionJournalReceiptScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  current: {
    readonly store: SessionJournalStorePersistenceV1;
    readonly table: PinnedPointTableV1;
    readonly anchor: PointMutationSessionAnchorV1;
  },
): Promise<void> {
  const run = (request: SessionJournalPointOperationV1) =>
    runSessionJournalPointOperation(current.store, current.table, request);
  const readState = async () => ({
    roots: await persistence.drizzle.select().from(fxSystemTransactionJournals)
      .where(eq(fxSystemTransactionJournals.sessionId, current.anchor.sessionId)),
    receipts: await persistence.drizzle.select().from(fxSystemTransactionJournalLatestReceipts)
      .where(eq(fxSystemTransactionJournalLatestReceipts.sessionId, current.anchor.sessionId)),
    points: await persistence.drizzle.select().from(fxSystemTransactionJournalPoints)
      .where(eq(fxSystemTransactionJournalPoints.sessionId, current.anchor.sessionId)),
    events: await persistence.drizzle.select().from(fxSystemTransactionJournalWriteEvents)
      .where(eq(fxSystemTransactionJournalWriteEvents.sessionId, current.anchor.sessionId)),
  });
  await expect(run({
    kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(1n),
    fields: { name: "first receipt" },
  })).resolves.toMatchObject({ kind: "completed", delivery: "executed" });
  const before = await readState();
  const next = {
    kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
    fields: { name: "replacement receipt" },
  } satisfies SessionJournalPointOperationV1;
  // Test-only DDL injects failure at the SQL boundary; ordinary state uses Drizzle.
  await persistence.exec(`create function fx_test_receipt_no_delete() returns trigger
    language plpgsql as $$ begin raise exception 'receipt delete forbidden'; end $$`);
  await persistence.exec(`create function fx_test_receipt_root_failure() returns trigger
    language plpgsql as $$ begin
      if new.last_syscall_sequence = 2 then raise exception 'root CAS failure'; end if;
      return new;
    end $$`);
  try {
    await persistence.exec(`create trigger fx_test_receipt_no_delete before delete
      on fx_system_tx_journal_latest_receipt for each row
      execute function fx_test_receipt_no_delete()`);
    await persistence.exec(`create trigger fx_test_receipt_root_failure before update
      on fx_system_tx_journal for each row
      execute function fx_test_receipt_root_failure()`);
    await expect(run(next)).rejects.toMatchObject({ _tag: "SessionJournalPersistenceV1Error" });
    expect(await readState()).toEqual(before);
    await persistence.exec("drop trigger fx_test_receipt_root_failure on fx_system_tx_journal");
    const executed = await run(next);
    expect(executed).toMatchObject({ kind: "completed", delivery: "executed" });
    const after = await readState();
    expect(after.receipts).toHaveLength(1);
    expect(after.receipts[0]).toMatchObject({
      lastSyscallSequence: 2n, operationKind: "insert",
      createdAt: after.receipts[0]?.updatedAt,
    });
    expect(after.roots[0]).toMatchObject({ lastSyscallSequence: 2n, writeOperations: 2 });
    expect(after.points).toHaveLength(2);
    expect(after.events).toHaveLength(2);
    expect(await run(next)).toEqual({ ...executed, delivery: "replayed" });
    expect(await readState()).toEqual(after);
  } finally {
    await persistence.exec("drop trigger if exists fx_test_receipt_root_failure on fx_system_tx_journal");
    await persistence.exec("drop trigger if exists fx_test_receipt_no_delete on fx_system_tx_journal_latest_receipt");
    await persistence.exec("drop function fx_test_receipt_root_failure()");
    await persistence.exec("drop function fx_test_receipt_no_delete()");
  }
}
