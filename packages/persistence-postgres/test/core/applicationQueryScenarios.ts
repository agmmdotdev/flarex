import { randomBytes } from "node:crypto";
import { bytesEqual } from "@flarex/utils/bytes";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { encodeDocumentId } from "flarex-protocol/document-id";
import { encodeIndexKey } from "flarex-protocol/index-key";
import { openCoreDatabase } from "../../src/core/database";
import type { CoreDatabaseOptions, CoreProgramPublication } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { keyInInterval } from "../../src/core/writeLog";
import { loadBootstrapRegistry } from "../../src/core/bootstrap";
import { loadCoreRegistry, PROGRAMS, TABLES, INDEXES } from "../../src/core/registry";
import { CoreFinalizationVault, createCoreTransaction, prepareCoreTransactionIds } from "../../src/core/transaction";
import * as transactionOwner from "../../src/core/transaction";
import type { CorePersistenceFixture } from "./fixture";
import { activateCoreSchema, CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { captureCoreSchema } from "../../src/core/schemaTypes";

const id = (value: number) => new Uint8Array(16).fill(value);
const options: CoreDatabaseOptions = { schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, now: Effect.succeed(1_000_000_000n), randomBytes: (length: 16 | 32) => Effect.sync(() => randomBytes(length)) };
const path = "items:read";
const schema = Result.getOrThrow(captureCoreSchema({ schemaValidation: true, tables: [{ tableName: "items",
  documentType: { type: "object", value: { value: { fieldType: { type: "number" }, optional: false } } },
  indexes: [{ indexDescriptor: "by_value", fields: ["value"] }], stagedDbIndexes: [] }] }));
const publication: CoreProgramPublication = {
  programs: [{ identity: { functionPath: path, programHash: "old", schemaHash: "schema" }, metadata: { visibility: "public" } }] };
export function registerCoreApplicationQueryScenarios(name: string, createFixture: () => Promise<CorePersistenceFixture>) {
describe(name, () => {
  it("holds query metadata, nested selection, data and time at S and fences completion after publication", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      yield* activateCoreSchema(database, schema, publication);
      const writer = yield* database.begin();
      const documentId = yield* writer.insert("items", { value: 1 });
      yield* database.commit(yield* writer.finalize());
      const query = yield* database.beginQuery(path);
      const timestamp = query.transaction.timestamp;
      const unixTime = query.transaction.unixTime;
      expect(query.program.metadata.visibility).toBe("public");
      const update = yield* database.begin();
      yield* update.patch(documentId, { value: 2 });
      yield* database.commit(yield* update.finalize());
      yield* database.publishPrograms({ programs: [{ identity: { functionPath: path,
        programHash: "new", schemaHash: "schema" }, metadata: { visibility: "internal" } }] });
      expect((yield* query.transaction.selectProgram(path)).identity.programHash).toBe("old");
      expect(Option.getOrThrow(yield* query.transaction.get(documentId)).value).toBe(1);
      expect(query.transaction.unixTime).toBe(unixTime);
      const published = yield* database.publishedTimestamp;
      expect(timestamp < published).toBe(true);
      expect(Result.getFailure(yield* Effect.result(query.finish()))).toEqual(
        Option.some(expect.objectContaining({ reason: "authorityRevoked" })));
      expect(yield* database.publishedTimestamp).toBe(published);
      expect(Result.isFailure(yield* Effect.result(query.finish()))).toBe(true);
      expect(Result.isFailure(yield* Effect.result(query.transaction.get(documentId)))).toBe(true);
      const latest = yield* database.beginQuery(path);
      expect(latest.program.metadata.visibility).toBe("internal");
      expect(Option.getOrThrow(yield* latest.transaction.get(documentId)).value).toBe(2);
      expect(Object.keys(latest.transaction)).not.toContain("insert");
      expect(Object.keys(latest.transaction)).not.toContain("finalize");
      yield* latest.finish();
      expect(yield* database.publishedTimestamp).toBe(published);
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("returns exact point, absence, metadata and consumed range evidence, with owned token bytes", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const database = yield* openCoreDatabase(fixture.persistence, options);
      const activated = yield* activateCoreSchema(database, schema, publication);
      const table = activated.tables.find(table => table.name === "items");
      const byId = table?.indexes.find(index => index.name === "by_id")?.ref.id;
      const byValue = table?.indexes.find(index => index.name === "by_value")?.ref.id;
      if (table === undefined || byId === undefined || byValue === undefined) throw new Error("Missing actual item identities");
      const writer = yield* database.begin();
      const first = yield* writer.insert("items", { value: 1 });
      const second = yield* writer.insert("items", { value: 2 });
      yield* database.commit(yield* writer.finalize());
      const absent = Result.getOrThrow(encodeDocumentId(table.number, id(222)));
      const query = yield* database.beginQuery(path);
      expect(Option.isSome(yield* query.transaction.get(first))).toBe(true);
      expect(Option.isNone(yield* query.transaction.get(absent))).toBe(true);
      const stream = yield* query.transaction.startQuery({ query: { source: { type: "IndexRange",
        indexName: "items.by_value", range: [], order: "asc" }, operators: [] } });
      expect((yield* stream.nextPage({ maxResults: 1, maxBytes: 1_000_000 })).documents).toHaveLength(1);
      yield* stream.close();
      const before = yield* database.publishedTimestamp;
      const token = yield* query.finish();
      const point = token.reads.find(read => read.indexId.every((byte, index) => byte === byId[index]));
      const range = token.reads.find(read => read.indexId.every((byte, index) => byte === byValue[index]));
      expect(point?.intervals.some(interval => keyInInterval(Result.getOrThrow(encodeIndexKey([], first)), interval))).toBe(true);
      expect(point?.intervals.some(interval => keyInInterval(Result.getOrThrow(encodeIndexKey([], absent)), interval))).toBe(true);
      expect(point?.intervals.some(interval => keyInInterval(Result.getOrThrow(encodeIndexKey([], second)), interval))).toBe(false);
      expect(range?.intervals.some(interval => keyInInterval(Result.getOrThrow(encodeIndexKey([1], first)), interval))).toBe(true);
      expect(range?.intervals.some(interval => keyInInterval(Result.getOrThrow(encodeIndexKey([2], second)), interval))).toBe(false);
      const snapshot = yield* fixture.persistence.readSnapshot(token.timestamp);
      const registry = yield* loadCoreRegistry(snapshot, yield* loadBootstrapRegistry(fixture.persistence, snapshot));
      const programTable = registry.table(PROGRAMS)?.definition;
      const programIndex = programTable?.indexes.find(index => index.name === "by_id");
      const programRead = token.reads.find(read => programIndex !== undefined
        && read.indexId.every((byte, index) => byte === programIndex.ref.id[index]));
      const head = registry.head(path);
      const revision = registry.program(query.program.identity);
      if (head === undefined || revision === undefined || programTable === undefined) throw new Error("Missing selected program metadata");
      expect(programRead?.intervals).toHaveLength(2);
      for (const internalId of [head.id, revision.id]) {
        const documentId = Result.getOrThrow(encodeDocumentId(programTable.number, internalId));
        const key = Result.getOrThrow(encodeIndexKey([], documentId));
        expect(programRead?.intervals.some(interval => keyInInterval(key, interval))).toBe(true);
      }
      const indexes = registry.table(INDEXES)?.definition;
      const indexById = indexes?.indexes.find(index => index.name === "by_id");
      const indexRead = token.reads.find(read => indexById !== undefined
        && read.indexId.every((byte, index) => byte === indexById.ref.id[index]));
      if (indexes === undefined) throw new Error("Missing index metadata");
      if (programIndex === undefined) throw new Error("Missing program index");
      expect(indexRead?.intervals).toHaveLength(3);
      for (const indexId of [byValue, byId, programIndex.ref.id]) {
        const indexKey = Result.getOrThrow(encodeIndexKey([], Result.getOrThrow(encodeDocumentId(indexes.number, indexId))));
        expect(indexRead?.intervals.some(interval => keyInInterval(indexKey, interval))).toBe(true);
      }
      const tables = registry.table(TABLES)?.definition;
      const tableById = tables?.indexes.find(index => index.name === "by_id");
      const tableRead = token.reads.find(read => tableById !== undefined
        && read.indexId.every((byte, index) => byte === tableById.ref.id[index]));
      expect(tableRead?.intervals).toEqual([{ start: null, end: null }]);
      expect(token.reads).toHaveLength(5);
      const readonly = createCoreTransaction({ snapshot, registry, ...(yield* prepareCoreTransactionIds(options)),
        vault: new CoreFinalizationVault(), readonly: true });
      expect(Result.getFailure(yield* Effect.result(readonly.transaction.insert("items", { value: 3 })))).toEqual(
        Option.some(expect.objectContaining({ reason: "readonly" })));
      expect(Result.getFailure(yield* Effect.result(readonly.transaction.finalize()))).toEqual(
        Option.some(expect.objectContaining({ reason: "readonly" })));
      yield* readonly.finishRead();
      const writeful = createCoreTransaction({ snapshot, registry, ...(yield* prepareCoreTransactionIds(options)),
        vault: new CoreFinalizationVault() });
      yield* writeful.transaction.insert("items", { value: 3 });
      expect(Result.getFailure(yield* Effect.result(writeful.finishRead()))).toEqual(
        Option.some(expect.objectContaining({ reason: "readonly" })));
      yield* writeful.transaction.abort();
      const bytes = token.reads[0]?.indexId;
      const original = bytes?.slice();
      bytes?.fill(0);
      expect(token.reads[0]?.indexId).toEqual(original);
      expect(yield* database.publishedTimestamp).toBe(before);
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("refuses in-flight read completion and closes/drains late callbacks without disclosing their result", async () => {
    const fixture = await createFixture();
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      let held = false;
      let byId: Uint8Array | undefined;
      const persistence: CorePersistence = { ...fixture.persistence,
        readSnapshot: (timestamp, retention) => fixture.persistence.readSnapshot(timestamp, retention).pipe(Effect.map(snapshot => ({ ...snapshot,
          scan: request => Effect.gen(function* () {
            if (held && byId !== undefined && bytesEqual(request.index.id, byId)) {
              expect(request).toMatchObject({ order: "asc", maxResults: 2 });
              yield* Deferred.succeed(entered, undefined);
              yield* Deferred.await(release);
            }
            return yield* snapshot.scan(request);
          }),
        }))),
      };
      const database = yield* openCoreDatabase(persistence, options);
      const activated = yield* activateCoreSchema(database, schema, publication);
      byId = activated.tables.find(table => table.name === "items")?.indexes.find(index => index.name === "by_id")?.ref.id;
      if (byId === undefined) throw new Error("Missing actual item by_id identity");
      const writer = yield* database.begin();
      const documentId = yield* writer.insert("items", { value: 1 });
      yield* database.commit(yield* writer.finalize());
      const query = yield* database.beginQuery(path);
      held = true;
      const read = yield* Effect.forkChild(Effect.result(query.transaction.get(documentId)));
      yield* Deferred.await(entered);
      expect(Result.getFailure(yield* Effect.result(query.finish()))).toEqual(Option.some(expect.objectContaining({ reason: "inflight" })));
      const closing = yield* Effect.forkChild(database.close());
      yield* Effect.yieldNow;
      expect(Result.getFailure(yield* Effect.result(database.beginQuery(path)))).toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
      yield* Deferred.succeed(release, undefined);
      expect(Result.getFailure(yield* Fiber.join(read))).toEqual(Option.some(expect.objectContaining({ reason: "closed" })));
      yield* Fiber.join(closing);
      expect(Result.isFailure(yield* Effect.result(query.finish()))).toBe(true);
      expect(Result.isFailure(yield* Effect.result(writer.insert("items", { value: 3 })))).toBe(true);
    }))); } finally { await fixture.close(); }
  }, 30_000);

  it("retains the committed correlated outcome when the owner closes after write before acknowledgement", async () => {
    const fixture = await createFixture();
    const identity = { key: "close-after-write", requestHash: "original-request",
      program: { functionPath: path, programHash: "old", schemaHash: "schema" } };
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        let armed = false;
        let close = Effect.void;
        const persistence: CorePersistence = { ...fixture.persistence,
          write: (lease, batch) => fixture.persistence.write(lease, batch).pipe(Effect.andThen(Effect.suspend(() => {
            if (!armed) return Effect.void;
            armed = false;
            return close;
          }))),
        };
        const database = yield* openCoreDatabase(persistence, options);
        close = database.close();
        yield* activateCoreSchema(database, schema, publication);
        const acquisition = yield* database.claimRequest(identity);
        if (acquisition.kind !== "claimed") throw new Error("Expected original request claim");
        const transaction = yield* database.begin({ program: identity.program, claim: acquisition.claim });
        yield* transaction.insert("items", { value: 42 });
        const finalized = yield* transaction.finalize();
        armed = true;
        const result = yield* Effect.result(database.commit(finalized, { claim: acquisition.claim, result: { original: 42 } }));
        expect(Result.getFailure(result)).toEqual(Option.some(expect.objectContaining({ reason: "uncertainWrite" })));
        expect(Result.isFailure(yield* Effect.result(database.abortRequest(acquisition.claim)))).toBe(true);
      })));
      const reopened = await fixture.reopen();
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const database = yield* openCoreDatabase(reopened, options);
        expect(yield* database.resolveRequest(identity)).toMatchObject({ kind: "committed", result: { original: 42 } });
        expect(yield* database.claimRequest(identity)).toMatchObject({ kind: "committed", result: { original: 42 } });
        const query = yield* database.beginQuery(path);
        expect((yield* query.transaction.scan("items", "by_value")).map(document => document.value)).toEqual([42]);
        yield* query.finish();
      })));
    } finally { await fixture.close(); }
  }, 30_000);

  it("disposes failed operation admissions on every Exit while preserving successfully transferred borrows", async () => {
    const fixture = await createFixture();
    const created: transactionOwner.CoreTransactionInternals[] = [];
    let fault: Effect.Effect<never, CorePersistenceError> | undefined;
    const construct = transactionOwner.createCoreTransaction;
    // Observe real owner-issued capabilities, without adding a production
    // retention counter or replacing their validation/disposal behavior.
    const capture = vi.spyOn(transactionOwner, "createCoreTransaction").mockImplementation(input => {
      const context = construct(input);
      created.push(context);
      // Metadata may be resident. Inject after the real factory returns, at
      // the private read capability used during admission, so make() has
      // registered its borrow before the injected Exit is observed.
      return new Proxy(context, {
        get: (target, property) => property === "readPrivate"
          ? (table: string, internalId: Uint8Array) => fault ?? target.readPrivate(table, internalId)
          : Reflect.get(target, property, target),
      });
    });
    try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
      const persistence: CorePersistence = { ...fixture.persistence,
        readSnapshot: (timestamp, retention) => fixture.persistence.readSnapshot(timestamp, retention).pipe(Effect.map(snapshot => ({ ...snapshot,
          get: (tableId, internalId) => fault ?? snapshot.get(tableId, internalId),
          scan: request => fault ?? snapshot.scan(request),
        }))),
      };
      const database = yield* openCoreDatabase(persistence, options);
      const activated = yield* activateCoreSchema(database, schema, { ...publication, authorityEpoch: 1n });
      const itemsNumber = activated.tables.find(table => table.name === "items")?.number;
      if (itemsNumber === undefined) throw new Error("Missing actual item table number");
      const program = publication.programs[0]?.identity;
      if (program === undefined) throw new Error("Missing installed program");
      const request = { key: "failed-admissions", requestHash: "original-request", program };
      const acquisition = yield* database.claimRequest(request);
      if (acquisition.kind !== "claimed") throw new Error("Expected durable claim");
      const assertDisposed = Effect.fn("CoreQueryScenario.assertDisposed")(function* (before: number) {
        expect(created.length).toBeGreaterThan(before);
        const context = created.at(-1);
        if (context === undefined) throw new Error("No acquired transaction to inspect");
        expect(Result.getFailure(yield* Effect.result(context.transaction.tableNumber("items")))).toEqual(
          Option.some(expect.objectContaining({ reason: "closed" })));
      });
      const missing = { ...program, functionPath: "missing:program" };
      for (const operation of [
        database.begin({ program: missing }),
        database.begin({ program, authorityEpoch: 0n }),
        database.beginQuery("missing:program"),
        database.publishPrograms({ programs: [], authorityEpoch: -1n }),
        database.claimRequest({ ...request, program: missing }),
        database.advanceAuthorityEpoch(-1n),
      ]) {
        const before = created.length;
        expect(Exit.isFailure(yield* Effect.exit(operation))).toBe(true);
        yield* assertDisposed(before);
      }
      const refusal = new CorePersistenceError({ reason: "unavailable" });
      fault = Effect.fail(refusal);
      let before = created.length;
      const failed = yield* Effect.exit(database.recoverRequest(request));
      expect(Exit.isFailure(failed) && failed.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === refusal)).toBe(true);
      yield* assertDisposed(before);
      const defect = new Error("Admission metadata defect");
      const combined = Cause.combine(Cause.fail(refusal), Cause.die(defect));
      fault = Effect.failCause(combined);
      before = created.length;
      const died = yield* Effect.exit(database.abortRequest(acquisition.claim));
      expect(Exit.isFailure(died) && died.cause.reasons).toHaveLength(2);
      expect(Exit.isFailure(died) && died.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error === refusal)).toBe(true);
      expect(Exit.isFailure(died) && died.cause.reasons.some(reason => Cause.isDieReason(reason) && reason.defect === defect)).toBe(true);
      yield* assertDisposed(before);
      fault = Effect.interrupt;
      before = created.length;
      const interrupted = yield* Effect.exit(database.begin({ program }));
      expect(Exit.isFailure(interrupted) && interrupted.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
      yield* assertDisposed(before);
      fault = undefined;
      expect(yield* database.resolveRequest(request)).toEqual({ kind: "busy" });
      const transaction = yield* database.begin({ program, authorityEpoch: 1n });
      expect(yield* transaction.tableNumber("items")).toBe(itemsNumber);
      yield* transaction.abort();
      const query = yield* database.beginQuery(path);
      expect(yield* query.transaction.tableNumber("items")).toBe(itemsNumber);
      yield* query.finish();
      yield* database.abortRequest(acquisition.claim);
      expect(yield* database.resolveRequest(request)).toEqual({ kind: "failed" });
    }))); } finally { capture.mockRestore(); await fixture.close(); }
  }, 30_000);
});
}
