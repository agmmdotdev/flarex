import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureDocumentValueWithSize, encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { captureLogicalQuery, fingerprintQuery, type IndexRangeExpression, type LogicalQuery } from "flarex-protocol/index-range";
import { openCoreDatabase } from "../../src/core/database";
import { CoreQueryInputError, type CoreDatabase, type CoreDatabaseOptions, type CoreInstallation, type CoreQuery } from "../../src/core/api";
import type { CoreIndexCursor, CorePersistence } from "../../src/core/contracts";
import type { CorePersistenceFixture } from "./fixture";

const id = (last: number) => { const bytes = new Uint8Array(16); bytes[15] = last; return bytes; };
const options: CoreDatabaseOptions = { now: Effect.succeed(1_000_000_000n), newInternalId: Effect.sync(() => randomBytes(16)) };
const installation: CoreInstallation = { tables: [{
  name: "items", number: 10000, tabletId: id(100), validator: { type: "object", value: {
    value: { fieldType: { type: "number" }, optional: false }, text: { fieldType: { type: "string" }, optional: true },
  } }, indexes: [{ name: "by_value", ref: { id: id(101) }, fields: ["value", "_creationTime"], enabled: true }],
}], programs: [] };
const logical = (order: "asc" | "desc" = "asc", range: readonly IndexRangeExpression[] = [], limit?: number): LogicalQuery =>
  Result.getOrThrow(captureLogicalQuery({ source: { type: "IndexRange", indexName: "items.by_value", range, order },
    operators: limit === undefined ? [] : [{ limit }] }));
const next = (query: CoreQuery, maxResults: number, maxBytes = 8 * 1024 * 1024) => query.nextPage({ maxResults, maxBytes });
const values = (documents: readonly DocumentObject[]) => documents.map(document => document.value);
const seed = Effect.fn("CoreQueryScenario.seed")(function* (database: CoreDatabase, count: number, text?: string) {
  const transaction = yield* database.begin();
  const ids: string[] = [];
  for (let value = 0; value < count; value += 1) ids.push(yield* transaction.insert("items", { value, ...(text === undefined ? {} : { text }) }));
  yield* database.commit(yield* transaction.finalize());
  return ids;
});
const position = (cursor: CoreIndexCursor | null): CoreIndexCursor => {
  if (cursor === null) throw new Error("Expected consumed cursor position");
  return cursor;
};

export function registerCoreQueryScenarios(name: string, createFixture: () => Promise<CorePersistenceFixture>) {
describe(name, () => {
  it("selects actual intrinsic indexes for default table order and complete developer-ID equality", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      const writer = yield* database.begin();
      const ids: string[] = [];
      for (const value of [5, -2, 1]) ids.push(yield* writer.insert("items", { value }));
      yield* database.commit(yield* writer.finalize());
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: {
        source: { type: "FullTableScan", tableName: "items", order: "asc" }, operators: [],
      } });
      expect(values((yield* next(query, 10)).documents)).toEqual([5, -2, 1]);
      const byId = yield* transaction.startQuery({ query: {
        source: { type: "IndexRange", indexName: "items.by_id", order: "asc",
          range: [{ op: "eq", field: "_id", value: ids[1] }] }, operators: [],
      } });
      expect(values((yield* next(byId, 10)).documents)).toEqual([-2]);
      expect(query.queryFingerprint).not.toEqual(byId.queryFingerprint);
      yield* transaction.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("preserves the pinned escaped-string prefix behavior without a residual Application equality predicate", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      const table = installation.tables[0];
      if (table === undefined) throw new Error("Missing table fixture");
      yield* database.install({ tables: [{ ...table, indexes: [...table.indexes,
        { name: "by_text", ref: { id: id(102) }, fields: ["text", "_creationTime"], enabled: true },
      ] }], programs: [] });
      const writer = yield* database.begin();
      yield* writer.insert("items", { value: 0, text: "a" });
      yield* writer.insert("items", { value: 1, text: "a\u0000" });
      yield* writer.insert("items", { value: 2, text: "ab" });
      yield* database.commit(yield* writer.finalize());
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: {
        source: { type: "IndexRange", indexName: "items.by_text", order: "asc",
          range: [{ op: "eq", field: "text", value: "a" }] }, operators: [],
      } });
      expect((yield* next(query, 10)).documents.map(document => document.text)).toEqual(["a", "a\u0000"]);
      yield* transaction.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("crosses physical chunks in both orders and observes End only on a subsequent full-page request", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      yield* seed(database, 260);
      for (const order of ["asc", "desc"] as const) {
        const transaction = yield* database.begin();
        const query = yield* transaction.startQuery({ query: logical(order) });
        const first = yield* next(query, 128);
        expect(first.done).toBe(false);
        expect(first.position?.kind).toBe("after");
        const second = yield* next(query, 128);
        const third = yield* next(query, 4);
        expect(third.done).toBe(false);
        expect(values([...first.documents, ...second.documents, ...third.documents])).toEqual(
          Array.from({ length: 260 }, (_, index) => order === "asc" ? index : 259 - index));
        const end = yield* next(query, 128);
        expect(end).toEqual({ documents: [], position: { kind: "end" }, done: true });
        expect((yield* transaction.usage).user.documentsRead).toBe(260);
        expect((yield* transaction.usage).databaseQueries).toBe(1);
        yield* query.close();
        yield* transaction.abort();
      }
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("limits zero/one/two reads without probing the tail and retains the actual yielded full key", async () => {
    const fixture = await createFixture();
    const requests: number[] = [];
    let tracing = false;
    const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (at, retention) => Effect.map(fixture.persistence.readSnapshot(at, retention), snapshot => ({
      ...snapshot, scan: request => { if (tracing) requests.push(request.maxResults); return snapshot.scan(request); },
    })) };
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(persistence, options);
      yield* database.install(installation);
      yield* seed(database, 5);
      tracing = true;
      for (const limit of [0, 1, 2]) {
        const transaction = yield* database.begin();
        const query = yield* transaction.startQuery({ query: logical("asc", [], limit) });
        const page = yield* next(query, 128);
        expect(values(page.documents)).toEqual(Array.from({ length: limit }, (_, index) => index));
        expect(page.done).toBe(true);
        expect(page.position?.kind ?? null).toBe(limit === 0 ? null : "after");
        expect((yield* transaction.usage).user.documentsRead).toBe(limit);
        yield* transaction.abort();
      }
      expect(requests).toEqual([1, 2]);
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("does not infer End from a short byte-limited page or charge its unreturned candidate", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      yield* seed(database, 3, "padding".repeat(30));
      const transaction = yield* database.begin();
      const sample = yield* transaction.scan("items", "by_value", { limit: 1 });
      const single = Result.getOrThrow(encodeDocumentValue(sample[0])).byteLength;
      const query = yield* transaction.startQuery({ query: logical() });
      const page = yield* query.nextPage({ maxResults: 128, maxBytes: single + 2 + 50,
        positionSize: () => ({ encodedBytes: 50, semanticBytes: 0 }) });
      expect(page.documents).toHaveLength(1);
      expect(page.done).toBe(false);
      const document = page.documents[0];
      if (document === undefined || typeof document._id !== "string") throw new Error("Expected returned document");
      expect(page.position).toEqual({ kind: "after", key: Result.getOrThrow(encodeIndexKey(
        [document.value, document._creationTime], document._id)) });
      expect((yield* transaction.usage).user.documentsRead).toBe(2); // one explicit sample and one emitted query document
      expect(values((yield* next(query, 128)).documents)).toEqual([1, 2]);
      yield* transaction.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("refuses an oversized single page item explicitly and preserves the first query failure", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      yield* seed(database, 1, "large payload");
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: logical() });
      const refused = yield* Effect.result(next(query, 128, 10));
      expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "capacity", cause: { budget: "queryPageBytes" } });
      const repeated = yield* Effect.result(next(query, 128));
      expect(repeated).toEqual(refused);
      expect((yield* transaction.usage).user.documentsRead).toBe(0);
      yield* transaction.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("splits before either encoded or semantic page bytes exceed their exact boundary", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      yield* seed(database, 3, "boundary document");
      const sampleTransaction = yield* database.begin();
      const sample = yield* sampleTransaction.scan("items", "by_value", { limit: 2 });
      yield* sampleTransaction.abort();
      const encoded = Result.getOrThrow(encodeDocumentValue(sample)).byteLength;
      const semantic = Result.getOrThrow(captureDocumentValueWithSize(sample)).semanticSizeBytes;
      const ceiling = encoded + semantic + 32;
      for (const metric of ["encoded", "semantic"] as const) for (const offset of [-1, 0, 1]) {
        const transaction = yield* database.begin();
        const query = yield* transaction.startQuery({ query: logical() });
        const positionSize = () => ({ encodedBytes: metric === "encoded" ? ceiling - encoded : 0,
          semanticBytes: metric === "semantic" ? ceiling - semantic : 0 });
        const page = yield* query.nextPage({ maxResults: 2, maxBytes: ceiling + offset, positionSize });
        const count = offset === -1 ? 1 : 2;
        expect(values(page.documents), `${metric}/${offset}`).toEqual(Array.from({ length: count }, (_, index) => index));
        expect(page.done).toBe(false);
        expect((yield* transaction.usage).user.documentsRead).toBe(count);
        const resumed = yield* query.nextPage({ maxResults: 1, maxBytes: ceiling + 1, positionSize });
        expect(values(resumed.documents)).toEqual([count]);
        expect((yield* transaction.usage).user.documentsRead).toBe(count + 1);
        yield* transaction.abort();
      }
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("checks envelope-only limits and single-document semantic overflow before charging or observing the row", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      yield* seed(database, 1);
      const ceiling = 1000;
      for (const metric of ["encoded", "semantic"] as const) for (const offset of [-1, 0, 1]) {
        const transaction = yield* database.begin();
        const query = yield* transaction.startQuery({ query: logical() });
        const page = yield* Effect.result(query.nextPage({ maxResults: 0, maxBytes: ceiling,
          positionSize: () => ({ encodedBytes: metric === "encoded" ? ceiling - 2 + offset : 0,
            semanticBytes: metric === "semantic" ? ceiling - 2 + offset : 0 }) }));
        expect(Result.isSuccess(page), `${metric}/${offset}`).toBe(offset <= 0);
        if (Result.isFailure(page)) expect(page.failure).toMatchObject({ reason: "capacity", cause: {
          budget: metric === "encoded" ? "queryPageBytes" : "queryPageSemanticBytes", actual: ceiling + 1, limit: ceiling,
        } });
        expect((yield* transaction.usage).user.documentsRead).toBe(0);
        expect((yield* transaction.usage).databaseQueries).toBe(0);
        yield* transaction.abort();
      }
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: logical() });
      const refused = yield* Effect.result(query.nextPage({ maxResults: 1, maxBytes: ceiling,
        positionSize: position => ({ encodedBytes: 0, semanticBytes: position === null ? 0 : ceiling - 2 }) }));
      expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "capacity",
        cause: { budget: "queryPageSemanticBytes" } });
      expect((yield* transaction.usage).user.documentsRead).toBe(0);
      expect((yield* transaction.usage).databaseQueries).toBe(0);
      expect(yield* Effect.result(next(query, 1))).toEqual(refused);
      yield* transaction.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("budgets a growing End envelope before observing exhaustion on empty and inverted sources", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      const inverted = logical("asc", [{ op: "gt", field: "value", value: 2 }, { op: "lt", field: "value", value: 1 }]);
      for (const source of [logical(), inverted]) for (const metric of ["encoded", "semantic", "both"] as const) {
        const transaction = yield* database.begin();
        const query = yield* transaction.startQuery({ query: source });
        const requestedPositions: Array<CoreIndexCursor | null> = [];
        const refused = yield* Effect.result(query.nextPage({ maxResults: 1, maxBytes: 99,
          positionSize: position => {
            requestedPositions.push(position);
            return { encodedBytes: position?.kind === "end" && metric !== "semantic" ? 100 : 0,
              semanticBytes: position?.kind === "end" && metric !== "encoded" ? 100 : 0 };
          } }));
        expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "capacity", cause: {
          budget: metric === "semantic" ? "queryPageSemanticBytes" : "queryPageBytes", actual: 102, limit: 99,
        } });
        expect(requestedPositions).toEqual([null, { kind: "end" }]);
        expect((yield* transaction.usage).user.documentsRead).toBe(0);
        expect((yield* transaction.usage).databaseQueries).toBe(0);
        expect(yield* Effect.result(next(query, 1, 1000))).toEqual(refused);
        yield* transaction.abort();
      }

      yield* seed(database, 1);
      const positionSize = (position: CoreIndexCursor | null) => ({
        encodedBytes: position?.kind === "end" ? 100 : 0,
        semanticBytes: position?.kind === "end" ? 100 : 0,
      });
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: logical() });
      const first = yield* query.nextPage({ maxResults: 2, maxBytes: 128, positionSize });
      expect(values(first.documents)).toEqual([0]);
      expect(first.done).toBe(false);
      expect(first.position?.kind).toBe("after");
      expect(yield* query.nextPage({ maxResults: 2, maxBytes: 128, positionSize })).toEqual({
        documents: [], position: { kind: "end" }, done: true,
      });
      yield* transaction.abort();

      const prefixReader = yield* database.begin();
      const prefixQuery = yield* prefixReader.startQuery({ query: logical() });
      expect((yield* prefixQuery.nextPage({ maxResults: 2, maxBytes: 128, positionSize })).done).toBe(false);
      yield* prefixQuery.close();
      yield* prefixReader.insert("items", { value: 1000 });
      const writer = yield* database.begin();
      yield* writer.insert("items", { value: 1 });
      yield* database.commit(yield* writer.finalize());
      expect(Result.isSuccess(yield* Effect.result(database.commit(yield* prefixReader.finalize())))).toBe(true);
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("chunks more than128 numeric-array documents by semantic bytes without observing prefetched rows", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      const table = installation.tables[0];
      if (table === undefined || table.validator.type !== "object") throw new Error("Missing object table fixture");
      yield* database.install({ tables: [{ ...table, validator: { ...table.validator, value: { ...table.validator.value,
        values: { fieldType: { type: "array", value: { type: "number" } }, optional: false },
      } } }], programs: [] });
      const writer = yield* database.begin();
      const ids: string[] = [];
      const numbers = Array<number>(8192).fill(0);
      for (let value = 0; value < 130; value += 1) ids.push(yield* writer.insert("items", { value, values: numbers }));
      yield* database.commit(yield* writer.finalize());
      const sampleTransaction = yield* database.begin();
      const sample = yield* sampleTransaction.scan("items", "by_value", { limit: 128 });
      yield* sampleTransaction.abort();
      const ceiling = 8 * 1024 * 1024;
      // Preserve the failing witness: legal documents fit the JSON transport budget
      // together while their normalized page exceeds the independent semantic budget.
      expect(Result.getOrThrow(encodeDocumentValue(sample)).byteLength).toBeLessThan(ceiling);
      expect(Result.getOrThrow(captureDocumentValueWithSize(sample)).semanticSizeBytes).toBeGreaterThan(ceiling);
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: logical() });
      const first = yield* next(query, 128, ceiling);
      expect(first.documents.length).toBeGreaterThan(0);
      expect(first.documents.length).toBeLessThan(128);
      expect(first.done).toBe(false);
      expect(Result.getOrThrow(encodeDocumentValue(first.documents)).byteLength).toBeLessThanOrEqual(ceiling);
      expect(Result.getOrThrow(captureDocumentValueWithSize(first.documents)).semanticSizeBytes).toBeLessThanOrEqual(ceiling);
      expect((yield* transaction.usage).user.documentsRead).toBe(first.documents.length);
      const second = yield* next(query, 128, ceiling);
      expect(values([...first.documents, ...second.documents])).toEqual(Array.from({ length: 130 }, (_, index) => index));
      expect(second.done).toBe(true);
      expect((yield* transaction.usage).user.documentsRead).toBe(130);
      yield* transaction.abort();

      const prefixReader = yield* database.begin();
      const prefixQuery = yield* prefixReader.startQuery({ query: logical() });
      const prefix = yield* next(prefixQuery, 128, ceiling);
      yield* prefixQuery.close();
      yield* prefixReader.insert("items", { value: 1000, values: [] });
      const outsideWriter = yield* database.begin();
      yield* outsideWriter.patch(ids[prefix.documents.length] ?? "", { values: [1] });
      yield* database.commit(yield* outsideWriter.finalize());
      expect(Result.isSuccess(yield* Effect.result(database.commit(yield* prefixReader.finalize())))).toBe(true);
    }))); } finally { await fixture.close(); }
  }, 60_000);

  it("merges pending inserts, deletes and moves made between pages in both orders", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      const ids = yield* seed(database, 5);
      for (const order of ["asc", "desc"] as const) {
        const transaction = yield* database.begin();
        const query = yield* transaction.startQuery({ query: logical(order) });
        const sample = yield* transaction.scan("items", "by_value", { order, limit: 1 });
        const single = Math.max(Result.getOrThrow(encodeDocumentValue(sample[0])).byteLength,
          Result.getOrThrow(captureDocumentValueWithSize(sample[0])).semanticSizeBytes);
        const first = yield* next(query, 128, single + 2);
        expect(values(first.documents)).toEqual([order === "asc" ? 0 : 4]);
        yield* transaction.delete(ids[2] ?? "");
        yield* transaction.patch(ids[order === "asc" ? 1 : 3] ?? "", { value: order === "asc" ? 10 : -10 });
        yield* transaction.insert("items", { value: order === "asc" ? 1.5 : 2.5 });
        expect(values((yield* next(query, 128)).documents)).toEqual(order === "asc" ? [1.5, 3, 4, 10] : [2.5, 1, 0, -10]);
        yield* transaction.abort();
      }
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("resumes a raw authenticated position in a new snapshot after its last row is deleted", async () => {
    const fixture = await createFixture();
    let cursor: Readonly<{ position: CoreIndexCursor; queryFingerprint: Uint8Array }> | undefined;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.install(installation);
        const ids = yield* seed(database, 4);
        const transaction = yield* database.begin();
        const query = yield* transaction.startQuery({ query: logical() });
        const page = yield* next(query, 2);
        cursor = { position: position(page.position), queryFingerprint: query.queryFingerprint };
        yield* transaction.abort();
        const writer = yield* database.begin();
        yield* writer.delete(ids[1] ?? "");
        yield* writer.insert("items", { value: 1.5 });
        yield* database.commit(yield* writer.finalize());
      })));
      const persistence = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(persistence, options);
        const transaction = yield* database.begin();
        if (cursor === undefined) throw new Error("Expected cursor");
        const query = yield* transaction.startQuery({ query: logical(), cursor });
        const page = yield* next(query, 100);
        expect(values(page.documents)).toEqual([1.5, 2, 3]);
        expect(page.done).toBe(true);
        const ended = yield* transaction.startQuery({ query: logical(), cursor: { position: { kind: "end" }, queryFingerprint: query.queryFingerprint } });
        expect((yield* next(ended, 100)).documents).toEqual([]);
        yield* transaction.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("binds cursors to selected fields/order/logical operators while excluding page size", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      yield* seed(database, 3);
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: logical() });
      const first = yield* next(query, 1);
      const cursor = { position: position(first.position), queryFingerprint: query.queryFingerprint };
      expect(values((yield* next(yield* transaction.startQuery({ query: logical(), cursor }), 2)).documents)).toEqual([1, 2]);
      for (const changed of [logical("desc"), logical("asc", [], 1)]) {
        const refused = yield* Effect.result(transaction.startQuery({ query: changed, cursor }));
        expect(Result.isFailure(refused) && refused.failure).toBeInstanceOf(CoreQueryInputError);
      }
      const wrongFields = fingerprintQuery(logical(), ["value"]);
      const refused = yield* Effect.result(transaction.startQuery({ query: logical(), cursor: { ...cursor, queryFingerprint: wrongFields } }));
      expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "invalidCursor" });
      yield* transaction.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("preserves consumed-frontier OCC for same-key updates, inside phantoms and outside nonconflicts", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      const ids = yield* seed(database, 3);
      for (const witness of ["outside", "phantom", "same-key", "move"] as const) {
        const reader = yield* database.begin();
        const query = yield* reader.startQuery({ query: logical("asc", [], 1) });
        expect(values((yield* next(query, 128)).documents)).toEqual([0]);
        yield* reader.insert("items", { value: 1000 });
        const writer = yield* database.begin();
        if (witness === "outside") yield* writer.insert("items", { value: 10 });
        if (witness === "phantom") yield* writer.insert("items", { value: -1 });
        if (witness === "same-key") yield* writer.patch(ids[0] ?? "", { text: "updated at the identical key" });
        if (witness === "move") yield* writer.patch(ids[2] ?? "", { value: -2 });
        yield* database.commit(yield* writer.finalize());
        const committed = yield* Effect.result(database.commit(yield* reader.finalize()));
        expect(Result.isSuccess(committed), witness).toBe(witness === "outside");
        if (Result.isFailure(committed)) expect(committed.failure).toMatchObject({ reason: "conflict" });
        // Reset each interfering witness while retaining the same owned index/table identities.
        const reset = yield* database.begin();
        for (const document of yield* reset.scan("items", "by_value")) {
          if (document.value === -1 || document.value === 10 || document.value === 1000) yield* reset.delete(String(document._id));
          if (document.value === -2) yield* reset.patch(String(document._id), { value: 2 });
        }
        yield* database.commit(yield* reset.finalize());
      }
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("shares document and interval budgets across pages and overlapping queries", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, { ...options, transactionLimits: { documentsRead: 3, databaseQueries: 1 } });
      yield* database.install(installation);
      yield* seed(database, 4);
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: logical() });
      yield* next(query, 1);
      yield* next(query, 1);
      expect((yield* transaction.usage).databaseQueries).toBe(1);
      const overlapping = yield* transaction.startQuery({ query: logical("asc", [], 1) });
      yield* next(overlapping, 1);
      expect((yield* transaction.usage).databaseQueries).toBe(1);
      const refused = yield* Effect.result(next(query, 1));
      expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "capacity", cause: { budget: "documentsRead", actual: 4 } });
      expect((yield* Effect.result(next(query, 1)))).toEqual(refused);
      yield* transaction.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("enforces the shared byte quota across pages and counts separated source intervals independently", async () => {
    const fixture = await createFixture();
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(fixture.persistence, options);
        yield* database.install(installation);
        yield* seed(database, 4, "x".repeat(200));
      })));
      const persistence = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(persistence, { ...options, transactionLimits: { bytesRead: 400, databaseQueries: 1 } });
        const transaction = yield* database.begin();
        const query = yield* transaction.startQuery({ query: logical() });
        yield* next(query, 1);
        const refused = yield* Effect.result(next(query, 1));
        expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "capacity", cause: { budget: "bytesRead" } });
        yield* transaction.abort();
        const separated = yield* database.begin();
        const first = yield* separated.startQuery({ query: logical("asc", [{ op: "eq", field: "value", value: -1 }]) });
        yield* next(first, 1);
        const second = yield* separated.startQuery({ query: logical("asc", [{ op: "eq", field: "value", value: 5 }]) });
        const extra = yield* Effect.result(next(second, 1));
        // Interval accounting happens at source consumption, independently of transport page starts.
        expect(Result.isFailure(extra) && extra.failure).toMatchObject({ reason: "capacity", cause: { budget: "databaseQueries", actual: 2 } });
        yield* separated.abort();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("keeps descending consumed frontiers narrow and preserves inclusive/exclusive boundary phantoms", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      const ids = yield* seed(database, 3);
      const removeMiddle = yield* database.begin();
      yield* removeMiddle.delete(ids[1] ?? "");
      yield* database.commit(yield* removeMiddle.finalize());
      for (const op of ["gt", "gte"] as const) {
        const reader = yield* database.begin();
        const query = yield* reader.startQuery({ query: logical("desc", [
          { op, field: "value", value: 1 }, { op: "lt", field: "value", value: 2 },
        ]) });
        expect((yield* next(query, 10)).done).toBe(true);
        yield* reader.insert("items", { value: 100 });
        const writer = yield* database.begin();
        const inserted = yield* writer.insert("items", { value: 1 });
        yield* database.commit(yield* writer.finalize());
        const result = yield* Effect.result(database.commit(yield* reader.finalize()));
        expect(Result.isSuccess(result), op).toBe(op === "gt");
        const cleanup = yield* database.begin();
        yield* cleanup.delete(inserted);
        for (const document of yield* cleanup.scan("items", "by_value"))
          if (document.value === 100) yield* cleanup.delete(String(document._id));
        yield* database.commit(yield* cleanup.finalize());
      }
      const reader = yield* database.begin();
      const query = yield* reader.startQuery({ query: logical("desc", [], 1) });
      expect(values((yield* next(query, 1)).documents)).toEqual([2]);
      yield* reader.insert("items", { value: 100 });
      const outside = yield* database.begin();
      yield* outside.insert("items", { value: -10 });
      yield* database.commit(yield* outside.finalize());
      expect(Result.isSuccess(yield* Effect.result(database.commit(yield* reader.finalize())))).toBe(true);
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("records query metadata before the first page and preserves the selected registry across replacement", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      const reader = yield* database.begin();
      const query = yield* reader.startQuery({ query: logical() });
      const table = installation.tables[0];
      if (table === undefined) throw new Error("Missing table fixture");
      yield* database.install({ tables: [{ ...table,
        indexes: [{ name: "by_value", ref: { id: id(101) }, fields: ["text", "_creationTime"], enabled: false }],
      }], programs: [] });
      expect((yield* next(query, 10)).done).toBe(true);
      yield* reader.insert("items", { value: 100 });
      const refused = yield* Effect.result(database.commit(yield* reader.finalize()));
      expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "conflict" });
      const current = yield* database.begin();
      const unavailable = yield* Effect.result(current.startQuery({ query: logical() }));
      expect(Result.isFailure(unavailable) && unavailable.failure).toMatchObject({ reason: "indexUnavailable" });
      yield* current.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("checks the consumed query frontier against accepted writes before their save completes", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let pause = false;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        if (pause) { pause = false; yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); }
        yield* fixture.persistence.write(lease, batch);
      }) };
      const database = yield* openCoreDatabase(persistence, options);
      yield* database.install(installation);
      yield* seed(database, 2);
      const reader = yield* database.begin();
      const query = yield* reader.startQuery({ query: logical("asc", [], 1) });
      yield* next(query, 1);
      yield* reader.insert("items", { value: 100 });
      const writer = yield* database.begin();
      yield* writer.insert("items", { value: -1 });
      pause = true;
      const saving = yield* Effect.forkChild(database.commit(yield* writer.finalize()));
      yield* Deferred.await(entered);
      yield* Effect.ensuring(Effect.gen(function* () {
        const refused = yield* Effect.result(database.commit(yield* reader.finalize()));
        expect(Result.isFailure(refused) && refused.failure).toMatchObject({ reason: "conflict" });
      }), Deferred.succeed(release, undefined));
      yield* Fiber.join(saving);
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("does not fetch inverted/empty intervals and rejects bad range input as an ordinary query refusal", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* database.install(installation);
      yield* seed(database, 3);
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: logical("asc", [
        { op: "gt", field: "value", value: 2 }, { op: "lt", field: "value", value: 1 },
      ]) });
      expect(yield* next(query, 10)).toEqual({ documents: [], position: { kind: "end" }, done: true });
      expect((yield* transaction.usage).user.documentsRead).toBe(0);
      const invalid = yield* Effect.result(transaction.startQuery({ query: logical("asc", [
        { op: "eq", field: "missing", value: 2 },
      ]) }));
      expect(Result.isFailure(invalid) && invalid.failure).toBeInstanceOf(CoreQueryInputError);
      expect(values((yield* next(yield* transaction.startQuery({ query: logical() }), 10)).documents)).toEqual([0, 1, 2]);
      yield* transaction.abort();
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("excludes finalize while a page is in flight and closes retained handles after settlement", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let pause = false;
      const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (at, retention) => Effect.map(fixture.persistence.readSnapshot(at, retention), snapshot => ({
        ...snapshot, scan: request => Effect.gen(function* () {
          if (pause) { yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release); }
          return yield* snapshot.scan(request);
        }),
      })) };
      const database = yield* openCoreDatabase(persistence, options);
      yield* database.install(installation);
      yield* seed(database, 1);
      const transaction = yield* database.begin();
      const query = yield* transaction.startQuery({ query: logical() });
      pause = true;
      const page = yield* Effect.forkChild(next(query, 1));
      yield* Deferred.await(entered);
      const refusal = yield* Effect.result(transaction.finalize());
      expect(Result.isFailure(refusal) && refusal.failure).toMatchObject({ reason: "inflight" });
      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(page);
      yield* database.commit(yield* transaction.finalize());
      const closed = yield* Effect.result(next(query, 1));
      expect(Result.isFailure(closed) && closed.failure).toMatchObject({ reason: "closed" });
    }))); } finally { await fixture.close(); }
  }, 30_000);
});
}
