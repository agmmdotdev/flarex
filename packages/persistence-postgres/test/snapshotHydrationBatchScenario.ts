import { isJsonObject } from "flarex-protocol/json";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, projectScopeIdUuidV1, type ScopeEpoch } from "flarex-protocol/storage-authority";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction, consumeBoundedAppRowsAtSnapshotInTransactionEffect,
  readLiveAppRowsAtSnapshotInTransactionEffect, type AppRowIdentityV1, type AppRowTransaction, type ReadAppRowError } from "../src/appRows";
import { fxAppRowRevisions } from "../src/schema";
import { runEffect } from "./effectTestRuntime";

/** Both storage lanes run the same exact snapshot/order/failure witness. */
export async function snapshotHydrationBatchScenario(tx: AppRowTransaction,
  input: Readonly<{ identity: AppRowIdentityV1; epoch: ScopeEpoch; schemaVersionId: CatalogSchemaVersionId; creationTime: AppCreationTimeV1 }>) {
  const { scopeId, tableId } = input.identity;
  const live = decodeAppRowIdHexV1("b1000000000000000000000000000001");
  const tombstone = decodeAppRowIdHexV1("b1000000000000000000000000000002");
  const missing = decodeAppRowIdHexV1("b1000000000000000000000000000003");
  const corrupt = decodeAppRowIdHexV1("b1000000000000000000000000000004");
  for (const rowId of [live, tombstone, corrupt]) {
    const value = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime: input.creationTime, fields: { title: "at snapshot" } });
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, { kind: "live", scopeId, tableId, rowId,
      writeEpoch: input.epoch, schemaVersionId: input.schemaVersionId, creationTime: input.creationTime,
      commitSeq: CommitSeqSchema.make(1n), prevCommitSeq: null, value });
  }
  await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, { kind: "tombstone", scopeId, tableId, rowId: tombstone,
    writeEpoch: input.epoch, schemaVersionId: input.schemaVersionId, creationTime: input.creationTime,
    commitSeq: CommitSeqSchema.make(2n), prevCommitSeq: CommitSeqSchema.make(1n) });
  const later = await canonicalizeAppDocumentV1({ tableId, rowId: live, creationTime: input.creationTime, fields: { title: "later" } });
  await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, { kind: "live", scopeId, tableId, rowId: live,
    writeEpoch: input.epoch, schemaVersionId: input.schemaVersionId, creationTime: input.creationTime,
    commitSeq: CommitSeqSchema.make(3n), prevCommitSeq: CommitSeqSchema.make(1n), value: later });
  const selected = { scopeId, tableId, snapshotCommitSeq: CommitSeqSchema.make(2n), maximumTotalValueBytes: 1_048_576, rowIds: [missing, tombstone, live] };
  const observations: unknown[] = [];
  const statements: string[] = [];
  await runEffect(consumeBoundedAppRowsAtSnapshotInTransactionEffect(tx, selected, cause => cause, (rowId, revision) => Effect.sync(() => {
    observations.push({ rowId, kind: revision.kind, commitSeq: revision.kind === "missing" ? null : revision.commitSeq,
      title: revision.kind === "live" && isJsonObject(revision.document.valueJson) ? revision.document.valueJson.title : null });
  }), query => { statements.push(query.name); }));
  expect(observations).toEqual([{ rowId: missing, kind: "missing", commitSeq: null, title: null },
    { rowId: tombstone, kind: "tombstone", commitSeq: 2n, title: null },
    { rowId: live, kind: "live", commitSeq: 1n, title: "at snapshot" }]);
  expect(statements).toEqual(["snapshotRevision"]);
  let entered = 0;
  for (const rowIds of [[live, live], Array.from({ length: 257 }, () => live)]) {
    expect(await runEffect(Effect.result(consumeBoundedAppRowsAtSnapshotInTransactionEffect(tx, { ...selected, rowIds },
      cause => cause, () => Effect.sync(() => { entered += 1; })))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidAppRowReadInputError" } });
  }
  expect(entered).toBe(0);
  const boundedMissing = Array.from({ length: 256 }, (_, ordinal) =>
    decodeAppRowIdHexV1((BigInt(ordinal) + 0xc1000000000000000000000000000000n).toString(16)));
  let missingCount = 0;
  await runEffect(consumeBoundedAppRowsAtSnapshotInTransactionEffect(tx, { ...selected, rowIds: boundedMissing },
    cause => cause, (_rowId, revision) => Effect.sync(() => { expect(revision.kind).toBe("missing"); missingCount += 1; })));
  expect(missingCount).toBe(256);
  expect(await runEffect(Effect.result(readLiveAppRowsAtSnapshotInTransactionEffect(tx,
    { ...selected, rowIds: boundedMissing.slice(0, 128) }))))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "AppRowStorageCorruptionError" } });
  expect(await runEffect(Effect.result(readLiveAppRowsAtSnapshotInTransactionEffect(tx,
    { ...selected, rowIds: boundedMissing.slice(0, 129) }))))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidAppRowReadInputError", issue: { reason: "rowLimitExceeded" } } });

  expect(await runEffect(Effect.result(readLiveAppRowsAtSnapshotInTransactionEffect(tx, selected))))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "AppRowStorageCorruptionError" } });
  // Deliberately alter canonical bytes without changing their authenticated hash.
  await tx.update(fxAppRowRevisions).set({ valueBytes: sql`decode('00', 'hex')` }).where(and(
    eq(fxAppRowRevisions.scopeUuid, projectScopeIdUuidV1(scopeId).scopeUuid),
    eq(fxAppRowRevisions.tableId, tableId), eq(fxAppRowRevisions.rowId, appRowIdHexV1ToBytes(corrupt))));
  const failed = await runEffect(Effect.result(consumeBoundedAppRowsAtSnapshotInTransactionEffect<ReadAppRowError | "byteBudget", never>(tx,
    { ...selected, maximumTotalValueBytes: 0, rowIds: [live, corrupt] }, cause => cause, (_rowId, revision) => {
      entered += 1;
      return revision.kind === "live" && revision.document.canonicalBytes.byteLength > 1
        ? Effect.fail("byteBudget" as const) : Effect.void;
    })));
  expect(failed).toEqual(Result.fail("byteBudget"));
  expect(entered).toBe(1);
  expect(await runEffect(Effect.result(consumeBoundedAppRowsAtSnapshotInTransactionEffect(tx,
    { ...selected, rowIds: [corrupt, live] }, cause => cause, () => Effect.void))))
      .toMatchObject({ _tag: "Failure", failure: { _tag: "AppRowStorageCorruptionError" } });
  const crossing = await runEffect(Effect.result(consumeBoundedAppRowsAtSnapshotInTransactionEffect<ReadAppRowError | "byteBudget", never>(tx,
    { ...selected, maximumTotalValueBytes: 0, rowIds: [corrupt, live] }, cause => cause, () => Effect.fail("byteBudget" as const))));
  expect(crossing).toMatchObject({ _tag: "Failure", failure: { _tag: "AppRowStorageCorruptionError" } });
  const exhausted = await runEffect(Effect.exit(consumeBoundedAppRowsAtSnapshotInTransactionEffect(tx,
    { ...selected, maximumTotalValueBytes: 0, rowIds: [live, corrupt] }, cause => cause, () => Effect.void)));
  if (!Exit.isFailure(exhausted)) throw new Error("Expected trusted hydration invariant defect");
  expect(Cause.pretty(exhausted.cause)).toContain("Trusted snapshot hydration reached a withheld body");

}
