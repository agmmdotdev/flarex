import { Effect } from "effect";
import type { CommitSeq, ScopeId } from "flarex-protocol/storage-authority";
import type { OrderedIndexBoundsV1 } from "flarex-protocol/ordered-index";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { consumeCurrentAppIndexPagesInTransactionEffect, scanAppIndexAtSnapshotInTransactionEffect, scanCurrentAppIndexInTransactionEffect, AppIndexEntryReadPersistenceError, AppIndexEntryHashError,
  MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, type AppIndexRangeEntryV1, type AppIndexEntryTransaction,
  type AppIndexRangeCursorV1, type AppIndexRangePageV1 } from "../appIndexEntries";
import type { LogicalDocumentFailure, LogicalDocumentFailureReason } from "./model";

export const logicalIndexReadFailureReason = (cause: unknown): LogicalDocumentFailureReason =>
  cause instanceof AppIndexEntryReadPersistenceError ? "statementFailure" :
    cause instanceof AppIndexEntryHashError ? "resourceFailure" : "storedCorruption";

export interface LogicalIndexRead {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly bounds: OrderedIndexBoundsV1;
  readonly entries: readonly AppIndexRangeEntryV1[];
}
/** An examined keyset window, including its negative interval and EOF proof. */
export interface LogicalIndexPageRead extends LogicalIndexRead {
  readonly after?: AppIndexRangeCursorV1;
  readonly isDone: boolean;
}

export const readLogicalIndexPage = Effect.fn("LogicalDocuments.readIndexPage")(function* <Failure>(
  tx: AppIndexEntryTransaction, scopeId: ScopeId,
  selection: Pick<LogicalIndexPageRead, "definition" | "bounds" | "after">,
  limit: number, error: LogicalDocumentFailure<Failure>,
  observer?: Parameters<typeof scanCurrentAppIndexInTransactionEffect>[2],
  snapshotCommitSeq?: CommitSeq,
) {
  return yield* (snapshotCommitSeq === undefined
    ? scanCurrentAppIndexInTransactionEffect(tx, { scopeId, ...selection, limit }, observer)
    : scanAppIndexAtSnapshotInTransactionEffect(tx, { scopeId, ...selection, limit, snapshotCommitSeq }, observer))
    .pipe(Effect.mapError(cause => error(logicalIndexReadFailureReason(cause), cause)));
});

/** Complete bounded membership, shared by request capture and settlement. */
export const readLogicalIndexRange = Effect.fn("LogicalDocuments.readIndexRange")(function* <Failure>(
  tx: AppIndexEntryTransaction, scopeId: ScopeId,
  selection: Pick<LogicalIndexRead, "definition" | "bounds">,
  limit: number, error: LogicalDocumentFailure<Failure>,
  observer?: Parameters<typeof scanCurrentAppIndexInTransactionEffect>[2],
  snapshotCommitSeq?: CommitSeq,
) {
  if (!Number.isSafeInteger(limit) || limit < 1) return yield* Effect.fail(error("invalidInput"));
  const entries: AppIndexRangeEntryV1[] = [];
  let after: AppIndexRangeCursorV1 | undefined;
  while (true) {
    const page = yield* readLogicalIndexPage(tx, scopeId,
      { ...selection, ...(after === undefined ? {} : { after }) },
      Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, limit - entries.length), error, observer, snapshotCommitSeq);
    entries.push(...page.entries);
    if (page.isDone) return Object.freeze(entries);
    if (entries.length >= limit) return yield* Effect.fail(error("limitExceeded"));
    if (page.continueCursor === null) return yield* Effect.fail(error("storedCorruption"));
    after = page.continueCursor;
  }
});

/** Initial small predicates share the existing bounded page command. Complete
 * each ordinal, including its overflow/corruption verdict, before comparison. */
export const consumeLogicalIndexRanges = Effect.fn("LogicalDocuments.consumeIndexRanges")(function* <Failure, Requirements>(
  tx: AppIndexEntryTransaction, scopeId: ScopeId, reads: readonly LogicalIndexRead[],
  maximumEntries: number, error: LogicalDocumentFailure<Failure>,
  consume: (ordinal: number, entries: readonly AppIndexRangeEntryV1[]) => Effect.Effect<void, Failure, Requirements>,
) {
  if (reads.length === 0) return;
  if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) return yield* Effect.fail(error("invalidInput"));
  yield* consumeCurrentAppIndexPagesInTransactionEffect(tx, reads.map(read => ({ scopeId,
    definition: read.definition, bounds: read.bounds,
    limit: Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, maximumEntries, Math.max(1, read.entries.length + 1)),
  })), cause => error(logicalIndexReadFailureReason(cause), cause), (ordinal, first) => Effect.gen(function* () {
    const read = reads[ordinal];
    if (read === undefined) return yield* Effect.die(new Error("Logical range batch lost an ordinal"));
    const entries = [...first.entries];
    let page = first;
    while (!page.isDone) {
      if (entries.length >= maximumEntries) return yield* Effect.fail(error("limitExceeded"));
      if (page.continueCursor === null) return yield* Effect.fail(error("storedCorruption"));
      page = yield* readLogicalIndexPage(tx, scopeId,
        { definition: read.definition, bounds: read.bounds, after: page.continueCursor },
        Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, maximumEntries - entries.length), error);
      entries.push(...page.entries);
    }
    yield* consume(ordinal, Object.freeze(entries));
  }));
});

/** Page observations retain their examined keyset cursor and EOF obligation. */
export const consumeLogicalIndexPages = Effect.fn("LogicalDocuments.consumeIndexPages")(function* <Failure, Requirements>(
  tx: AppIndexEntryTransaction, scopeId: ScopeId, reads: readonly LogicalIndexPageRead[],
  error: LogicalDocumentFailure<Failure>,
  consume: (ordinal: number, page: AppIndexRangePageV1) => Effect.Effect<void, Failure, Requirements>,
) {
  yield* consumeCurrentAppIndexPagesInTransactionEffect(tx, reads.map(read => ({ scopeId,
    definition: read.definition, bounds: read.bounds, limit: Math.max(1, read.entries.length),
    ...(read.after === undefined ? {} : { after: read.after }),
  })), cause => error(logicalIndexReadFailureReason(cause), cause), consume);
});

export const sameLogicalIndexMembership = (left: readonly AppIndexRangeEntryV1[], right: readonly AppIndexRangeEntryV1[]): boolean =>
  left.length === right.length && left.every((entry, position) => {
    const other = right[position];
    return other !== undefined && entry.tableId === other.tableId && entry.rowId === other.rowId &&
      entry.encodedKey === other.encodedKey && entry.commitSeq === other.commitSeq;
  });
