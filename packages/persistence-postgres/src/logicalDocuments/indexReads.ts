import { Effect } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { OrderedIndexBoundsV1 } from "flarex-protocol/ordered-index";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { scanCurrentAppIndexInTransactionEffect, AppIndexEntryReadPersistenceError, AppIndexEntryHashError,
  MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, type AppIndexRangeEntryV1, type AppIndexEntryTransaction,
  type AppIndexRangeCursorV1 } from "../appIndexEntries";
import type { LogicalDocumentFailure } from "./model";

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
) {
  return yield* scanCurrentAppIndexInTransactionEffect(tx, { scopeId, ...selection, limit }, observer)
    .pipe(Effect.mapError(cause => error(cause instanceof AppIndexEntryReadPersistenceError ? "statementFailure" :
      cause instanceof AppIndexEntryHashError ? "resourceFailure" : "storedCorruption", cause)));
});

/** Complete bounded membership, shared by request capture and settlement. */
export const readLogicalIndexRange = Effect.fn("LogicalDocuments.readIndexRange")(function* <Failure>(
  tx: AppIndexEntryTransaction, scopeId: ScopeId,
  selection: Pick<LogicalIndexRead, "definition" | "bounds">,
  limit: number, error: LogicalDocumentFailure<Failure>,
  observer?: Parameters<typeof scanCurrentAppIndexInTransactionEffect>[2],
) {
  if (!Number.isSafeInteger(limit) || limit < 1) return yield* Effect.fail(error("invalidInput"));
  const entries: AppIndexRangeEntryV1[] = [];
  let after: AppIndexRangeCursorV1 | undefined;
  while (true) {
    const page = yield* readLogicalIndexPage(tx, scopeId,
      { ...selection, ...(after === undefined ? {} : { after }) },
      Math.min(MAX_APP_INDEX_RANGE_PAGE_SIZE_V1, limit - entries.length), error, observer);
    entries.push(...page.entries);
    if (page.isDone) return Object.freeze(entries);
    if (entries.length >= limit) return yield* Effect.fail(error("limitExceeded"));
    if (page.continueCursor === null) return yield* Effect.fail(error("storedCorruption"));
    after = page.continueCursor;
  }
});

export const sameLogicalIndexMembership = (left: readonly AppIndexRangeEntryV1[], right: readonly AppIndexRangeEntryV1[]): boolean =>
  left.length === right.length && left.every((entry, position) => {
    const other = right[position];
    return other !== undefined && entry.tableId === other.tableId && entry.rowId === other.rowId &&
      entry.encodedKey === other.encodedKey && entry.commitSeq === other.commitSeq;
  });
