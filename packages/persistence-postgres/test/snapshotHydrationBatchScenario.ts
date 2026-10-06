import { isJsonObject } from "flarex-protocol/json";
import { and, eq, sql } from "drizzle-orm";
import { Cause, Effect, Exit, Result } from "effect";
import { expect } from "vitest";
import { canonicalizeAppDocumentV1, type AppCreationTimeV1 } from "flarex-protocol/app-document";
import { decodeAppRowIdHexV1, appRowIdHexV1ToBytes } from "flarex-protocol/app-document-id";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import { CommitSeqSchema, projectScopeIdUuidV1, type ScopeEpoch } from "flarex-protocol/storage-authority";
import { appendAppRowRevisionAndAdvanceCurrentInTransaction, consumeAppRowSnapshotRevisionsInTransactionEffect, consumeBoundedAppRowsAtSnapshotInTransactionEffect,
  withPublicationAppRowTargetsInTransactionEffect,
  readLiveAppRowsAtSnapshotInTransactionEffect, type AppRowIdentityV1, type AppRowTransaction, type ReadAppRowError } from "../src/appRows";
import { fxAppRowRevisions, fxSystemScopeClocks } from "../src/schema";
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
  // Settlement retains every revision with greedy byte windows; a single
  // oversized original is consumed alone rather than refused or made missing.
  const largeIds = Array.from({ length: 4 }, (_, ordinal) => decodeAppRowIdHexV1(
    (0xb2000000000000000000000000000000n + BigInt(ordinal)).toString(16)));
  for (const [ordinal, rowId] of largeIds.entries()) {
    const document = await canonicalizeAppDocumentV1({ tableId, rowId, creationTime: input.creationTime,
      fields: { body: "x".repeat(ordinal === 3 ? 300_000 : 120_000) } });
    await appendAppRowRevisionAndAdvanceCurrentInTransaction(tx, { kind: "live", scopeId, tableId, rowId,
      writeEpoch: input.epoch, schemaVersionId: input.schemaVersionId, creationTime: input.creationTime,
      commitSeq: CommitSeqSchema.make(1n), prevCommitSeq: null, value: document });
  }
  const windows: string[] = [];
  const consumed: string[] = [];
  await runEffect(consumeAppRowSnapshotRevisionsInTransactionEffect(tx,
    { ...selected, rowIds: [...largeIds, missing, tombstone] }, cause => cause,
    (rowId, revision) => Effect.sync(() => { consumed.push(rowId); expect(revision.kind).toBe(
      rowId === missing ? "missing" : rowId === tombstone ? "tombstone" : "live"); }),
    observation => { windows.push(observation.sql); }));
  expect(consumed).toEqual([...largeIds, missing, tombstone]);
  expect(windows).toHaveLength(4);
  expect(windows.every(statement => /fx_read_snapshot_rows/i.test(statement))).toBe(true);
  let settlementMissing = 0;
  await runEffect(consumeAppRowSnapshotRevisionsInTransactionEffect(tx,
    { ...selected, rowIds: boundedMissing.slice(0, 32) }, cause => cause,
    () => Effect.sync(() => { settlementMissing++; })));
  expect(settlementMissing).toBe(32);
  expect(await runEffect(Effect.result(consumeAppRowSnapshotRevisionsInTransactionEffect(tx,
    { ...selected, rowIds: boundedMissing.slice(0, 33) }, cause => cause, () => Effect.void))))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidAppRowReadInputError" } });
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
  expect(await runEffect(Effect.result(consumeAppRowSnapshotRevisionsInTransactionEffect<ReadAppRowError | "firstRefusal", never>(tx,
    { ...selected, rowIds: [live, corrupt] }, cause => cause, () => Effect.fail("firstRefusal" as const)))))
    .toEqual(Result.fail("firstRefusal"));
  expect(await runEffect(Effect.result(consumeAppRowSnapshotRevisionsInTransactionEffect(tx,
    { ...selected, rowIds: [corrupt, live] }, cause => cause, () => Effect.void))))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "AppRowStorageCorruptionError" } });

  await tx.update(fxSystemScopeClocks).set({ lastCommitSeq: CommitSeqSchema.make(3n) })
    .where(eq(fxSystemScopeClocks.scopeId, scopeId));
  const targetInput = { scopeId, tableId, rowIds: [missing, corrupt],
    minimumCommitSeq: CommitSeqSchema.make(3n), pendingCommitSeq: CommitSeqSchema.make(4n) };
  expect(await runEffect(Effect.result(withPublicationAppRowTargetsInTransactionEffect<never, ReadAppRowError | "targetNotLive", never>(tx, targetInput,
    cause => cause, read => Effect.gen(function* () {
      expect(yield* read(0)).toBeNull();
      return yield* Effect.fail("targetNotLive" as const);
    }))))).toEqual(Result.fail("targetNotLive"));
  expect(await runEffect(Effect.result(withPublicationAppRowTargetsInTransactionEffect<never, ReadAppRowError | "targetNotLive", never>(tx,
    { ...targetInput, rowIds: [missing, largeIds[0]!] }, cause => cause, read => Effect.gen(function* () {
      expect(yield* read(0)).toBeNull();
      return yield* Effect.fail("targetNotLive" as const);
    }))))).toEqual(Result.fail("targetNotLive"));
  expect(await runEffect(Effect.result(withPublicationAppRowTargetsInTransactionEffect(tx,
    { ...targetInput, rowIds: [largeIds[0]!, missing] }, cause => cause, read => read(0)))))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidAppRowReadInputError" } });
  expect(await runEffect(Effect.result(withPublicationAppRowTargetsInTransactionEffect(tx,
    { ...targetInput, rowIds: [corrupt, missing] }, cause => cause, read => read(0)))))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "AppRowStorageCorruptionError" } });
  let retained: ((ordinal: number) => Effect.Effect<unknown, ReadAppRowError>) | undefined;
  await runEffect(withPublicationAppRowTargetsInTransactionEffect(tx, { ...targetInput, rowIds: [missing] },
    cause => cause, read => { retained = read; return Effect.void; }));
  if (retained === undefined) throw new Error("Missing closed publication target reader");
  expect(await runEffect(Effect.result(retained(0))))
    .toMatchObject({ _tag: "Failure", failure: { _tag: "InvalidAppRowReadInputError" } });

}
