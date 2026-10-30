/**
 * Exact shared index pages translated from Convex crates/indexing/src/
 * {index_cache/mod.rs,database_index_snapshot.rs,atomic_cache.rs} at
 * db914cf06e2b06ee985646611b9e12ed7a770318. Copyright 2026 Convex, Inc.,
 * FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Random, Result, Schema } from "effect";
import { bytesEqual, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { CoreTransactionError } from "./api";
import { CorePersistenceError, type CoreIndexPage, type CoreIndexScan,
  type CorePersistenceSnapshot, type CoreWriteBatch } from "./contracts";
import { INDEXES, publicDocumentId, type CoreRegistry } from "./registry";
import { copyInterval, pointInterval, type CoreWriteLogSnapshot } from "./writeLog";
import { CoreIndexCachePolicy } from "./indexCachePolicy";
import { CoreIndexCacheIntervals } from "./indexCacheIntervals";
import { hashCoreIndexPageKey } from "./indexCacheSketch";

const NonnegativeSafeInteger = Schema.Int.check(Schema.makeFilter(value =>
  Number.isSafeInteger(value) && value >= 0 ? undefined : "Expected a nonnegative safe integer"));
const decodeConfiguration = Schema.decodeUnknownEffect(Schema.Struct({
  maxBytes: NonnegativeSafeInteger,
  verifyPercent: NonnegativeSafeInteger.check(Schema.isLessThanOrEqualTo(100)),
}));

export interface CoreIndexCacheOptions {
  readonly maxBytes?: number;
  readonly verifyPercent?: number;
}

interface CachedPage {
  readonly beginTimestamp: bigint;
  readonly populateId: bigint;
  readonly indexKey: string;
  readonly request: CoreIndexScan;
  readonly page: CoreIndexPage;
  ready: boolean;
}

export interface CoreIndexCache {
  readonly scan: (input: Readonly<{
    snapshot: CorePersistenceSnapshot;
    registry: CoreRegistry;
    request: CoreIndexScan;
  }>) => Effect.Effect<CoreIndexPage, CorePersistenceError>;
  /** Called synchronously after log append and before a newer snapshot is exposed. */
  readonly invalidate: (batch: CoreWriteBatch, oldRegistry: CoreRegistry, newRegistry: CoreRegistry) => void;
  readonly close: () => void;
}

function copyRequest(request: CoreIndexScan): CoreIndexScan {
  return Object.freeze({ ...request, index: Object.freeze({ ...request.index, id: request.index.id.slice() }),
    tableId: request.tableId.slice(), interval: copyInterval(request.interval) });
}

function cacheKey(request: CoreIndexScan): string {
  return JSON.stringify([encodeBytesToLowercaseHex(request.index.id),
    request.interval.start === null ? null : encodeBytesToLowercaseHex(request.interval.start),
    request.interval.end === null ? null : encodeBytesToLowercaseHex(request.interval.end),
    request.order, request.maxResults]);
}

function copyPage(page: CoreIndexPage): CoreIndexPage {
  return Object.freeze({ entries: Object.freeze(page.entries.map(entry => Object.freeze({ key: entry.key.slice(),
    document: Object.freeze({ ...entry.document, tableId: entry.document.tableId.slice(),
      id: entry.document.id.slice(), jsonValue: entry.document.jsonValue.slice() }),
  }))), cursor: page.cursor.kind === "end" ? Object.freeze({ kind: "end" as const })
    : Object.freeze({ kind: "after" as const, key: page.cursor.key.slice() }) });
}

/** Like upstream's heap-size weight this accounts residency, not total JS heap. */
function pageWeight(key: string, request: CoreIndexScan, page: CoreIndexPage): number {
  const keyBytes = 64 + key.length * 2 + request.index.id.length
    + (request.interval.start?.length ?? 0) + (request.interval.end?.length ?? 0);
  return 2 * keyBytes + 96 + (page.cursor.kind === "after" ? page.cursor.key.length : 0)
    + page.entries.reduce((total, entry) => total + 112 + entry.key.length + entry.document.tableId.length
      + entry.document.id.length + entry.document.jsonValue.length, 0);
}

function pagesEqual(left: CoreIndexPage, right: CoreIndexPage): boolean {
  if (left.entries.length !== right.entries.length || left.cursor.kind !== right.cursor.kind) return false;
  if (left.cursor.kind === "after" && (right.cursor.kind !== "after" || !bytesEqual(left.cursor.key, right.cursor.key))) return false;
  for (let index = 0; index < left.entries.length; index += 1) {
    const a = left.entries[index];
    const b = right.entries[index];
    if (a === undefined || b === undefined || !bytesEqual(a.key, b.key)) return false;
    const x = a.document;
    const y = b.document;
    if (x.ts !== y.ts || x.prevTs !== y.prevTs || x.deleted !== y.deleted
      || !bytesEqual(x.tableId, y.tableId) || !bytesEqual(x.id, y.id) || !bytesEqual(x.jsonValue, y.jsonValue)) return false;
  }
  return true;
}

/** A separate instance per fenced database lifetime supplies deployment/source isolation. */
export const makeCoreIndexCache = Effect.fn("CoreIndexCache.make")(function* (
  options: CoreIndexCacheOptions,
  readLog: Effect.Effect<CoreWriteLogSnapshot>,
): Effect.fn.Return<CoreIndexCache, CoreTransactionError> {
  const configuration = yield* decodeConfiguration({ maxBytes: options.maxBytes ?? 512 * 1024 * 1024,
    verifyPercent: options.verifyPercent ?? 100 }).pipe(
    Effect.mapError(cause => new CoreTransactionError({ reason: "invalidValue", cause })),
  );
  const seeds = yield* Effect.sync(() => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    const view = new DataView(bytes.buffer);
    return [view.getBigUint64(0, true), view.getBigUint64(8, true)] as const;
  });
  const hash = (key: string) => hashCoreIndexPageKey(key, seeds[0], seeds[1]);
  const registrations = new Map<string, CoreIndexCacheIntervals>();
  const policy = new CoreIndexCachePolicy<CachedPage>(configuration.maxBytes, hash, (key, page) => {
    const registered = registrations.get(page.indexKey);
    registered?.remove(key);
    if (registered?.size === 0) registrations.delete(page.indexKey);
  });
  let nextPopulateId = 0n;
  let closed = false;

  const removeOwn = (key: string, page: CachedPage) => {
    if (policy.peek(key) === page) policy.remove(key);
  };

  const populate = Effect.fn("CoreIndexCache.populate")(function* (
    key: string, request: CoreIndexScan, snapshot: CorePersistenceSnapshot,
    registry: CoreRegistry, fetched: CoreIndexPage,
  ) {
    if (closed || configuration.maxBytes === 0 || policy.peek(key) !== undefined) return;
    const weight = pageWeight(key, request, fetched);
    if (weight > configuration.maxBytes) return;
    const metadataTable = registry.table(INDEXES)?.definition;
    const metadataById = metadataTable?.indexes.find(index => index.name === "by_id" && index.enabled);
    if (metadataTable === undefined || metadataById === undefined) return;
    const metadataKey = yield* Effect.fromResult(publicDocumentId(metadataTable, request.index.id).pipe(
      Result.flatMap(id => Result.mapError(encodeIndexKey([], id), cause => new CoreTransactionError({ reason: "invalidValue", cause }))),
      Result.mapError(cause => new CorePersistenceError({ reason: "corruptData", cause })),
    ));
    const indexKey = encodeBytesToLowercaseHex(request.index.id);
    const page: CachedPage = { beginTimestamp: snapshot.timestamp, populateId: nextPopulateId++,
      indexKey, request, page: copyPage(fetched), ready: false };
    if (!policy.insert(key, page, weight)) return;
    let intervals = registrations.get(indexKey);
    if (intervals === undefined) {
      intervals = new CoreIndexCacheIntervals();
      registrations.set(indexKey, intervals);
    }
    intervals.insert(key, request.interval, Number(hash(`${key}@${page.populateId}`) & 0xffff_ffffn));
    yield* Effect.ensuring(Effect.gen(function* () {
      const log = yield* readLog;
      const valid = yield* Result.match(log.conflict([
        { indexId: request.index.id, intervals: [request.interval] },
        { indexId: metadataById.ref.id, intervals: [pointInterval(metadataKey)] },
      ], snapshot.timestamp), {
        onFailure: error => error.reason === "outOfRetention" ? Effect.succeed(false) : Effect.fail(error),
        onSuccess: conflict => Effect.succeed(conflict === undefined),
      });
      if (!valid) { removeOwn(key, page); return; }
      const current = policy.peek(key);
      if (current !== page || current.beginTimestamp !== snapshot.timestamp || current.populateId !== page.populateId) return;
      if (!registrations.get(indexKey)?.has(key)) { removeOwn(key, page); return; }
      page.ready = true;
      policy.touch(key);
    }), Effect.sync(() => { if (!page.ready) removeOwn(key, page); }));
  });

  const scan: CoreIndexCache["scan"] = Effect.fn("CoreIndexCache.scan")(function* (input) {
    const request = copyRequest(input.request);
    const selected = input.registry.indexById(request.index.id);
    const known = selected !== undefined && selected.index.enabled
      && bytesEqual(selected.table.tabletId, request.tableId)
      && selected.index.ref.persistenceIndexId === request.index.persistenceIndexId;
    const key = cacheKey(request);
    const cached = closed || !known ? undefined : policy.get(key);
    if (cached !== undefined && cached.ready && input.snapshot.timestamp >= cached.beginTimestamp) {
      if (!registrations.get(cached.indexKey)?.has(key)) policy.remove(key);
      else {
        const verify = configuration.verifyPercent === 100 || (configuration.verifyPercent > 0
          && (yield* Random.nextIntBetween(0, 100)) < configuration.verifyPercent);
        if (verify) {
          const persisted = yield* input.snapshot.scan(request);
          if (!pagesEqual(cached.page, persisted)) return yield* Effect.die(new Error(
            "Shared index cache disagrees with persistence; possible data corruption.",
          ));
        }
        return copyPage(cached.page);
      }
    }
    const fetched = yield* input.snapshot.scan(request);
    if (known && !closed) yield* populate(key, request, input.snapshot, input.registry, fetched);
    return fetched;
  });

  const invalidate: CoreIndexCache["invalidate"] = (batch, oldRegistry, newRegistry) => {
    const oldMetadataTable = oldRegistry.table(INDEXES)?.definition.tabletId;
    const newMetadataTable = newRegistry.table(INDEXES)?.definition.tabletId;
    for (const document of batch.documents) {
      if ((oldMetadataTable === undefined || !bytesEqual(document.tableId, oldMetadataTable))
        && (newMetadataTable === undefined || !bytesEqual(document.tableId, newMetadataTable))) continue;
      const indexKey = encodeBytesToLowercaseHex(document.id);
      const registered = registrations.get(indexKey);
      if (registered === undefined) continue;
      for (const key of registered.keys()) policy.remove(key);
    }
    for (const write of batch.indexes) {
      const registered = registrations.get(encodeBytesToLowercaseHex(write.index.id));
      if (registered === undefined) continue;
      for (const key of registered.query(write.key)) policy.remove(key);
    }
  };
  return Object.freeze({ scan, invalidate, close: () => { closed = true; policy.clear(); } });
});
