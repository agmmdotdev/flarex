import { Deferred, Effect, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeDocumentValue } from "flarex-protocol/document-value";
import { encodeIndexKey } from "flarex-protocol/index-key";
import type { CoreDocumentLogEntry, CorePersistenceIndexEntry, CorePersistenceSnapshot } from "../../src/core/contracts";
import { createCorePersistence } from "../../src/database/corePersistence/persistence";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";

const tableId = identity(10);
const indexId = identity(20);
const documentId = identity(30);
const resultId = identity(31);
const utf8 = new TextEncoder();

function identity(value: number): Uint8Array {
  const id = new Uint8Array(16);
  new DataView(id.buffer).setUint32(12, value, false);
  return id;
}

function document(ts: bigint, name: string, id = documentId, prevTs: bigint | null = null): CoreDocumentLogEntry {
  return { ts, tableId, id, deleted: false, prevTs,
    jsonValue: Result.getOrThrow(encodeDocumentValue({
      _id: Result.getOrThrow(encodeDocumentId(100, id)), _creationTime: 1, name,
    })),
  };
}

function key(name: string, id = documentId): Uint8Array {
  return Result.getOrThrow(encodeIndexKey([name], Result.getOrThrow(encodeDocumentId(100, id))));
}

function index(ts: bigint, name: string, id = documentId, deleted = false): CorePersistenceIndexEntry {
  return { ts, index: { id: indexId }, key: key(name, id), mode: "scanComplete", prev: null,
    value: deleted ? null : { tableId, documentId: id } };
}

function scan(snapshot: CorePersistenceSnapshot, maxResults = 100, order: "asc" | "desc" = "asc",
  interval: Readonly<{ start: Uint8Array | null; end: Uint8Array | null }> = { start: null, end: null }) {
  return Effect.runPromise(snapshot.scan({ index: { id: indexId }, tableId, interval, order, maxResults }));
}

function after(keyBytes: Uint8Array): Uint8Array {
  const bound = new Uint8Array(keyBytes.length + 1);
  bound.set(keyBytes);
  return bound;
}

export function registerCorePersistenceScenarios(
  lane: string,
  create: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>,
) {
  const withFixture = async (run: (fixture: CorePersistenceFixture) => Promise<void>, sqlPageSize?: number) => {
    const fixture = await create(sqlPageSize === undefined ? {} : { sqlPageSize });
    try { await run(fixture); } finally { await fixture.close(); }
  };
  describe(`translated five-table persistence (${lane})`, () => {
    it("persists a large ordinary-index batch without losing backend execution or its fence", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      const names = Array.from({ length: 7000 }, (_, offset) => `large-${String(offset).padStart(5, "0")}`);
      await Effect.runPromise(persistence.write(lease, {
        documents: [document(1n, "large-index-batch")], indexes: names.map(name => index(1n, name)),
      }));
      expect(await Effect.runPromise(persistence.latestTimestamp(lease))).toBe(1n);
      const snapshot = await Effect.runPromise(persistence.readSnapshot(1n));
      const actual: Uint8Array[] = [];
      let interval: Readonly<{ start: Uint8Array | null; end: Uint8Array | null }> = { start: null, end: null };
      while (true) {
        const page = await scan(snapshot, 512, "asc", interval);
        actual.push(...page.entries.map(entry => entry.key));
        expect(page.entries.every(entry => entry.document.jsonValue.length !== 0 && entry.document.ts === 1n)).toBe(true);
        if (page.cursor.kind === "end") break;
        interval = { start: after(page.cursor.key), end: null };
      }
      expect(actual).toEqual(names.map(name => key(name)));
      expect(await Effect.runPromise(fixture.persistence.isFresh(lease))).toBe(false);
    }));

    it("hydrates unchanged keys from the exact document revision and retains tombstones", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      await Effect.runPromise(persistence.write(lease, { documents: [document(1n, "first")], indexes: [index(1n, "same")] }));
      const old = await Effect.runPromise(persistence.readSnapshot(1n));
      await Effect.runPromise(persistence.write(lease, { documents: [document(2n, "second", documentId, 1n)], indexes: [index(2n, "same")] }));
      expect((await scan(old)).entries[0]?.document).toEqual(document(1n, "first"));
      const current = await Effect.runPromise(persistence.readSnapshot(2n));
      expect((await scan(current)).entries[0]?.document).toEqual(document(2n, "second", documentId, 1n));
      await Effect.runPromise(persistence.write(lease, { documents: [{ ...document(3n, "unused"), deleted: true, jsonValue: new Uint8Array(), prevTs: 2n }],
        indexes: [index(3n, "same", documentId, true)] }));
      const deleted = await Effect.runPromise(persistence.readSnapshot(3n));
      expect((await scan(deleted)).entries).toEqual([]);
      const tombstone = await Effect.runPromise(deleted.get(tableId, documentId));
      expect(Option.isSome(tombstone) && tombstone.value.deleted).toBe(true);
      const reopened = await fixture.reopen();
      const newLease = await Effect.runPromise(reopened.acquireLease());
      expect(await Effect.runPromise(reopened.latestTimestamp(newLease))).toBe(3n);
      expect((await scan(await Effect.runPromise(reopened.readSnapshot(1n)))).entries[0]?.document).toEqual(document(1n, "first"));
    }));

    it("rolls back documents, indexes and a private outcome together after an index failure", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      const first = index(1n, "one");
      const rejected = await Effect.runPromise(Effect.result(persistence.write(lease, {
        documents: [document(1n, "user"), document(1n, "private-outcome", resultId)], indexes: [first, first],
      })));
      expect(Result.isFailure(rejected)).toBe(true);
      const snapshot = await Effect.runPromise(persistence.readSnapshot(1n));
      expect(await Effect.runPromise(snapshot.get(tableId, documentId))).toEqual(Option.none());
      expect(await Effect.runPromise(snapshot.get(tableId, resultId))).toEqual(Option.none());
      expect((await scan(snapshot)).entries).toEqual([]);
      await Effect.runPromise(persistence.write(lease, {
        documents: [document(1n, "user"), document(1n, "private-outcome", resultId)], indexes: [first],
      }));
      expect(Option.isSome(await Effect.runPromise(snapshot.get(tableId, resultId)))).toBe(true);
    }));

    it("buffers long common prefixes across SQL pages and paginates in full-key order", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      const names = ["d", "b", "a", "c"].map(suffix => "p".repeat(2600) + suffix);
      const rows = names.map((name, offset) => ({ name, id: identity(100 + offset) }));
      await Effect.runPromise(persistence.write(lease, { documents: rows.map(row => document(1n, row.name, row.id)),
        indexes: rows.map(row => index(1n, row.name, row.id)) }));
      const snapshot = await Effect.runPromise(persistence.readSnapshot(1n));
      const expected = [...rows].toSorted((a, b) => a.name.localeCompare(b.name)).map(row => key(row.name, row.id));
      const first = await scan(snapshot, 2);
      expect(first.entries.map(entry => entry.key)).toEqual(expected.slice(0, 2));
      expect(first.cursor.kind).toBe("after");
      const second = await scan(snapshot, 2, "asc", { start: after(expected[1] ?? new Uint8Array()), end: null });
      expect(second.entries.map(entry => entry.key)).toEqual(expected.slice(2));
      expect(second.cursor.kind).toBe("after");
      expect((await scan(snapshot, 2, "asc", { start: after(expected[3] ?? new Uint8Array()), end: null })).cursor.kind).toBe("end");
      const reverse = await scan(snapshot, 2, "desc");
      expect(reverse.entries.map(entry => entry.key)).toEqual(expected.slice(2).toReversed());
      const reverseNext = await scan(snapshot, 2, "desc", { start: null, end: expected[2] ?? null });
      expect(reverseNext.entries.map(entry => entry.key)).toEqual(expected.slice(0, 2).toReversed());
      expect((await scan(snapshot, 10, "asc", { start: expected[1] ?? null, end: expected[3] ?? null })).entries.map(entry => entry.key))
        .toEqual(expected.slice(1, 3));
    }, 1));

    it("makes old scanning backfill idempotent without overriding later moves/deletes", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      await Effect.runPromise(persistence.write(lease, { documents: [document(1n, "old")], indexes: [] }));
      await Effect.runPromise(persistence.write(lease, { documents: [document(2n, "new", documentId, 1n)],
        indexes: [index(2n, "old", documentId, true), index(2n, "new")] }));
      const backfill = { ...index(1n, "old"), mode: "scanning" as const };
      await Effect.runPromise(persistence.writeIndexBackfill(lease, [backfill]));
      await Effect.runPromise(persistence.writeIndexBackfill(lease, [backfill]));
      await Effect.runPromise(persistence.reconcileIndexBackfill(lease, { id: indexId }));
      expect((await scan(await Effect.runPromise(persistence.readSnapshot(2n)))).entries.map(entry => entry.key)).toEqual([key("new")]);
      expect((await scan(await Effect.runPromise(persistence.readSnapshot(1n)))).entries[0]?.document).toEqual(document(1n, "old"));
    }, 1));

    it("rejects fabricated leases and stale owners while read-only acquisition is atomic", () => withFixture(async fixture => {
      const first = fixture.persistence;
      const lease = await Effect.runPromise(first.acquireLease());
      const second = await fixture.reopen();
      const replacement = await Effect.runPromise(second.acquireLease());
      const stale = await Effect.runPromise(Effect.result(first.write(lease, { documents: [document(1n, "stale")], indexes: [] })));
      expect(stale).toMatchObject({ _tag: "Failure", failure: { reason: "leaseLost" } });
      const forged = await Effect.runPromise(Effect.result(second.write({ token: replacement.token }, { documents: [], indexes: [] })));
      expect(forged).toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
      await fixture.query(`INSERT INTO "${fixture.namespace}".read_only (instance_name) VALUES ($1)`, [fixture.instanceName]);
      expect(await Effect.runPromise(Effect.result((await fixture.reopen()).acquireLease())))
        .toMatchObject({ _tag: "Failure", failure: { reason: "readOnly" } });
      await fixture.query(`DELETE FROM "${fixture.namespace}".read_only WHERE instance_name = $1`, [fixture.instanceName]);
      await Effect.runPromise(second.write(replacement, { documents: [document(1n, "current")], indexes: [] }));
    }));

    it("distinguishes missing rows, retention expiry and corrupted retention metadata", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      const snapshot = await Effect.runPromise(persistence.readSnapshot(1n));
      expect(await Effect.runPromise(snapshot.get(tableId, documentId))).toEqual(Option.none());
      await Effect.runPromise(persistence.putGlobal(lease, "document_min_snapshot_ts", utf8.encode("2")));
      expect(await Effect.runPromise(Effect.result(snapshot.get(tableId, documentId))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "outOfRetention" } });
      await Effect.runPromise(persistence.putGlobal(lease, "min_snapshot_ts", utf8.encode("2")));
      expect(await Effect.runPromise(Effect.result(persistence.readSnapshot(1n))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "outOfRetention" } });
      await Effect.runPromise(persistence.putGlobal(lease, "min_snapshot_ts", utf8.encode("corrupt")));
      expect(await Effect.runPromise(Effect.result(persistence.readSnapshot(2n))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
      await Effect.runPromise(persistence.putGlobal(lease, "min_snapshot_ts", utf8.encode("01")));
      expect(await Effect.runPromise(Effect.result(persistence.readSnapshot(2n))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
    }));

    it.each(["point", "index"] as const)("rejects a %s read when retention advances after its rows were fetched", async kind => {
      const fetched = await Effect.runPromise(Deferred.make<void>());
      const release = await Effect.runPromise(Deferred.make<void>());
      let armed = false;
      let fetchedRows = 0;
      const fixture = await create({ wrapRuntimeDriver: driver => ({
        withConnection: driver.withConnection,
        transaction: driver.transaction,
        query: (statement, parameters) => driver.query(statement, parameters).pipe(Effect.tap(rows => {
          const matches = kind === "point"
            ? statement.startsWith("SELECT ts::text AS ts, table_id, id, json_value")
            : statement.startsWith("SELECT a.ts::text AS ts, a.key_prefix");
          if (!armed || !matches) return Effect.void;
          armed = false;
          fetchedRows = rows.length;
          return Effect.gen(function* () {
            yield* Deferred.succeed(fetched, undefined);
            yield* Deferred.await(release);
          });
        })),
      }) });
      let reading: Promise<unknown> | undefined;
      try {
        const persistence = fixture.persistence;
        const lease = await Effect.runPromise(persistence.acquireLease());
        await Effect.runPromise(persistence.write(lease, {
          documents: [document(1n, "retained")], indexes: [index(1n, "retained")],
        }));
        const snapshot = await Effect.runPromise(persistence.readSnapshot(1n));
        armed = true;
        const operation = kind === "point" ? snapshot.get(tableId, documentId).pipe(Effect.asVoid)
          : snapshot.scan({ index: { id: indexId }, tableId,
            interval: { start: null, end: null }, order: "asc", maxResults: 1 }).pipe(Effect.asVoid);
        reading = Effect.runPromise(Effect.result(operation));
        await Effect.runPromise(Deferred.await(fetched));
        expect(fetchedRows).toBe(1);
        await Effect.runPromise(persistence.putGlobal(lease,
          kind === "point" ? "document_min_snapshot_ts" : "min_snapshot_ts", utf8.encode("2")));
        await Effect.runPromise(Deferred.succeed(release, undefined));
        expect(await reading).toMatchObject({ _tag: "Failure", failure: { reason: "outOfRetention" } });
      } finally {
        await Effect.runPromise(Deferred.succeed(release, undefined));
        try { await reading; } finally { await fixture.close(); }
      }
    });

    it("reconstructs outcome-only progress and persisted repeatable bounds after reopening", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      await Effect.runPromise(persistence.write(lease, { documents: [document(7n, "private-outcome", resultId)], indexes: [] }));
      await Effect.runPromise(persistence.putGlobal(lease, "max_repeatable_ts", utf8.encode("9")));
      const reopened = await fixture.reopen();
      const replacement = await Effect.runPromise(reopened.acquireLease());
      expect(await Effect.runPromise(reopened.latestTimestamp(replacement))).toBe(9n);
      const snapshot = await Effect.runPromise(reopened.readSnapshot(9n));
      expect(await Effect.runPromise(snapshot.get(tableId, resultId))).toEqual(Option.some(document(7n, "private-outcome", resultId)));
      expect(await Effect.runPromise(snapshot.get(tableId, documentId))).toEqual(Option.none());
    }));

    it("preserves timestamps beyond JavaScript's exact-number range", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      const timestamp = 9_007_199_254_740_993n;
      await Effect.runPromise(persistence.write(lease, { documents: [document(timestamp, "precise")],
        indexes: [index(timestamp, "same")] }));
      const snapshot = await Effect.runPromise(persistence.readSnapshot(timestamp));
      expect(await Effect.runPromise(snapshot.get(tableId, documentId))).toEqual(Option.some(document(timestamp, "precise")));
      expect((await scan(snapshot)).entries[0]?.document.ts).toBe(timestamp);
      expect(await Effect.runPromise(persistence.latestTimestamp(lease))).toBe(timestamp);
    }));

    it("confines identical table/document/index IDs to the captured instance", () => withFixture(async fixture => {
      const first = fixture.persistence;
      const second = await fixture.reopen("another-application");
      const firstLease = await Effect.runPromise(first.acquireLease());
      const secondLease = await Effect.runPromise(second.acquireLease());
      await Effect.runPromise(first.write(firstLease, { documents: [document(1n, "first-app")], indexes: [index(1n, "same")] }));
      await Effect.runPromise(second.write(secondLease, { documents: [document(1n, "second-app")], indexes: [index(1n, "same")] }));
      expect((await scan(await Effect.runPromise(first.readSnapshot(1n)))).entries[0]?.document).toEqual(document(1n, "first-app"));
      expect((await scan(await Effect.runPromise(second.readSnapshot(1n)))).entries[0]?.document).toEqual(document(1n, "second-app"));
      expect(await Effect.runPromise(Effect.result(second.latestTimestamp(firstLease))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
    }));

    it("refuses a fabricated target without touching existing namespaces", async () => {
      expect(await Effect.runPromise(Effect.result(createCorePersistence({ namespace: "public" }, "application"))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidTarget" } });
    });

    it("distinguishes partial bootstrap anchors from timestamp-zero documents and orphan indexes", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      expect(await Effect.runPromise(persistence.isFresh(lease))).toBe(true);
      await Effect.runPromise(persistence.putGlobal(lease, "tables_table_id", identity(50)));
      expect(await Effect.runPromise(persistence.isFresh(lease))).toBe(true);
      await Effect.runPromise(persistence.write(lease, { documents: [document(0n, "bootstrap")], indexes: [] }));
      expect(await Effect.runPromise(persistence.latestTimestamp(lease))).toBe(0n);
      expect(await Effect.runPromise(persistence.isFresh(lease))).toBe(false);
      const orphan = await fixture.reopen("orphan-index-instance");
      const orphanLease = await Effect.runPromise(orphan.acquireLease());
      await Effect.runPromise(orphan.write(orphanLease, { documents: [], indexes: [index(0n, "orphan")] }));
      expect(await Effect.runPromise(orphan.isFresh(orphanLease))).toBe(false);
    }));

    it("reports a dangling exact-timestamp index reference as corruption rather than an empty range", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      await Effect.runPromise(persistence.write(lease, { documents: [document(1n, "body")], indexes: [index(2n, "dangling")] }));
      const snapshot = await Effect.runPromise(persistence.readSnapshot(2n));
      expect(await Effect.runPromise(Effect.result(snapshot.scan({ index: { id: indexId }, tableId,
        interval: { start: null, end: null }, order: "asc", maxResults: 1 }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "corruptData" } });
    }));
  });
}
