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
import oldMetadata from "./fixtures/native-key-suffix-old-metadata.json" with { type: "json" };

const target = { scopeUuid: "8a390000-0000-4000-8000-000000000001", epochUuid: "8a390000-0000-4000-8000-000000000002" };
const origin = { kind: "synthetic", sourceId: "neutral-native-key-suffix" } as const;
const lifecycleOrigin = { kind: "implicit", sourceId: "neutral-native-key-suffix.lifecycle" } as const;
const relational = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  tables: [{ tableId: "link", origin, columns: [
    ...["left", "right"].map(columnId => ({ columnId, type: "text" as const, nullable: false,
      default: { kind: "none" as const }, origin })),
    { columnId: "note", type: "text", nullable: false, default: { kind: "textLiteral", value: "" }, origin },
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
      default: { kind: "currentTimestamp" as const }, origin: lifecycleOrigin })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
  ], keys: [{ keyId: "link.primary", kind: "primary", columns: ["left", "right"], origin }], indexes: [
    { indexId: "link.active-right", kind: "btree", columns: ["right"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
    { indexId: "link.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
  ], constraints: [], relationships: [] }], capabilities: [
    { capabilityId: "link.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "link", columnId: "created_at" },
      updatedAtColumn: { tableId: "link", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
    { capabilityId: "link.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "link", columnId: "deleted_at" },
      activeRowsIndex: { tableId: "link", indexId: "link.active" }, origin: lifecycleOrigin },
  ] }));

const compileNativeKeySuffixDefinition = Effect.fn("NativeKeySuffixTest.compile")(function* () {
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-key-suffix", owner: "medusa",
    writeProfile: "medusa.neutral-native-key-suffix", evidence: { provenance: origin }, definition: { kind: "relational", schema: relational },
    bindings: [{ kind: "definition", localName: "link", table: { namespace: "medusa", logicalName: origin.sourceId + "/link" } }] });
  return yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
});

/** This fixture assembles real schema, native commands and persistence owners.
 * It does not implement query selection, membership, validation or settlement. */
const setup = Effect.fn("NativeKeySuffixTest.setup")(function* (fixture: CorePersistenceFixture,
  persistence: CorePersistence = fixture.persistence) {
  const definition = yield* compileNativeKeySuffixDefinition();
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const options: CoreDatabaseOptions = { schemaBundles: [bundle],
    now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0,
  };
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let active = false;
  for (let step = 0; step < 256; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); active = true; break;
    }
    if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Key suffix schema " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  if (!active) return yield* Effect.die(new Error("Key suffix schema did not activate"));
  const commands = [{ name: "suffix-write", mode: "write" }, { name: "suffix-read", mode: "read" }] as const;
  const binding = yield* database.bindNative({ definition, commands });
  const metadata = yield* database.readNativeBinding(binding);
  const declaration = definition.tables[0], installed = metadata.tables.find(table => table.name === declaration?.name);
  if (declaration === undefined || installed === undefined) return yield* Effect.die(new Error("Missing native key suffix table"));
  const begin = () => database.beginNative(binding, { commandName: "suffix-write", ...coreNativeTestBudget() });
  const write = Effect.fn("NativeKeySuffixTest.write")(<A>(body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>) =>
    Effect.acquireUseRelease(begin(), operation => Effect.gen(function* () {
      const value = yield* body(operation.operations); yield* database.commit(yield* operation.finalize()); return value;
    }), operation => operation.abort()));
  const read = Effect.fn("NativeKeySuffixTest.read")((where: JsonObject) => Effect.acquireUseRelease(database.beginNative(binding,
    { commandName: "suffix-read", ...coreNativeTestBudget(), limits: { maxIdentities: 8, maxDocumentBytes: 65_536 } }),
  operation => Effect.gen(function* () {
    const rows = yield* operation.operations.find(declaration.name, where); yield* operation.finishRead(); return rows;
  }), operation => operation.abort()));
  return { database, definition, bundle, options, commands, declaration, installed, binding, begin, write, read, table: declaration.name };
});
const failed = <A>(result: Result.Result<A, CoreError>) => Result.isFailure(result) ? result.failure : undefined;
const lefts = (rows: readonly DocumentObject[]) => rows.map(row => row.left).toSorted();

export function registerNativeKeySuffixIndexScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    it("selects an unconditional reverse range for complete composite-key suffix history", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      expect(graph.declaration.rowKey?.fields).toEqual(["left", "right"]);
      expect(graph.definition.foreignKeys).toBeUndefined();
      expect(graph.declaration.uniqueConstraints).toHaveLength(1);
      expect(graph.declaration.indexes?.find(index => index.nativeId === "link.active-right"))
        .toMatchObject({ fields: ["deleted_at", "right"], requiredPrefix: { field: "deleted_at", value: null } });
      expect(yield* Effect.fromResult(planCoreNativeQuery(graph.installed, { right: "selected" })))
        .toMatchObject({ kind: "range", index: { fields: ["right"] } });
    })), 120_000);

    it("captures only the selected active and deleted history when unrelated endpoints exceed its original bound", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table, "insert", [
        { left: "active", right: "selected" }, { left: "deleted", right: "selected" },
        ...Array.from({ length: 10 }, (_, position) => ({ left: "unrelated-" + position, right: "other-" + position })),
      ]));
      yield* graph.write(operations => operations.lifecycle(graph.table, "softDelete", [{ left: "deleted", right: "selected" }]));
      const history = yield* graph.read({ right: "selected" });
      expect(history.map(row => row.left).toSorted()).toEqual(["active", "deleted"]);
      expect(history.find(row => row.left === "active")?.deleted_at).toBeNull();
      expect(history.find(row => row.left === "deleted")?.deleted_at).not.toBeNull();
    })), 120_000);

    it("keeps pending insertions, endpoint moves, tombstones and lifecycle changes in the inferred range", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table, "insert", [
        { left: "leave", right: "selected" }, { left: "historical", right: "selected" }, { left: "other", right: "other" },
      ]));
      yield* graph.write(operations => operations.lifecycle(graph.table, "softDelete", [{ left: "historical", right: "selected" }]));
      yield* graph.write(operations => Effect.gen(function* () {
        expect(lefts(yield* operations.find(graph.table, { right: "selected" }))).toEqual(["historical", "leave"]);
        yield* operations.writeRows(graph.table, "insert", [{ left: "enter", right: "selected" }]);
        yield* operations.deleteRows(graph.table, [{ left: "leave", right: "selected" }]);
        yield* operations.writeRows(graph.table, "insert", [{ left: "leave", right: "other" }]);
        expect(lefts(yield* operations.find(graph.table, { right: "selected" }))).toEqual(["enter", "historical"]);
        expect(lefts(yield* operations.find(graph.table, { right: "other" }))).toEqual(["leave", "other"]);
        yield* operations.lifecycle(graph.table, "softDelete", [{ left: "enter", right: "selected" }]);
        expect(lefts(yield* operations.find(graph.table, { right: "selected" }))).toEqual(["enter", "historical"]);
        expect((yield* operations.find(graph.table, { right: "selected", deleted_at: null }))).toHaveLength(0);
        yield* operations.lifecycle(graph.table, "restore", [{ left: "enter", right: "selected" }]);
      }));
      expect(lefts(yield* graph.read({ right: "selected" }))).toEqual(["enter", "historical"]);
      expect(lefts(yield* graph.read({ right: "selected", deleted_at: null }))).toEqual(["enter"]);
    })), 120_000);

    for (const change of ["insert", "remove", "move", "unrelated"] as const) {
      it(`validates complete suffix membership after a published ${change} without widening to unrelated endpoints`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture);
        yield* graph.write(operations => operations.writeRows(graph.table, "insert", [
          { left: "existing", right: "selected" }, { left: "other", right: "other" },
        ]));
        const held = yield* graph.begin();
        expect(lefts(yield* held.operations.find(graph.table, { right: "selected" }))).toEqual(["existing"]);
        yield* held.operations.writeRows(graph.table, "insert", [{ left: "receipt", right: "receipt" }]);
        const finalized = yield* held.finalize();
        yield* graph.write(operations => Effect.gen(function* () {
          if (change === "insert") yield* operations.writeRows(graph.table, "insert", [{ left: "new", right: "selected" }]);
          else if (change === "unrelated") yield* operations.writeRows(graph.table, "update", [{ left: "other", right: "other", note: "changed" }]);
          else {
            yield* operations.deleteRows(graph.table, [{ left: "existing", right: "selected" }]);
            if (change === "move") yield* operations.writeRows(graph.table, "insert", [{ left: "existing", right: "moved" }]);
          }
        }));
        const settled = yield* Effect.result(graph.database.commit(finalized));
        if (change === "unrelated") expect(Result.isSuccess(settled)).toBe(true);
        else expect(failed(settled)).toMatchObject({ reason: "conflict" });
        yield* held.abort();
        expect((yield* graph.read({ right: "receipt" }))).toHaveLength(change === "unrelated" ? 1 : 0);
        expect(lefts(yield* graph.read({ right: "selected" })))
          .toEqual(change === "insert" ? ["existing", "new"] : change === "unrelated" ? ["existing"] : []);
      })), 120_000);
    }

    it("rejects an empty suffix observation against an accepted but unpublished insertion", run(fixture => Effect.gen(function* () {
      const entered = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      let armed = false;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        const documents = yield* Effect.forEach(batch.documents.filter(document => !document.deleted), document => Effect.fromResult(readDocumentObject(document)));
        if (armed && documents.some(document => document.left === "accepted" && document.right === "selected")) {
          yield* Deferred.succeed(entered, undefined); yield* Deferred.await(release);
        }
        yield* fixture.persistence.write(lease, batch);
      }) };
      const graph = yield* setup(fixture, persistence), held = yield* graph.begin();
      expect(yield* held.operations.find(graph.table, { right: "selected" })).toEqual([]);
      yield* held.operations.writeRows(graph.table, "insert", [{ left: "receipt", right: "receipt" }]);
      const heldFinalized = yield* held.finalize();
      const predecessor = yield* graph.begin();
      yield* predecessor.operations.writeRows(graph.table, "insert", [{ left: "accepted", right: "selected" }]);
      const predecessorFinalized = yield* predecessor.finalize();
      const before = yield* graph.database.publishedTimestamp;
      yield* Effect.ensuring(Effect.gen(function* () {
        armed = true;
        const saving = yield* Effect.forkChild(Effect.result(graph.database.commit(predecessorFinalized)));
        yield* Deferred.await(entered);
        expect(yield* graph.database.publishedTimestamp).toBe(before);
        expect(failed(yield* Effect.result(graph.database.commit(heldFinalized)))).toMatchObject({ reason: "conflict" });
        expect(yield* graph.database.publishedTimestamp).toBe(before);
        yield* Deferred.succeed(release, undefined);
        expect(Result.isSuccess(yield* Fiber.join(saving))).toBe(true);
      }).pipe(Effect.timeout("20 seconds")), Deferred.succeed(release, undefined));
      yield* held.abort(); yield* predecessor.abort();
      expect(lefts(yield* graph.read({ right: "selected" }))).toEqual(["accepted"]);
      expect(yield* graph.read({ right: "receipt" })).toEqual([]);
    })), 120_000);

    it("changes affected proof identity, cold reopens the new index and refuses authentic old stored metadata", run(fixture => Effect.gen(function* () {
      const observed = new Map<string, Readonly<{ entry: CoreDocumentLogEntry; document: DocumentObject }>>();
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        yield* fixture.persistence.write(lease, batch);
        for (const entry of batch.documents) if (!entry.deleted) {
          const document = yield* Effect.fromResult(readDocumentObject(entry));
          if (typeof document.native === "string") observed.set("schema", { entry, document });
        }
      }) };
      const graph = yield* setup(fixture, persistence);
      expect(graph.definition.identity.sourceSha256).toBe(oldMetadata.definition.identity.sourceSha256);
      expect(graph.definition.identity.definitionHash).not.toBe(oldMetadata.definition.identity.definitionHash);
      expect(graph.definition.metadata).not.toBe(oldMetadata.definition.metadata);
      expect(yield* Effect.fromResult(serializeCoreSchema(graph.definition.schema))).not.toBe(oldMetadata.definition.serializedSchema);
      yield* graph.write(operations => operations.writeRows(graph.table, "insert", [{ left: "stored", right: "selected" }]));
      yield* graph.database.close();
      const reopened = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause });
      const cold = yield* Effect.acquireRelease(openCoreDatabase(reopened, graph.options), db => db.close());
      const binding = yield* cold.bindNative({ definition: graph.definition, commands: graph.commands });
      yield* Effect.acquireUseRelease(cold.beginNative(binding, { commandName: "suffix-read", ...coreNativeTestBudget() }), operation =>
        Effect.gen(function* () {
          expect(lefts(yield* operation.operations.find(graph.table, { right: "selected" }))).toEqual(["stored"]);
          yield* operation.finishRead();
        }), operation => operation.abort());
      yield* cold.close();
      const record = observed.get("schema");
      if (record === undefined) return yield* Effect.die(new Error("Missing actual installed native schema frame"));
      const statement = `UPDATE "${fixture.namespace}".documents SET json_value=$1
        WHERE instance_name=$2 AND table_id=$3 AND id=$4 AND ts=$5 RETURNING id`;
      const coordinates = [fixture.instanceName, record.entry.tableId, record.entry.id, record.entry.ts.toString()] as const;
      const oldDocument = { ...record.document, native: oldMetadata.bundle.metadata };
      yield* Effect.acquireUseRelease(Effect.tryPromise({ try: () => fixture.query(statement,
        [Result.getOrThrow(encodeDocumentValue(oldDocument)), ...coordinates]), catch: cause => cause }), rows => Effect.gen(function* () {
        expect(rows).toHaveLength(1);
        const oldPersistence = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause });
        const refusal = yield* Effect.result(Effect.acquireRelease(openCoreDatabase(oldPersistence, graph.options), db => db.close()));
        expect(failed(refusal)).toMatchObject({ reason: "corruptData", cause: "Tagged schema metadata has no expected producer proof" });
      }), () => Effect.tryPromise({ try: () => fixture.query(statement, [record.entry.jsonValue, ...coordinates]), catch: cause => cause }));
      const restoredPersistence = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => cause });
      const restored = yield* Effect.acquireRelease(openCoreDatabase(restoredPersistence, graph.options), db => db.close());
      expect(yield* restored.publishedTimestamp).toBeGreaterThan(0n);
    })), 120_000);
  });
}
