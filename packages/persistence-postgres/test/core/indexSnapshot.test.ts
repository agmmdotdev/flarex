import { Effect, Exit, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { bytesEqual, compareBytesLexicographically } from "@flarex/utils/bytes";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { decodeDocumentId } from "flarex-protocol/document-id";
import { type CoreTableDefinition } from "../../src/core/api";
import { CorePersistenceError, type CoreHydratedIndexEntry, type CoreIndexPage,
  type CoreIndexScan, type CoreInterval, type CorePersistenceSnapshot } from "../../src/core/contracts";
import { documentIndexKey } from "../../src/core/documentIndex";
import { createCoreIndexSnapshot } from "../../src/core/indexSnapshot";
import { initialRegistry, publicDocumentId, readDocumentObject } from "../../src/core/registry";
import { CoreFinalizationVault, createCoreTransaction } from "../../src/core/transaction";
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import { keyInInterval, pointInterval } from "../../src/core/writeLog";

const internalId = (last: number) => { const bytes = new Uint8Array(16); bytes[15] = last; return bytes; };
const table: CoreTableDefinition = { name: "items", number: 10000, tabletId: internalId(100), namespace: null, state: "active", indexes: [
  { name: "by_id", ref: { id: internalId(101) }, fields: [] },
  { name: "by_value", ref: { id: internalId(102) }, fields: ["value"] },
] };
const byId = table.indexes[0];
const byValue = table.indexes[1];
if (byId === undefined || byValue === undefined) throw new Error("Missing index fixture");
const registry = Result.getOrThrow(initialRegistry([
  { name: "_tables", number: 513, tabletId: internalId(1), namespace: null, state: "active", indexes: [
    { name: "by_id", ref: { id: internalId(2) }, fields: [] },
  ] },
  { name: "_index", number: 514, tabletId: internalId(3), namespace: null, state: "active", indexes: [
    { name: "by_id", ref: { id: internalId(4) }, fields: [] },
  ] }, table,
]));

function documents(count: number) {
  return Array.from({ length: count }, (_, value) => {
    const id = internalId(150 + value);
    const developerId = Result.getOrThrow(publicDocumentId(table, id));
    return { ts: 9n, tableId: table.tabletId, id, jsonValue: Result.getOrThrow(encodeDocumentValue({
      _id: developerId, _creationTime: value + 1, value, nested: { text: `value-${value}` },
    })), deleted: false, prevTs: null };
  });
}

/** A pure reader witness, not an SQL implementation or database isolation proof. */
function reader(count = 4) {
  const rows = documents(count);
  const calls: CoreIndexScan[] = [];
  const snapshot: CorePersistenceSnapshot = {
    timestamp: 10n,
    get: () => Effect.die(new Error("Normal point reads must use ById index pages")),
    scan: request => Effect.sync(() => {
      calls.push(request);
      const index = table.indexes.find(candidate => bytesEqual(candidate.ref.id, request.index.id));
      if (index === undefined) throw new Error("Unexpected fixture index");
      const entries = rows.map(document => ({
        key: Result.getOrThrow(documentIndexKey(index, Result.getOrThrow(readDocumentObject(document, table)))), document,
      })).filter(entry => keyInInterval(entry.key, request.interval))
        .sort((left, right) => compareBytesLexicographically(left.key, right.key) * (request.order === "asc" ? 1 : -1));
      const selected = entries.slice(0, request.maxResults);
      const last = selected.at(-1);
      return { entries: selected, cursor: selected.length >= request.maxResults && last !== undefined
        ? { kind: "after" as const, key: last.key } : { kind: "end" as const } };
    }),
  };
  return { rows, calls, snapshot };
}

function request(index = byValue, interval: CoreInterval = { start: null, end: null }, maxResults = 100,
  order: "asc" | "desc" = "asc"): CoreIndexScan {
  return { index: index.ref, tableId: table.tabletId, interval, order, maxResults };
}

const rowValues = (page: CoreIndexPage) => page.entries.map(entry => Result.getOrThrow(readDocumentObject(entry.document, table)).value);
const keyFor = (entry: CoreHydratedIndexEntry["document"], index = byValue) =>
  Result.getOrThrow(documentIndexKey(index, Result.getOrThrow(readDocumentObject(entry, table))));

describe("translated operation index snapshot", () => {
  it("warms enabled secondary and ById lookups from one fetched range without charging a user read", async () => {
    const physical = reader();
    const snapshot = createCoreIndexSnapshot({ snapshot: physical.snapshot, registry });
    expect(rowValues(await Effect.runPromise(snapshot.scan(request())))).toEqual([0, 1, 2, 3]);
    for (const row of physical.rows) {
      const point = await Effect.runPromise(snapshot.scan(request(byId, pointInterval(keyFor(row, byId)), 2)));
      expect(point.entries).toHaveLength(1);
      expect(point.cursor).toEqual({ kind: "end" });
    }
    expect(rowValues(await Effect.runPromise(snapshot.scan(request(byValue, { start: null, end: null }, 100, "desc")))))
      .toEqual([3, 2, 1, 0]);
    expect(physical.calls).toHaveLength(1);
  });

  it("retains negative coverage and returns independent mutable byte ownership", async () => {
    const physical = reader(0);
    const snapshot = createCoreIndexSnapshot({ snapshot: physical.snapshot, registry });
    expect(await Effect.runPromise(snapshot.scan(request()))).toEqual({ entries: [], cursor: { kind: "end" } });
    expect(await Effect.runPromise(snapshot.scan(request(byValue, { start: internalId(1), end: null }))))
      .toEqual({ entries: [], cursor: { kind: "end" } });
    expect(physical.calls).toHaveLength(1);
    const populated = reader(1);
    const cached = createCoreIndexSnapshot({ snapshot: populated.snapshot, registry });
    const first = await Effect.runPromise(cached.scan(request()));
    first.entries[0]?.document.jsonValue.fill(0);
    first.entries[0]?.key.fill(0);
    expect(rowValues(await Effect.runPromise(cached.scan(request())))).toEqual([0]);
    expect(populated.calls).toHaveLength(1);
  });

  it.each(["asc", "desc"] as const)("certifies only a truncated %s page and preserves its original After cursor", async order => {
    const physical = reader(3);
    const snapshot = createCoreIndexSnapshot({ snapshot: physical.snapshot, registry });
    const first = await Effect.runPromise(snapshot.scan(request(byValue, { start: null, end: null }, 1, order)));
    expect(rowValues(first)).toEqual(order === "asc" ? [0] : [2]);
    expect(first.cursor.kind).toBe("after");
    const last = physical.rows[order === "asc" ? 2 : 0];
    if (last === undefined) throw new Error("Missing fixture row");
    expect(rowValues(await Effect.runPromise(snapshot.scan(request(byValue, pointInterval(keyFor(last)))))))
      .toEqual(order === "asc" ? [2] : [0]);
    expect(physical.calls).toHaveLength(2);
  });

  it("allows one body beyond its budget but refuses complete range coverage afterward", async () => {
    const physical = reader(3);
    const snapshot = createCoreIndexSnapshot({ snapshot: physical.snapshot, registry, maxBytes: 0 });
    expect(rowValues(await Effect.runPromise(snapshot.scan(request())))).toEqual([0, 1, 2]);
    expect(rowValues(await Effect.runPromise(snapshot.scan(request())))).toEqual([0, 1, 2]);
    expect(physical.calls).toHaveLength(2);
    const first = physical.rows[0];
    if (first === undefined) throw new Error("Missing fixture row");
    await Effect.runPromise(snapshot.scan(request(byId, pointInterval(keyFor(first, byId)), 2)));
    expect(physical.calls).toHaveLength(2);
  });

  it("selects resident rows before operation coverage or physical pages", async () => {
    const physical = reader();
    const residentPage: CoreIndexPage = { entries: [], cursor: { kind: "end" } };
    let residentReads = 0;
    const snapshot = createCoreIndexSnapshot({ snapshot: physical.snapshot, registry, maxBytes: 0,
      resident: () => { residentReads += 1; return residentPage; } });
    expect(await Effect.runPromise(snapshot.scan(request()))).toBe(residentPage);
    expect(await Effect.runPromise(snapshot.scan(request()))).toBe(residentPage);
    expect(residentReads).toBe(2);
    expect(physical.calls).toHaveLength(0);
  });

  it.each(["asc", "desc"] as const)("uses only the first three covered components before the %s fallback", async order => {
    const physical = reader(9);
    const snapshot = createCoreIndexSnapshot({ snapshot: physical.snapshot, registry });
    for (const value of [1, 3, 5, 7]) {
      const row = physical.rows[value];
      if (row === undefined) throw new Error("Missing fixture row");
      await Effect.runPromise(snapshot.scan(request(byValue, pointInterval(keyFor(row)))));
    }
    const before = physical.calls.length;
    expect(rowValues(await Effect.runPromise(snapshot.scan(request(byValue, { start: null, end: null }, 100, order)))))
      .toEqual(order === "asc" ? [0, 1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1, 0]);
    const fetched = physical.calls.slice(before);
    expect(fetched).toHaveLength(4);
    const seventh = physical.rows[7];
    if (seventh === undefined) throw new Error("Missing fixture row");
    // The fourth known component is deliberately fetched again. Descending
    // requests reverse the same source-chosen ascending component plan.
    expect(fetched.some(call => call.interval.end === null && keyInInterval(keyFor(seventh), call.interval))).toBe(true);
  });

  it("propagates persistence failure without certifying a negative interval", async () => {
    const physical = reader();
    let failing = true;
    const failure = new CorePersistenceError({ reason: "unavailable" });
    const snapshot = createCoreIndexSnapshot({ snapshot: { ...physical.snapshot,
      scan: input => failing ? Effect.fail(failure) : physical.snapshot.scan(input),
    }, registry });
    expect(Exit.isFailure(await Effect.runPromiseExit(snapshot.scan(request())))).toBe(true);
    failing = false;
    expect(rowValues(await Effect.runPromise(snapshot.scan(request())))).toEqual([0, 1, 2, 3]);
    expect(physical.calls).toHaveLength(1);
  });

  it("serves a transaction point through ById, preserves first-original writes and charges repeated gets", async () => {
    const physical = reader(1);
    const row = physical.rows[0];
    if (row === undefined) throw new Error("Missing fixture row");
    const id = Result.getOrThrow(publicDocumentId(table, row.id));
    const vault = new CoreFinalizationVault();
    const transaction = createCoreTransaction({ snapshot: physical.snapshot, registry, now: 10n,
      idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 10n)), vault }).transaction;
    const original = await Effect.runPromise(transaction.get(id));
    expect(Option.isSome(original)).toBe(true);
    await Effect.runPromise(transaction.get(id));
    expect((await Effect.runPromise(transaction.usage)).user.documentsRead).toBe(2);
    expect(physical.calls).toHaveLength(1);
    expect(physical.calls[0]).toMatchObject({ order: "asc", maxResults: 2, interval: pointInterval(keyFor(row, byId)) });
    await Effect.runPromise(transaction.patch(id, { value: 20 }));
    await Effect.runPromise(transaction.patch(id, { value: 30 }));
    expect(Option.getOrThrow(await Effect.runPromise(transaction.get(id))).value).toBe(30);
    const finalized = vault.take(await Effect.runPromise(transaction.finalize()));
    expect(finalized?.changes).toHaveLength(1);
    expect(finalized?.changes[0]?.original?.ts).toBe(9n);
    expect(finalized?.changes[0]?.originalDocument?.value).toBe(0);
    expect(finalized?.changes[0]?.finalDocument?.value).toBe(30);
    expect(physical.calls).toHaveLength(1);
  });

  it("keeps new pending insert/delete/reinsert state ahead of cached absence", async () => {
    const physical = reader(0);
    const vault = new CoreFinalizationVault();
    const transaction = createCoreTransaction({ snapshot: physical.snapshot, registry, now: 1_000_000n,
      idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 1_000_000n)), vault }).transaction;
    const id = await Effect.runPromise(transaction.insert("items", { value: 1 }));
    const insertedInternalId = Result.getOrThrow(decodeDocumentId(id)).internalId;
    expect(Option.getOrThrow(await Effect.runPromise(transaction.get(id))).value).toBe(1);
    await Effect.runPromise(transaction.delete(id));
    expect(Option.isNone(await Effect.runPromise(transaction.get(id)))).toBe(true);
    // Generated inserts stage old=None without a committed read. Their pending
    // insert/delete observations must stay entirely within this transaction.
    expect(physical.calls).toHaveLength(0);
    // The trusted private writer models reinsertion of this same identity;
    // generated public inserts continue to allocate a new identity.
    const context = createCoreTransaction({ snapshot: physical.snapshot, registry, now: 1_000_000n,
      idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32).fill(1), 1_000_000n)), vault: new CoreFinalizationVault() });
    await Effect.runPromise(context.writePrivate("items", insertedInternalId, { value: 2 }));
    expect(physical.calls).toHaveLength(1);
    await Effect.runPromise(context.writePrivate("items", insertedInternalId, null));
    await Effect.runPromise(context.writePrivate("items", insertedInternalId, { value: 3 }));
    expect(Option.getOrThrow(await Effect.runPromise(context.transaction.get(id))).value).toBe(3);
    await Effect.runPromise(context.transaction.abort());
    const finalized = vault.take(await Effect.runPromise(transaction.finalize()));
    expect(finalized?.changes[0]?.original).toBeUndefined();
    expect(finalized?.changes[0]?.originalDocument).toBeNull();
    expect(finalized?.changes[0]?.finalDocument).toBeNull();
    expect(physical.calls).toHaveLength(1);
  });

  it("does not turn operation prefetch into additional user reads or consumed dependencies", async () => {
    const physical = reader(3);
    const first = physical.rows[0];
    const second = physical.rows[1];
    if (first === undefined || second === undefined) throw new Error("Missing fixture rows");
    const context = createCoreTransaction({ snapshot: physical.snapshot, registry, now: 1_000_000n,
      idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 1_000_000n)), vault: new CoreFinalizationVault(), readonly: true });
    await Effect.runPromise(context.transaction.get(Result.getOrThrow(publicDocumentId(table, first.id))));
    const query = await Effect.runPromise(context.transaction.startQuery({ query: {
      source: { type: "IndexRange", indexName: "items.by_value", order: "asc", range: [] }, operators: [],
    } }));
    const page = await Effect.runPromise(query.nextPage({ maxResults: 2, maxBytes: 1024 * 1024 }));
    expect(page.documents.map(document => document.value)).toEqual([0, 1]);
    expect((await Effect.runPromise(context.transaction.usage)).user.documentsRead).toBe(3);
    const token = await Effect.runPromise(context.finishRead());
    const read = token.reads.find(entry => bytesEqual(entry.indexId, byValue.ref.id));
    expect(read?.intervals).toHaveLength(1);
    const consumed = read?.intervals[0];
    const third = physical.rows[2];
    if (consumed === undefined || third === undefined) throw new Error("Missing consumed interval fixture");
    expect(keyInInterval(keyFor(second), consumed)).toBe(true);
    expect(keyInInterval(keyFor(third), consumed)).toBe(false);
  });

  it.each(["duplicate", "unfinished"] as const)("rejects a %s singleton ById response", async mode => {
    const physical = reader(1);
    const row = physical.rows[0];
    if (row === undefined) throw new Error("Missing fixture row");
    const id = Result.getOrThrow(publicDocumentId(table, row.id));
    const entry = { key: keyFor(row, byId), document: row };
    const transaction = createCoreTransaction({ snapshot: { ...physical.snapshot, scan: () => Effect.succeed({
      entries: mode === "duplicate" ? [entry, entry] : [entry], cursor: mode === "duplicate"
        ? { kind: "end" } : { kind: "after", key: entry.key },
    }) }, registry, now: 10n, idGenerator: Result.getOrThrow(createTransactionIdGenerator(new Uint8Array(32), 10n)), vault: new CoreFinalizationVault() }).transaction;
    const exit = await Effect.runPromiseExit(transaction.get(id));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(exit.cause.reasons).toMatchObject([{ error: { reason: "corruptData" } }]);
    await Effect.runPromise(transaction.abort());
  });
});
