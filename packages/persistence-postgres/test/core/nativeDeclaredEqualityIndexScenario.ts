import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import type { CoreDatabaseOptions, CoreError, CoreNativeOperations } from "../../src/core/api";
import type { CoreDocumentLogEntry, CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { planCoreNativeQuery } from "../../src/core/nativeQuery";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { serializeCoreSchema } from "../../src/core/schemaJson";
import { readDocumentObject } from "../../src/core/registry";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import oldMetadata from "./fixtures/native-declared-equality-old-metadata.json" with { type: "json" };

const target = { scopeUuid: "8a400000-0000-4000-8000-000000000001", epochUuid: "8a400000-0000-4000-8000-000000000002" };
const origin = { kind: "synthetic", sourceId: "neutral-native-declared-equality" } as const;
const lifecycleOrigin = { kind: "implicit", sourceId: "neutral-native-declared-equality.lifecycle" } as const;
const relational = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  tables: [{ tableId: "record", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "lookup", type: "text", nullable: true, default: { kind: "none" }, origin },
    { columnId: "note", type: "text", nullable: false, default: { kind: "textLiteral", value: "" }, origin },
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
      default: { kind: "currentTimestamp" as const }, origin: lifecycleOrigin })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
  ], keys: [{ keyId: "record.primary", kind: "primary", columns: ["id"], origin }], indexes: [
    { indexId: "record.lookup-equality", kind: "textEquality", columns: ["lookup"], predicate: null, origin },
    { indexId: "record.active-lookup", kind: "btree", columns: ["lookup"],
      predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
    { indexId: "record.active", kind: "btree", columns: ["deleted_at"],
      predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
  ], constraints: [], relationships: [] }], capabilities: [
    { capabilityId: "record.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "record", columnId: "created_at" },
      updatedAtColumn: { tableId: "record", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
    { capabilityId: "record.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "record", columnId: "deleted_at" },
      activeRowsIndex: { tableId: "record", indexId: "record.active" }, origin: lifecycleOrigin },
  ] }));

export const compileNativeDeclaredEqualityDefinition = Effect.fn("NativeDeclaredEqualityTest.compile")(function* () {
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-declared-equality", owner: "medusa",
    writeProfile: "medusa.neutral-native-declared-equality", evidence: { provenance: origin },
    definition: { kind: "relational", schema: relational }, bindings: [{ kind: "definition", localName: "record",
      table: { namespace: "medusa", logicalName: origin.sourceId + "/record" } }] });
  return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
});

/** Construction only: query selection, pending state and settlement remain Core-owned. */
const setup = Effect.fn("NativeDeclaredEqualityTest.setup")(function* (fixture: CorePersistenceFixture,
  persistence: CorePersistence = fixture.persistence) {
  const definition = yield* compileNativeDeclaredEqualityDefinition();
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const options: CoreDatabaseOptions = { schemaBundles: [bundle], now: Effect.succeed(1_000_000_000n),
    randomBytes: length => Effect.sync(() => randomBytes(length)), schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 };
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let active = false;
  for (let step = 0; step < 256; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); active = true; break;
    }
    if (status.state === "failed" || status.state === "overwritten")
      return yield* Effect.die(new Error("Declared equality schema " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  if (!active) return yield* Effect.die(new Error("Declared equality schema did not activate"));
  const commands = [{ name: "equality-write", mode: "write" }, { name: "equality-read", mode: "read" }] as const;
  const binding = yield* database.bindNative({ definition, commands });
  const metadata = yield* database.readNativeBinding(binding);
  const declaration = definition.tables[0], installed = metadata.tables.find(table => table.name === declaration?.name);
  if (declaration === undefined || installed === undefined) return yield* Effect.die(new Error("Missing declared equality table"));
  const begin = Effect.fn("NativeDeclaredEqualityTest.begin")(() =>
    database.beginNative(binding, { commandName: "equality-write", ...coreNativeTestBudget() }));
  const write = Effect.fn("NativeDeclaredEqualityTest.write")(<A>(body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>) =>
    Effect.acquireUseRelease(begin(),
      operation => Effect.gen(function* () {
        const result = yield* body(operation.operations);
        yield* database.commit(yield* operation.finalize()); return result;
      }), operation => operation.abort()));
  const read = Effect.fn("NativeDeclaredEqualityTest.read")((where: JsonObject) => Effect.acquireUseRelease(
    database.beginNative(binding, { commandName: "equality-read", ...coreNativeTestBudget(),
      limits: { maxIdentities: 8, maxDocumentBytes: 65_536 } }), operation => Effect.gen(function* () {
      const rows = yield* operation.operations.find(declaration.name, where);
      yield* operation.finishRead(); return rows;
    }), operation => operation.abort()));
  return { database, definition, bundle, options, commands, declaration, installed, binding, begin, write, read, table: declaration.name };
});
const failed = <A>(result: Result.Result<A, CoreError>) => Result.isFailure(result) ? result.failure : undefined;
const ids = (rows: readonly DocumentObject[]) => rows.map(row => row.id).toSorted();

export function registerNativeDeclaredEqualityIndexScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    it("captures declared nullable equality history without charging unrelated or null rows", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table, "insert", [
        { id: "active", lookup: "selected" }, { id: "deleted", lookup: "selected" },
        ...Array.from({ length: 10 }, (_, position) => ({ id: "unrelated-" + position, lookup: "other-" + position })),
        ...Array.from({ length: 10 }, (_, position) => ({ id: "null-" + position, lookup: null })),
      ]));
      yield* graph.write(operations => operations.lifecycle(graph.table, "softDelete", [{ id: "deleted" }]));
      const plan = yield* Effect.fromResult(planCoreNativeQuery(graph.installed, { lookup: "selected" }));
      // Execute before the shape assertion so the RED is the actual bounded owner failure.
      const history = yield* graph.read({ lookup: "selected" });
      expect(history.map(row => row.id).toSorted()).toEqual(["active", "deleted"]);
      expect(history.find(row => row.id === "active")?.deleted_at).toBeNull();
      expect(history.find(row => row.id === "deleted")?.deleted_at).not.toBeNull();
      expect(plan).toMatchObject({ kind: "range", index: { fields: ["lookup"] } });
      expect(graph.declaration.indexes?.find(index => index.nativeId === "record.lookup-equality"))
        .toMatchObject({ kind: "index", fields: ["lookup"] });
      expect(graph.declaration.uniqueConstraints.map(constraint => constraint.descriptor)).toEqual(["record.primary"]);
      expect(graph.declaration.rowKey).toBeUndefined();
      expect(graph.definition.foreignKeys).toBeUndefined();
      expect(graph.definition.privateTables).toBeUndefined();
    })), 120_000);

    it("preserves duplicate and null lookup values without conflating null and text", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table, "insert", [
        { id: "one", lookup: "same" }, { id: "two", lookup: "same" },
        { id: "null-one", lookup: null }, { id: "null-two", lookup: null }, { id: "literal", lookup: "null" },
      ]));
      expect(ids(yield* graph.read({ lookup: "same" }))).toEqual(["one", "two"]);
      expect(ids(yield* graph.read({ lookup: null }))).toEqual(["null-one", "null-two"]);
      expect(ids(yield* graph.read({ lookup: "null" }))).toEqual(["literal"]);
      expect(yield* graph.read({ lookup: "absent" })).toEqual([]);
    })), 120_000);

    it("keeps pending insert move delete and lifecycle transitions in one equality owner", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table, "insert", [
        { id: "leave", lookup: "selected" }, { id: "historical", lookup: "selected" }, { id: "other", lookup: "other" },
      ]));
      yield* graph.write(operations => operations.lifecycle(graph.table, "softDelete", [{ id: "historical" }]));
      yield* graph.write(operations => Effect.gen(function* () {
        expect(ids(yield* operations.find(graph.table, { lookup: "selected" }))).toEqual(["historical", "leave"]);
        yield* operations.writeRows(graph.table, "insert", [{ id: "enter", lookup: "selected" }]);
        yield* operations.writeRows(graph.table, "update", [{ id: "leave", lookup: "other" }]);
        yield* operations.deleteRows(graph.table, [{ id: "historical" }]);
        expect(ids(yield* operations.find(graph.table, { lookup: "selected" }))).toEqual(["enter"]);
        expect(ids(yield* operations.find(graph.table, { lookup: "other" }))).toEqual(["leave", "other"]);
        yield* operations.lifecycle(graph.table, "softDelete", [{ id: "enter" }]);
        expect(ids(yield* operations.find(graph.table, { lookup: "selected" }))).toEqual(["enter"]);
        expect(yield* operations.find(graph.table, { lookup: "selected", deleted_at: null })).toEqual([]);
        yield* operations.lifecycle(graph.table, "restore", [{ id: "enter" }]);
        yield* operations.writeRows(graph.table, "update", [{ id: "enter", lookup: null }]);
        expect(yield* operations.find(graph.table, { lookup: "selected" })).toEqual([]);
        expect(ids(yield* operations.find(graph.table, { lookup: null }))).toEqual(["enter"]);
      }));
      expect(ids(yield* graph.read({ lookup: null }))).toEqual(["enter"]);
      expect(yield* graph.read({ lookup: "selected" })).toEqual([]);
    })), 120_000);

    for (const change of ["insert", "remove", "move-out", "move-in", "unrelated"] as const) {
      it(`validates equality membership after a published ${change}`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture), empty = change === "insert" || change === "move-in";
        yield* graph.write(operations => operations.writeRows(graph.table, "insert", [
          { id: "existing", lookup: empty ? "other" : "selected" }, { id: "other", lookup: "other" },
        ]));
        const held = yield* Effect.acquireRelease(graph.begin(), operation => operation.abort());
        expect(ids(yield* held.operations.find(graph.table, { lookup: "selected" }))).toEqual(empty ? [] : ["existing"]);
        yield* held.operations.writeRows(graph.table, "insert", [{ id: "receipt", lookup: "receipt" }]);
        const finalized = yield* held.finalize();
        yield* graph.write(operations => Effect.gen(function* () {
          if (change === "insert") yield* operations.writeRows(graph.table, "insert", [{ id: "new", lookup: "selected" }]);
          else if (change === "remove") yield* operations.deleteRows(graph.table, [{ id: "existing" }]);
          else if (change === "unrelated") yield* operations.writeRows(graph.table, "update", [{ id: "other", lookup: "other", note: "changed" }]);
          else yield* operations.writeRows(graph.table, "update", [{ id: "existing", lookup: change === "move-in" ? "selected" : "moved" }]);
        }));
        const settled = yield* Effect.result(graph.database.commit(finalized));
        if (change === "unrelated") expect(Result.isSuccess(settled)).toBe(true);
        else expect(failed(settled)).toMatchObject({ reason: "conflict" });
        expect(yield* graph.read({ lookup: "receipt" })).toHaveLength(change === "unrelated" ? 1 : 0);
        expect(ids(yield* graph.read({ lookup: "selected" }))).toEqual(
          change === "insert" ? ["new"] : change === "move-in" || change === "unrelated" ? ["existing"] : []);
      })), 120_000);
    }

    for (const change of ["matching", "unrelated"] as const) {
      it(`validates empty equality against an accepted unpublished ${change} write`, run(fixture => Effect.gen(function* () {
        const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), receiptSaving = yield* Deferred.make<void>();
        let armed = false;
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          const documents = yield* Effect.forEach(batch.documents.filter(entry => !entry.deleted), entry => Effect.fromResult(readDocumentObject(entry)));
          if (armed && documents.some(document => document.id === "accepted")) {
            yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release);
          }
          if (armed && documents.some(document => document.id === "receipt")) yield* Deferred.succeed(receiptSaving, undefined);
          yield* fixture.persistence.write(lease, batch);
        }) };
        const graph = yield* setup(fixture, persistence);
        const held = yield* Effect.acquireRelease(graph.begin(), operation => operation.abort());
        expect(yield* held.operations.find(graph.table, { lookup: "selected" })).toEqual([]);
        yield* held.operations.writeRows(graph.table, "insert", [{ id: "receipt", lookup: "receipt" }]);
        const finalized = yield* held.finalize();
        const predecessor = yield* Effect.acquireRelease(graph.begin(), operation => operation.abort());
        yield* predecessor.operations.writeRows(graph.table, "insert", [{ id: "accepted", lookup: change === "matching" ? "selected" : "other" }]);
        const predecessorFinalized = yield* predecessor.finalize(), before = yield* graph.database.publishedTimestamp;
        yield* Effect.ensuring(Effect.gen(function* () {
          armed = true;
          const saving = yield* Effect.forkChild(Effect.result(graph.database.commit(predecessorFinalized)));
          yield* Deferred.await(entered);
          expect(yield* graph.database.publishedTimestamp).toBe(before);
          if (change === "matching") {
            expect(failed(yield* Effect.result(graph.database.commit(finalized)))).toMatchObject({ reason: "conflict" });
            expect(yield* Deferred.isDone(receiptSaving)).toBe(false);
          } else {
            const settling = yield* Effect.forkChild(graph.database.commit(finalized));
            yield* Effect.raceFirst(Deferred.await(receiptSaving), Fiber.join(settling).pipe(Effect.asVoid));
            expect(yield* graph.database.publishedTimestamp).toBe(before);
            yield* Deferred.succeed(release, undefined);
            yield* Fiber.join(settling);
          }
          yield* Deferred.succeed(release, undefined);
          expect(Result.isSuccess(yield* Fiber.join(saving))).toBe(true);
        }).pipe(Effect.timeout("20 seconds")), Deferred.succeed(release, undefined));
        expect(ids(yield* graph.read({ lookup: "selected" }))).toEqual(change === "matching" ? ["accepted"] : []);
        expect(ids(yield* graph.read({ lookup: "receipt" }))).toEqual(change === "unrelated" ? ["receipt"] : []);
      })), 120_000);
    }

    it("cold reopens the equality index and refuses authentic old metadata despite stable flat identity", run(fixture => Effect.gen(function* () {
      const observed = new Map<string, Readonly<{ entry: CoreDocumentLogEntry; document: DocumentObject }>>();
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        yield* fixture.persistence.write(lease, batch);
        for (const entry of batch.documents) if (!entry.deleted) {
          const document = yield* Effect.fromResult(readDocumentObject(entry));
          if (typeof document.native === "string") observed.set("schema", { entry, document });
        }
      }) };
      const graph = yield* setup(fixture, persistence);
      expect(graph.definition.identity).toEqual(oldMetadata.definition.identity);
      expect(graph.definition.metadata).not.toBe(oldMetadata.definition.metadata);
      expect(yield* Effect.fromResult(serializeCoreSchema(graph.definition.schema))).not.toBe(oldMetadata.definition.serializedSchema);
      yield* graph.write(operations => operations.writeRows(graph.table, "insert", [{ id: "stored", lookup: "selected" }]));
      yield* graph.database.close();
      const reopened = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause });
      const cold = yield* Effect.acquireRelease(openCoreDatabase(reopened, graph.options), database => database.close());
      const binding = yield* cold.bindNative({ definition: graph.definition, commands: graph.commands });
      yield* Effect.acquireUseRelease(cold.beginNative(binding, { commandName: "equality-read", ...coreNativeTestBudget() }), operation =>
        Effect.gen(function* () {
          expect(ids(yield* operation.operations.find(graph.table, { lookup: "selected" }))).toEqual(["stored"]);
          yield* operation.finishRead();
        }), operation => operation.abort());
      yield* cold.close();
      const record = observed.get("schema");
      if (record === undefined) return yield* Effect.die(new Error("Missing actual installed equality schema frame"));
      const statement = `UPDATE "${fixture.namespace}".documents SET json_value=$1
        WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5 RETURNING id`;
      const coordinates = [fixture.instanceName, record.entry.tableId, record.entry.id, record.entry.ts.toString()] as const;
      const oldDocument = { ...record.document, native: oldMetadata.bundle.metadata };
      yield* Effect.acquireUseRelease(Effect.tryPromise({ try: () => fixture.query(statement,
        [Result.getOrThrow(encodeDocumentValue(oldDocument)), ...coordinates]), catch: cause => cause }), rows => Effect.gen(function* () {
        expect(rows).toHaveLength(1);
        const oldPersistence = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause });
        const refusal = yield* Effect.result(Effect.acquireRelease(openCoreDatabase(oldPersistence, graph.options), database => database.close()));
        expect(failed(refusal)).toMatchObject({ reason: "corruptData", cause: "Tagged schema metadata has no expected producer proof" });
      }), () => Effect.tryPromise({ try: () => fixture.query(statement, [record.entry.jsonValue, ...coordinates]), catch: cause => cause }));
      const restoredPersistence = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause });
      const restored = yield* Effect.acquireRelease(openCoreDatabase(restoredPersistence, graph.options), database => database.close());
      expect(yield* restored.publishedTimestamp).toBeGreaterThan(0n);
    })), 120_000);
  });
}
