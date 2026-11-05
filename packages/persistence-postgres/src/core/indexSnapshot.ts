/**
 * Operation index coverage translated from Convex crates/indexing/src/database_index_snapshot.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Effect, Exit, Result } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { incrementIndexKeyPrefix, indexRangeIsEmpty, splitIndexRangeAfter } from "flarex-protocol/index-range";
import { CoreTransactionError, type CoreError, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreHydratedIndexEntry, type CoreIndexPage, type CoreIndexScan,
  type CoreInterval, type CorePersistenceSnapshot } from "./contracts";
import { captureCoreDocument } from "./document";
import { documentIndexKey } from "./documentIndex";
import { CoreRegistry, INDEXES, readDocumentObject } from "./registry";
import { isCoreSystemTable } from "./nativeTableAccess";
import { CoreReadSetBuilder, copyInterval } from "./writeLog";

interface IndexDocuments {
  readonly documents: BTree<Uint8Array, CoreHydratedIndexEntry>;
  readonly intervals: CoreReadSetBuilder;
}

type CacheComponent = Readonly<{ kind: "document"; entry: CoreHydratedIndexEntry }>
  | Readonly<{ kind: "miss"; interval: CoreInterval }>;

export interface CoreIndexSnapshot {
  readonly timestamp: bigint;
  readonly scan: (request: CoreIndexScan) => Effect.Effect<CoreIndexPage, CoreError>;
}

/** The operation snapshot owner, which also serves independent range batches. */
export interface CoreBatchIndexSnapshot extends CoreIndexSnapshot {
  /** db914cf06 database_index_snapshot.rs::range_batch: independent requests are
   * fetched concurrently and each keeps its own outcome in input order. Cache
   * population runs serially after every fetch has settled. */
  readonly rangeBatch: (requests: readonly CoreIndexScan[], options: CoreIndexRangeBatchOptions)
    => Effect.Effect<readonly Exit.Exit<CoreIndexPage, CoreError>[]>;
}

export interface CoreIndexRangeBatchOptions {
  /** Source uses buffer_unordered(20); hosts supply their own connection bound. */
  readonly concurrency: number;
  /** Shared admission for each request's persistence fetch, e.g. a database-wide bound. */
  readonly withPermit?: <A, E>(fetch: Effect.Effect<A, E>) => Effect.Effect<A, E>;
}

const MAX_CACHED_RANGES_PER_INTERVAL = 3;
const REFERENCE_OPERATION_CACHE_BYTES = 16 * 1024 * 1024;
const boundedInterval = (interval: CoreInterval) => ({ start: interval.start ?? new Uint8Array(), end: interval.end });
const emptyPage = (): CoreIndexPage => Object.freeze({ entries: Object.freeze([]), cursor: Object.freeze({ kind: "end" }) });

function copyEntry(entry: CoreHydratedIndexEntry): CoreHydratedIndexEntry {
  const document = entry.document;
  return Object.freeze({ key: entry.key.slice(), document: Object.freeze({ ...document,
    tableId: document.tableId.slice(), id: document.id.slice(), jsonValue: document.jsonValue.slice() }) });
}

function maximumStart(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  return a === null ? b : b === null ? a : compareBytesLexicographically(a, b) >= 0 ? a : b;
}

function minimumEnd(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  return a === null ? b : b === null ? a : compareBytesLexicographically(a, b) <= 0 ? a : b;
}

/** One operation's coverage. This never records user dependencies or charges user reads. */
export function createCoreIndexSnapshot(input: Readonly<{
  snapshot: CorePersistenceSnapshot;
  registry: CoreRegistry;
  resident?: (request: CoreIndexScan) => CoreIndexPage | undefined;
  maxBytes?: number;
}>): CoreBatchIndexSnapshot {
  const indexes = new Map<string, IndexDocuments>();
  const maxBytes = input.maxBytes ?? REFERENCE_OPERATION_CACHE_BYTES;
  let cacheBytes = 0;

  function indexDocuments(indexId: Uint8Array): IndexDocuments {
    const identity = encodeBytesToLowercaseHex(indexId);
    let docs = indexes.get(identity);
    if (docs === undefined) {
      docs = { documents: new BTree(undefined, compareBytesLexicographically), intervals: new CoreReadSetBuilder() };
      indexes.set(identity, docs);
    }
    return docs;
  }

  function components(request: CoreIndexScan): readonly CacheComponent[] {
    const cached = indexes.get(encodeBytesToLowercaseHex(request.index.id));
    if (cached === undefined) return [{ kind: "miss", interval: copyInterval(request.interval) }];
    const results: CacheComponent[] = [];
    let start = request.interval.start;
    let cachedRanges = 0;
    let complete = false;
    // Source chooses the first three populated components in ascending key
    // order, then reverses the resulting components for a descending request.
    for (const covered of cached.intervals.snapshot()[0]?.intervals ?? []) {
      const overlap = { start: maximumStart(start, covered.start), end: minimumEnd(request.interval.end, covered.end) };
      if (indexRangeIsEmpty(boundedInterval(overlap))) continue;
      if (cachedRanges >= MAX_CACHED_RANGES_PER_INTERVAL) break;
      if (overlap.start !== null && (start === null || compareBytesLexicographically(start, overlap.start) < 0))
        results.push({ kind: "miss", interval: copyInterval({ start, end: overlap.start }) });
      for (const [key, entry] of cached.documents.entries(overlap.start ?? undefined)) {
        if (overlap.end !== null && compareBytesLexicographically(key, overlap.end) >= 0) break;
        results.push({ kind: "document", entry });
      }
      cachedRanges += 1;
      start = overlap.end;
      if (start === null || (request.interval.end !== null && compareBytesLexicographically(start, request.interval.end) >= 0)) {
        complete = true;
        break;
      }
    }
    if (!complete) {
      const remaining = { start, end: request.interval.end };
      if (!indexRangeIsEmpty(boundedInterval(remaining))) results.push({ kind: "miss", interval: copyInterval(remaining) });
    }
    return request.order === "asc" ? results : results.toReversed();
  }

  function populate(indexId: Uint8Array, table: CoreTableDefinition,
    entries: readonly CoreHydratedIndexEntry[], interval: CoreInterval): Result.Result<void, CoreError> {
    return Result.gen(function* () {
      for (const entry of entries) {
        const document = yield* readDocumentObject(entry.document, table);
        const measured = yield* Result.mapError(captureCoreDocument(document, isCoreSystemTable(table)),
          cause => new CorePersistenceError({ reason: "corruptData", cause }));
        // Keep a single immutable document revision shared by its secondary
        // keys. The source charges document value size only through ById.
        const owned = copyEntry(entry).document;
        for (const index of table.indexes) {
          if (cacheBytes > maxBytes) continue;
          if (index.name === "by_id") cacheBytes += measured.semanticSizeBytes;
          const key = yield* documentIndexKey(index, measured.value);
          const docs = indexDocuments(index.ref.id);
          docs.documents.set(key, Object.freeze({ key, document: owned }));
          docs.intervals.add(index.ref.id, { start: key.slice(), end: incrementIndexKeyPrefix(key) });
        }
      }
      // Full coverage is certified only after every fetched row was stored.
      // One body may push the source budget over its limit; do not certify the
      // whole fetched interval once that happens.
      if (cacheBytes <= maxBytes) indexDocuments(indexId).intervals.add(indexId, interval);
    });
  }

  /** The concurrent half of a range read: cached components plus persistence
   * misses, without mutating this operation cache. */
  const fetch = Effect.fnUntraced(function* (request: CoreIndexScan, withPermit: CoreIndexRangeBatchOptions["withPermit"]) {
    const selected = input.registry.tableByTablet(request.tableId);
    const index = selected?.definition.indexes.find(candidate => bytesEqual(candidate.ref.id, request.index.id));
    if (selected === undefined || index === undefined) {
      // An index created by the current transaction has no committed rows in
      // its starting registry. The bootstrap _index index must always exist.
      if (selected?.definition.name === INDEXES) return yield* new CorePersistenceError({ reason: "corruptData" });
      return { page: emptyPage() };
    }
    if (index.ref.persistenceIndexId !== request.index.persistenceIndexId)
      return yield* new CorePersistenceError({ reason: "corruptData" });
    if (!Number.isSafeInteger(request.maxResults) || request.maxResults <= 0)
      return yield* new CoreTransactionError({ reason: "invalidValue" });
    if (indexRangeIsEmpty(boundedInterval(request.interval))) return { page: emptyPage() };
    const resident = input.resident?.(request);
    if (resident !== undefined) return { page: resident };
    const results: CoreHydratedIndexEntry[] = [];
    const misses: CoreHydratedIndexEntry[] = [];
    let cursor: CoreIndexPage["cursor"] = Object.freeze({ kind: "end" });
    for (const component of components(request)) {
      if (component.kind === "document") results.push(component.entry);
      else {
        const missRequest = { ...request, interval: component.interval };
        const page = yield* (withPermit === undefined ? input.snapshot.scan(missRequest) : withPermit(input.snapshot.scan(missRequest)));
        results.push(...page.entries);
        misses.push(...page.entries);
        if (page.cursor.kind !== "end") {
          cursor = page.cursor;
          break;
        }
      }
      if (results.length >= request.maxResults) {
        const last = results.at(-1);
        if (last !== undefined) cursor = Object.freeze({ kind: "after", key: last.key.slice() });
        break;
      }
    }
    const observed = cursor.kind === "end" ? request.interval
      : splitIndexRangeAfter(boundedInterval(request.interval), cursor.key, request.order).observed;
    const page: CoreIndexPage = Object.freeze({ entries: Object.freeze(results.map(copyEntry)), cursor: cursor.kind === "end"
      ? Object.freeze({ kind: "end" as const }) : Object.freeze({ kind: "after" as const, key: cursor.key.slice() }) });
    return { page, fill: { indexId: request.index.id, table: selected.definition, misses, observed } };
  });
  type Fetched = Effect.Success<ReturnType<typeof fetch>>;
  const fill = (fetched: Fetched) => fetched.fill === undefined ? Result.succeed(fetched.page)
    : Result.map(populate(fetched.fill.indexId, fetched.fill.table, fetched.fill.misses, fetched.fill.observed), () => fetched.page);

  const scan = Effect.fnUntraced(function* (request: CoreIndexScan) {
    return yield* Effect.fromResult(fill(yield* fetch(request, undefined)));
  }, effect => Effect.withSpan(effect, "CoreIndexSnapshot.scan", { captureStackTrace: false }));

  const rangeBatch: CoreBatchIndexSnapshot["rangeBatch"] = Effect.fn("CoreIndexSnapshot.rangeBatch")(function* (requests, options) {
    const fetched = yield* Effect.forEach(requests, request => Effect.exit(fetch(request, options.withPermit)),
      { concurrency: Math.max(1, options.concurrency) });
    // Source fills the cache only after the concurrent phase; a failed slot
    // contributes nothing and does not affect any other slot.
    return fetched.map((outcome): Exit.Exit<CoreIndexPage, CoreError> => Exit.isSuccess(outcome)
      ? Result.match(fill(outcome.value), { onFailure: error => Exit.fail(error), onSuccess: page => Exit.succeed(page) })
      : Exit.failCause(outcome.cause));
  });

  return Object.freeze({ timestamp: input.snapshot.timestamp, scan, rangeBatch });
}
