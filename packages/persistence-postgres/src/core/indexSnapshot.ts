/**
 * Operation index coverage translated from Convex crates/indexing/src/database_index_snapshot.rs
 * at db914cf06e2b06ee985646611b9e12ed7a770318. Upstream source:
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { Cause, Effect, Exit, Result } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import { incrementIndexKeyPrefix, indexRangeIsEmpty, splitIndexRangeAfter } from "flarex-protocol/index-range";
import { CoreTransactionError, type CoreError, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreHydratedIndexEntry, type CoreIndexPage, type CoreIndexScan,
  type CoreInterval, type CorePersistenceSnapshot } from "./contracts";
import { captureCoreDocument } from "./document";
import { documentIndexKey } from "./documentIndex";
import { CoreRegistry, INDEXES, readDocumentObject } from "./registry";
import { isCoreSystemTable } from "./nativeTableAccess";
import { CoreIntervalSet, copyInterval } from "./writeLog";

/** What a fill admitted to one index, kept in fill order until that index is read. */
type PendingCoverage = Readonly<{ kind: "document"; value: DocumentObject; stored: CoreDocumentLogEntry }>
  | Readonly<{ kind: "interval"; interval: CoreInterval }>;

interface IndexDocuments {
  readonly fields: CoreIndexDefinition["fields"];
  readonly documents: BTree<Uint8Array, CoreHydratedIndexEntry>;
  readonly intervals: CoreIntervalSet;
  pending: PendingCoverage[];
}
type CachedIndex = Pick<CoreIndexDefinition, "fields" | "ref">;

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

function copyDocument(document: CoreDocumentLogEntry): CoreDocumentLogEntry {
  return Object.freeze({ ...document,
    tableId: document.tableId.slice(), id: document.id.slice(), jsonValue: document.jsonValue.slice() });
}

function copyEntry(entry: CoreHydratedIndexEntry): CoreHydratedIndexEntry {
  return Object.freeze({ key: entry.key.slice(), document: copyDocument(entry.document) });
}

/** Every full key ends with the developer ID, the only part whose encoding can
 * refuse for a captured document. A fill proves it once with this key. */
const DEVELOPER_ID_KEY: Pick<CoreIndexDefinition, "fields"> = Object.freeze({ fields: Object.freeze([]) });

/** Stores one admitted row or certified interval in its index. */
function cover(docs: IndexDocuments, admitted: PendingCoverage): Result.Result<void, CoreError> {
  if (admitted.kind === "interval") {
    docs.intervals.addOwned(admitted.interval);
    return Result.succeed(undefined);
  }
  return Result.map(documentIndexKey(docs, admitted.value), key => {
    docs.documents.set(key, Object.freeze({ key, document: admitted.stored }));
    // The key is never written after this point, so the interval may share it.
    docs.intervals.addOwned({ start: key, end: incrementIndexKeyPrefix(key) });
  });
}

/** Applies what fills left pending for one index, in fill order, so its
 * reader sees exactly the coverage an immediate fill would have built. An
 * index nobody reads derives no keys. */
function settle(docs: IndexDocuments): Result.Result<void, CoreError> {
  if (docs.pending.length === 0) return Result.succeed(undefined);
  const pending = docs.pending;
  docs.pending = [];
  for (const [position, admitted] of pending.entries()) {
    const covered = cover(docs, admitted);
    // A plain guard: this loop runs per pending row and a failure needs its position.
    if (Result.isFailure(covered)) {
      // The fill proved this row's developer ID, so no key can refuse. Keep
      // the rest pending: the same failure then answers every later read.
      docs.pending = pending.slice(position);
      return covered;
    }
  }
  return Result.succeed(undefined);
}

function maximumStart(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  return a === null ? b : b === null ? a : compareBytesLexicographically(a, b) >= 0 ? a : b;
}

function minimumEnd(a: Uint8Array | null, b: Uint8Array | null): Uint8Array | null {
  return a === null ? b : b === null ? a : compareBytesLexicographically(a, b) <= 0 ? a : b;
}

/** A preload only moves first pages into one statement. A typed failure drops the
 * batch and leaves each ordinary scan to report its own outcome, in its own order. */
export const advisoryPreload = Effect.fnUntraced(function* <E, R>(preload: Effect.Effect<void, E, R>): Effect.fn.Return<void, never, R> {
  const preloaded = yield* Effect.exit(preload);
  const propagated = Exit.isFailure(preloaded) ? preloaded.cause.reasons.filter((reason): reason is Cause.Die | Cause.Interrupt =>
    Cause.isDieReason(reason) || Cause.isInterruptReason(reason)) : [];
  if (propagated.length > 0) return yield* Effect.failCause(Cause.fromReasons<never>(propagated));
});

/** Hands each document a fill decoded to the one observation that reads the
 * same stored revision next, so a fetched row is decoded once. A handed
 * document leaves this owner: a later observation of that row decodes again,
 * exactly as it does without a handoff. Byte-identical stored JSON and the
 * same expected table are required, so a handed document is what a fresh
 * decode would return. Only the most recent offers are kept, within a small
 * window of stored bytes of its own: a reader takes right after its fill, and
 * offers no reader takes must not accumulate for the transaction. */
const DECODED_HANDOFF_BYTES = 1024 * 1024;
export class CoreDecodedDocumentHandoff {
  private readonly offered = new Map<string, Readonly<{ entry: CoreDocumentLogEntry;
    table: Pick<CoreTableDefinition, "number" | "tabletId">; document: DocumentObject }>>();
  private bytes = 0;
  private readonly maxBytes: number;
  constructor(maxBytes: number = DECODED_HANDOFF_BYTES) { this.maxBytes = Math.min(maxBytes, DECODED_HANDOFF_BYTES); }

  offer(entry: CoreDocumentLogEntry, table: Pick<CoreTableDefinition, "number" | "tabletId">, document: DocumentObject): void {
    const revision = revisionKey(entry);
    this.withdraw(revision);
    if (entry.jsonValue.byteLength > this.maxBytes) return;
    this.offered.set(revision, { entry, table, document });
    this.bytes += entry.jsonValue.byteLength;
    for (const oldest of this.offered.keys()) {
      if (this.bytes <= this.maxBytes) break;
      this.withdraw(oldest);
    }
  }

  take(entry: CoreDocumentLogEntry, table: Pick<CoreTableDefinition, "number" | "tabletId">): DocumentObject | undefined {
    const revision = revisionKey(entry);
    const offer = this.offered.get(revision);
    if (offer === undefined) return undefined;
    this.withdraw(revision);
    return offer.table.number === table.number && bytesEqual(offer.table.tabletId, table.tabletId)
      && bytesEqual(offer.entry.tableId, entry.tableId) && bytesEqual(offer.entry.jsonValue, entry.jsonValue)
      ? offer.document : undefined;
  }

  private withdraw(revision: string): void {
    const offer = this.offered.get(revision);
    if (offer === undefined) return;
    this.offered.delete(revision);
    this.bytes -= offer.entry.jsonValue.byteLength;
  }
}
const revisionKey = (entry: CoreDocumentLogEntry) => `${encodeBytesToLowercaseHex(entry.id)}:${entry.ts}`;

/** One operation's coverage. This never records user dependencies or charges user reads. */
export function createCoreIndexSnapshot(input: Readonly<{
  snapshot: CorePersistenceSnapshot;
  registry: CoreRegistry;
  resident?: (request: CoreIndexScan) => CoreIndexPage | undefined;
  maxBytes?: number;
  decoded?: CoreDecodedDocumentHandoff;
}>): CoreBatchIndexSnapshot {
  const indexes = new Map<string, IndexDocuments>();
  const maxBytes = input.maxBytes ?? REFERENCE_OPERATION_CACHE_BYTES;
  let cacheBytes = 0;

  function indexDocuments(index: CachedIndex): IndexDocuments {
    const identity = encodeBytesToLowercaseHex(index.ref.id);
    let docs = indexes.get(identity);
    if (docs === undefined) {
      docs = { fields: index.fields, documents: new BTree(undefined, compareBytesLexicographically),
        intervals: new CoreIntervalSet(), pending: [] };
      indexes.set(identity, docs);
    }
    return docs;
  }

  /** The only reader of index coverage. */
  function components(request: CoreIndexScan): Result.Result<readonly CacheComponent[], CoreError> {
    const cached = indexes.get(encodeBytesToLowercaseHex(request.index.id));
    return Result.map(cached === undefined ? Result.succeed(undefined) : settle(cached), () => cachedComponents(cached, request));
  }

  function cachedComponents(cached: IndexDocuments | undefined, request: CoreIndexScan): readonly CacheComponent[] {
    if (cached === undefined) return [{ kind: "miss", interval: copyInterval(request.interval) }];
    const results: CacheComponent[] = [];
    let start = request.interval.start;
    let cachedRanges = 0;
    let complete = false;
    // Source chooses the first three populated components in ascending key
    // order, then reverses the resulting components for a descending request.
    for (const covered of cached.intervals.values()) {
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

  /** Decodes one fetched row and admits it to the table's indexes. The source
   * derives every index key here; Flarex decides admission and charges the
   * budget here, in the same order, and leaves key derivation to the first read
   * of each index (divergences/deferred-index-coverage.md). */
  function admit(table: CoreTableDefinition, entry: CoreHydratedIndexEntry,
    resolved: Array<IndexDocuments | undefined>): Result.Result<void, CoreError> {
    return Result.flatMap(readDocumentObject(entry.document, table), document =>
      Result.flatMap(Result.mapError(captureCoreDocument(document, isCoreSystemTable(table)),
        cause => new CorePersistenceError({ reason: "corruptData", cause })), (measured): Result.Result<void, CoreError> => {
        // Keep a single immutable document revision shared by its secondary
        // keys. The source charges document value size only through ById.
        const stored = copyDocument(entry.document);
        input.decoded?.offer(stored, table, measured.value);
        if (cacheBytes > maxBytes || table.indexes.length === 0) return Result.succeed(undefined);
        return Result.map(documentIndexKey(DEVELOPER_ID_KEY, measured.value), () => {
          const admitted: PendingCoverage = { kind: "document", value: measured.value, stored };
          for (const [position, index] of table.indexes.entries()) {
            if (cacheBytes > maxBytes) continue;
            if (index.name === "by_id") cacheBytes += measured.semanticSizeBytes;
            let docs = resolved[position];
            if (docs === undefined) resolved[position] = docs = indexDocuments(index);
            docs.pending.push(admitted);
          }
        });
      }));
  }

  function populate(index: CachedIndex, table: CoreTableDefinition,
    entries: readonly CoreHydratedIndexEntry[], interval: CoreInterval): Result.Result<void, CoreError> {
    const resolved: Array<IndexDocuments | undefined> = [];
    for (const entry of entries) {
      const admitted = admit(table, entry, resolved);
      // A plain guard: this loop runs per fetched row, without a generator.
      if (Result.isFailure(admitted)) return admitted;
    }
    // Full coverage is certified only after every fetched row was stored.
    // One body may push the source budget over its limit; do not certify the
    // whole fetched interval once that happens.
    if (cacheBytes <= maxBytes) indexDocuments(index).pending.push({ kind: "interval", interval: copyInterval(interval) });
    return Result.succeed(undefined);
  }

  /** The concurrent half of a range read: cached components plus persistence
   * misses. It admits nothing to this operation cache; reading the components
   * only applies what earlier fills left pending for that index, which gives
   * the same coverage whichever fetch does it first. */
  const fetch = Effect.fnUntraced(function* (request: CoreIndexScan, withPermit: CoreIndexRangeBatchOptions["withPermit"],
    resident: CoreIndexPage | undefined) {
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
    if (resident !== undefined) return { page: resident };
    const results: CoreHydratedIndexEntry[] = [];
    const misses: CoreHydratedIndexEntry[] = [];
    let cursor: CoreIndexPage["cursor"] = Object.freeze({ kind: "end" });
    for (const component of yield* Effect.fromResult(components(request))) {
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
    return { page, fill: { index, table: selected.definition, misses, observed } };
  });
  type Fetched = Effect.Success<ReturnType<typeof fetch>>;
  const fill = (fetched: Fetched) => fetched.fill === undefined ? Result.succeed(fetched.page)
    : Result.map(populate(fetched.fill.index, fetched.fill.table, fetched.fill.misses, fetched.fill.observed), () => fetched.page);

  const scan = Effect.fnUntraced(function* (request: CoreIndexScan) {
    return yield* Effect.fromResult(fill(yield* fetch(request, undefined, input.resident?.(request))));
  }, effect => Effect.withSpan(effect, "CoreIndexSnapshot.scan", { captureStackTrace: false }));

  const rangeBatch: CoreBatchIndexSnapshot["rangeBatch"] = Effect.fnUntraced(function* (requests, options) {
    // Flarex transport divergence (divergences/native-read-batches.md): the
    // misses' first SQL pages travel in one statement at this snapshot's
    // timestamp; each fetch below still performs its ordinary scan. A typed
    // preload failure leaves every scan to report its own outcome.
    // Only each request's first miss is certainly scanned by its fetch; resident
    // pages are evaluated once and handed to that fetch.
    const residents = requests.map(request => input.resident?.(request));
    const misses = requests.flatMap((request, position) => {
      if (residents[position] !== undefined) return [];
      // Reading the components applies earlier fills' pending rows for that index
      // and admits nothing; each fetch below then reads the same coverage. A read
      // whose coverage cannot be read reports that from its own fetch.
      const miss = Result.getOrUndefined(components(request))?.find(component => component.kind === "miss");
      return miss === undefined ? [] : [{ ...request, interval: miss.interval }];
    });
    if (misses.length > 1) {
      const preload = input.snapshot.preload(misses);
      yield* advisoryPreload(options.withPermit === undefined ? preload : options.withPermit(preload));
    }
    const fetched = yield* Effect.forEach(requests, (request, position) =>
      Effect.exit(fetch(request, options.withPermit, residents[position])),
      { concurrency: Math.max(1, options.concurrency) });
    // Source fills the cache only after the concurrent phase; a failed slot
    // contributes nothing and does not affect any other slot.
    return fetched.map((outcome): Exit.Exit<CoreIndexPage, CoreError> => Exit.isSuccess(outcome)
      ? Result.match(fill(outcome.value), { onFailure: error => Exit.fail(error), onSuccess: page => Exit.succeed(page) })
      : Exit.failCause(outcome.cause));
  });

  return Object.freeze({ timestamp: input.snapshot.timestamp, scan, rangeBatch });
}
