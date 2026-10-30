import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import type { CoreDocumentLogEntry, CoreDocumentLogCursor } from "../../src/core/contracts";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";
const id = (n: number) => { const value = new Uint8Array(16); value[15] = n; return value; };
const row = (ts: bigint, tablet: number, n: number, deleted = false, prevTs: bigint | null = null): CoreDocumentLogEntry => ({
  ts, tableId: id(tablet), id: id(n), deleted, prevTs, jsonValue: deleted ? new Uint8Array() : new TextEncoder().encode("{}"),
});

export function registerCoreHistoryScenarios(lane: string, create: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>) {
  const withFixture = async (run: (fixture: CorePersistenceFixture) => Promise<void>, options?: CorePersistenceFixtureOptions) => {
    const fixture = await create(options);
    try { await run(fixture); } finally { await fixture.close(); }
  };
  describe(`source timestamp log and exact predecessor ports (${lane})`, () => {
    it("paginates equal timestamps by tablet and ID, preserving tombstones and predecessor timestamps", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      const documents = [row(1n, 3, 2), row(1n, 2, 5), row(1n, 2, 4), row(2n, 2, 4, true, 1n)];
      await Effect.runPromise(persistence.write(lease, { documents, indexes: [] }));
      let after: CoreDocumentLogCursor | undefined;
      const collected: CoreDocumentLogEntry[] = [];
      while (true) {
        const page = await Effect.runPromise(persistence.loadDocuments({ start: 1n, end: 2n, maxResults: 1, order: "asc",
          ...(after === undefined ? {} : { after }) }));
        collected.push(...page.documents);
        if (page.done) break;
        if (page.cursor === null) throw new Error("Full log page omitted its tuple cursor");
        after = page.cursor;
      }
      expect(collected.map(value => [value.ts, value.tableId[15], value.id[15], value.deleted, value.prevTs]))
        .toEqual([[1n, 2, 4, false, null], [1n, 2, 5, false, null], [1n, 3, 2, false, null], [2n, 2, 4, true, 1n]]);
      const reverse = await Effect.runPromise(persistence.loadDocuments({ start: 1n, end: 2n, maxResults: 10, order: "desc", tableId: id(2) }));
      expect(reverse.documents.map(value => [value.ts, value.id[15]])).toEqual([[2n, 4], [1n, 5], [1n, 4]]);
    }));

    it("selects EXACT prevTs while validating the successor witness and validates empty log batches", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      await Effect.runPromise(persistence.write(lease, { documents: [row(1n, 2, 4), row(3n, 2, 4, false, 1n)], indexes: [] }));
      await Effect.runPromise(persistence.putGlobal(lease, "document_min_snapshot_ts", new TextEncoder().encode("50")));
      const exact = await Effect.runPromise(persistence.previousRevisionsOfDocuments([{ tableId: id(2), id: id(4), ts: 51n, prevTs: 1n },
        { tableId: id(2), id: id(4), ts: 51n, prevTs: 2n }]));
      expect(exact.map(value => [value.query.ts, value.query.prevTs, value.document.ts])).toEqual([[51n, 1n, 1n]]);
      const expired = await Effect.runPromise(Effect.result(persistence.loadDocuments({ start: 49n, end: 49n, maxResults: 1, order: "asc" })));
      expect(Result.isFailure(expired) && expired.failure.reason).toBe("outOfRetention");
      const empty = await Effect.runPromise(persistence.loadDocuments({ start: 50n, end: 50n, maxResults: 1, order: "asc" }));
      expect(empty).toEqual({ documents: [], cursor: null, done: true });
    }));

    it("uses the source PostgreSQL logical index key for normal writes, reads and replay despite captured compact IDs", () => withFixture(async fixture => {
      const persistence = fixture.persistence;
      const lease = await Effect.runPromise(persistence.acquireLease());
      const index = { id: id(40), persistenceIndexId: 7n };
      const document = row(1n, 2, 4);
      const entry = { ts: 1n, mode: "scanning" as const, index, key: Uint8Array.of(1),
        value: { tableId: document.tableId, documentId: document.id }, prev: null };
      await Effect.runPromise(persistence.write(lease, { documents: [document], indexes: [entry] }));
      await Effect.runPromise(persistence.writeIndexBackfill(lease, [{ ...entry, index: { ...index, persistenceIndexId: 8n } }]));
      await Effect.runPromise(persistence.reconcileIndexBackfill(lease, index));
      const snapshot = await Effect.runPromise(persistence.readSnapshot(1n));
      const page = await Effect.runPromise(snapshot.scan({ index: { ...index, persistenceIndexId: 9n }, tableId: document.tableId,
        interval: { start: null, end: null }, order: "asc", maxResults: 2 }));
      expect(page.entries.map(value => value.document.id)).toEqual([document.id]);
      expect(await fixture.query(`SELECT index_id = $2 AS logical_key FROM "${fixture.namespace}"."indexes" WHERE instance_name = $1`,
        [fixture.instanceName, index.id])).toEqual([{ logical_key: true }]);
    }));

    it("validates the minimum predecessor witness after every native lookup batch has settled", async () => {
      let settled = 0;
      const witnessed: bigint[] = [];
      await withFixture(async fixture => {
        const queries = Array.from({ length: 9 }, (_, n) => ({ tableId: id(2), id: id(n + 1), ts: n === 0 ? 11n : 31n, prevTs: 1n }));
        expect(await Effect.runPromise(fixture.persistence.previousRevisionsOfDocuments(queries, {
          validateIndex: () => Effect.void,
          validateDocument: at => Effect.sync(() => { expect(settled).toBe(2); witnessed.push(at); }),
        }))).toEqual([]);
        expect(witnessed).toEqual([11n]);
      }, { wrapRuntimeDriver: driver => ({ ...driver, withConnection: run => driver.withConnection(connection => run({
        query: (statement, parameters) => connection.query(statement, parameters).pipe(Effect.tap(() => Effect.sync(() => {
          if (statement.includes("AS query_ts")) settled += 1;
        }))),
      })) }) });
    });
  });
}
