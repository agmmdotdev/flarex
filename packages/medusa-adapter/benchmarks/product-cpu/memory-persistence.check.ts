import assert from "node:assert/strict";
import { Effect, Option, Result } from "effect";
import { makeMemoryPersistence } from "./memory-persistence";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistenceIndexEntry } from "../../../persistence-postgres/src/core/contracts";

const store = makeMemoryPersistence(), port = store.persistence;
const run = Effect.runPromise;
const lease = await run(port.acquireLease());
const table = new Uint8Array(16).fill(1), id = new Uint8Array(16).fill(2), index = { id: new Uint8Array(16).fill(3) };
const entry = (ts: bigint, text: string, deleted = false): CoreDocumentLogEntry => ({ ts, tableId: table.slice(), id: id.slice(),
  jsonValue: new TextEncoder().encode(text), deleted, prevTs: ts === 1n ? null : ts - 1n });
const indexed = (ts: bigint, deleted = false): CorePersistenceIndexEntry => ({ mode: "scanComplete", ts, index,
  key: new Uint8Array([7]), value: deleted ? null : { tableId: table, documentId: id }, prev: null });
const old = entry(1n, "old");
await run(port.write(lease, { documents: [old], indexes: [indexed(1n)] }));
old.jsonValue.fill(0);
const at1 = await run(port.readSnapshot(1n));
assert.equal(new TextDecoder().decode(Option.getOrThrow(await run(at1.get(table, id))).jsonValue), "old");
await run(port.write(lease, { documents: [entry(2n, "new")], indexes: [indexed(2n)] }));
const at2 = await run(port.readSnapshot(2n));
assert.equal(new TextDecoder().decode(Option.getOrThrow(await run(at1.get(table, id))).jsonValue), "old");
assert.equal(new TextDecoder().decode(Option.getOrThrow(await run(at2.get(table, id))).jsonValue), "new");
const scan = { index, tableId: table, interval: { start: null, end: null }, order: "asc" as const, maxResults: 1 };
const page = await run(at2.scan(scan));
assert.equal(page.entries[0]?.document.ts, 2n);
assert.equal(page.cursor.kind, "after");
assert.equal((await run(at2.scan({ ...scan, interval: { start: null, end: new Uint8Array([7]) } }))).entries.length, 0);
const detached = Option.getOrThrow(await run(at2.get(table, id))); detached.jsonValue.fill(0);
assert.equal(new TextDecoder().decode(Option.getOrThrow(await run(at2.get(table, id))).jsonValue), "new");
await run(port.write(lease, { documents: [entry(3n, "null", true)], indexes: [indexed(3n, true)] }));
const at3 = await run(port.readSnapshot(3n));
assert.equal(Option.getOrThrow(await run(at3.get(table, id))).deleted, true);
assert.equal((await run(at3.scan(scan))).entries.length, 0);
assert.equal((await run(at2.scan(scan))).entries.length, 1);
const duplicate = await run(Effect.result(port.write(lease, { documents: [entry(4n, "must not publish")], indexes: [indexed(4n), indexed(4n)] })));
assert(Result.isFailure(duplicate));
assert.equal(duplicate.failure.reason, "corruptData");
assert.equal(await run(port.latestTimestamp(lease)), 3n);
const successor = await run(port.acquireLease());
const stale = await run(Effect.result(port.putGlobal(lease, "bad", new Uint8Array([1]))));
assert(Result.isFailure(stale)); assert.equal(stale.failure.reason, "leaseLost");
assert(Option.isNone(await run(port.getGlobal("bad"))));
const timestamp = "9007199254740993";
await run(port.putGlobal(successor, "max_repeatable_ts", new TextEncoder().encode(timestamp)));
assert.equal(await run(port.latestTimestamp(successor)), 9007199254740993n);
const log = await run(port.loadDocuments({ start: 1n, end: 3n, maxResults: 2, order: "desc" }));
assert.deepEqual(log.documents.map(row => row.ts), [3n, 2n]); assert.equal(log.done, false);
assert(log.cursor !== null);
const next = await run(port.loadDocuments({ start: 1n, end: 3n, maxResults: 2, order: "desc", after: log.cursor }));
assert.deepEqual(next.documents.map(row => row.ts), [1n]); assert.equal(next.done, true);
const historical = await run(port.previousRevisions([{ tableId: table, id, ts: 3n }]));
assert.equal(historical[0]?.document.ts, 2n);
const exact = await run(port.previousRevisionsOfDocuments([{ tableId: table, id, ts: 3n, prevTs: 1n }]));
assert.equal(exact[0]?.document.ts, 1n);
const rejecting = { validateIndex: () => Effect.void,
  validateDocument: () => Effect.fail(new CorePersistenceError({ reason: "outOfRetention" })) };
for (const attempt of [port.previousRevisions([{ tableId: table, id, ts: 3n }], rejecting),
  port.previousRevisionsOfDocuments([{ tableId: table, id, ts: 3n, prevTs: 1n }], rejecting)]) {
  const rejected = await run(Effect.result(attempt));
  assert(Result.isFailure(rejected)); assert.equal(rejected.failure.reason, "outOfRetention");
}
await run(port.putGlobal(successor, "document_min_snapshot_ts", new TextEncoder().encode("3")));
for (const attempt of [port.previousRevisions([{ tableId: table, id, ts: 2n }]),
  port.previousRevisionsOfDocuments([{ tableId: table, id, ts: 2n, prevTs: 1n }])]) {
  const rejected = await run(Effect.result(attempt));
  assert(Result.isFailure(rejected)); assert.equal(rejected.failure.reason, "outOfRetention");
}
assert.deepEqual(await run(port.previousRevisions([], rejecting)), []);
assert.deepEqual(await run(port.previousRevisionsOfDocuments([], rejecting)), []);
console.log(JSON.stringify({ storagePortChecks: "passed", databaseEngines: false }));
