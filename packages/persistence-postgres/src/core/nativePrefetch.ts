/** Trusted owners only: overlap the first slot reads of complete rows that will be
 * inserted next, or of independent finds about to run in order. The seam is keyed by
 * an issued native facade; it is not part of CoreNativeOperations, so adapters cannot
 * reach it. A framework host that holds the facade may forward the finds and the rows
 * of one graph insert its adapter announces (divergences/native-read-batches.md). */
import { Effect } from "effect";
import type { JsonObject } from "flarex-protocol/json";
import type { CoreNativeOperations } from "./api";

/** Any issued native facade; every one carries the ordered find this seam precedes. */
type IssuedNativeFacade = Pick<CoreNativeOperations, "find">;

export type CoreNativeInsertGroups = readonly Readonly<{ tableName: string; rows: readonly JsonObject[] }>[];
/** One native find exactly as `CoreNativeOperations.find` receives it. */
export type CoreNativeAnnouncedFind = Readonly<{ tableName: string; where: JsonObject }>;
/** What a trusted owner knows it will read next: finds in any order, then the complete
 * rows of one graph insert in table insert order. */
export type CoreNativeAnnouncement = Readonly<{ finds?: readonly CoreNativeAnnouncedFind[]; inserts?: CoreNativeInsertGroups }>;
export interface CoreNativePrefetcher {
  readonly inserts: (groups: CoreNativeInsertGroups) => Effect.Effect<void>;
  readonly plan: (announcement: CoreNativeAnnouncement) => Effect.Effect<void>;
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
/** One call per batch of independent finds on the same issued facade. A read batch:
 * it replaces the previous batch's unconsumed pages and keeps an announcement's. */
export const prefetchCoreNativeFindSlots = (operations: IssuedNativeFacade, tableName: string, wheres: readonly JsonObject[]) =>
  prefetchers.get(operations)?.finds(tableName, wheres) ?? Effect.void;

/** One announcement plans at most this many graph insert slots, whole tables in insert
 * order and counted before duplicates are removed. */
export const CORE_NATIVE_INSERT_GRAPH_SLOTS = 1024;
/** One announcement plans at most this many finds, in announced order. */
export const CORE_NATIVE_ANNOUNCED_FINDS = 256;
/** All announcements of one transaction together plan at most this many slots, finds included. */
export const CORE_NATIVE_INSERT_GRAPH_TRANSACTION_SLOTS = 4 * CORE_NATIVE_INSERT_GRAPH_SLOTS;
/** One call for what follows next: native finds, and the complete rows of one graph
 * insert in table insert order before its ordered table inserts. Every planned slot is
 * read in one batch. An announcement past a bound is truncated at the first item that
 * does not fit, never refused. The pages replace any earlier announcement's, except
 * the held page of a find announced again, which is kept and neither read nor counted
 * a second time. They stay across read batches and covered table inserts; a write to
 * a find's table drops that find's page, and any other write batch drops them all. */
export const planCoreNativeSlots = (operations: IssuedNativeFacade, announcement: CoreNativeAnnouncement) =>
  prefetchers.get(operations)?.plan(announcement) ?? Effect.void;
