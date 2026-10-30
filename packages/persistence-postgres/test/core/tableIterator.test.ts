import { Cause, Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { bytesEqual } from "@flarex/utils/bytes";
import type { CoreTableDefinition } from "../../src/core/api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CoreIndexPage, type CorePersistence } from "../../src/core/contracts";
import { createCoreLatestTableIterator, createCoreMultiTableIterator, createCoreTableIterator } from "../../src/core/tableIterator";

const id = (n: number) => { const value = new Uint8Array(16); value[15] = n; return value; };
const table: CoreTableDefinition = { name: "items", number: 10001, tabletId: id(1), namespace: null, state: "active",
  indexes: [{ name: "by_name", fields: ["name"], ref: { id: id(2) } }] };
const index = { name: "by_name", fields: ["name"], ref: { id: id(2) } };
function document(n: number, name: string, ts: bigint, prevTs: bigint | null = null): CoreDocumentLogEntry {
  return { ts, tableId: table.tabletId, id: id(n), prevTs, deleted: false,
    jsonValue: Result.getOrThrow(encodeDocumentValue({ _id: Result.getOrThrow(encodeDocumentId(table.number, id(n))), _creationTime: 1, name })) };
}
const key = (name: string, n: number) => Result.getOrThrow(encodeIndexKey([name], Result.getOrThrow(encodeDocumentId(table.number, id(n)))));
const unavailable = () => Effect.die("Unexpected unused physical operation");

function retryWitness(lane: "historical" | "latest", recentTimestamp: Effect.Effect<bigint, CorePersistenceError>,
  scan: (timestamp: bigint) => Effect.Effect<CoreIndexPage, CorePersistenceError>) {
  const snapshots: bigint[] = [];
  const persistence: CorePersistence = { acquireLease: unavailable, latestTimestamp: unavailable, isFresh: unavailable,
    readRetentionBounds: unavailable, write: unavailable, writeIndexBackfill: unavailable, reconcileIndexBackfill: unavailable,
    putGlobal: unavailable, getGlobal: () => Effect.succeed(Option.none()), previousRevisionsOfDocuments: unavailable,
    loadDocuments: () => Effect.succeed({ documents: [], cursor: null, done: true }),
    readSnapshot: timestamp => Effect.sync(() => {
      snapshots.push(timestamp);
      return { timestamp, get: unavailable, scan: () => scan(timestamp) };
    }),
  };
  const budget = { pageSize: 1, documentBytes: 10000, documentCount: 2, logPageSize: 2, maxLogPagesPerStep: 1, maxMetadataEntries: 100 };
  if (lane === "historical") {
    const iterator = createCoreTableIterator({ persistence, table, index, snapshotTs: 10n, recentTimestamp, budget });
    return { snapshots, readCursor: () => iterator.nextPage().pipe(Effect.map(page => page.cursor)) };
  }
  const iterator = createCoreLatestTableIterator({ persistence, table, index, minimumTs: 10n, recentTimestamp, budget, pageSize: 1 });
  return { snapshots, readCursor: () => iterator.nextPage().pipe(Effect.map(page => page.cursor)) };
}

describe("source historical TableIterator", () => {
  it("reconstructs moved/deleted documents, ignores post-S inserts, spills exact revisions and checkpoints only proven ranges", async () => {
    const moved = document(10, "b", 1n), unchanged = document(11, "c", 3n), deleted = document(12, "d", 2n);
    const changed = document(10, "z", 15n, 1n), inserted = document(13, "e", 17n);
    const deletion = { ...document(12, "unused", 16n, 2n), deleted: true, jsonValue: new Uint8Array() };
    const foreign = { ...document(10, "foreign", 14n, 4n), tableId: id(99) };
    const logPages = [[foreign, changed], [deletion, inserted], [document(10, "zz", 19n, 15n)]];
    let scans = 0, logs = 0;
    const predecessorWitnesses: bigint[] = [];
    const persistence: CorePersistence = {
      acquireLease: unavailable, latestTimestamp: unavailable, isFresh: unavailable, readRetentionBounds: unavailable,
      write: unavailable, writeIndexBackfill: unavailable, reconcileIndexBackfill: unavailable, putGlobal: unavailable,
      getGlobal: () => Effect.succeed(Option.none()),
      readSnapshot: timestamp => Effect.succeed({ timestamp, get: unavailable, scan: () => Effect.sync(() => {
        scans += 1;
        return scans === 1 ? { entries: [{ key: key("c", 11), document: unchanged }, { key: key("e", 13), document: inserted }],
          cursor: { kind: "after" as const, key: key("e", 13) } } : { entries: [{ key: key("zz", 10), document: document(10, "zz", 19n, 15n) }], cursor: { kind: "end" as const } };
      }) }),
      loadDocuments: () => Effect.sync(() => {
        const documents = logPages[logs++] ?? [];
        const last = documents.at(-1);
        return { documents, done: logs === logPages.length, cursor: last === undefined ? null : { ts: last.ts, tableId: last.tableId, id: last.id } };
      }),
      previousRevisionsOfDocuments: queries => Effect.sync(() => queries.flatMap(query => {
        predecessorWitnesses.push(query.ts);
        const document = [moved, deleted, unchanged].find(value => value.ts === query.prevTs && bytesEqual(value.id, query.id));
        return document === undefined ? [] : [{ query, document }];
      })),
    };
    const iterator = createCoreTableIterator({ persistence, table, index, snapshotTs: 10n, recentTimestamp: Effect.succeed(20n),
      budget: { pageSize: 2, documentBytes: 10000, documentCount: 2, logPageSize: 2, maxLogPagesPerStep: 1, maxMetadataEntries: 100 } });
    const one = await Effect.runPromise(iterator.nextPage());
    const two = await Effect.runPromise(iterator.nextPage());
    expect(one).toMatchObject({ entries: [], cursor: null, done: false, progressed: false });
    expect(two).toMatchObject({ entries: [], cursor: null, done: false, progressed: false });
    const collected: number[] = [];
    let finished = false;
    for (let calls = 0; calls < 12; calls += 1) {
      const page = await Effect.runPromise(iterator.nextPage());
      collected.push(...page.entries.map(entry => entry.document.id[15] ?? -1));
      if (page.done) { expect(page.cursor).toEqual({ kind: "end" }); finished = true; break; }
    }
    expect(finished).toBe(true);
    expect(collected).toEqual([10, 11, 12]);
    expect(predecessorWitnesses.length).toBeGreaterThan(2);
    expect(new Set(predecessorWitnesses)).toEqual(new Set([11n]));
  });

  it("does not retry unavailable errors and poisons partially observed state after failure", async () => {
    let scans = 0;
    const persistence: CorePersistence = { acquireLease: unavailable, latestTimestamp: unavailable, isFresh: unavailable,
      readRetentionBounds: unavailable, write: unavailable, writeIndexBackfill: unavailable, reconcileIndexBackfill: unavailable,
      putGlobal: unavailable, getGlobal: () => Effect.succeed(Option.none()), loadDocuments: unavailable, previousRevisionsOfDocuments: unavailable,
      readSnapshot: timestamp => Effect.succeed({ timestamp, get: unavailable, scan: () => {
        scans += 1; return Effect.fail(new CorePersistenceError({ reason: "unavailable" }));
      } }) };
    const iterator = createCoreTableIterator({ persistence, table, index, snapshotTs: 10n,
      budget: { pageSize: 2, documentBytes: 10000, documentCount: 1, logPageSize: 2, maxLogPagesPerStep: 1, maxMetadataEntries: 100 } });
    expect((await Effect.runPromise(Effect.result(iterator.nextPage())))._tag).toBe("Failure");
    const result = await Effect.runPromise(Effect.result(iterator.nextPage()));
    expect(Result.isFailure(result) && result.failure.reason).toBe("closed");
    expect(scans).toBe(1);
  });

  it.each(["historical", "latest"] as const)("reselects a fresh timestamp for each eligible %s snapshot retry", async lane => {
    for (const reason of ["timeout", "outOfRetention"] as const) {
      let recentReads = 0, scans = 0;
      const witness = retryWitness(lane, Effect.sync(() => BigInt(++recentReads) * 10n), () => Effect.suspend(() => {
        scans += 1;
        return scans === 1 ? Effect.fail(new CorePersistenceError({ reason }))
          : Effect.succeed({ entries: [], cursor: { kind: "end" } });
      }));
      expect(await Effect.runPromise(witness.readCursor())).toEqual({ kind: "end" });
      expect(witness.snapshots).toEqual([10n, 20n]);
      expect({ recentReads, scans }).toEqual({ recentReads: 2, scans: 2 });
    }
  });

  it.each(["historical", "latest"] as const)("stops the %s retry after one repetition and preserves its last failure", async lane => {
    let recentReads = 0, scans = 0;
    const first = new CorePersistenceError({ reason: "timeout" }), last = new CorePersistenceError({ reason: "outOfRetention" });
    const witness = retryWitness(lane, Effect.sync(() => BigInt(++recentReads) * 10n), () => Effect.suspend(() => {
      scans += 1; return Effect.fail(scans === 1 ? first : last);
    }));
    const result = await Effect.runPromise(Effect.result(witness.readCursor()));
    expect(Result.isFailure(result) && result.failure).toBe(last);
    expect(witness.snapshots).toEqual([10n, 20n]);
    expect({ recentReads, scans }).toEqual({ recentReads: 2, scans: 2 });
  });

  it.each(["historical", "latest"] as const)("does not retry unrelated failures, defects or interruption in a %s read", async lane => {
    for (const outcome of ["unavailable", "defect", "interruption"] as const) {
      let recentReads = 0, scans = 0;
      const failure = new CorePersistenceError({ reason: "unavailable" }), defect = new Error("Reader defect");
      const witness = retryWitness(lane, Effect.sync(() => { recentReads += 1; return 10n; }), () => Effect.suspend(() => {
        scans += 1;
        return outcome === "unavailable" ? Effect.fail(failure) : outcome === "defect" ? Effect.die(defect) : Effect.interrupt;
      }));
      const exit = await Effect.runPromiseExit(witness.readCursor());
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        if (outcome === "unavailable") expect(exit.cause.reasons).toMatchObject([{ _tag: "Fail", error: failure }]);
        else if (outcome === "defect") expect(exit.cause.reasons).toMatchObject([{ _tag: "Die", defect }]);
        else expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      }
      expect({ recentReads, scans }).toEqual({ recentReads: 1, scans: 1 });
    }
  });

  it.each(["historical", "latest"] as const)("preserves the complete mixed failure without retrying a %s read", async lane => {
    let recentReads = 0, scans = 0;
    const failure = new CorePersistenceError({ reason: "timeout" }), defect = new Error("Reader cleanup defect");
    const mixed = Cause.combine(Cause.combine(Cause.fail(failure), Cause.die(defect)), Cause.interrupt(99));
    const witness = retryWitness(lane, Effect.sync(() => { recentReads += 1; return 10n; }), () => Effect.suspend(() => {
      scans += 1; return Effect.failCause(mixed);
    }));
    const exit = await Effect.runPromiseExit(witness.readCursor());
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause.reasons.map(reason => reason._tag)).toEqual(["Fail", "Die", "Interrupt"]);
      // Effect.fn clones reason wrappers to add stack annotations; payload identities stay exact.
      const [typed, bug, cancelled] = exit.cause.reasons;
      expect(typed !== undefined && Cause.isFailReason(typed) ? typed.error : undefined).toBe(failure);
      expect(bug !== undefined && Cause.isDieReason(bug) ? bug.defect : undefined).toBe(defect);
      expect(cancelled !== undefined && Cause.isInterruptReason(cancelled) ? cancelled.fiberId : undefined).toBe(99);
    }
    expect({ recentReads, scans }).toEqual({ recentReads: 1, scans: 1 });
  });

  it("keeps a regressed historical timestamp terminal before another physical scan", async () => {
    let recentReads = 0;
    const first = document(10, "a", 1n);
    const witness = retryWitness("historical", Effect.sync(() => ++recentReads === 1 ? 20n : 10n), () => Effect.succeed({
      entries: [{ key: key("a", 10), document: first }], cursor: { kind: "after", key: key("a", 10) },
    }));
    expect(await Effect.runPromise(witness.readCursor())).toEqual({ kind: "after", key: key("a", 10) });
    const result = await Effect.runPromise(Effect.result(witness.readCursor()));
    expect(Result.isFailure(result) && result.failure.reason).toBe("corruptData");
    expect(witness.snapshots).toEqual([20n]);
    expect(recentReads).toBe(2);
  });

  it("shares one global log walk across registered tables and frees unregistered table observations", async () => {
    const second: CoreTableDefinition = { ...table, name: "second", number: 10002, tabletId: id(50) };
    const firstOld = document(10, "first", 1n);
    const secondOld = { ...document(20, "second", 2n), tableId: second.tabletId,
      jsonValue: Result.getOrThrow(encodeDocumentValue({ _id: Result.getOrThrow(encodeDocumentId(second.number, id(20))), _creationTime: 1, name: "second" })) };
    let walks = 0;
    const persistence: CorePersistence = { acquireLease: unavailable, latestTimestamp: unavailable, isFresh: unavailable,
      readRetentionBounds: unavailable, write: unavailable, writeIndexBackfill: unavailable, reconcileIndexBackfill: unavailable,
      putGlobal: unavailable, getGlobal: () => Effect.succeed(Option.none()),
      readSnapshot: timestamp => Effect.succeed({ timestamp, get: unavailable, scan: () => Effect.succeed({ entries: [], cursor: { kind: "end" } }) }),
      loadDocuments: () => Effect.sync(() => {
        walks += 1;
        return { documents: [{ ...firstOld, ts: 11n, prevTs: 1n }, { ...secondOld, ts: 12n, prevTs: 2n }], done: true, cursor: null };
      }), previousRevisionsOfDocuments: queries => Effect.succeed(queries.flatMap(query => {
        const document = [firstOld, secondOld].find(value => bytesEqual(value.tableId, query.tableId) && value.ts === query.prevTs);
        return document === undefined ? [] : [{ query, document }];
      })),
    };
    const multi = createCoreMultiTableIterator({ persistence, snapshotTs: 10n, tables: [table, second], recentTimestamp: Effect.succeed(20n),
      budget: { pageSize: 2, documentBytes: 10000, documentCount: 1, logPageSize: 2, maxLogPagesPerStep: 1, maxMetadataEntries: 100 } });
    expect((await Effect.runPromise(multi.table(table, index).nextPage())).entries.map(entry => entry.document.id)).toEqual([id(10)]);
    multi.unregisterTable(table.tabletId);
    expect((await Effect.runPromise(multi.table(second, index).nextPage())).entries.map(entry => entry.document.id)).toEqual([id(20)]);
    expect(walks).toBe(1);
    expect(() => multi.table(table, index)).toThrow("not registered");
  });

  it("batches exact predecessor and spilled body reloads and restores key order from unordered physical rows", async () => {
    const old = [document(10, "a", 1n), document(11, "b", 2n), document(12, "c", 3n), document(13, "d", 4n)];
    const unchanged = old[0];
    if (unchanged === undefined) throw new Error("Missing test revision");
    const batches: number[] = [];
    const persistence: CorePersistence = { acquireLease: unavailable, latestTimestamp: unavailable, isFresh: unavailable,
      readRetentionBounds: unavailable, write: unavailable, writeIndexBackfill: unavailable, reconcileIndexBackfill: unavailable,
      putGlobal: unavailable, getGlobal: () => Effect.succeed(Option.none()),
      readSnapshot: timestamp => Effect.succeed({ timestamp, get: unavailable, scan: () => Effect.succeed({ entries: [{ key: key("a", 10), document: unchanged }], cursor: { kind: "end" } }) }),
      loadDocuments: () => Effect.succeed({ documents: old.slice(1).map(value => ({ ...value, ts: value.ts + 10n, prevTs: value.ts })), done: true, cursor: null }),
      previousRevisionsOfDocuments: queries => Effect.sync(() => {
        batches.push(queries.length);
        return queries.flatMap(query => { const document = old.find(value => value.ts === query.prevTs && bytesEqual(value.id, query.id));
          return document === undefined ? [] : [{ query, document }]; }).toReversed();
      }),
    };
    const iterator = createCoreTableIterator({ persistence, snapshotTs: 10n, table, index, recentTimestamp: Effect.succeed(20n),
      budget: { pageSize: 4, documentBytes: 10000, documentCount: 2, logPageSize: 8, maxLogPagesPerStep: 1, maxMetadataEntries: 100 } });
    const page = await Effect.runPromise(iterator.nextPage());
    expect(page.entries.map(entry => entry.document.id[15])).toEqual([10, 11]);
    expect(page.done).toBe(false);
    const final = await Effect.runPromise(iterator.nextPage());
    expect(final.entries.map(entry => entry.document.id[15])).toEqual([12, 13]);
    expect(final.done).toBe(true);
    expect(batches).toEqual([2, 1, 2, 2]);
  });

  it("fails closed at predecessor metadata capacity and rejects oversized bodies before decoding or reload", async () => {
    const first = document(10, "a", 1n), second = document(11, "b", 2n);
    let exactReads = 0;
    const persistence: CorePersistence = { acquireLease: unavailable, latestTimestamp: unavailable, isFresh: unavailable,
      readRetentionBounds: unavailable, write: unavailable, writeIndexBackfill: unavailable, reconcileIndexBackfill: unavailable,
      putGlobal: unavailable, getGlobal: () => Effect.succeed(Option.none()),
      readSnapshot: timestamp => Effect.succeed({ timestamp, get: unavailable, scan: () => Effect.succeed({ entries: [{ key: key("a", 10), document: first }], cursor: { kind: "end" } }) }),
      loadDocuments: () => Effect.succeed({ documents: [{ ...first, ts: 11n, prevTs: 1n }, { ...second, ts: 12n, prevTs: 2n }], done: true, cursor: null }),
      previousRevisionsOfDocuments: () => Effect.sync(() => { exactReads += 1; return []; }),
    };
    const budget = { pageSize: 2, documentBytes: 10000, documentCount: 2, logPageSize: 2, maxLogPagesPerStep: 1, maxMetadataEntries: 1 };
    const metadata = createCoreTableIterator({ persistence, table, index, snapshotTs: 10n, recentTimestamp: Effect.succeed(20n), budget });
    const result = await Effect.runPromise(Effect.result(metadata.nextPage()));
    expect(Result.isFailure(result) && result.failure.reason).toBe("capacity");
    expect(exactReads).toBe(0);
    const body = createCoreTableIterator({ persistence, table, index, snapshotTs: 10n, recentTimestamp: Effect.succeed(10n),
      budget: { ...budget, documentBytes: first.jsonValue.byteLength - 1, maxMetadataEntries: 10 } });
    const oversized = await Effect.runPromise(Effect.result(body.nextPage()));
    expect(Result.isFailure(oversized) && oversized.failure.reason).toBe("capacity");
    expect(exactReads).toBe(0);
  });

  it("bounds latest validation body pages without skipping unreturned source coverage", async () => {
    const first = document(10, "a", 1n), second = document(11, "b", 2n);
    let scans = 0;
    const persistence = { readSnapshot: (timestamp: bigint) => Effect.succeed({ timestamp, get: unavailable, scan: () => Effect.sync(() => {
      scans += 1;
      return { entries: scans === 1 ? [{ key: key("a", 10), document: first }, { key: key("b", 11), document: second }]
        : [{ key: key("b", 11), document: second }], cursor: { kind: "end" as const } };
    }) }) };
    const latest = createCoreLatestTableIterator({ persistence, table, index, minimumTs: 10n, recentTimestamp: Effect.succeed(20n), pageSize: 2,
      budget: { documentCount: 2, documentBytes: Math.max(first.jsonValue.byteLength, second.jsonValue.byteLength) } });
    const one = await Effect.runPromise(latest.nextPage());
    expect(one.entries.map(entry => entry.document.id[15])).toEqual([10]);
    expect(one.cursor).toEqual({ kind: "after", key: key("a", 10) });
    const two = await Effect.runPromise(latest.nextPage());
    expect(two.entries.map(entry => entry.document.id[15])).toEqual([11]);
    expect(two.cursor).toEqual({ kind: "end" });
  });
});
