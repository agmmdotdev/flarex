/** Trusted owners only: overlap the first slot reads of complete rows that will be
 * inserted next, or of independent finds about to run in order. The seam is keyed by
 * an issued native facade; it is not part of CoreNativeOperations, so adapters cannot
 * reach it. A framework host that holds the facade may forward the rows of one graph
 * insert its adapter announces (divergences/native-read-batches.md). */
import { Effect } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import type { CoreNativeOperations } from "./api";

/** Any issued native facade; every one carries the ordered find this seam precedes. */
type IssuedNativeFacade = Pick<CoreNativeOperations, "find">;

export type CoreNativeInsertGroups = readonly Readonly<{ tableName: string; rows: readonly JsonObject[] }>[];
export interface CoreNativePrefetcher {
  readonly inserts: (groups: CoreNativeInsertGroups) => Effect.Effect<void>;
  readonly graphInserts: (groups: CoreNativeInsertGroups) => Effect.Effect<void>;
  readonly finds: (tableName: string, wheres: readonly JsonObject[]) => Effect.Effect<void>;
}
const prefetchers = new WeakMap<IssuedNativeFacade, CoreNativePrefetcher>();

/** Called only by the transaction owner that issued this facade. */
export const registerCoreNativePrefetcher = (issued: IssuedNativeFacade, prefetcher: CoreNativePrefetcher) => {
  prefetchers.set(issued, prefetcher);
};
/** One call per batch: it replaces any earlier batch's unconsumed prefetches. */
export const prefetchCoreNativeInsertSlots = (operations: IssuedNativeFacade, groups: CoreNativeInsertGroups) =>
  prefetchers.get(operations)?.inserts(groups) ?? Effect.void;
/** One call per batch of independent finds on the same issued facade. */
export const prefetchCoreNativeFindSlots = (operations: IssuedNativeFacade, tableName: string, wheres: readonly JsonObject[]) =>
  prefetchers.get(operations)?.finds(tableName, wheres) ?? Effect.void;

/** One graph insert plans at most this many slots, whole tables in insert order and
 * counted before duplicates are removed. */
export const CORE_NATIVE_INSERT_GRAPH_SLOTS = 1024;
/** All graph inserts of one transaction together plan at most this many slots. */
export const CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS = 4 * CORE_NATIVE_INSERT_GRAPH_SLOTS;
/** One call for the complete rows of one graph insert, in table insert order, before
 * the ordered table inserts that follow it. Covered tables keep these pages across
 * their own inserts; any other batch call replaces them. */
export const prefetchCoreNativeGraphInsertSlots = (operations: IssuedNativeFacade, groups: CoreNativeInsertGroups) =>
  prefetchers.get(operations)?.graphInserts(groups) ?? Effect.void;
