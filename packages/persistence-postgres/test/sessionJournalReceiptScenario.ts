import { and, eq, sql } from "drizzle-orm";
import { expect } from "vitest";
import { CommitSyscallSequenceV1Schema } from "flarex-protocol/commit-protocol";
import { CommitSeqSchema } from "flarex-protocol/storage-authority";
import type { PGliteFlarexPersistence } from "../src/pglite";
import type { PostgresFlarexPersistence } from "../src/postgres";
import {
  fxSystemTransactionJournals,
  fxSystemTransactionJournalReceipts,
  fxSystemTransactionJournalPoints,
  fxSystemTransactionJournalWriteEvents,
} from "../src/schema";
import type { PointMutationSessionAnchorV1 } from "../src/transactionSessionActivation";
import type {
  PinnedPointTableV1,
  SessionJournalPointOperationV1,
  SessionJournalStorePersistence,
} from "../src/sessionJournalStore";
import { runSessionJournalPointOperation } from "./effectTestRuntime";

/** A root CAS failure rolls back the new immutable receipt with its point effects. */
export async function sessionJournalReceiptScenario(
  persistence: PGliteFlarexPersistence | PostgresFlarexPersistence,
  current: {
    readonly store: SessionJournalStorePersistence;
    readonly table: PinnedPointTableV1;
    readonly anchor: PointMutationSessionAnchorV1;
  },
): Promise<void> {
  const run = (request: SessionJournalPointOperationV1) =>
    runSessionJournalPointOperation(current.store, current.table, request);
  const readState = async () => ({
    roots: await persistence.drizzle.select().from(fxSystemTransactionJournals)
      .where(eq(fxSystemTransactionJournals.sessionId, current.anchor.sessionId)),
    receipts: await persistence.drizzle.select().from(fxSystemTransactionJournalReceipts)
      .where(eq(fxSystemTransactionJournalReceipts.sessionId, current.anchor.sessionId)),
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
  const point = before.points[0];
  if (point === undefined) throw new Error("Missing original native insertion point");
  expect(point).toMatchObject({ dependencyKind: "missing_no_visible_revision", dependencyRevisionCommitSeq: null });
  const pointIdentity = and(
    eq(fxSystemTransactionJournalPoints.scopeUuid, point.scopeUuid),
    eq(fxSystemTransactionJournalPoints.sessionId, point.sessionId),
    eq(fxSystemTransactionJournalPoints.attemptFence, point.attemptFence),
    eq(fxSystemTransactionJournalPoints.tableId, point.tableId),
    eq(fxSystemTransactionJournalPoints.rowId, point.rowId),
  );
  const revision = CommitSeqSchema.make(1n);
  const zero = CommitSeqSchema.make(0n);
  // Structural CHECK coverage uses one genuinely issued point. These mutations
  // never assert admission authority and always roll back with its full receipt.
  for (const test of [
    { kind: "present", revision, accepted: true },
    { kind: "present", revision: null, accepted: false },
    { kind: "present", revision: zero, accepted: false },
    { kind: "missing_no_visible_revision", revision: null, accepted: true },
    { kind: "missing_no_visible_revision", revision, accepted: false },
    { kind: "missing_tombstone", revision, accepted: true },
    { kind: "missing_tombstone", revision: null, accepted: false },
    { kind: "missing_tombstone", revision: zero, accepted: false },
    { kind: "generated_insertion", revision: null, accepted: true },
    { kind: "generated_insertion", revision, accepted: false },
    { kind: sql`${"unknown_dependency"}`, revision: null, accepted: false },
  ] as const) {
    const rollback = new Error("Rollback structural journal dependency witness");
    const changed = persistence.drizzle.transaction(async tx => {
      const rows = await tx.update(fxSystemTransactionJournalPoints).set({
        dependencyKind: test.kind, dependencyRevisionCommitSeq: test.revision,
      }).where(pointIdentity).returning();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ dependencyKind: test.kind, dependencyRevisionCommitSeq: test.revision });
      throw rollback;
    });
    if (test.accepted) await expect(changed).rejects.toBe(rollback);
    else await expect(changed).rejects.toMatchObject({ cause: {
      code: "23514", constraint: "fx_system_tx_journal_point_dependency_check",
    } });
    expect(await readState()).toEqual(before);
  }
  const next = {
    kind: "insert", syscallSequence: CommitSyscallSequenceV1Schema.make(2n),
    fields: { name: "second receipt" },
  } satisfies SessionJournalPointOperationV1;
  // Test-only DDL injects failure at the SQL boundary; ordinary state uses Drizzle.
  await persistence.exec(`create function fx_test_receipt_immutable() returns trigger
    language plpgsql as $$ begin raise exception 'receipt mutation forbidden'; end $$`);
  await persistence.exec(`create function fx_test_receipt_root_failure() returns trigger
    language plpgsql as $$ begin
      if new.last_syscall_sequence = 2 then raise exception 'root CAS failure'; end if;
      return new;
    end $$`);
  try {
    await persistence.exec(`create trigger fx_test_receipt_no_update before update
      on fx_system_tx_journal_receipt for each row
      execute function fx_test_receipt_immutable()`);
    await persistence.exec(`create trigger fx_test_receipt_root_failure before update
      on fx_system_tx_journal for each row
      execute function fx_test_receipt_root_failure()`);
    await expect(run(next)).rejects.toMatchObject({ _tag: "SessionJournalPersistenceV1Error" });
    expect(await readState()).toEqual(before);
    await persistence.exec("drop trigger fx_test_receipt_root_failure on fx_system_tx_journal");
    const executed = await run(next);
    expect(executed).toMatchObject({ kind: "completed", delivery: "executed" });
    const after = await readState();
    expect(after.receipts).toHaveLength(2);
    expect(after.receipts.map((receipt) => receipt.lastSyscallSequence).sort()).toEqual([1n, 2n]);
    expect(after.receipts.every((receipt) => receipt.operationKind === "insert")).toBe(true);
    expect(after.roots[0]).toMatchObject({ lastSyscallSequence: 2n, writeOperations: 2 });
    expect(after.points).toHaveLength(2);
    expect(after.events).toHaveLength(2);
    expect(await run(next)).toEqual({ ...executed, delivery: "replayed" });
    expect(await readState()).toEqual(after);
  } finally {
    await persistence.exec("drop trigger if exists fx_test_receipt_root_failure on fx_system_tx_journal");
    await persistence.exec("drop trigger if exists fx_test_receipt_no_update on fx_system_tx_journal_receipt");
    await persistence.exec("drop function fx_test_receipt_root_failure()");
    await persistence.exec("drop function fx_test_receipt_immutable()");
  }
}
