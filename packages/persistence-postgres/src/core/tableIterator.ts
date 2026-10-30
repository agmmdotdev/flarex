/**
 * TableIterator translated from Convex table_iteration/src/table_iterator.rs at db914cf06.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Cause, Effect, Exit, Option, Schema } from "effect";
import { bytesEqual, compareBytesLexicographically, encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { CanonicalNonNegativePostgresBigIntFromString } from "flarex-protocol/internal/postgres-bigint";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { CoreTransactionError, type CoreError, type CoreIndexDefinition, type CoreTableDefinition } from "./api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreDocumentLogCursor,
  type CoreHydratedIndexEntry, type CoreIndexCursor, type CorePersistence, type CoreRetentionValidator } from "./contracts";
import { documentIndexKey } from "./documentIndex";
import { CoreTableIteratorBudgetSchema, type CoreTableIteratorBudget } from "./iteratorBudget";
export { CoreTableIteratorBudgetSchema, CoreTableIteratorResourceBudgetSchema, type CoreTableIteratorBudget } from "./iteratorBudget";
import { readDocumentObject } from "./registry";

export interface CoreTableIteratorPage {
  readonly entries: readonly CoreHydratedIndexEntry[];
  /** Only emitted coverage may be checkpointed; a partial log walk cannot advance this cursor. */
  readonly cursor: CoreIndexCursor | null;
  readonly done: boolean;
  readonly progressed: boolean;
}
export interface CoreTableIterator {
  readonly nextPage: () => Effect.Effect<CoreTableIteratorPage, CoreError>;
}
interface StoredRevision { readonly key: Uint8Array; readonly id: Uint8Array; readonly ts: bigint; readonly byteLength: number; document?: CoreDocumentLogEntry }
interface PendingPage {
  readonly end: CoreIndexCursor;
  readonly recentTs: bigint;
  readonly page: readonly StoredRevision[];
}
const corrupt = (cause: unknown) => new CorePersistenceError({ reason: "corruptData", cause });
// RC.112 retry selects the first Fail from mixed Causes; retain every other reason.
const retrySnapshotRead = <A>(read: Effect.Effect<A, CorePersistenceError>) => Effect.catchCause(read, cause => {
  const reason = cause.reasons[0];
  return cause.reasons.length === 1 && reason !== undefined && Cause.isFailReason(reason)
    && (reason.error.reason === "timeout" || reason.error.reason === "outOfRetention")
    ? read : Effect.failCause(cause);
});
const afterKey = (key: Uint8Array): Uint8Array => { const result = new Uint8Array(key.length + 1); result.set(key); return result; };
const walked = (cursor: CoreIndexCursor | null, key: Uint8Array): boolean => cursor?.kind === "end"
  || cursor?.kind === "after" && compareBytesLexicographically(key, cursor.key) <= 0;

/** Static durable recent timestamp, including the source missing-global -> MIN branch. */
export const coreRepeatableRecentTimestamp = Effect.fn("CoreTableIterator.recent")(function* (persistence: CorePersistence) {
  const stored = yield* persistence.getGlobal("max_repeatable_ts");
  if (Option.isNone(stored)) return 0n;
  const text = yield* Effect.try({ try: () => new TextDecoder("utf-8", { fatal: true }).decode(stored.value), catch: corrupt });
  return yield* Schema.decodeUnknownEffect(CanonicalNonNegativePostgresBigIntFromString)(text).pipe(Effect.mapError(corrupt));
});

/** Source by-ID continuation is exclusive after the developer ID, including restart. */
export const coreTableIteratorCursor = (id: string) => encodeIndexKey([], id);

/**
 * A recent index walk merged with exact pre-change revisions at S. Bodies evict to
 * identity/timestamp references. Bounded DO steps keep the source observation map
 * intact and expose no durable progress until the corresponding log range is proven.
 */
interface CoreTableIteratorOptions {
  readonly persistence: CorePersistence; readonly snapshotTs: bigint; readonly table: CoreTableDefinition; readonly index: CoreIndexDefinition;
  readonly after?: Uint8Array; readonly recentTimestamp?: Effect.Effect<bigint, CorePersistenceError>;
  readonly retention?: CoreRetentionValidator; readonly budget: CoreTableIteratorBudget;
}
interface BufferedPredecessor { readonly id: Uint8Array; readonly prevTs: bigint | null }
interface SharedIterationLog {
  readonly ensure: (at: bigint) => Effect.Effect<boolean, CoreError>;
  readonly predecessors: (tableId: Uint8Array, offset: number, maxResults: number) => Readonly<{ entries: readonly BufferedPredecessor[]; total: number }>;
  readonly unregister: (tableId: Uint8Array) => void;
  readonly poison: () => void;
}
function createSharedIterationLog(options: Readonly<{
  persistence: CorePersistence; snapshotTs: bigint; tables: readonly CoreTableDefinition[];
  retention?: CoreRetentionValidator; budget: CoreTableIteratorBudget;
}>): SharedIterationLog {
  const buffers = new Map(options.tables.map(table => [encodeBytesToLowercaseHex(table.tabletId), { ids: new Set<string>(), predecessors: new Array<BufferedPredecessor>() }]));
  let endTs = options.snapshotTs;
  let pending: { target: bigint; after?: CoreDocumentLogCursor } | undefined;
  let metadata = 0, poisoned = false;
  const ensure = Effect.fn("CoreMultiTableIterator.walkLog")(function* (target: bigint): Effect.fn.Return<boolean, CoreError> {
    if (poisoned) return yield* Effect.fail(new CoreTransactionError({ reason: "closed" }));
    if (target < endTs) return yield* Effect.fail(corrupt("Shared recent timestamp regressed"));
    if (pending !== undefined && target !== pending.target) return yield* Effect.fail(new CoreTransactionError({ reason: "inflight" }));
    if (target === endTs) return true;
    pending ??= { target };
    for (let pages = 0; pages < options.budget.maxLogPagesPerStep; pages += 1) {
      const page = yield* options.persistence.loadDocuments({ start: endTs + 1n, end: target,
        order: "asc", maxResults: options.budget.logPageSize, ...(pending.after === undefined ? {} : { after: pending.after }) }, options.retention);
      for (const document of page.documents) {
        const buffer = buffers.get(encodeBytesToLowercaseHex(document.tableId));
        const id = encodeBytesToLowercaseHex(document.id);
        if (buffer === undefined || buffer.ids.has(id)) continue;
        if (metadata >= options.budget.maxMetadataEntries) return yield* Effect.fail(new CoreTransactionError({
          reason: "capacity", cause: "Shared iterator predecessor metadata capacity" }));
        if (document.prevTs !== null && document.prevTs > options.snapshotTs)
          return yield* Effect.fail(corrupt("First post-snapshot predecessor is newer than snapshot"));
        buffer.ids.add(id); buffer.predecessors.push({ id: document.id.slice(), prevTs: document.prevTs }); metadata += 1;
      }
      if (page.cursor !== null) pending.after = page.cursor;
      if (page.done) { endTs = target; pending = undefined; return true; }
    }
    return false;
  });
  return { ensure: target => ensure(target).pipe(Effect.onExit(exit => Effect.sync(() => { if (Exit.isFailure(exit)) poisoned = true; }))),
    predecessors: (tableId, offset, maxResults) => { const entries = buffers.get(encodeBytesToLowercaseHex(tableId))?.predecessors ?? [];
      return { entries: entries.slice(offset, offset + maxResults), total: entries.length }; },
    unregister: tableId => { const key = encodeBytesToLowercaseHex(tableId); metadata -= buffers.get(key)?.ids.size ?? 0; buffers.delete(key); },
    poison: () => { poisoned = true; },
  };
}
export function createCoreMultiTableIterator(options: Readonly<{
  persistence: CorePersistence; snapshotTs: bigint; tables: readonly CoreTableDefinition[];
  recentTimestamp?: Effect.Effect<bigint, CorePersistenceError>; retention?: CoreRetentionValidator; budget: CoreTableIteratorBudget;
}>) {
  const log = createSharedIterationLog(options);
  const registered = new Set(options.tables.map(table => encodeBytesToLowercaseHex(table.tabletId)));
  return Object.freeze({ table: (table: CoreTableDefinition, index: CoreIndexDefinition, after?: Uint8Array): CoreTableIterator => {
    if (!registered.has(encodeBytesToLowercaseHex(table.tabletId))) throw new Error("TableIterator table was not registered");
    return makeCoreTableIterator({ ...options, table, index, ...(after === undefined ? {} : { after }) }, log);
  }, unregisterTable: (tableId: Uint8Array) => { registered.delete(encodeBytesToLowercaseHex(tableId)); log.unregister(tableId); } });
}
export function createCoreTableIterator(options: CoreTableIteratorOptions): CoreTableIterator {
  return makeCoreTableIterator(options, createSharedIterationLog({ ...options, tables: [options.table] }));
}
function makeCoreTableIterator(options: CoreTableIteratorOptions, sharedLog: SharedIterationLog): CoreTableIterator {
  const { persistence, snapshotTs, table, index, budget } = options;
  let observedCount = 0;
  const skipped = new Map<string, StoredRevision>();
  let cursor: CoreIndexCursor | null = options.after === undefined ? null : { kind: "after", key: options.after.slice() };
  let emittedCursor: CoreIndexCursor | null = cursor;
  let endTs = snapshotTs;
  let pending: PendingPage | undefined;
  let ready: StoredRevision[] = [];
  let done = false;
  let fullCount = 0, fullBytes = 0;
  const fullBodies = new Set<StoredRevision>();
  let busy = false;
  let failed = false;
  const dropBody = (revision: StoredRevision) => {
    if (revision.document === undefined) return;
    fullCount -= 1; fullBytes -= revision.document.jsonValue.byteLength; fullBodies.delete(revision); delete revision.document;
  };
  const retain = (key: Uint8Array, document: CoreDocumentLogEntry): StoredRevision => {
    const revision: StoredRevision = { key: key.slice(), id: document.id.slice(), ts: document.ts, byteLength: document.jsonValue.byteLength };
    if (fullCount < budget.documentCount && fullBytes + document.jsonValue.byteLength <= budget.documentBytes) {
      revision.document = document; fullCount += 1; fullBytes += document.jsonValue.byteLength; fullBodies.add(revision);
    }
    return revision;
  };
  const reserveBodies = (bytes: number, count: number) => {
    for (const revision of fullBodies) {
      if (fullBytes + bytes <= budget.documentBytes && fullCount + count <= budget.documentCount) break;
      dropBody(revision);
    }
  };
  const loadExactBatch = Effect.fn("CoreTableIterator.loadExactBatch")(function* (requests: readonly Readonly<{ id: Uint8Array; ts: bigint }>[]) {
    if (snapshotTs === 0x7fff_ffff_ffff_ffffn) return yield* Effect.fail(corrupt("Snapshot has no successor retention witness"));
    const rows = yield* persistence.previousRevisionsOfDocuments(requests.map(request => ({
      tableId: table.tabletId, id: request.id, ts: snapshotTs + 1n, prevTs: request.ts })), options.retention);
    const revisions = new Map<string, CoreDocumentLogEntry>();
    for (const row of rows) {
      const key = encodeBytesToLowercaseHex(row.document.id) + ":" + row.document.ts;
      if (!bytesEqual(row.document.tableId, table.tabletId) || !bytesEqual(row.query.tableId, table.tabletId) || row.query.ts !== snapshotTs + 1n
        || row.query.prevTs !== row.document.ts || !bytesEqual(row.query.id, row.document.id) || revisions.has(key))
        return yield* Effect.fail(corrupt("Invalid exact predecessor batch"));
      revisions.set(key, row.document);
    }
    const ordered: CoreDocumentLogEntry[] = [];
    for (const request of requests) {
      const revision = revisions.get(encodeBytesToLowercaseHex(request.id) + ":" + request.ts);
      if (revision === undefined) return yield* Effect.fail(corrupt("Missing exact snapshot predecessor"));
      if (revision.jsonValue.byteLength > budget.documentBytes) return yield* Effect.fail(new CoreTransactionError({
        reason: "capacity", cause: "Iterator document byte capacity" }));
      ordered.push(revision);
    }
    if (rows.length !== requests.length) return yield* Effect.fail(corrupt("Unexpected exact predecessor batch rows"));
    return ordered;
  });
  const fetchPage = Effect.fn("CoreTableIterator.fetchPage")(function* () {
    const recent = yield* options.recentTimestamp ?? coreRepeatableRecentTimestamp(persistence);
    const at = recent > snapshotTs ? recent : snapshotTs;
    if (at < endTs) return yield* Effect.fail(corrupt("Recent iterator timestamp regressed"));
    const snapshot = yield* persistence.readSnapshot(at, options.retention);
    const result = yield* snapshot.scan({ tableId: table.tabletId, index: index.ref, order: "asc", maxResults: Math.min(budget.pageSize, budget.documentCount),
      interval: { start: cursor?.kind === "after" ? afterKey(cursor.key) : null, end: null } });
    return { recentTs: at, result };
  }, retrySnapshotRead);
  const step = Effect.fn("CoreTableIterator.nextPage")(function* (): Effect.fn.Return<CoreTableIteratorPage, CoreError> {
    yield* Schema.decodeUnknownEffect(CoreTableIteratorBudgetSchema)(budget).pipe(Effect.mapError(cause =>
      new CoreTransactionError({ reason: "capacity", cause })));
    if (done) return { entries: [], cursor: emittedCursor, done: true, progressed: false };
    if (ready.length === 0) {
      if (pending === undefined) {
        const fetched = yield* fetchPage();
        pending = { end: fetched.result.cursor, recentTs: fetched.recentTs,
          page: fetched.result.entries.filter(entry => entry.document.ts <= snapshotTs)
            .map(entry => retain(entry.key, entry.document)) };
      }
      const logDone = yield* sharedLog.ensure(pending.recentTs);
      if (!logDone) return { entries: [], cursor: emittedCursor, done: false, progressed: false };
      const observations = sharedLog.predecessors(table.tabletId, observedCount, budget.logPageSize * budget.maxLogPagesPerStep);
      const batchSize = Math.min(8, budget.documentCount, budget.pageSize);
      for (let offset = 0; offset < observations.entries.length; offset += batchSize) {
        const chunk = observations.entries.slice(offset, offset + batchSize);
        const requests = chunk.flatMap(predecessor => predecessor.prevTs === null ? [] : [{ id: predecessor.id, ts: predecessor.prevTs }]);
        const previous = requests.length === 0 ? [] : yield* loadExactBatch(requests);
        for (const revision of previous) {
          if (revision.deleted) continue;
          reserveBodies(revision.jsonValue.byteLength, 1);
          const body = yield* Effect.fromResult(readDocumentObject(revision, table));
          const key = yield* Effect.fromResult(documentIndexKey(index, body));
          if (walked(cursor, key)) continue;
          const encoded = encodeBytesToLowercaseHex(key);
          if (skipped.has(encoded)) return yield* Effect.fail(corrupt("Duplicate historical index key"));
          if (observedCount + skipped.size >= budget.maxMetadataEntries) return yield* Effect.fail(new CoreTransactionError({
            reason: "capacity", cause: "Iterator predecessor metadata capacity" }));
          skipped.set(encoded, retain(key, revision));
        }
        observedCount += chunk.length;
      }
      if (observedCount < observations.total) return { entries: [], cursor: emittedCursor, done: false, progressed: false };
      if (observedCount !== observations.total) return yield* Effect.fail(corrupt("Iterator lost buffered predecessor metadata"));
      const merged = new Map<string, StoredRevision>();
      for (const entry of pending.page) merged.set(encodeBytesToLowercaseHex(entry.key), entry);
      for (const [key, revision] of skipped) {
        if (!walked(pending.end, revision.key)) continue;
        if (merged.has(key)) return yield* Effect.fail(corrupt("Duplicate snapshot revision from index and log"));
        merged.set(key, revision); skipped.delete(key);
      }
      ready = [...merged.values()].toSorted((a, b) => compareBytesLexicographically(a.key, b.key));
      const ids = new Set<string>();
      for (const revision of ready) {
        const id = encodeBytesToLowercaseHex(revision.id);
        if (ids.has(id) || revision.ts > snapshotTs || walked(cursor, revision.key) || !walked(pending.end, revision.key))
          return yield* Effect.fail(corrupt("Iterator merge violated snapshot range or identity"));
        ids.add(id);
      }
      endTs = pending.recentTs; cursor = pending.end; pending = undefined;
    }
    const entries: CoreHydratedIndexEntry[] = [];
    let bytes = 0;
    while (ready.length > 0 && entries.length < Math.min(budget.pageSize, budget.documentCount)) {
      const batch: StoredRevision[] = [];
      let batchBytes = 0;
      for (const revision of ready) {
        if (revision.byteLength > budget.documentBytes) return yield* Effect.fail(new CoreTransactionError({
          reason: "capacity", cause: "Iterator document byte capacity" }));
        if (batch.length >= Math.min(8, budget.documentCount - entries.length, budget.pageSize - entries.length)
          || bytes + batchBytes + revision.byteLength > budget.documentBytes) break;
        batch.push(revision); batchBytes += revision.byteLength;
      }
      if (batch.length === 0) break;
      reserveBodies(bytes + batchBytes, entries.length + batch.length);
      const references = batch.filter(revision => revision.document === undefined);
      const reloaded = references.length === 0 ? [] : yield* loadExactBatch(references);
      let offset = 0;
      for (const revision of batch) {
        const document = revision.document ?? reloaded[offset++];
        if (document === undefined || document.deleted || document.jsonValue.byteLength !== revision.byteLength)
          return yield* Effect.fail(corrupt("Reloaded snapshot revision is absent, deleted or changed its immutable body size"));
        ready.shift(); dropBody(revision); bytes += document.jsonValue.byteLength;
        entries.push({ key: revision.key, document }); emittedCursor = { kind: "after", key: revision.key.slice() };
      }
    }
    if (ready.length === 0 && cursor?.kind === "end") {
      if (skipped.size !== 0) return yield* Effect.fail(corrupt("Skipped revisions remain beyond final page"));
      done = true; emittedCursor = { kind: "end" };
    } else if (ready.length === 0) emittedCursor = cursor;
    return { entries, cursor: emittedCursor, done, progressed: true };
  });
  return Object.freeze({ nextPage: () => Effect.suspend(() => {
    if (failed) return Effect.fail(new CoreTransactionError({ reason: "closed" }));
    if (busy) return Effect.fail(new CoreTransactionError({ reason: "inflight" }));
    busy = true;
    return step().pipe(Effect.onExit(exit => Effect.sync(() => {
      busy = false;
      if (Exit.isFailure(exit)) { failed = true; sharedLog.poison(); }
    })));
  }) });
}

/** LatestTableIterator: proposal-bounded recent pages; write-time validation closes concurrent changes. */
export function createCoreLatestTableIterator(options: Readonly<{
  persistence: Pick<CorePersistence, "readSnapshot">; minimumTs: bigint; table: CoreTableDefinition; index: CoreIndexDefinition;
  recentTimestamp: Effect.Effect<bigint, CorePersistenceError>; pageSize: number; after?: Uint8Array;
  budget: Pick<CoreTableIteratorBudget, "documentBytes" | "documentCount">;
}>) {
  let cursor: CoreIndexCursor | null = options.after === undefined ? null : { kind: "after", key: options.after.slice() };
  return { nextPage: Effect.fn("CoreLatestTableIterator.nextPage")(function* () {
    if (cursor?.kind === "end") return { entries: [], cursor, timestamp: options.minimumTs };
    const { timestamp, page } = yield* Effect.gen(function* () {
      const recent = yield* options.recentTimestamp;
      const at = recent < options.minimumTs ? options.minimumTs : recent;
      const snapshot = yield* options.persistence.readSnapshot(at);
      const result = yield* snapshot.scan({ tableId: options.table.tabletId, index: options.index.ref,
        interval: { start: cursor?.kind === "after" ? afterKey(cursor.key) : null, end: null }, order: "asc",
        maxResults: Math.min(options.pageSize, options.budget.documentCount) });
      return { timestamp: at, page: result };
    }).pipe(retrySnapshotRead);
    const entries: CoreHydratedIndexEntry[] = [];
    let bytes = 0;
    for (const entry of page.entries) {
      if (entry.document.jsonValue.byteLength > options.budget.documentBytes) return yield* Effect.fail(new CoreTransactionError({
        reason: "capacity", cause: "Latest iterator document byte capacity" }));
      if (bytes + entry.document.jsonValue.byteLength > options.budget.documentBytes) break;
      entries.push(entry); bytes += entry.document.jsonValue.byteLength;
    }
    const last = entries.at(-1);
    cursor = entries.length < page.entries.length && last !== undefined
      ? { kind: "after", key: last.key.slice() } : page.cursor;
    return { entries, cursor, timestamp };
  }) };
}
