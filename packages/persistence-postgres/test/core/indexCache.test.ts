import { Cause, Deferred, Effect, Exit, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { makeCoreIndexCache, type CoreIndexCache } from "../../src/core/indexCache";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreIndexPage, type CoreIndexScan,
  type CorePersistenceIndexEntry, type CorePersistenceSnapshot, type CoreWriteBatch } from "../../src/core/contracts";
import { INDEXES, initialRegistry, publicDocumentId } from "../../src/core/registry";
import { CoreWriteLog, indexKeysFromWrites } from "../../src/core/writeLog";
import type { CoreTableDefinition } from "../../src/core/api";

const id = (value: number) => { const bytes = new Uint8Array(16); bytes[15] = value; return bytes; };
const byte = (value: number) => Uint8Array.of(value);
const utf8 = new TextEncoder();
const metadata: CoreTableDefinition = { name: INDEXES, number: 514, tabletId: id(1), namespace: null, state: "active",
  indexes: [{ name: "by_id", ref: { id: id(2) }, fields: [] }] };
const items: CoreTableDefinition = { name: "items", number: 10000, tabletId: id(3), namespace: null, state: "active",
  indexes: [{ name: "by_id", ref: { id: id(4) }, fields: [] },
    { name: "by_value", ref: { id: id(5) }, fields: ["value"] }] };
const registry = Result.getOrThrow(initialRegistry([metadata, items]));
const rangeIndex = { id: id(5) };
const request: CoreIndexScan = { index: rangeIndex, tableId: items.tabletId,
  interval: { start: null, end: null }, order: "asc", maxResults: 2 };

function document(value: number, ts = 0n): CoreDocumentLogEntry {
  return { ts, tableId: items.tabletId.slice(), id: id(value), jsonValue: utf8.encode(`body-${value}-${ts}`), deleted: false, prevTs: null };
}

function page(value: number, ts = 0n, after = false): CoreIndexPage {
  return { entries: [{ key: byte(value), document: document(value, ts) }],
    cursor: after ? { kind: "after", key: byte(value) } : { kind: "end" } };
}

const empty: CoreIndexPage = { entries: [], cursor: { kind: "end" } };

function snapshot(timestamp: bigint, result: CoreIndexPage, onRead?: () => void): CorePersistenceSnapshot {
  return { timestamp, get: () => Effect.succeed(Option.none()), scan: () => Effect.sync(() => {
    onRead?.();
    return result;
  }) };
}

function scan(cache: CoreIndexCache, raw: CorePersistenceSnapshot, selected = request) {
  return cache.scan({ snapshot: raw, registry, request: selected });
}

function write(key: number, ts: bigint, deleted = false): CorePersistenceIndexEntry {
  return { mode: "scanComplete", ts, index: rangeIndex, key: byte(key),
    value: deleted ? null : { tableId: items.tabletId, documentId: id(key) }, prev: null };
}

function metadataBatch(ts: bigint): CoreWriteBatch {
  const developerId = Result.getOrThrow(publicDocumentId(metadata, rangeIndex.id));
  const key = Result.getOrThrow(encodeIndexKey([], developerId));
  return { documents: [{ ...document(5, ts), tableId: metadata.tabletId, id: rangeIndex.id }], indexes: [{
    mode: "scanComplete", ts, index: { id: id(2) }, key,
    value: { tableId: metadata.tabletId, documentId: rangeIndex.id }, prev: null,
  }] };
}

function publish(cache: CoreIndexCache, log: CoreWriteLog, ts: bigint, batch: CoreWriteBatch): void {
  log.append(ts, indexKeysFromWrites(batch.indexes));
  cache.invalidate(batch, registry, registry);
}

describe("translated shared exact index pages", () => {
  it("reuses exact pages at newer timestamps and detaches original/result bytes", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.sync(() => log.snapshot()));
      let reads = 0;
      const original = page(2, 0n, true);
      const first = yield* scan(cache, snapshot(0n, original, () => { reads += 1; }));
      first.entries[0]?.key.fill(99);
      first.entries[0]?.document.jsonValue.fill(99);
      if (first.cursor.kind === "after") first.cursor.key.fill(99);
      const second = yield* scan(cache, snapshot(3n, empty, () => { reads += 1; }));
      expect(second).toEqual(page(2, 0n, true));
      second.entries[0]?.document.id.fill(99);
      expect(yield* scan(cache, snapshot(4n, empty))).toEqual(page(2, 0n, true));
      expect(reads).toBe(1);
      cache.close();
    }));
  });

  it("keeps direction, exact interval, result budget, and original exact-limit cursor distinct", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.succeed(new CoreWriteLog(0n).snapshot()));
      let reads = 0;
      const raw = snapshot(0n, page(2, 0n, true), () => { reads += 1; });
      for (const selected of [request, { ...request, order: "desc" as const }, { ...request, maxResults: 1 },
        { ...request, interval: { start: byte(0), end: null } }, { ...request, interval: { start: null, end: byte(10) } }]) {
        expect((yield* scan(cache, raw, selected)).cursor).toEqual({ kind: "after", key: byte(2) });
        yield* scan(cache, raw, selected);
      }
      expect(reads).toBe(5);
      cache.close();
    }));
  });

  it("misses when a cached page begins after the requested snapshot without replacing it", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.sync(() => log.snapshot()));
      let reads = 0;
      yield* scan(cache, snapshot(10n, page(2, 10n), () => { reads += 1; }));
      expect(yield* scan(cache, snapshot(5n, page(2, 5n), () => { reads += 1; }))).toEqual(page(2, 5n));
      expect(yield* scan(cache, snapshot(12n, empty, () => { reads += 1; }))).toEqual(page(2, 10n));
      expect(reads).toBe(2);
    }));
  });

  it.each(["insert", "delete", "rewrite"] as const)("invalidates whole pages for a published %s", async kind => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.sync(() => log.snapshot()));
      let reads = 0;
      const before = kind === "insert" ? empty : page(2);
      const after = kind === "delete" ? empty : page(2, 1n);
      yield* scan(cache, snapshot(0n, before, () => { reads += 1; }));
      publish(cache, log, 1n, { documents: [], indexes: [write(2, 1n, kind === "delete")] });
      expect(yield* scan(cache, snapshot(1n, after, () => { reads += 1; }))).toEqual(after);
      expect(reads).toBe(2);
      expect(yield* scan(cache, snapshot(1n, empty))).toEqual(after);
    }));
  });

  it("invalidates both the old and new intervals of a moved key", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.sync(() => log.snapshot()));
      const oldRange = { ...request, interval: { start: byte(1), end: byte(4) } };
      const newRange = { ...request, interval: { start: byte(6), end: byte(9) } };
      yield* scan(cache, snapshot(0n, page(2)), oldRange);
      yield* scan(cache, snapshot(0n, empty), newRange);
      publish(cache, log, 1n, { documents: [], indexes: [write(2, 1n, true), write(7, 1n)] });
      expect(yield* scan(cache, snapshot(1n, empty), oldRange)).toEqual(empty);
      expect(yield* scan(cache, snapshot(1n, page(7, 1n)), newRange)).toEqual(page(7, 1n));
    }));
  });

  it("rejects a fill whose SQL fetch raced a newer publication", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.sync(() => log.snapshot()));
      const raw: CorePersistenceSnapshot = { ...snapshot(0n, page(2)), scan: () => Effect.sync(() => {
        publish(cache, log, 1n, { documents: [], indexes: [write(2, 1n)] });
        return page(2);
      }) };
      expect(yield* scan(cache, raw)).toEqual(page(2));
      let reads = 0;
      expect(yield* scan(cache, snapshot(1n, page(2, 1n), () => { reads += 1; }))).toEqual(page(2, 1n));
      expect(reads).toBe(1);
    }));
  });

  it("does not let old phase-two validation certify a replacement with the same begin timestamp", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const oldEntered = yield* Deferred.make<void>();
      const oldRelease = yield* Deferred.make<void>();
      const newEntered = yield* Deferred.make<void>();
      const newRelease = yield* Deferred.make<void>();
      let validations = 0;
      const readLog = Effect.gen(function* () {
        const selected = log.snapshot();
        validations += 1;
        const ordinal = validations;
        if (ordinal === 1) { yield* Deferred.succeed(oldEntered, undefined); yield* Deferred.await(oldRelease); }
        if (ordinal === 2) { yield* Deferred.succeed(newEntered, undefined); yield* Deferred.await(newRelease); }
        return selected;
      });
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, readLog);
      const oldFill = yield* Effect.forkChild(scan(cache, snapshot(0n, page(2))));
      yield* Deferred.await(oldEntered);
      publish(cache, log, 1n, { documents: [], indexes: [write(2, 1n)] });
      const newFill = yield* Effect.forkChild(scan(cache, snapshot(0n, page(2))));
      yield* Deferred.await(newEntered);
      yield* Deferred.succeed(oldRelease, undefined);
      expect(yield* Fiber.join(oldFill)).toEqual(page(2));
      let reads = 0;
      expect(yield* scan(cache, snapshot(1n, page(2, 1n), () => { reads += 1; }))).toEqual(page(2, 1n));
      expect(reads).toBe(1);
      yield* Deferred.succeed(newRelease, undefined);
      expect(yield* Fiber.join(newFill)).toEqual(page(2));
      expect(yield* scan(cache, snapshot(1n, page(2, 1n)))).toEqual(page(2, 1n));
    }));
  });

  it("untracks an entire modified index and rejects metadata writes during a fill", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.sync(() => log.snapshot()));
      const left = { ...request, interval: { start: byte(1), end: byte(4) } };
      const right = { ...request, interval: { start: byte(6), end: byte(9) } };
      yield* scan(cache, snapshot(0n, page(2)), left);
      yield* scan(cache, snapshot(0n, empty), right);
      publish(cache, log, 1n, metadataBatch(1n));
      let reads = 0;
      yield* scan(cache, snapshot(1n, page(2, 1n), () => { reads += 1; }), left);
      yield* scan(cache, snapshot(1n, empty, () => { reads += 1; }), right);
      expect(reads).toBe(2);
      const stale = { ...snapshot(1n, page(2, 1n)), scan: () => Effect.sync(() => {
        publish(cache, log, 2n, metadataBatch(2n));
        return page(2, 1n);
      }) };
      // A different exact page causes a new fill spanning the metadata write.
      yield* scan(cache, stale, { ...request, maxResults: 1 });
      expect(yield* scan(cache, snapshot(2n, page(2, 2n)), { ...request, maxResults: 1 })).toEqual(page(2, 2n));
    }));
  });

  it("preserves a new registration when an evicted same-S fill resumes phase two", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const oldEntered = yield* Deferred.make<void>();
      const oldRelease = yield* Deferred.make<void>();
      const replacementEntered = yield* Deferred.make<void>();
      const replacementRelease = yield* Deferred.make<void>();
      let validations = 0;
      const readLog = Effect.gen(function* () {
        const selected = log.snapshot();
        const ordinal = ++validations;
        if (ordinal === 1) { yield* Deferred.succeed(oldEntered, undefined); yield* Deferred.await(oldRelease); }
        if (ordinal === 4) { yield* Deferred.succeed(replacementEntered, undefined); yield* Deferred.await(replacementRelease); }
        return selected;
      });
      // Two small pages fit; the third admits against the cold oldest page.
      const cache = yield* makeCoreIndexCache({ maxBytes: 1500, verifyPercent: 0 }, readLog);
      const firstRange = { ...request, interval: { start: byte(1), end: byte(4) } };
      const secondRange = { ...request, interval: { start: byte(6), end: byte(9) } };
      const thirdRange = { ...request, interval: { start: byte(11), end: byte(14) } };
      const oldFill = yield* Effect.forkChild(scan(cache, snapshot(0n, page(2)), firstRange));
      yield* Deferred.await(oldEntered);
      yield* scan(cache, snapshot(0n, page(7)), secondRange);
      yield* scan(cache, snapshot(0n, page(12)), thirdRange);
      publish(cache, log, 1n, { documents: [], indexes: [write(2, 1n)] });
      const replacement = yield* Effect.forkChild(scan(cache, snapshot(0n, page(2)), firstRange));
      yield* Deferred.await(replacementEntered);
      yield* Deferred.succeed(oldRelease, undefined);
      yield* Fiber.join(oldFill);
      let reads = 0;
      expect(yield* scan(cache, snapshot(1n, page(2, 1n), () => { reads += 1; }), firstRange)).toEqual(page(2, 1n));
      expect(reads).toBe(1);
      yield* Deferred.succeed(replacementRelease, undefined);
      yield* Fiber.join(replacement);
      yield* scan(cache, snapshot(1n, page(2, 1n)), firstRange);
      publish(cache, log, 2n, { documents: [], indexes: [write(2, 2n)] });
      expect(yield* scan(cache, snapshot(2n, page(2, 2n)), firstRange)).toEqual(page(2, 2n));
    }));
  });

  it("discards population on a write-log gap while allowing the original historical read", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(5n);
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.sync(() => log.snapshot()));
      expect(yield* scan(cache, snapshot(0n, page(2)))).toEqual(page(2));
      expect(yield* scan(cache, snapshot(5n, page(2, 5n)))).toEqual(page(2, 5n));
    }));
  });

  it("cleans up interrupted population without unregistering a later fill", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = new CoreWriteLog(0n);
      const entered = yield* Deferred.make<void>();
      let validations = 0;
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.gen(function* () {
        validations += 1;
        if (validations === 1) { yield* Deferred.succeed(entered, undefined); yield* Effect.never; }
        return log.snapshot();
      }));
      const fill = yield* Effect.forkChild(scan(cache, snapshot(0n, page(2))));
      yield* Deferred.await(entered);
      yield* Fiber.interrupt(fill);
      yield* scan(cache, snapshot(0n, page(2)));
      publish(cache, log, 1n, { documents: [], indexes: [write(2, 1n)] });
      expect(yield* scan(cache, snapshot(1n, page(2, 1n)))).toEqual(page(2, 1n));
    }));
  });

  it.each(["timestamp", "cursor"] as const)("treats a verified %s mismatch as corruption without fallback", async changed => {
    await Effect.runPromise(Effect.gen(function* () {
      const cache = yield* makeCoreIndexCache({}, Effect.succeed(new CoreWriteLog(0n).snapshot()));
      yield* scan(cache, snapshot(0n, page(2)));
      const different = changed === "timestamp" ? page(2, 1n) : page(2, 0n, true);
      const exit = yield* Effect.exit(scan(cache, snapshot(1n, different)));
      expect(Exit.isFailure(exit) && exit.cause.reasons.some(reason => Cause.isDieReason(reason)
        && reason.defect instanceof Error && reason.defect.message.includes("corruption"))).toBe(true);
    }));
  });

  it("propagates persistence failure on a verification hit", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const cache = yield* makeCoreIndexCache({}, Effect.succeed(new CoreWriteLog(0n).snapshot()));
      yield* scan(cache, snapshot(0n, page(2)));
      const failure = new CorePersistenceError({ reason: "unavailable" });
      const exit = yield* Effect.exit(scan(cache, { ...snapshot(1n, empty), scan: () => Effect.fail(failure) }));
      expect(Exit.isFailure(exit) && exit.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === failure)).toBe(true);
    }));
  });

  it("isolates owner lifetimes, bypasses oversized pages, and removes pages on close", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const log = Effect.succeed(new CoreWriteLog(0n).snapshot());
      const first = yield* makeCoreIndexCache({ verifyPercent: 0 }, log);
      const second = yield* makeCoreIndexCache({ verifyPercent: 0 }, log);
      yield* scan(first, snapshot(0n, page(2)));
      expect(yield* scan(second, snapshot(0n, page(3)))).toEqual(page(3));
      first.close();
      expect(yield* scan(first, snapshot(0n, page(4)))).toEqual(page(4));
      const small = yield* makeCoreIndexCache({ maxBytes: 1, verifyPercent: 0 }, log);
      yield* scan(small, snapshot(0n, page(2)));
      expect(yield* scan(small, snapshot(0n, page(3)))).toEqual(page(3));
    }));
  });

  it("does not populate unknown, disabled or foreign physical index references", async () => {
    await Effect.runPromise(Effect.gen(function* () {
      const cache = yield* makeCoreIndexCache({ verifyPercent: 0 }, Effect.succeed(new CoreWriteLog(0n).snapshot()));
      const unknown = { ...request, index: { id: id(99) } };
      yield* scan(cache, snapshot(0n, page(2)), unknown);
      expect(yield* scan(cache, snapshot(0n, page(3)), unknown)).toEqual(page(3));
      const foreign = { ...request, index: { id: id(5), persistenceIndexId: 999n } };
      yield* scan(cache, snapshot(0n, page(2)), foreign);
      expect(yield* scan(cache, snapshot(0n, page(3)), foreign)).toEqual(page(3));
      const selected = registry.indexById(rangeIndex.id);
      if (selected === undefined) throw new Error("Missing cache fixture index");
      const disabled = yield* Effect.fromResult(registry.withIndex({ ...selected.index, state: { type: "Backfilled2", staged: true } }));
      yield* cache.scan({ snapshot: snapshot(0n, page(2)), registry: disabled, request });
      expect(yield* cache.scan({ snapshot: snapshot(0n, page(3)), registry: disabled, request })).toEqual(page(3));
    }));
  });
});
