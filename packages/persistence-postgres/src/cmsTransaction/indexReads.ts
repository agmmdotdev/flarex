import { Effect } from "effect";
import type { ScopeId } from "flarex-protocol/storage-authority";
import type { OrderedIndexBoundsV1 } from "flarex-protocol/ordered-index";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import { scanCurrentAppIndexInTransactionEffect, AppIndexEntryReadPersistenceError, AppIndexEntryHashError,
  type AppIndexRangeEntryV1, type AppIndexEntryTransaction } from "../appIndexEntries";
import { cmsError, cmsLimits } from "./model";

export interface CmsIndexRead {
  readonly definition: LocatedAppIndexDefinitionV1;
  readonly bounds: OrderedIndexBoundsV1;
  readonly entries: readonly AppIndexRangeEntryV1[];
}

/** Complete bounded membership, shared by request capture and settlement. */
export const readCmsIndexRange = Effect.fn("CmsIndex.readRange")(function* (
  tx: AppIndexEntryTransaction, scopeId: ScopeId,
  selection: Pick<CmsIndexRead, "definition" | "bounds">,
  observer?: Parameters<typeof scanCurrentAppIndexInTransactionEffect>[2],
) {
  const page = yield* scanCurrentAppIndexInTransactionEffect(tx, { scopeId, ...selection, limit: cmsLimits.identities }, observer)
    .pipe(Effect.mapError(cause => cmsError(cause instanceof AppIndexEntryReadPersistenceError ? "statementFailure" :
      cause instanceof AppIndexEntryHashError ? "resourceFailure" : "storedCorruption", cause)));
  if (!page.isDone) return yield* Effect.fail(cmsError("limitExceeded"));
  return page.entries;
});

export const sameCmsIndexMembership = (left: readonly AppIndexRangeEntryV1[], right: readonly AppIndexRangeEntryV1[]): boolean =>
  left.length === right.length && left.every((entry, position) => {
    const other = right[position];
    return other !== undefined && entry.tableId === other.tableId && entry.rowId === other.rowId &&
      entry.encodedKey === other.encodedKey && entry.commitSeq === other.commitSeq;
  });
