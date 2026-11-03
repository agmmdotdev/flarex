import { randomBytes } from "node:crypto";
import { Buffer } from "node:buffer";
import { Cause, Effect, Exit, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { compileIndexRange } from "flarex-protocol/index-range";
import { normalizeRelationalSchema, type RelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { DocumentObject } from "flarex-protocol/document-value";
import type { JsonObject } from "flarex-protocol/json";
import type { CoreError, CoreNativeOperations } from "../../src/core/api";
import type { CoreIndexPage, CoreIndexScan, CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { coreNativeRelationalRows, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { planCoreNativeQuery } from "../../src/core/nativeQuery";
import { executeCoreNativeRelationalPage, prepareCoreNativeRelationalRead } from "../../src/core/nativeRelationalQuery";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const origin = { kind: "synthetic", sourceId: "native-non-null-index" } as const;
const lifecycleOrigin = { kind: "implicit", sourceId: "native-non-null-index.lifecycle" } as const;
const target = { scopeUuid: "8a500000-0000-4000-8000-000000000001", epochUuid: "8a500000-0000-4000-8000-000000000002" };
type Shape = "admitted" | "unique" | "compound" | "unrelatedKey";

const compileDefinition = Effect.fn("NativeNonNullIndexTest.compileDefinition")(function* (relational: RelationalSchema) {
  const source = yield* captureLogicalSchemaSource({ key: "medusa.native-non-null-index", owner: "medusa",
    writeProfile: "medusa.native-non-null-index", evidence: { provenance: origin },
    definition: { kind: "relational", schema: relational }, bindings: relational.tables.map(table => ({
      kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: origin.sourceId + "/" + table.identity.tableId },
    })) });
  return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
});

export const compileNativeNonNullIndex = Effect.fn("NativeNonNullIndexTest.compile")(function* (shape: Shape = "admitted") {
  const relational = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: [{ tableId: "record", origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "lookup", type: "text", nullable: true, default: { kind: "none" }, origin },
      { columnId: "guarded", type: "text", nullable: false, default: { kind: "textLiteral", value: "" }, origin },
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false,
        default: { kind: "currentTimestamp" }, origin: lifecycleOrigin })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
    ], keys: [{ keyId: "record.primary", kind: "primary", columns: ["id"], origin }], indexes: [
      { indexId: "record.active", kind: "btree", columns: ["deleted_at"],
        predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
      { indexId: "record.deleted", kind: "btree", columns: ["deleted_at"],
        predicate: { kind: "isNotNull", columnId: "deleted_at" }, origin },
      { indexId: "record.history", kind: "textEquality", columns: ["lookup"], predicate: null, origin },
      { indexId: "record.non-null", kind: "btree", columns: ["lookup"],
        predicate: { kind: "isNotNull", columnId: "lookup" }, origin },
      { indexId: "record.guarded", kind: "btree", columns: ["guarded"],
        predicate: { kind: "isNotNull", columnId: "guarded" }, origin },
      { indexId: "record.active-non-null", kind: shape === "unique" ? "uniqueBtree" : "btree",
        columns: shape === "compound" ? ["lookup", "id"] : shape === "unrelatedKey" ? ["id"] : ["lookup"],
        predicate: { kind: "isNullAndNotNull", nullColumnId: "deleted_at", notNullColumnId: "lookup" }, origin },
    ], constraints: [], relationships: [] }], capabilities: [
      { capabilityId: "record.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "record", columnId: "created_at" },
        updatedAtColumn: { tableId: "record", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
      { capabilityId: "record.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "record", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "record", indexId: "record.active" }, origin: lifecycleOrigin },
    ] }));
  return yield* compileDefinition(relational);
});

type CompoundShape = "admitted" | "unique" | "testedKey" | "singleOffKey" | "singleOffKeyUnique" | "unorderedPredicate";
const tuple = ["reference", "reference_id"];
const textColumn = (columnId: string) => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin } as const);

export const compileNativeCompoundNonNullIndex = Effect.fn("NativeNonNullIndexTest.compileCompound")(function* (
  shape: CompoundShape = "admitted",
) {
  const relational = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: [
      { tableId: "parent", origin, columns: tuple.map(textColumn), keys: [
        { keyId: "parent.primary", kind: "primary", columns: tuple, origin },
      ], indexes: [], constraints: [], relationships: [] },
      { tableId: "record", origin, columns: [
        textColumn("id"), ...tuple.map(textColumn),
        ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false,
          default: { kind: "currentTimestamp" }, origin: lifecycleOrigin })),
        { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
        { columnId: "payload", type: "jsonb", nullable: true, default: { kind: "none" }, origin },
      ], keys: [{ keyId: "record.primary", kind: "primary", columns: ["id"], origin }], indexes: [
        { indexId: "record.active", kind: "btree", columns: ["deleted_at"],
          predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
        { indexId: "record.compound-history", kind: shape === "unique" || shape === "singleOffKeyUnique" ? "uniqueBtree" : "btree",
          columns: shape === "testedKey" ? ["reference", "deleted_at"]
            : shape === "singleOffKey" || shape === "singleOffKeyUnique" ? ["reference"] : tuple,
          predicate: { kind: "isNotNull", columnId: shape === "unorderedPredicate" ? "payload" : "deleted_at" }, origin },
      ], constraints: [{ constraintId: "record.parent", kind: "foreignKey", sourceColumns: tuple,
        targetColumns: tuple.map(columnId => ({ tableId: "parent", columnId })), onDelete: "noAction", onUpdate: "noAction", origin }],
      relationships: [] },
    ], capabilities: [
      { capabilityId: "record.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "record", columnId: "created_at" },
        updatedAtColumn: { tableId: "record", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
      { capabilityId: "record.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "record", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "record", indexId: "record.active" }, origin: lifecycleOrigin },
    ] }));
  return yield* compileDefinition(relational);
});

const setup = Effect.fn("NativeNonNullIndexTest.setup")(function* (persistence: CorePersistence,
  definitionEffect: ReturnType<typeof compileNativeNonNullIndex> = compileNativeNonNullIndex(),
) {
  const definition = yield* definitionEffect;
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, { schemaBundles: [bundle],
    now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 }), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  for (let step = 0; step < 256; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle });
      break;
    }
    if (status.state === "failed" || status.state === "overwritten" || step === 255)
      return yield* Effect.die(new Error("Non-null schema did not activate: " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  const commands = [{ name: "write", mode: "write" }, { name: "read", mode: "read" }] as const;
  const binding = yield* database.bindNative({ definition, commands });
  const declaration = definition.tables.find(table => table.localName === "record"), metadata = yield* database.readNativeBinding(binding);
  const installed = metadata.tables.find(table => table.name === declaration?.name);
  if (declaration === undefined || installed === undefined) return yield* Effect.die(new Error("Missing native non-null test table"));
  const begin = () => database.beginNative(binding, { commandName: "write", ...coreNativeTestBudget() });
  const write = Effect.fn("NativeNonNullIndexTest.write")(<A>(body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>) =>
    Effect.acquireUseRelease(begin(),
      operation => Effect.gen(function* () {
        const value = yield* body(operation.operations);
        yield* database.commit(yield* operation.finalize());
        return value;
      }), operation => operation.abort()));
  const read = Effect.fn("NativeNonNullIndexTest.read")(<A>(body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>) =>
    Effect.acquireUseRelease(database.beginNative(binding, { commandName: "read", ...coreNativeTestBudget(),
      limits: { maxIdentities: 8, maxDocumentBytes: 65_536 } }), operation => Effect.gen(function* () {
        const value = yield* body(operation.operations);
        yield* operation.finishRead();
        return value;
      }), operation => operation.abort()));
  return { database, begin, definition, declaration, installed, table: declaration.name, read, write };
});

const ids = (rows: readonly DocumentObject[]) => rows.map(row => row.id).toSorted();
const activeNonNull = { deleted_at: null, lookup: { gt: null } };
const selectedReference = { reference: "source", reference_id: "selected" };
const otherReference = { reference: "source", reference_id: "other" };
const compoundHistory = { ...selectedReference, deleted_at: { gt: null } };

export function registerNativeNonNullIndexScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const exit = await Effect.runPromiseExit(Effect.acquireUseRelease(
        Effect.tryPromise({ try: createFixture, catch: cause => cause }),
        fixture => Effect.scoped(Effect.suspend(() => body(fixture))),
        fixture => Effect.tryPromise({ try: () => fixture.close(), catch: cause => cause }),
      ));
      if (Exit.isFailure(exit)) throw new Error(Cause.pretty(exit.cause), { cause: exit.cause });
    };

    it("uses the bounded ordinary interval through pending and committed lifecycle transitions", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence), { table } = graph;
      yield* graph.write(operations => operations.writeRows(table, "insert", [
        { id: "live", lookup: "shared" }, { id: "empty", lookup: "" }, { id: "deleted", lookup: "shared" },
        ...Array.from({ length: 12 }, (_, position) => ({ id: "null-" + position, lookup: null })),
        ...Array.from({ length: 12 }, (_, position) => ({ id: "historical-" + position, lookup: "other" })),
      ]));
      yield* graph.write(operations => operations.lifecycle(table, "softDelete", [
        { id: "deleted" }, ...Array.from({ length: 12 }, (_, position) => ({ id: "historical-" + position })),
      ]));
      const selected = yield* Effect.fromResult(planCoreNativeQuery(graph.installed, activeNonNull));
      expect(selected).toMatchObject({ kind: "range", index: { fields: ["deleted_at", "lookup"] } });
      expect(ids(yield* graph.read(operations => operations.find(table, activeNonNull)))).toEqual(["empty", "live"]);
      expect(ids(yield* graph.read(operations => operations.find(table, { lookup: "shared" })))).toEqual(["deleted", "live"]);

      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.lifecycle(table, "softDelete", [{ id: "live" }]);
        yield* operations.lifecycle(table, "restore", [{ id: "deleted" }]);
        yield* operations.writeRows(table, "update", [{ id: "null-0", lookup: "new" }, { id: "empty", lookup: null }]);
        expect(ids(yield* operations.find(table, activeNonNull))).toEqual(["deleted", "null-0"]);
      }));
      expect(ids(yield* graph.read(operations => operations.find(table, activeNonNull)))).toEqual(["deleted", "null-0"]);
    })), 120_000);

    it("retains incumbent page authority and refuses a newly guarded named page", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence), { table } = graph;
      const active = graph.declaration.indexes?.find(index => index.nativeId === "record.active");
      const deleted = graph.declaration.indexes?.find(index => index.nativeId === "record.deleted");
      const history = graph.declaration.indexes?.find(index => index.nativeId === "record.history");
      const nonNull = graph.declaration.indexes?.find(index => index.nativeId === "record.non-null");
      const guarded = graph.declaration.indexes?.find(index => index.nativeId === "record.active-non-null");
      if (active === undefined || history === undefined || guarded === undefined)
        return yield* Effect.die(new Error("Missing incumbent or guarded index"));
      expect(deleted).toMatchObject({ indexName: active.indexName, requiredNonNull: "deleted_at" });
      expect(nonNull).toMatchObject({ indexName: history.indexName, requiredNonNull: "lookup" });
      expect(guarded).toMatchObject({ fields: ["deleted_at", "lookup"], requiredNonNull: "lookup",
        requiredPrefix: { field: "deleted_at", value: null } });
      expect(graph.definition.source.definition).toMatchObject({ kind: "relational", schema: { tables: [{ indexes: expect.arrayContaining([
        expect.objectContaining({ predicate: expect.objectContaining({ kind: "isNullAndNotNull" }) }),
      ]) }] } });
      yield* graph.write(operations => operations.writeRows(table, "insert", [
        { id: "one", lookup: "value", guarded: "" }, { id: "null", lookup: null },
      ]));
      expect(ids(yield* graph.read(operations => operations.find(table, { lookup: { gt: null } })))).toEqual(["one"]);
      const page = (indexName: string) => ({ indexName, offset: 0, limit: 1 });
      const existing = yield* graph.read(operations => operations.findPage(table, { deleted_at: null, id: "one" }, page(active.indexName)));
      expect(ids(existing.documents)).toEqual(["one"]);
      const refused = yield* Effect.result(graph.read(operations => operations.findPage(table, activeNonNull, page(guarded.indexName))));
      expect(refused).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreNativeQueryError", reason: "invalidInput" } });
      const policy = coreNativeRelationalRows(graph.definition, table);
      if (policy === undefined) return yield* Effect.die(new Error("Missing native row policy"));
      const query = yield* Effect.fromResult(prepareCoreNativeRelationalRead(policy, { fields: ["id"],
        order: { column: "guarded", direction: "asc" }, predicate: { kind: "isNull", column: "deleted_at" }, take: 1 }, 8));
      const generic = yield* Effect.result(graph.read(operations =>
        executeCoreNativeRelationalPage(operations, graph.installed, graph.declaration, policy, query)));
      expect(generic).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreQueryInputError", reason: "invalidQuery" } });
    })), 120_000);

    it.each(["admitted", "singleOffKey"] as const)("reads the exact %s off-key interval under the examined limit and keeps historical FK membership", shape => run(fixture => Effect.gen(function* () {
      const scans: Array<Readonly<{ request: CoreIndexScan; page: CoreIndexPage }>> = [];
      const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (...args) =>
        fixture.persistence.readSnapshot(...args).pipe(Effect.map(snapshot => ({ ...snapshot, scan: request =>
          snapshot.scan(request).pipe(Effect.tap(page => Effect.sync(() => { scans.push({ request, page }); }))),
        }))) };
      const graph = yield* setup(persistence, compileNativeCompoundNonNullIndex(shape)), { table } = graph;
      const parent = graph.definition.tables.find(candidate => candidate.localName === "parent");
      const guarded = graph.declaration.indexes?.find(index => index.nativeId === "record.compound-history");
      const reverse = graph.declaration.indexes?.find(index => index.nativeId === "foreign-key/record.parent");
      if (parent === undefined || guarded === undefined || reverse === undefined)
        return yield* Effect.die(new Error("Missing history and independent reverse bindings"));
      const prefix: Readonly<Record<string, string>> = shape === "singleOffKey"
        ? { reference: selectedReference.reference } : selectedReference;
      const sibling = shape === "singleOffKey" ? { ...otherReference, reference: "other-source" } : otherReference;
      const history = { ...prefix, deleted_at: { gt: null } };
      const fields = [...Object.keys(prefix), "deleted_at"];
      expect(guarded).toMatchObject({ fields, requiredNonNull: "deleted_at" });
      expect(reverse.fields).toEqual(tuple);
      expect(reverse).not.toHaveProperty("requiredNonNull");
      expect(reverse.indexName).not.toBe(guarded.indexName);
      expect(graph.definition.foreignKeys).toMatchObject([{ descriptor: "record.parent", sourceIndexName: reverse.indexName }]);
      expect(graph.declaration.uniqueConstraints.map(constraint => constraint.descriptor)).toEqual(["record.primary"]);

      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(parent.name, "insert", [selectedReference, sibling]);
        yield* operations.writeRows(table, "insert", [
          { id: "selected-history", ...selectedReference }, { id: "other-history", ...sibling },
          ...Array.from({ length: 12 }, (_, position) => ({ id: "active-" + position, ...selectedReference })),
        ]);
        yield* operations.lifecycle(table, "softDelete", [{ id: "selected-history" }, { id: "other-history" }]);
      }));

      const selected = yield* Effect.fromResult(planCoreNativeQuery(graph.installed, history));
      if (selected.kind !== "range") return yield* Effect.die(new Error("Expected ordinary off-key range"));
      const interval = yield* Effect.fromResult(compileIndexRange([
        ...Object.entries(prefix).map(([field, value]) => ({ op: "eq" as const, field, value })),
        { op: "gt", field: "deleted_at", value: null },
      ], fields));
      expect(selected.index.name).toBe(guarded.indexName);
      expect(selected.interval).toEqual(interval);
      scans.length = 0;
      expect(ids(yield* graph.read(operations => operations.find(table, history)))).toEqual(["selected-history"]);
      expect(scans.filter(({ request }) => Buffer.from(request.index.id).equals(selected.index.ref.id))
        .map(({ request, page }) => ({ interval: request.interval, examined: page.entries.length, cursor: page.cursor })))
        .toEqual([{ interval, examined: 1, cursor: { kind: "end" } }]);

      const incompleteWhere: JsonObject = shape === "singleOffKey" ? prefix
        : { reference: selectedReference.reference, reference_id: { gt: null }, deleted_at: { gt: null } };
      const incomplete = yield* Effect.result(graph.read(operations => operations.find(table, incompleteWhere)));
      expect(incomplete).toMatchObject({ _tag: "Failure", failure: { reason: "capacity", cause: "Native complete index capture limit" } });
      const page = yield* Effect.result(graph.read(operations => operations.findPage(table, history,
        { indexName: guarded.indexName, offset: 0, limit: 1 })));
      expect(page).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput", cause: "Native non-null index does not admit named pages" } });

      expect(ids(yield* graph.read(operations => operations.find(table, sibling)))).toEqual(["other-history"]);
      const restricted = yield* Effect.result(graph.write(operations => operations.deleteRows(parent.name, [sibling])));
      expect(restricted).toMatchObject({ _tag: "Failure", failure: { _tag: "CoreNativeForeignKeyError", reason: "deleteRestricted" } });

      yield* graph.write(operations => Effect.gen(function* () {
        expect(ids(yield* operations.find(table, history))).toEqual(["selected-history"]);
        yield* operations.lifecycle(table, "softDelete", [{ id: "active-0" }]);
        yield* operations.lifecycle(table, "restore", [{ id: "selected-history" }]);
        expect(ids(yield* operations.find(table, history))).toEqual(["active-0"]);
      }));
      expect(ids(yield* graph.read(operations => operations.find(table, history)))).toEqual(["active-0"]);
    }))(), 120_000);

    it("conflicts when a competitor enters a negative history interval and ignores active siblings", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence, compileNativeCompoundNonNullIndex()), { table } = graph;
      const parent = graph.definition.tables.find(candidate => candidate.localName === "parent");
      if (parent === undefined) return yield* Effect.die(new Error("Missing compound parent binding"));
      yield* graph.write(operations => operations.writeRows(parent.name, "insert", [selectedReference, otherReference]));
      const holdEmptyHistory = Effect.fn("NativeNonNullIndexTest.holdEmptyHistory")(function* () {
        const held = yield* Effect.acquireRelease(graph.begin(), operation => operation.abort());
        expect(yield* held.operations.find(table, compoundHistory)).toEqual([]);
        return yield* held.finalize();
      });

      const activeSibling = yield* holdEmptyHistory();
      yield* graph.write(operations => operations.writeRows(table, "insert", [{ id: "active", ...selectedReference }]));
      expect(Result.isSuccess(yield* Effect.result(graph.database.commit(activeSibling)))).toBe(true);
      const otherTuple = yield* holdEmptyHistory();
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(table, "insert", [{ id: "other", ...otherReference }]);
        yield* operations.lifecycle(table, "softDelete", [{ id: "other" }]);
      }));
      expect(Result.isSuccess(yield* Effect.result(graph.database.commit(otherTuple)))).toBe(true);

      const crossing = yield* holdEmptyHistory();
      yield* graph.write(operations => operations.lifecycle(table, "softDelete", [{ id: "active" }]));
      expect(yield* Effect.result(graph.database.commit(crossing))).toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
      expect(ids(yield* graph.read(operations => operations.find(table, compoundHistory)))).toEqual(["active"]);
      yield* graph.write(operations => operations.lifecycle(table, "restore", [{ id: "active" }]));

      const insertion = yield* holdEmptyHistory();
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(table, "insert", [{ id: "new-history", ...selectedReference }]);
        yield* operations.lifecycle(table, "softDelete", [{ id: "new-history" }]);
      }));
      expect(yield* Effect.result(graph.database.commit(insertion))).toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
      expect(ids(yield* graph.read(operations => operations.find(table, compoundHistory)))).toEqual(["new-history"]);
    })), 120_000);
  });
}
