import { randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema, relationalSchemaSourceFromDefinition } from "flarex-protocol/internal/relational-schema";
import type { CoreError, CoreNativeOperations, CoreNativeSetNullIntent, CoreRequestIdentity } from "../../src/core/api";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { inspectReferenceFailure } from "../../src/values/referenceFailure";
import { inspectRelationalFailure } from "../../src/values/relationalFailure";
import { projectCoreCommerceFailure } from "../../src/frameworks/commerceTransaction/nativeFailure";
import { makeNativeCommerceParticipant } from "../../src/frameworks/commerceTransaction/nativeStore";
import { commerceError, commerceLimits } from "../../src/frameworks/commerceTransaction/model";
import { makeBoundedRequestLifetime } from "../../src/execution/preparation/boundedRequestLifetime";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "2beec849-aec4-4f91-8b57-3ad10cc44080", epochUuid: "99695e9e-97df-4353-aa16-50c99263ef53" };
const origin = { kind: "synthetic", sourceId: "neutral-native-checkpoint" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId, capabilities: [], tables: [
  { tableId: "parent", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "parent.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [] },
  { tableId: "child", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "parent_id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "code", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "count", type: "integer", nullable: false, default: { kind: "integerLiteral", value: 1 }, origin },
  ], keys: [{ keyId: "child.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [
    { constraintId: "child.parent", kind: "foreignKey", sourceColumns: ["parent_id"], targetColumns: [{ tableId: "parent", columnId: "id" }],
      onDelete: "noAction", onUpdate: "noAction", origin },
    { constraintId: "child.count", kind: "integerRange", columnId: "count", minimum: 0, maximum: 10, origin },
  ], relationships: [] },
] }));

const lifecycleOrigin = { kind: "implicit", sourceId: `${origin.sourceId}.lifecycle` };
const lifecycleSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId, tables: [
  { tableId: "parent", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
      default: { kind: "currentTimestamp" as const }, origin: lifecycleOrigin })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
  ], keys: [{ keyId: "parent.primary", kind: "primary", columns: ["id"], origin }], indexes: [
    { indexId: "parent.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
  ], constraints: [], relationships: [] },
], capabilities: [
  { capabilityId: "parent.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "parent", columnId: "created_at" },
    updatedAtColumn: { tableId: "parent", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
  { capabilityId: "parent.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "parent", columnId: "deleted_at" },
    activeRowsIndex: { tableId: "parent", indexId: "parent.active" }, origin: lifecycleOrigin },
] }));

const replacementSchema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  tables: ["parent", "child"].map(tableId => ({ tableId, origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    ...(tableId === "child" ? [{ columnId: "parent_id", type: "text", nullable: true, default: { kind: "none" }, origin }] : []),
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false,
      default: { kind: "currentTimestamp" }, origin: lifecycleOrigin })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
  ], keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin }], indexes: [
    { indexId: `${tableId}.active`, kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
  ], constraints: tableId === "child" ? [{ constraintId: "child.parent", kind: "foreignKey", sourceColumns: ["parent_id"],
    targetColumns: [{ tableId: "parent", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin }] : [], relationships: [],
  })), capabilities: ["parent", "child"].flatMap(tableId => [
    { capabilityId: `${tableId}.timestamps`, kind: "managedTimestamps", createdAtColumn: { tableId, columnId: "created_at" },
      updatedAtColumn: { tableId, columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
    { capabilityId: `${tableId}.lifecycle`, kind: "softDelete", deletedAtColumn: { tableId, columnId: "deleted_at" },
      activeRowsIndex: { tableId, indexId: `${tableId}.active` }, origin: lifecycleOrigin },
  ]),
}));

const setup = Effect.fn("NativeCheckpointTest.setup")(function* (fixture: CorePersistenceFixture, nullableReference = false,
  baseSchema: typeof schema = schema, now: Effect.Effect<bigint> = Effect.succeed(1_000_000_000n)) {
  const nativeSchema = nullableReference ? yield* Effect.fromResult(normalizeRelationalSchema(relationalSchemaSourceFromDefinition({ ...baseSchema,
    tables: baseSchema.tables.map(table => table.identity.tableId !== "child" ? table : { ...table,
      columns: table.columns.map(column => column.identity.columnId !== "parent_id" ? column : { ...column, nullable: true }) }),
  }))) : baseSchema;
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-checkpoint", owner: "medusa",
    writeProfile: "medusa.neutral-native-checkpoint", evidence: { provenance: origin }, definition: { kind: "relational", schema: nativeSchema },
    bindings: nativeSchema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${origin.sourceId}/${table.identity.tableId}` } })) });
  const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
  const foreignOrigin = { kind: "synthetic", sourceId: "neutral-checkpoint-foreign" };
  const foreignSchema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: foreignOrigin.sourceId,
    capabilities: [], tables: [{ tableId: "foreign", origin: foreignOrigin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin: foreignOrigin },
    ], keys: [{ keyId: "foreign.primary", kind: "primary", columns: ["id"], origin: foreignOrigin }], indexes: [], constraints: [], relationships: [] }] }));
  const foreignSource = yield* captureLogicalSchemaSource({ key: "medusa.neutral-checkpoint-foreign", owner: "medusa",
    writeProfile: "medusa.neutral-checkpoint-foreign", evidence: { provenance: foreignOrigin }, definition: { kind: "relational", schema: foreignSchema },
    bindings: [{ kind: "definition", localName: "foreign", table: { namespace: "medusa", logicalName: "neutral-checkpoint-foreign/foreign" } }] });
  const foreign = yield* makeCoreRelationalNativeDefinition({ ...target, source: foreignSource, provenance: foreignOrigin, commands: [] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }, { kind: "native", definition: foreign }] });
  const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, { schemaBundles: [bundle],
    now, randomBytes: length => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 }), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let ready = false;
  for (let step = 0; step < 128; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); ready = true; break;
    }
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Neutral checkpoint schema refused"));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 8 });
  }
  if (!ready) return yield* Effect.die(new Error("Neutral checkpoint schema did not activate"));
  const binding = yield* database.bindNative({ definition, commands: [{ name: "checkpoint-write", mode: "write" }, { name: "checkpoint-read", mode: "read" }] });
  const foreignBinding = yield* database.bindNative({ definition: foreign, commands: [{ name: "foreign-read", mode: "read" }, { name: "foreign-write", mode: "write" }] });
  const metadata = yield* database.readNativeBinding(binding);
  const table = (name: string) => {
    const selected = definition.tables.find(table => table.localName === name);
    if (selected === undefined) throw new Error("Missing neutral checkpoint table");
    return selected.name;
  };
  const begin = () => database.beginNative(binding, { commandName: "checkpoint-write", ...coreNativeTestBudget() });
  const write = <A>(body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>) => Effect.acquireUseRelease(begin(), operation =>
    Effect.gen(function* () { const result = yield* body(operation.operations); yield* database.commit(yield* operation.finalize()); return result; }), operation => operation.abort());
  const read = (name: string) => Effect.acquireUseRelease(database.beginNative(binding,
    { commandName: "checkpoint-read", ...coreNativeTestBudget() }), operation => Effect.gen(function* () {
    const rows = yield* operation.operations.find(table(name), {}); yield* operation.finishRead(); return rows;
  }), operation => operation.abort());
  return { database, bundle, metadata, binding, foreignBinding, foreign, table, begin, write, read };
});

const failed = <A>(result: Result.Result<A, CoreError>) => Result.isFailure(result) ? result.failure : undefined;

export function registerNativeCheckpointScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    it("checks the actual pending outgoing graph without publishing or requiring parent-first insertion", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(graph.table("child"), "insert", [{ id: "child", parent_id: "parent", code: "valid" }]);
        yield* operations.writeRows(graph.table("parent"), "insert", [{ id: "parent" }]);
        yield* operations.checkpointReferences(graph.table("child"));
        expect(yield* graph.read("parent")).toEqual([]);
        expect(yield* graph.read("child")).toEqual([]);
      }));
      expect(yield* graph.read("child")).toMatchObject([{ id: "child", parent_id: "parent", code: "valid" }]);
    })), 120_000);

    it("issues exact checkpoint provenance and refuses foreign sources and copied failures", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), operation = yield* graph.begin();
      yield* operation.operations.writeRows(graph.table("child"), "insert", [{ id: "missing-child", parent_id: "missing", code: "valid" }]);
      const refusal = failed(yield* Effect.result(operation.operations.checkpointReferences(graph.table("child"))));
      if (refusal === undefined) return yield* Effect.die(new Error("Expected outgoing checkpoint refusal"));
      expect(refusal).toMatchObject({ _tag: "CoreNativeForeignKeyError", reason: "targetMissing", descriptor: "child.parent" });
      const projected = projectCoreCommerceFailure(refusal);
      expect(inspectReferenceFailure(projected)).toMatchObject({ storage: "core", origin: "checkpoint", descriptor: "child.parent",
        child: { tableName: "child", identity: { tableId: "child" } }, sourceColumns: ["parent_id"],
        target: { tableName: "parent", columns: ["id"], values: ["missing"] } });
      expect(inspectReferenceFailure({ ...projected })).toBeUndefined();
      expect(inspectReferenceFailure({ cause: projected })).toBeUndefined();
      const foreign = graph.foreign.tables[0];
      if (foreign === undefined) return yield* Effect.die(new Error("Missing foreign source"));
      expect(failed(yield* Effect.result(operation.operations.checkpointReferences(foreign.name))))
        .toMatchObject({ reason: "authorityRevoked" });
      yield* operation.abort();
      expect(yield* graph.read("child")).toEqual([]);
    })), 120_000);

    it("rechecks a target removed after checkpoint before accepting the child", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table("parent"), "insert", [{ id: "racing-parent" }]));
      const operation = yield* graph.begin();
      yield* operation.operations.writeRows(graph.table("child"), "insert", [{ id: "racing-child", parent_id: "racing-parent", code: "valid" }]);
      yield* operation.operations.checkpointReferences(graph.table("child"));
      yield* graph.write(operations => operations.deleteRows(graph.table("parent"), ["racing-parent"]));
      const refusal = failed(yield* Effect.result(operation.finalize().pipe(Effect.flatMap(graph.database.commit))));
      if (refusal === undefined) return yield* Effect.die(new Error("Expected final checkpoint race refusal"));
      expect(["conflict", "targetMissing"]).toContain(refusal.reason);
      yield* operation.abort();
      expect(yield* graph.read("child")).toEqual([]);
      expect(yield* graph.read("parent")).toEqual([]);
    })), 120_000);

    it("keeps entity-group required and row CHECK phases ahead of the selected identity conflict", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), child = graph.table("child");
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(graph.table("parent"), "insert", [{ id: "parent" }]);
        yield* operations.writeRows(child, "insert", [{ id: "existing", parent_id: "parent", code: "original" }]);
      }));
      const operation = yield* graph.begin();
      const input = [{ id: "existing", parent_id: "parent", code: "valid" }, { id: "later", parent_id: "parent" }];
      const ordinary = failed(yield* Effect.result(operation.operations.writeRows(child, "insert", input)));
      expect(ordinary).toMatchObject({ _tag: "CoreNativeUniqueConflict", descriptor: "child.primary" });
      const required = failed(yield* Effect.result(operation.operations.writeRows(child, "insert", input, { insertValidation: "entityBatch" })));
      if (required === undefined) return yield* Effect.die(new Error("Expected required group failure"));
      expect(inspectRelationalFailure(projectCoreCommerceFailure(required))).toMatchObject({ origin: "row", kind: "missing", column: "code",
        candidate: { id: "later", parent_id: "parent", count: 1 } });
      const checked = failed(yield* Effect.result(operation.operations.writeRows(child, "insert",
        [{ id: "existing", parent_id: "parent", code: "valid", count: -1 }], { insertValidation: "entityBatch" })));
      if (checked === undefined) return yield* Effect.die(new Error("Expected CHECK-before-identity failure"));
      expect(inspectRelationalFailure(projectCoreCommerceFailure(checked))).toMatchObject({ kind: "check", constraint: { constraintId: "child.count" },
        candidate: { id: "existing", count: -1 } });
      expect((yield* operation.operations.find(child, {})).map(row => row.code)).toEqual(["original"]);
      yield* operation.abort();
    })), 120_000);

    it("records actual source-confined rows and rebased native operations without extra lookups", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), operation = yield* graph.begin(), operations = operation.operations;
      const cursor = operations.nativeActivityCursor();
      yield* operations.writeRows(graph.table("parent"), "insert", [{ id: "traced-parent" }]);
      const afterParent = operations.nativeActivityCursor();
      yield* operations.writeRows(graph.table("child"), "insert", [{ id: "traced-child", parent_id: "traced-parent", code: "valid" }]);
      yield* operations.checkpointReferences(graph.table("child"));
      const activity = yield* operations.nativeActivitySince(afterParent);
      expect(activity.mutations).toMatchObject([{ ordinal: 0, table: graph.table("child"), operation: "insert", before: null,
        after: { id: "traced-child", parent_id: "traced-parent", code: "valid", count: 1 } }]);
      expect(activity.observedRows).toEqual(expect.arrayContaining([
        { table: graph.table("parent"), row: { id: "traced-parent" } },
        { table: graph.table("child"), row: { id: "traced-child", parent_id: "traced-parent", code: "valid", count: 1 } },
      ]));
      expect((yield* operations.nativeActivitySince(cursor)).mutations).toHaveLength(2);
      const foreign = yield* graph.database.beginNative(graph.foreignBinding, { commandName: "foreign-read", ...coreNativeTestBudget() });
      expect(failed(yield* Effect.result(foreign.operations.nativeActivitySince(cursor)))).toMatchObject({ reason: "authorityRevoked" });
      yield* foreign.abort();
      yield* operation.abort();
      expect(yield* graph.read("child")).toEqual([]);
    })), 120_000);

    it("poisons the owning native request before a caught checkpoint error can reach later callbacks", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), operation = yield* graph.begin();
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "checkpoint-native-request", "write"), value => value.close);
      const participant = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, lifetime, lifetime.context,
        "checkpoint-native-request", operation.unixTime, undefined, { allowReferenceCheckpoints: true });
      const child = yield* participant.table(lifetime.context, "child");
      yield* child.write(lifetime.context, "insert", [{ id: "caught-child", parent_id: "missing", code: "valid" }]);
      const checkpoint = participant.checkpointRelationalReferences;
      if (checkpoint === undefined) return yield* Effect.die(new Error("Missing selected checkpoint capability"));
      expect(Result.isFailure(yield* Effect.result(checkpoint(lifetime.context, "child")))).toBe(true);
      let callbacks = 0;
      const later = yield* Effect.result(lifetime.operation(lifetime.context, "checkpoint-native-request", "write", Effect.sync(() => { callbacks++; })));
      expect(Result.isFailure(later)).toBe(true);
      expect(callbacks).toBe(0);
      expect(Result.isFailure(yield* Effect.result(lifetime.seal))).toBe(true);
      yield* operation.abort();
      expect(yield* graph.read("child")).toEqual([]);
    })), 120_000);

    it("advances an active restore only through the authentic selected invocation policy", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, false, lifecycleSchema), parent = graph.table("parent");
      const before = "1970-01-01T00:00:00.000Z";
      yield* graph.write(operations => operations.writeRows(parent, "insert", [{ id: "active", created_at: before, updated_at: before }]));
      const operation = yield* graph.begin(), cursor = operation.operations.nativeActivityCursor();
      const forged = { allowActiveRestoreUpdate: true as const, unexpected: true };
      expect(failed(yield* Effect.result(operation.operations.lifecycle(parent, "restore", ["active"], forged))))
        .toMatchObject({ _tag: "CoreNativeQueryError", reason: "invalidInput" });
      const ordinary = yield* operation.operations.lifecycle(parent, "restore", ["active"]);
      expect(ordinary[0]?.updated_at).toBe(before);
      expect((yield* operation.operations.nativeActivitySince(cursor)).mutations).toEqual([]);
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "active-restore-native-request", "write"), value => value.close);
      const participant = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, lifetime, lifetime.context,
        "active-restore-native-request", operation.unixTime, undefined, { allowActiveRestoreUpdate: true });
      const active = yield* participant.store.lifecycle(lifetime.context, "restore", ["active"]);
      const timestamp = new Date(operation.unixTime).toISOString();
      expect(active).toMatchObject([{ id: "active", created_at: before, updated_at: timestamp, deleted_at: null }]);
      expect(timestamp).not.toBe(before);
      const activity = yield* operation.operations.nativeActivitySince(cursor);
      expect(activity.mutations).toMatchObject([{ ordinal: 0, operation: "patch", before: { updated_at: before }, after: { updated_at: timestamp } }]);
      expect(activity.lifecycle).toMatchObject([{ operation: "restore", attemptOrdinal: null },
        { operation: "restore", attemptOrdinal: 0, beforeDeletedAt: null, afterDeletedAt: null, rowAtOperation: null }]);
      yield* graph.database.commit(yield* operation.finalize());
      yield* operation.abort();
      expect(yield* graph.read("parent")).toMatchObject([{ id: "active", created_at: before, updated_at: timestamp, deleted_at: null }]);
    })), 120_000);

    it("retains loaded native page candidates before offset and successor projection", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), parent = graph.table("parent");
      yield* graph.write(operations => operations.writeRows(parent, "insert", [{ id: "a" }, { id: "b" }, { id: "c" }]));
      const table = graph.metadata.tables.find(candidate => candidate.name === parent);
      const index = table?.indexes.find(candidate => candidate.fields[0] === "id");
      if (index === undefined) return yield* Effect.die(new Error("Missing declared neutral identity index"));
      const operation = yield* graph.begin();
      yield* operation.operations.writeRows(parent, "insert", [{ id: "z-pending-outside-range" }]);
      const cursor = operation.operations.nativeActivityCursor();
      const page = yield* operation.operations.findPage(parent, { id: { lt: "m" } }, { indexName: index.name, offset: 1, limit: 1 });
      expect(page).toMatchObject({ documents: [{ id: "b" }], hasMore: true });
      const activity = yield* operation.operations.nativeActivitySince(cursor);
      expect(activity.observedRows.map(observation => observation.row.id).sort()).toEqual(["a", "b", "c"]);
      expect(activity.mutations).toEqual([]);
      yield* operation.abort();
      expect((yield* graph.read("parent")).map(row => row.id).sort()).toEqual(["a", "b", "c"]);
    })), 120_000);

    it("refuses unselected native storage order before observing rows and keeps the refusal sticky", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), parent = graph.table("parent");
      yield* graph.write(operations => operations.writeRows(parent, "insert", [{ id: "b" }, { id: "a" }]));
      const operation = yield* graph.begin();
      const standaloneLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "standalone-order", "write"), value => value.close);
      const standalone = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, standaloneLifetime,
        standaloneLifetime.context, "standalone-order", operation.unixTime);
      const standaloneStore = yield* standalone.table(standaloneLifetime.context, "parent");
      const selectedLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "selected-order", "write"), value => value.close);
      const selected = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, selectedLifetime,
        selectedLifetime.context, "selected-order", operation.unixTime, undefined, { allowStorageInsertionOrder: true });
      const selectedStore = yield* selected.table(selectedLifetime.context, "parent");
      const query = { predicate: { kind: "in", column: "id", values: ["a", "b"] }, order: { kind: "storageInsertion", direction: "asc" } };
      expect((yield* standaloneStore.find(standaloneLifetime.context, query)).map(row => row.id)).toEqual(["b", "a"]);
      expect((yield* selectedStore.find(selectedLifetime.context, query)).map(row => row.id)).toEqual(["b", "a"]);
      const deniedLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "unselected-order", "write"), value => value.close);
      const denied = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, deniedLifetime,
        deniedLifetime.context, "unselected-order", operation.unixTime, undefined, {});
      const deniedStore = yield* denied.table(deniedLifetime.context, "parent");
      const cursor = operation.operations.nativeActivityCursor();
      const refused = yield* Effect.result(deniedStore.find(deniedLifetime.context, query));
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) expect(refused.failure.reason).toBe("invalidAuthority");
      expect((yield* operation.operations.nativeActivitySince(cursor)).observedRows).toEqual([]);
      let callbacks = 0;
      expect(Result.isFailure(yield* Effect.result(deniedLifetime.operation(deniedLifetime.context, "unselected-order", "read",
        Effect.sync(() => { callbacks++; }))))).toBe(true);
      expect(callbacks).toBe(0);
      expect(Result.isFailure(yield* Effect.result(deniedLifetime.seal))).toBe(true);
      yield* operation.abort();
    })), 120_000);

    it("exposes native reference replacement only for the selected invocation while preserving standalone capability", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, true), operation = yield* graph.begin();
      const standaloneLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "standalone-replacement", "write"), value => value.close);
      const standalone = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, standaloneLifetime,
        standaloneLifetime.context, "standalone-replacement", operation.unixTime);
      expect(standalone.planReferenceReplacement).toBeTypeOf("function");
      const selectedLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "selected-replacement", "write"), value => value.close);
      const selected = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, selectedLifetime,
        selectedLifetime.context, "selected-replacement", operation.unixTime, undefined, { allowReferenceReplacement: true });
      expect(selected.planReferenceReplacement).toBeTypeOf("function");
      const deniedLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "unselected-replacement", "write"), value => value.close);
      const denied = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, deniedLifetime,
        deniedLifetime.context, "unselected-replacement", operation.unixTime, undefined, {});
      expect(denied.planReferenceReplacement).toBeUndefined();
      yield* operation.abort();
    })), 120_000);

    it("refuses unselected native preserving-deletion upsert before capturing its input", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), operation = yield* graph.begin();
      const standaloneLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "standalone-preserving-upsert", "write"), value => value.close);
      const standalone = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, standaloneLifetime,
        standaloneLifetime.context, "standalone-preserving-upsert", operation.unixTime);
      const standaloneStore = yield* standalone.table(standaloneLifetime.context, "parent");
      expect(yield* standaloneStore.write(standaloneLifetime.context, "upsertPreservingDeletion", [{ id: "standalone-supported" }]))
        .toEqual([{ id: "standalone-supported" }]);
      const deniedLifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "unselected-preserving-upsert", "write"), value => value.close);
      const denied = yield* makeNativeCommerceParticipant(operation.operations, graph.metadata, deniedLifetime,
        deniedLifetime.context, "unselected-preserving-upsert", operation.unixTime, undefined, {});
      const deniedStore = yield* denied.table(deniedLifetime.context, "parent");
      const cursor = operation.operations.nativeActivityCursor();
      const refused = yield* Effect.result(deniedStore.write(deniedLifetime.context, "upsertPreservingDeletion", undefined));
      expect(Result.isFailure(refused)).toBe(true);
      if (Result.isFailure(refused)) expect(refused.failure.reason).toBe("invalidAuthority");
      const activity = yield* operation.operations.nativeActivitySince(cursor);
      expect(activity.observedRows).toEqual([]);
      expect(activity.mutations).toEqual([]);
      let callbacks = 0;
      expect(Result.isFailure(yield* Effect.result(deniedLifetime.operation(deniedLifetime.context, "unselected-preserving-upsert", "write",
        Effect.sync(() => { callbacks++; }))))).toBe(true);
      expect(callbacks).toBe(0);
      expect(Result.isFailure(yield* Effect.result(deniedLifetime.seal))).toBe(true);
      yield* operation.abort();
      expect(yield* graph.read("parent")).toEqual([]);
    })), 120_000);

    it("projects every actual replacement patch including a kept reference with a managed update", run(fixture => Effect.gen(function* () {
      let wallTime = 1_000_000_000n;
      const graph = yield* setup(fixture, false, replacementSchema, Effect.sync(() => wallTime)), parent = graph.table("parent"), child = graph.table("child");
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(parent, "insert", [{ id: "target" }, { id: "other" }]);
        yield* operations.writeRows(child, "insert", [
          { id: "detach", parent_id: "target" }, { id: "kept", parent_id: "target" },
          { id: "moved", parent_id: "other" }, { id: "unrelated", parent_id: "other" }, { id: "deleted-desired", parent_id: "other" },
        ]);
      }));
      yield* graph.write(operations => operations.lifecycle(child, "softDelete", ["deleted-desired"]));
      const before = yield* graph.read("child"), previous = new Map(before.map(document => [document.id, document]));
      wallTime = 3_000_000_000n;
      const operation = yield* graph.begin(), operations = operation.operations, cursor = operations.nativeActivityCursor();
      yield* operations.writeRows(parent, "update", [{ id: "target" }]);
      const selection = { sourceTable: child, sourceColumn: "parent_id", targetTable: parent, targetColumn: "id", targetKey: "target",
        desiredKeys: ["moved", "kept", "missing", "deleted-desired", "kept"] };
      const replaced = yield* operations.replaceReferenceSet(selection);
      const projected = yield* operations.referenceReplacementChanges();
      expect(replaced.map(document => document.id).sort()).toEqual(["detach", "kept", "moved"]);
      expect(projected).toHaveLength(1);
      expect(projected[0]?.sourceTable).toBe(child);
      expect(projected[0]?.documents).toEqual(replaced);
      const timestamp = new Date(operation.unixTime).toISOString();
      for (const document of replaced) {
        const original = previous.get(document.id);
        expect(original).toBeDefined();
        expect(document._id).toBe(original?._id);
        expect(document.created_at).toBe(original?.created_at);
        expect(document.updated_at).toBe(timestamp);
        expect(document.updated_at).not.toBe(original?.updated_at);
        expect(document.parent_id).toBe(document.id === "detach" ? null : "target");
      }
      const activity = yield* operations.nativeActivitySince(cursor);
      expect(activity.mutations).toMatchObject([{ table: parent, operation: "patch", before: { id: "target" }, after: { id: "target" } }]);
      expect(activity.mutations).toHaveLength(1);
      expect(activity.referenceReplacements).toEqual([{ ...selection, desiredKeys: ["moved", "kept", "missing", "deleted-desired"] }]);
      expect(failed(yield* Effect.result(operations.find(child, {})))).toMatchObject({ reason: "invalidAuthority" });
      expect(yield* graph.read("child")).toEqual(before);
      yield* operations.prepareDeleteClosure();
      yield* graph.database.commit(yield* operation.finalize());
      yield* operation.abort();
      const committed = yield* graph.read("child");
      expect(committed).toHaveLength(5);
      for (const document of committed) {
        if (document.id === "unrelated" || document.id === "deleted-desired") expect(document).toEqual(previous.get(document.id));
        else expect(document).toEqual(replaced.find(replacement => replacement.id === document.id));
      }
    })), 120_000);

    it("queues only an actual deleted-target intent, seals native DAL and prepares derived patches without native child calls", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, true), parent = graph.table("parent"), child = graph.table("child");
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(parent, "insert", [{ id: "detach-parent" }]);
        yield* operations.writeRows(child, "insert", [{ id: "detach-child", parent_id: "detach-parent", code: "valid" }]);
      }));
      const operation = yield* graph.begin(), operations = operation.operations, cursor = operations.nativeActivityCursor();
      yield* operations.deleteRows(parent, ["detach-parent"]);
      const selection: CoreNativeSetNullIntent = { sourceTable: child, sourceColumn: "parent_id", targetTable: parent,
        targetColumn: "id", targetKey: "detach-parent", managedUpdate: "advance" };
      yield* operations.planSetNullReferences(selection);
      const native = yield* operations.nativeActivitySince(cursor);
      expect(native.mutations).toMatchObject([{ table: parent, operation: "delete", before: { id: "detach-parent" }, after: null }]);
      expect(native.setNull).toEqual([selection]);
      expect(failed(yield* Effect.result(operations.find(child, {})))).toMatchObject({ reason: "invalidAuthority" });
      yield* operations.prepareDeleteClosure();
      const prepared = yield* operations.nativeActivitySince(cursor);
      expect(prepared.mutations).toHaveLength(1);
      expect(prepared.setNull).toEqual([selection]);
      expect(prepared.observedRows).toEqual(expect.arrayContaining([{ table: child,
        row: { id: "detach-child", parent_id: null, code: "valid", count: 1 } }]));
      expect((yield* graph.read("child"))[0]?.parent_id).toBe("detach-parent");
      yield* graph.database.commit(yield* operation.finalize());
      yield* operation.abort();
      expect(yield* graph.read("parent")).toEqual([]);
      expect((yield* graph.read("child"))[0]?.parent_id).toBeNull();
    })), 120_000);

    it("seals only the set-null source while another native source can still use the same pending root", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, true), parent = graph.table("parent"), child = graph.table("child");
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(parent, "insert", [{ id: "source-parent" }]);
        yield* operations.writeRows(child, "insert", [{ id: "source-child", parent_id: "source-parent", code: "valid" }]);
      }));
      const root = yield* graph.database.bindNativeRoot({ bundle: graph.bundle, contract: { name: "native-set-null-source-seal" },
        participants: [{ binding: graph.binding, commands: ["checkpoint-write"], limits: coreNativeTestBudget().limits },
          { binding: graph.foreignBinding, commands: ["foreign-write"], limits: coreNativeTestBudget().limits }], maxFinalUserDocuments: 128 });
      const metadata = yield* graph.database.readNativeRootBinding(root);
      const identity: CoreRequestIdentity = { kind: "nativeRoot", root: metadata.identity, key: "source-seal-control", requestHash: "source-seal-control" };
      const acquired = yield* graph.database.claimRequest(identity, root);
      if (acquired.kind !== "claimed") return yield* Effect.die(new Error("Fresh source seal request was not claimed"));
      const operation = yield* graph.database.beginNativeRoot(root, { claim: acquired.claim, chargeRetained: coreNativeTestBudget().chargeRetained });
      const source = yield* operation.native(graph.binding), other = yield* operation.native(graph.foreignBinding);
      yield* source.deleteRows(parent, ["source-parent"]);
      yield* source.planSetNullReferences({ sourceTable: child, sourceColumn: "parent_id", targetTable: parent,
        targetColumn: "id", targetKey: "source-parent", managedUpdate: "advance" });
      expect(failed(yield* Effect.result(source.find(child, {})))).toMatchObject({ reason: "invalidAuthority" });
      const foreign = graph.foreign.tables[0];
      if (foreign === undefined) return yield* Effect.die(new Error("Missing other source"));
      yield* other.writeRows(foreign.name, "insert", [{ id: "other-source-still-open" }]);
      expect((yield* other.find(foreign.name, {})).map(row => row.id)).toEqual(["other-source-still-open"]);
      yield* operation.abort();
      yield* graph.database.abortRequest(acquired.claim);
      expect((yield* graph.read("child"))[0]?.parent_id).toBe("source-parent");
    })), 120_000);

    it.each(["nondeleted", "wrong FK", "nonnullable", "replacement", "earlier transient reference", "missing key", "foreign source"] as const)(
      "refuses the %s set-null plan without retaining a fabricated intent", mode => run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture, mode !== "nonnullable"), parent = graph.table("parent"), child = graph.table("child");
        yield* graph.write(operations => Effect.gen(function* () {
          yield* operations.writeRows(parent, "insert", [{ id: "parent-p" }, { id: "parent-q" }]);
          yield* operations.writeRows(child, "insert", [{ id: "child", parent_id: "parent-q", code: "valid" }]);
        }));
        const operation = yield* graph.begin(), operations = operation.operations, cursor = operations.nativeActivityCursor();
        if (mode === "earlier transient reference") {
          yield* operations.writeRows(child, "update", [{ id: "child", parent_id: "parent-p" }]);
          yield* operations.writeRows(child, "update", [{ id: "child", parent_id: null }]);
        }
        if (mode !== "nondeleted") yield* operations.deleteRows(parent, ["parent-p"]);
        if (mode === "replacement") yield* operations.writeRows(parent, "insert", [{ id: "parent-p" }]);
        const foreign = graph.foreign.tables[0];
        if (foreign === undefined) return yield* Effect.die(new Error("Missing foreign source"));
        const refusal = failed(yield* Effect.result(operations.planSetNullReferences({ sourceTable: mode === "foreign source" ? foreign.name : child,
          sourceColumn: mode === "wrong FK" ? "count" : "parent_id", targetTable: parent, targetColumn: "id",
          targetKey: mode === "missing key" ? "never-deleted" : "parent-p", managedUpdate: "advance" })));
        expect(refusal).toMatchObject({ reason: mode === "foreign source" ? "authorityRevoked" : "invalidAuthority" });
        expect((yield* operations.nativeActivitySince(cursor)).setNull).toEqual([]);
        yield* operation.abort();
        expect((yield* graph.read("child"))[0]?.parent_id).toBe("parent-q");
        expect(yield* graph.read("parent")).toHaveLength(2);
      }))(), 120_000);

    it("keeps the sixteen-intent bound and refuses duplicate or replacement-plan coexistence", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, true), parent = graph.table("parent"), child = graph.table("child");
      const keys = Array.from({ length: 17 }, (_, index) => `bounded-${index}`);
      yield* graph.write(operations => operations.writeRows(parent, "insert", keys.map(id => ({ id }))));
      const operation = yield* graph.begin(), operations = operation.operations, cursor = operations.nativeActivityCursor();
      yield* operations.deleteRows(parent, keys);
      for (const key of keys.slice(0, 16)) yield* operations.planSetNullReferences({ sourceTable: child, sourceColumn: "parent_id",
        targetTable: parent, targetColumn: "id", targetKey: key, managedUpdate: "advance" });
      const last = keys.at(-1);
      if (last === undefined) return yield* Effect.die(new Error("Missing bounded intent"));
      expect(failed(yield* Effect.result(operations.planSetNullReferences({ sourceTable: child, sourceColumn: "parent_id",
        targetTable: parent, targetColumn: "id", targetKey: last, managedUpdate: "advance" })))).toMatchObject({ reason: "capacity" });
      expect((yield* operations.nativeActivitySince(cursor)).setNull).toHaveLength(16);
      expect(failed(yield* Effect.result(operations.replaceReferenceSet({ sourceTable: child, sourceColumn: "parent_id",
        targetTable: parent, targetColumn: "id", targetKey: last, desiredKeys: [] })))).toMatchObject({ reason: "invalidAuthority" });
      yield* operation.abort();
      const duplicate = yield* graph.begin();
      yield* duplicate.operations.deleteRows(parent, [last]);
      const selection: CoreNativeSetNullIntent = { sourceTable: child, sourceColumn: "parent_id", targetTable: parent,
        targetColumn: "id", targetKey: last, managedUpdate: "preserve" };
      yield* duplicate.operations.planSetNullReferences(selection);
      expect(failed(yield* Effect.result(duplicate.operations.planSetNullReferences(selection)))).toMatchObject({ reason: "invalidAuthority" });
      yield* duplicate.abort();
      expect(yield* graph.read("parent")).toHaveLength(17);
    })), 120_000);

    it("refuses an incoming member after derived set-null preparation instead of widening the frozen graph", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, true), parent = graph.table("parent"), child = graph.table("child");
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(parent, "insert", [{ id: "frozen-parent" }]);
        yield* operations.writeRows(child, "insert", [{ id: "prepared-child", parent_id: "frozen-parent", code: "valid" }]);
      }));
      const operation = yield* graph.begin();
      yield* operation.operations.deleteRows(parent, ["frozen-parent"]);
      yield* operation.operations.planSetNullReferences({ sourceTable: child, sourceColumn: "parent_id", targetTable: parent,
        targetColumn: "id", targetKey: "frozen-parent", managedUpdate: "advance" });
      yield* operation.operations.prepareDeleteClosure();
      yield* graph.write(operations => operations.writeRows(child, "insert", [{ id: "late-child", parent_id: "frozen-parent", code: "valid" }]));
      const refusal = failed(yield* Effect.result(operation.finalize().pipe(Effect.flatMap(graph.database.commit))));
      if (refusal === undefined) return yield* Effect.die(new Error("Expected frozen set-null race refusal"));
      expect(["conflict", "deleteRestricted"]).toContain(refusal.reason);
      yield* operation.abort();
      expect(yield* graph.read("parent")).toHaveLength(1);
      expect((yield* graph.read("child")).map(row => [row.id, row.parent_id])
        .sort(([left], [right]) => String(left).localeCompare(String(right)))).toEqual([
        ["late-child", "frozen-parent"], ["prepared-child", "frozen-parent"],
      ]);
    })), 120_000);
  });
}
