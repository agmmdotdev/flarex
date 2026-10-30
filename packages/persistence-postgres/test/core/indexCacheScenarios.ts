import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { captureLogicalQuery, type IndexRangeExpression } from "flarex-protocol/index-range";
import type { DocumentObject } from "flarex-protocol/document-value";
import { openCoreDatabase } from "../../src/core/database";
import type { CoreDatabase, CoreDatabaseOptions, CoreReadTransaction } from "../../src/core/api";
import type { CorePersistenceFixture, CorePersistenceFixtureOptions } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const id = (value: number) => new Uint8Array(16).fill(value);
const definition = { schemaValidation: true, tables: [{ tableName: "items",
  documentType: { type: "object", value: {
    value: { fieldType: { type: "number" }, optional: false },
    label: { fieldType: { type: "string" }, optional: true },
  } }, indexes: [{ indexDescriptor: "by_value", fields: ["value"] }] }],
};
const publication = { programs: [{ identity: { functionPath: "items:read", programHash: "read", schemaHash: "items" }, metadata: {} }] };
const options = (verifyPercent = 0, maxBytes = 2 * 1024 * 1024): CoreDatabaseOptions => ({
  schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
  now: Effect.succeed(1_000_000_000n), newInternalId: Effect.sync(() => randomBytes(16)),
  indexCache: { maxBytes, verifyPercent }, operationCacheMaxBytes: 1024 * 1024,
});
const range = (order: "asc" | "desc" = "asc", expressions: readonly IndexRangeExpression[] = []) =>
  Result.getOrThrow(captureLogicalQuery({ source: { type: "IndexRange", indexName: "items.by_value",
    range: expressions, order }, operators: [] }));
const values = (documents: readonly DocumentObject[]) => documents.map(document => document.value);
const page = Effect.fn("IndexCacheScenario.page")(function* (transaction: CoreReadTransaction,
  order: "asc" | "desc" = "asc", expressions: readonly IndexRangeExpression[] = [], count = 10) {
  const query = yield* transaction.startQuery({ query: range(order, expressions) });
  const result = yield* query.nextPage({ maxResults: count, maxBytes: 1024 * 1024 });
  yield* query.close();
  return result;
});
const insert = Effect.fn("IndexCacheScenario.insert")(function* (database: CoreDatabase, value: number) {
  const transaction = yield* database.begin();
  const documentId = yield* transaction.insert("items", { value });
  yield* database.commit(yield* transaction.finalize());
  return documentId;
});

export function registerCoreIndexCacheScenarios(name: string,
  createFixture: (options?: CorePersistenceFixtureOptions) => Promise<CorePersistenceFixture>) {
  describe(name, () => {
    it("uses resident program observations, shares point pages and keeps operation coverage distinct", async () => {
      const statements: string[] = [];
      const fixture = await createFixture({ wrapRuntimeDriver: driver => ({ ...driver,
        query: (sql, parameters) => Effect.sync(() => { statements.push(sql); }).pipe(Effect.andThen(driver.query(sql, parameters))),
      }) });
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options());
        yield* activateCoreSchema(database, definition, publication);
        const documentId = yield* insert(database, 1);
        statements.length = 0;
        const first = yield* database.beginQuery("items:read");
        expect(statements).toEqual([]);
        expect(Option.getOrThrow(yield* first.transaction.get(documentId)).value).toBe(1);
        expect(statements.length).toBeGreaterThan(0);
        yield* first.finish();
        statements.length = 0;
        const second = yield* database.beginQuery("items:read");
        expect(Option.getOrThrow(yield* second.transaction.get(documentId)).value).toBe(1);
        expect(statements).toEqual([]);
        yield* second.finish();
        const third = yield* database.beginQuery("items:read");
        expect(values((yield* page(third.transaction)).documents)).toEqual([1]);
        statements.length = 0;
        expect(Option.getOrThrow(yield* third.transaction.get(documentId)).value).toBe(1);
        expect(statements).toEqual([]);
        yield* third.finish();
      }))); } finally { await fixture.close(); }
    }, 30_000);

    it("does not certify a page fetched at S after overlapping T publishes during the SQL return", async () => {
      const fetched = Deferred.makeUnsafe<void>();
      const release = Deferred.makeUnsafe<void>();
      let holdNext = false;
      const fixture = await createFixture({ wrapRuntimeDriver: driver => ({ ...driver,
        query: (sql, parameters) => driver.query(sql, parameters).pipe(Effect.tap(() => Effect.gen(function* () {
          if (!holdNext || !sql.includes("JOIN")) return;
          holdNext = false;
          yield* Deferred.succeed(fetched, undefined);
          yield* Deferred.await(release);
        }))),
      }) });
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options());
        yield* activateCoreSchema(database, definition, publication);
        const documentId = yield* insert(database, 1);
        const old = yield* database.beginQuery("items:read");
        holdNext = true;
        const reading = yield* Effect.forkChild(old.transaction.get(documentId));
        yield* Effect.gen(function* () {
          yield* Deferred.await(fetched);
          const writer = yield* database.begin();
          yield* writer.patch(documentId, { value: 2 });
          yield* database.commit(yield* writer.finalize());
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)));
        expect(Option.getOrThrow(yield* Fiber.join(reading)).value).toBe(1);
        yield* old.finish();
        const latest = yield* database.beginQuery("items:read");
        expect(Option.getOrThrow(yield* latest.transaction.get(documentId)).value).toBe(2);
        yield* latest.finish();
      }))); } finally { await fixture.close(); }
    }, 30_000);

    it.each([0, 100])("invalidates negative pages, moves, body rewrites and deletes at verification %i", async verifyPercent => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options(verifyPercent));
        yield* activateCoreSchema(database, definition, publication);
        const readValues = Effect.fn("IndexCacheScenario.readValues")(function* () {
          const query = yield* database.beginQuery("items:read");
          const result = yield* page(query.transaction);
          yield* query.finish();
          return result.documents;
        });
        expect(yield* readValues()).toEqual([]);
        const documentId = yield* insert(database, 1);
        expect(values(yield* readValues())).toEqual([1]);
        const body = yield* database.begin();
        yield* body.patch(documentId, { label: "new body" });
        yield* database.commit(yield* body.finalize());
        expect(yield* readValues()).toMatchObject([{ value: 1, label: "new body" }]);
        const held = yield* database.beginQuery("items:read");
        const move = yield* database.begin();
        yield* move.patch(documentId, { value: 4 });
        yield* database.commit(yield* move.finalize());
        expect(values((yield* page(held.transaction)).documents)).toEqual([1]);
        yield* held.finish();
        expect(values(yield* readValues())).toEqual([4]);
        const remove = yield* database.begin();
        yield* remove.delete(documentId);
        yield* database.commit(yield* remove.finalize());
        expect(yield* readValues()).toEqual([]);
        yield* insert(database, 2);
        expect(values(yield* readValues())).toEqual([2]);
      }))); } finally { await fixture.close(); }
    }, 30_000);

    it("preserves old admitted S, direction, exact-limit cursor and source isolation", async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options());
        yield* activateCoreSchema(database, definition, publication);
        for (const value of [1, 2, 3]) yield* insert(database, value);
        const old = yield* database.beginQuery("items:read");
        const writer = yield* database.begin();
        const all = yield* writer.scan("items", "by_value");
        const firstId = all[0]?._id;
        if (typeof firstId !== "string") return yield* Effect.die("Missing seeded cache document");
        yield* writer.patch(firstId, { value: 9 });
        yield* database.commit(yield* writer.finalize());
        const latest = yield* database.beginQuery("items:read");
        const descending = yield* page(latest.transaction, "desc", [], 3);
        expect(values(descending.documents)).toEqual([9, 3, 2]);
        expect(descending.position?.kind).toBe("after");
        expect(values((yield* page(old.transaction)).documents)).toEqual([1, 2, 3]);
        yield* latest.finish();
        yield* old.finish();
        const other = yield* openCoreDatabase(yield* Effect.tryPromise({ try: () => fixture.reopen("other-app"), catch: cause => cause }), options());
        const otherInstallation = yield* activateCoreSchema(other, definition, publication);
        const otherTable = otherInstallation.tables.find(table => table.name === "items");
        if (otherTable === undefined) return yield* Effect.die(new Error("Other-app fixture table is absent."));
        const otherRead = yield* other.beginQuery("items:read");
        expect((yield* page(otherRead.transaction)).documents).toEqual([]);
        expect(Option.isNone(yield* otherRead.transaction.get(Result.getOrThrow(encodeDocumentId(otherTable.number, id(200)))))).toBe(true);
        yield* otherRead.finish();
      }))); } finally { await fixture.close(); }
    }, 30_000);

    it("verifies shared hits through persistence when configured and reconstructs after zero-capacity eviction", async () => {
      const statements: string[] = [];
      const fixture = await createFixture({ wrapRuntimeDriver: driver => ({ ...driver,
        query: (sql, parameters) => Effect.sync(() => { statements.push(sql); }).pipe(Effect.andThen(driver.query(sql, parameters))),
      }) });
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options(100));
        yield* activateCoreSchema(database, definition, publication);
        const documentId = yield* insert(database, 7);
        for (let ordinal = 0; ordinal < 2; ordinal++) {
          statements.length = 0;
          const query = yield* database.beginQuery("items:read");
          expect(Option.getOrThrow(yield* query.transaction.get(documentId)).value).toBe(7);
          expect(statements.some(sql => sql.includes("JOIN"))).toBe(true);
          yield* query.finish();
        }
        yield* database.close();
        const reopened = yield* openCoreDatabase(yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause }), options(0, 0));
        const query = yield* reopened.beginQuery("items:read");
        expect(Option.getOrThrow(yield* query.transaction.get(documentId)).value).toBe(7);
        expect(values((yield* page(query.transaction)).documents)).toEqual([7]);
        yield* query.finish();
      }))); } finally { await fixture.close(); }
    }, 30_000);
  });
}
