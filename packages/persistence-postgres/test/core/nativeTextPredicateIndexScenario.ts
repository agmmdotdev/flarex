import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { DocumentObject } from "flarex-protocol/document-value";
import type { JsonObject } from "flarex-protocol/json";
import { compilePricingCoreDefinition } from "../../../medusa-adapter/src/modules/pricing/schema";
import type { CoreDatabaseOptions, CoreError, CoreNativeOperations } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition, type CoreNativeDefinition } from "../../src/core/nativePolicy";
import { readDocumentObject } from "../../src/core/registry";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { coreNativeIndexName } from "../../src/core/schemaTableName";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "8a370000-0000-4000-8000-000000000001", epochUuid: "8a370000-0000-4000-8000-000000000002" };
const origin = { kind: "synthetic", sourceId: "neutral-native-text-predicate" } as const;
const lifecycleOrigin = { kind: "implicit", sourceId: "neutral-native-text-predicate.lifecycle" } as const;
const eligibility = { kind: "isNullAndTextEquals", nullColumnId: "deleted_at", textColumnId: "status", value: "active" } as const;
const neutralSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  tables: [{ tableId: "entry", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "alias", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "status", type: "text", nullable: false, default: { kind: "textLiteral", value: "draft" }, origin },
    { columnId: "note", type: "text", nullable: false, default: { kind: "textLiteral", value: "" }, origin },
    ...["starts_at", "ends_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: true, default: { kind: "none" as const }, origin })),
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
      default: { kind: "currentTimestamp" as const }, origin: lifecycleOrigin })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
  ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
    { indexId: "entry.active-alias", kind: "uniqueBtree", columns: ["alias"], predicate: eligibility, origin },
    { indexId: "entry.active-order", kind: "btree", columns: ["status", "starts_at", "ends_at", "id"], predicate: eligibility, origin },
    { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
  ], constraints: [], relationships: [] }], capabilities: [
    { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
      updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
    { capabilityId: "entry.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "deleted_at" },
      activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: lifecycleOrigin },
  ] }));

const compileNeutral = Effect.fn("NativeTextPredicateTest.compileNeutral")(function* () {
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-text-predicate", owner: "medusa",
    writeProfile: "medusa.neutral-native-text-predicate", evidence: { provenance: origin }, definition: { kind: "relational", schema: neutralSchema },
    bindings: [{ kind: "definition", localName: "entry", table: { namespace: "medusa", logicalName: origin.sourceId + "/entry" } }] });
  return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
});
const failed = <A>(result: Result.Result<A, CoreError>) => Result.isFailure(result) ? result.failure : undefined;
const ids = (rows: readonly DocumentObject[]) => rows.map(row => row.id);
const priceList = (id: string, status = "active") => ({ id, title: id, description: id, status, type: "sale" });
function priceListSourceIndex(definition: CoreNativeDefinition) {
  if (definition.source.definition.kind !== "relational") throw new Error("Pricing source must retain its relational definition");
  const indexes = definition.source.definition.schema.tables.find(table => table.identity.tableId === "price_list")?.indexes
    .filter(index => index.predicate?.kind === "isNullAndTextEquals");
  expect(indexes).toHaveLength(1);
  const index = indexes?.[0];
  if (index === undefined) throw new Error("Missing authentic PriceList text-predicate declaration");
  expect(index.identity.indexId).toBe("PriceList_id_status_starts_at_ends_at_0");
  expect(index.kind).toBe("btree");
  expect(index.columns.map(column => column.columnId)).toEqual(["id", "status", "starts_at", "ends_at"]);
  expect(index.predicate).toMatchObject({ kind: "isNullAndTextEquals", value: "active",
    nullColumn: { tableId: "price_list", columnId: "deleted_at" }, textColumn: { tableId: "price_list", columnId: "status" } });
  return index;
}

/** Only real source/lifecycle/command assembly. Every query, index entry,
 * constraint, dependency and accepted-prefix decision belongs to Core. */
const setup = Effect.fn("NativeTextPredicateTest.setup")(function* (fixture: CorePersistenceFixture, kind: "pricing" | "neutral",
  persistence: CorePersistence = fixture.persistence, overrides: Partial<CoreDatabaseOptions> = {}) {
  const definition = yield* (kind === "pricing" ? compilePricingCoreDefinition(target) : compileNeutral());
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const options: CoreDatabaseOptions = { schemaBundles: [bundle], now: Effect.succeed(1_000_000_000n),
    randomBytes: length => Effect.sync(() => randomBytes(length)), schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0, ...overrides };
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let active = false;
  for (let step = 0; step < 256; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); active = true; break;
    }
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Text predicate schema " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  if (!active) return yield* Effect.die(new Error("Text predicate schema did not activate"));
  const commands = [{ name: "text-write", mode: "write" }, { name: "text-read", mode: "read" }] as const;
  const binding = yield* database.bindNative({ definition, commands });
  const metadata = yield* database.readNativeBinding(binding);
  const table = (localName: string) => {
    const declaration = definition.tables.find(table => table.localName === localName);
    const installed = metadata.tables.find(table => table.name === declaration?.name);
    if (declaration === undefined || installed === undefined) throw new Error("Missing authentic text-predicate table " + localName);
    return { declaration, installed, name: declaration.name };
  };
  const index = (localName: string, nativeId: string) => {
    const selected = table(localName);
    const declaration = selected.declaration.indexes?.find(index => index.nativeId === nativeId);
    const installed = selected.installed.indexes.find(index => index.name === declaration?.indexName);
    if (declaration === undefined || installed === undefined) throw new Error("Missing authentic text-predicate index " + nativeId);
    return { declaration, installed, name: installed.name };
  };
  const begin = () => database.beginNative(binding, { commandName: "text-write", ...coreNativeTestBudget() });
  const write = Effect.fn("NativeTextPredicateTest.write")(<A>(body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>) => Effect.acquireUseRelease(begin(), operation =>
    Effect.gen(function* () { const value = yield* body(operation.operations); yield* database.commit(yield* operation.finalize()); return value; }), operation => operation.abort()));
  const read = Effect.fn("NativeTextPredicateTest.read")((localName: string, where: JsonObject = {}) => Effect.acquireUseRelease(database.beginNative(binding,
    { commandName: "text-read", ...coreNativeTestBudget() }), operation => Effect.gen(function* () {
    const rows = yield* operation.operations.find(table(localName).name, where); yield* operation.finishRead(); return rows;
  }), operation => operation.abort()));
  const coldRead = Effect.fn("NativeTextPredicateTest.coldRead")(function* (localName: string, where: JsonObject = {}) {
    yield* database.close();
    const cold = yield* Effect.acquireRelease(openCoreDatabase(yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause }), options), db => db.close());
    const coldBinding = yield* cold.bindNative({ definition, commands });
    return yield* Effect.acquireUseRelease(cold.beginNative(coldBinding, { commandName: "text-read", ...coreNativeTestBudget() }), operation =>
      Effect.gen(function* () { const rows = yield* operation.operations.find(table(localName).name, where); yield* operation.finishRead(); return rows; }), operation => operation.abort());
  });
  return { database, definition, bundle, options, binding, metadata, table, index, begin, write, read, coldRead };
});

export function registerNativeTextPredicateIndexScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    it("keeps complete Pricing bodies in the ordinary index and requires both exact native page equalities", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, "pricing"), table = graph.table("price_list"), sourceIndex = priceListSourceIndex(graph.definition);
      const index = graph.index("price_list", sourceIndex.identity.indexId);
      expect(graph.definition.tables).toHaveLength(6);
      expect(index.installed.fields).toEqual(["deleted_at", "status", "id", "starts_at", "ends_at"]);
      expect(index.declaration.nativeId).toBe(sourceIndex.identity.indexId);
      expect(index.declaration.requiredPrefix).toEqual({ all: [{ field: "deleted_at", value: null }, { field: "status", value: "active" }] });
      if (table.declaration.table === undefined) return yield* Effect.die(new Error("Missing native Pricing table binding"));
      expect(index.name).toBe(yield* coreNativeIndexName(table.declaration.table, "index", sourceIndex.identity.indexId));
      expect(table.declaration.uniqueConstraints.some(constraint => constraint.indexName === index.name)).toBe(false);
      yield* graph.write(operations => operations.writeRows(table.name, "insert", [priceList("active"), priceList("draft", "draft"), priceList("deleted")]));
      yield* graph.write(operations => operations.lifecycle(table.name, "softDelete", ["deleted"]));
      const snapshot = yield* fixture.persistence.readSnapshot(yield* graph.database.publishedTimestamp);
      const backing = yield* snapshot.scan({ tableId: table.installed.tabletId, index: index.installed.ref,
        interval: { start: null, end: null }, order: "asc", maxResults: 128 });
      expect(ids(yield* Effect.forEach(backing.entries, entry => Effect.fromResult(readDocumentObject(entry.document, table.installed)))).toSorted())
        .toEqual(["active", "deleted", "draft"]);
      expect(backing.cursor.kind).toBe("end");
      expect(ids(yield* graph.read("price_list")).toSorted()).toEqual(["active", "deleted", "draft"]);
      expect(ids(yield* graph.read("price_list", { deleted_at: null })).toSorted()).toEqual(["active", "draft"]);
      expect(ids(yield* graph.read("price_list", { status: "draft" }))).toEqual(["draft"]);
      const valid = yield* graph.begin();
      expect(ids((yield* valid.operations.findPage(table.name, { deleted_at: null, status: "active" }, { indexName: index.name, offset: 0, limit: 8 })).documents))
        .toEqual(["active"]);
      yield* valid.abort();
      const invalidWhere: readonly JsonObject[] = [{}, { deleted_at: null }, { status: "active" }, { deleted_at: null, status: "draft" },
        { deleted_at: null, status: { eq: "active" } }, { deleted_at: "2026-11-01T00:00:00.000Z", status: "active" }];
      for (const where of invalidWhere) {
        const operation = yield* graph.begin();
        expect(failed(yield* Effect.result(operation.operations.findPage(table.name, where, { indexName: index.name, offset: 0, limit: 8 }))))
          .toMatchObject({ _tag: "CoreNativeQueryError", reason: "invalidInput" });
        yield* operation.abort();
      }
    })), 120_000);

    it("moves genuine Pricing status and deletion keys through pending overlays and cold committed reads", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, "pricing"), table = graph.table("price_list").name;
      const index = graph.index("price_list", priceListSourceIndex(graph.definition).identity.indexId).name;
      yield* graph.write(operations => operations.writeRows(table, "insert", [priceList("enter", "draft"), priceList("leave"), priceList("deleted")]));
      yield* graph.write(operations => operations.lifecycle(table, "softDelete", ["deleted"]));
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(table, "update", [{ id: "enter", status: "active" }, { id: "leave", status: "draft" }]);
        yield* operations.lifecycle(table, "restore", ["deleted"]);
        const page = yield* operations.findPage(table, { deleted_at: null, status: "active" }, { indexName: index, offset: 0, limit: 8 });
        expect(ids(page.documents)).toEqual(["deleted", "enter"]);
        yield* operations.lifecycle(table, "softDelete", ["enter"]);
        expect(ids((yield* operations.findPage(table, { deleted_at: null, status: "active" }, { indexName: index, offset: 0, limit: 8 })).documents)).toEqual(["deleted"]);
      }));
      const rows = yield* graph.coldRead("price_list");
      expect(rows).toHaveLength(3);
      expect(ids(rows.filter(row => row.deleted_at === null && row.status === "active"))).toEqual(["deleted"]);
      expect(rows.find(row => row.id === "leave")?.status).toBe("draft");
      expect(rows.find(row => row.id === "enter")?.deleted_at).not.toBeNull();
    })), 120_000);

    it("orders nullable tail fields and rejects an EOF phantom through the normal commit owner", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, "neutral"), table = graph.table("entry").name, index = graph.index("entry", "entry.active-order").name;
      const stamp = "2026-11-01T00:00:00.000Z";
      yield* graph.write(operations => operations.writeRows(table, "insert", [
        { id: "timed", status: "active", starts_at: stamp, ends_at: null },
        { id: "ends", status: "active", starts_at: null, ends_at: stamp },
        { id: "nulls", status: "active", starts_at: null, ends_at: null },
        { id: "draft", status: "draft", starts_at: null, ends_at: null },
      ]));
      const observing = yield* graph.begin();
      const page = yield* observing.operations.findPage(table, { deleted_at: null, status: "active" }, { indexName: index, offset: 0, limit: 8 });
      expect(ids(page.documents)).toEqual(["nulls", "ends", "timed"]);
      expect(page.hasMore).toBe(false);
      yield* observing.operations.writeRows(table, "insert", [{ id: "must-rollback", status: "draft" }]);
      yield* graph.write(operations => operations.writeRows(table, "insert", [{ id: "later-phantom", status: "active", starts_at: "2027-01-01T00:00:00.000Z" }]));
      expect(failed(yield* Effect.result(graph.database.commit(yield* observing.finalize())))).toMatchObject({ reason: "conflict" });
      yield* observing.abort();
      expect(yield* graph.read("entry", { id: "must-rollback" })).toHaveLength(0);
      expect(yield* graph.read("entry", { id: "later-phantom" })).toHaveLength(1);
    })), 120_000);

    it("separates nullable business keys from text eligibility and enforces pending entry and exit collisions", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, "neutral"), table = graph.table("entry").name;
      yield* graph.write(operations => operations.writeRows(table, "insert", [
        { id: "null-a", status: "active", alias: null }, { id: "null-b", status: "active", alias: null },
        { id: "owner", status: "active", alias: "shared" }, { id: "draft", status: "draft", alias: "shared" },
      ]));
      const pending = yield* graph.begin();
      expect(failed(yield* Effect.result(pending.operations.writeRows(table, "update", [{ id: "draft", status: "active" }]))))
        .toMatchObject({ _tag: "CoreNativeUniqueConflict", fields: ["alias"] });
      expect((yield* pending.operations.find(table, { id: "draft" }))[0]?.status).toBe("draft");
      yield* pending.operations.writeRows(table, "update", [{ id: "owner", status: "draft" }]);
      yield* pending.operations.writeRows(table, "update", [{ id: "draft", status: "active" }]);
      expect(ids(yield* pending.operations.find(table, { deleted_at: null, status: "active", alias: "shared" }))).toEqual(["draft"]);
      yield* graph.database.commit(yield* pending.finalize());
      yield* pending.abort();
      yield* graph.write(operations => operations.lifecycle(table, "softDelete", ["draft"]));
      yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", status: "active" }]));
      expect(failed(yield* Effect.result(graph.write(operations => operations.lifecycle(table, "restore", ["draft"])))))
        .toMatchObject({ _tag: "CoreNativeUniqueConflict", fields: ["alias"] });
      const rows = yield* graph.coldRead("entry");
      expect(rows.filter(row => row.status === "active" && row.deleted_at === null && row.alias === null)).toHaveLength(2);
      expect(ids(rows.filter(row => row.status === "active" && row.deleted_at === null && row.alias === "shared"))).toEqual(["owner"]);
      expect(rows.find(row => row.id === "draft")?.deleted_at).not.toBeNull();
    })), 120_000);

    it("accepts one of two concurrent conditional text claims and preserves exactly one owner", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, "neutral"), table = graph.table("entry").name;
      const first = yield* graph.begin(), second = yield* graph.begin();
      yield* first.operations.writeRows(table, "insert", [{ id: "first", status: "active", alias: "claimed" }]);
      yield* second.operations.writeRows(table, "insert", [{ id: "second", status: "active", alias: "claimed" }]);
      yield* graph.database.commit(yield* first.finalize());
      expect(failed(yield* Effect.result(graph.database.commit(yield* second.finalize())))).toMatchObject({ reason: "conflict" });
      yield* first.abort(); yield* second.abort();
      expect(ids(yield* graph.coldRead("entry", { deleted_at: null, status: "active", alias: "claimed" }))).toEqual(["first"]);
    })), 120_000);

    for (const profile of ["unique", "range"] as const) for (const fault of ["success", "beforeWrite"] as const) {
      it(`orders ${profile} text-predicate dependencies through an accepted status exit and ${fault} settlement`, run(fixture => Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), candidateAdmitting = yield* Deferred.make<void>();
        let armed = false, candidateAdmission = false, candidateSaved = false;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          const documents = yield* Effect.forEach(batch.documents.filter(document => !document.deleted), document => Effect.fromResult(readDocumentObject(document)));
          if (armed && documents.some(document => document.id === "competitor" && document.status === "draft")) {
            yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release);
            if (fault === "beforeWrite") return yield* new CorePersistenceError({ reason: "unavailable" });
          }
          yield* fixture.persistence.write(lease, batch);
          if (armed && documents.some(document => document.id === "candidate")) candidateSaved = true;
        }) };
        const graph = yield* setup(fixture, "neutral", persistence, { now: Effect.gen(function* () {
          if (candidateAdmission) { candidateAdmission = false; yield* Deferred.succeed(candidateAdmitting, undefined); }
          return 1_000_000_000n;
        }) });
        const table = graph.table("entry").name;
        const held = yield* graph.begin();
        if (profile === "range") expect(yield* held.operations.find(table, { deleted_at: null, status: "active" })).toEqual([]);
        yield* held.operations.writeRows(table, "insert", [{ id: "candidate", status: profile === "unique" ? "active" : "draft", alias: "claimed" }]);
        const heldFinalized = yield* held.finalize();
        yield* graph.write(operations => operations.writeRows(table, "insert", [{ id: "competitor", status: "active", alias: "claimed" }]));
        const predecessor = yield* graph.begin();
        yield* predecessor.operations.writeRows(table, "update", [{ id: "competitor", status: "draft" }]);
        const predecessorFinalized = yield* predecessor.finalize();
        yield* Effect.ensuring(Effect.gen(function* () {
          armed = true;
          const savingPredecessor = yield* Effect.forkChild(Effect.result(graph.database.commit(predecessorFinalized)));
          yield* Deferred.await(entered);
          candidateAdmission = true;
          const savingCandidate = yield* Effect.forkChild(Effect.result(graph.database.commit(heldFinalized)));
          yield* Deferred.await(candidateAdmitting);
          expect(candidateSaved).toBe(false);
          yield* Deferred.succeed(release, undefined);
          const predecessorResult = yield* Fiber.join(savingPredecessor), candidateResult = yield* Fiber.join(savingCandidate);
          if (fault === "success") {
            expect(Result.isSuccess(predecessorResult)).toBe(true);
            expect(Result.isSuccess(candidateResult)).toBe(true);
            expect(candidateSaved).toBe(true);
          } else {
            expect(failed(predecessorResult)).toMatchObject({ reason: "unavailable" });
            expect(candidateResult).toEqual(predecessorResult);
            expect(candidateSaved).toBe(false);
          }
        }).pipe(Effect.timeout("20 seconds")), Deferred.succeed(release, undefined));
        yield* held.abort(); yield* predecessor.abort();
        const rows = yield* graph.coldRead("entry");
        expect(rows.find(row => row.id === "competitor")?.status).toBe(fault === "success" ? "draft" : "active");
        expect(rows.some(row => row.id === "candidate")).toBe(fault === "success");
        expect(rows.filter(row => row.status === "active" && row.deleted_at === null && row.alias === "claimed")).toHaveLength(
          fault === "beforeWrite" || profile === "unique" ? 1 : 0);
      })), 120_000);
    }
  });
}
