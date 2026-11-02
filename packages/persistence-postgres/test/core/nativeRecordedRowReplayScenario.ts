import { randomBytes } from "node:crypto";
import { Cause, Deferred, Effect, Exit, Fiber, Option, Result, Schema } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { bytesEqual } from "@flarex/utils/bytes";
import { defineSchema, defineTable } from "flarex/server";
import { v } from "flarex/values";
import { prepareApplicationSchemaSource } from "@flarex/analysis/internal/logical-application-source";
import { isJsonObjectFromUnknown, type Json, type JsonObject } from "flarex-protocol/json";
import { encodeDocumentValue, type DocumentObject } from "flarex-protocol/document-value";
import { decodeDocumentId } from "flarex-protocol/document-id";
import type { CoreDatabaseOptions, CoreError, CoreNativeOperations, CoreRequestIdentity } from "../../src/core/api";
import { CorePersistenceError, type CoreDocumentLogEntry, type CorePersistence, type CorePersistenceLease } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { coreNativeRelationalRow } from "../../src/core/nativeRelationalQuery";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../src/core/schemaBundle";
import { readDocumentObject } from "../../src/core/registry";
import { makePreparedHostRuntime } from "../../src/execution/preparation/preparedHostRuntime";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceNativeHost } from "../../src/frameworks/atomicCommerce/nativeHost";
import { defineAtomicCommerceNativeSource } from "../../src/frameworks/atomicCommerce/nativeSelection";
import type { LogicalCommerceCallValidation } from "../../src/frameworks/atomicCommerce/participants";
import { defineCommerceCommand } from "../../src/frameworks/commerceTransaction/commands";
import { commerceNativeRegistrations, makeCommerceNativeHost, makeCommerceNativeReadHost } from "../../src/frameworks/commerceTransaction/nativeHost";
import { commerceError } from "../../src/frameworks/commerceTransaction/model";
import { capturePrivateCanonicalValue } from "../../src/installation/frameworkSchema/privateCanonicalValue";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { readCoreNativeFixtureInventory } from "./nativeFixtureInventory";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";
import { coreNativeTestBudget } from "./nativeTestBudget";

const target = { scopeUuid: "21b00000-0000-4000-8000-000000000001", epochUuid: "21b00000-0000-4000-8000-000000000002" };
const origin = { kind: "synthetic", sourceId: "neutral-native-recorded-row-replay" } as const;
const lifecycleOrigin = { kind: "implicit", sourceId: `${origin.sourceId}.lifecycle` } as const;
const amountOrigin = { kind: "authored", sourceId: `${origin.sourceId}.parent.amount` } as const;
const rawAmountOrigin = { kind: "derived", sourceId: `${origin.sourceId}.parent.raw_amount` } as const;
const created = "2020-01-02T03:04:05.000Z", updated = "2021-02-03T04:05:06.000Z", deleted = "2022-03-04T05:06:07.000Z";
const RecordedGraph = Schema.Struct({ parent: Schema.Array(Schema.JsonObject), children: Schema.Array(Schema.JsonObject) });
const decodeGraph = Schema.decodeUnknownEffect(RecordedGraph);

const setup = Effect.fn("NativeRecordedRowReplayTest.setup")(function* (fixture: CorePersistenceFixture,
  persistence: CorePersistence = fixture.persistence,
  input: Readonly<{ uniqueChildren?: true; applicationHandoff?: true; target?: typeof target; sourceKey?: string; options?: Partial<CoreDatabaseOptions> }> = {}) {
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: ["parent", "child"].map(tableId => ({ tableId, origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      ...(tableId === "parent" ? [
        { columnId: "amount", type: "numeric", nullable: false, default: { kind: "none" }, origin: amountOrigin },
        { columnId: "raw_amount", type: "jsonb", nullable: false, default: { kind: "none" }, origin: rawAmountOrigin },
      ] : [
        { columnId: "parent_id", type: "text", nullable: false, default: { kind: "none" }, origin },
        { columnId: "value", type: "text", nullable: false, default: { kind: "none" }, origin },
      ]),
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false,
        default: { kind: "currentTimestamp" }, origin: lifecycleOrigin })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
    ], keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin },
      ...(input.uniqueChildren === true && tableId === "child" ? [{ keyId: "child.value.unique", kind: "unique", columns: ["value"], origin }] : [])], indexes: [
      { indexId: `${tableId}.active`, kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
    ], constraints: tableId === "child" ? [{ constraintId: "child.parent", kind: "foreignKey", sourceColumns: ["parent_id"],
      targetColumns: [{ tableId: "parent", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin }] : [], relationships: [],
    })), capabilities: [
      ...["parent", "child"].flatMap(tableId => [
        { capabilityId: `${tableId}.timestamps`, kind: "managedTimestamps", createdAtColumn: { tableId, columnId: "created_at" },
          updatedAtColumn: { tableId, columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
        { capabilityId: `${tableId}.lifecycle`, kind: "softDelete", deletedAtColumn: { tableId, columnId: "deleted_at" },
          activeRowsIndex: { tableId, indexId: `${tableId}.active` }, origin: lifecycleOrigin },
      ]),
      { capabilityId: "parent.amount.exact", kind: "exactNumericCompanion", numericColumn: { tableId: "parent", columnId: "amount" },
        rawColumn: { tableId: "parent", columnId: "raw_amount" }, origin: rawAmountOrigin },
    ] }));
  const sourceKey = input.sourceKey ?? "medusa.neutral-native-recorded-row-replay";
  const source = yield* captureLogicalSchemaSource({ key: sourceKey, owner: "medusa",
    writeProfile: sourceKey, evidence: { provenance: origin }, definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${input.sourceKey === undefined ? origin.sourceId : sourceKey}/${table.identity.tableId}` } })) });
  const definition = yield* makeCoreRelationalNativeDefinition({ ...(input.target ?? target), source, provenance: origin, commands: [] });
  const unrelated = input.applicationHandoff === true
    ? yield* prepareApplicationSchemaSource(defineSchema({ replay_unrelated_notes: defineTable({ value: v.string() }) })) : undefined;
  const evolved = unrelated === undefined ? undefined
    : yield* prepareApplicationSchemaSource(defineSchema({ replay_unrelated_notes: defineTable({ value: v.string(), note: v.optional(v.string()) }) }));
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition },
    ...(unrelated === undefined ? [] : [{ kind: "application" as const, definition: unrelated }])] });
  const handoff = evolved === undefined ? bundle : yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }, { kind: "application", definition: evolved }] });
  const options: CoreDatabaseOptions = { schemaBundles: handoff === bundle ? [bundle] : [bundle, handoff], now: Effect.succeed(1_793_577_600_000_000_000n),
    randomBytes: length => Effect.sync(() => randomBytes(length)), schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0, ...input.options };
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), value => value.close());
  const activate = Effect.fn("NativeRecordedRowReplayTest.activate")(function* (selected: CoreSchemaBundle) {
    const proposal = yield* database.prepareSchema({ bundle: selected });
    for (let step = 0; step < 256; step++) {
      const status = yield* database.schemaStatus(proposal);
      if ((status.state === "validated" || status.state === "active") && status.indexesReady)
        return yield* database.activateSchema(proposal, { programs: [], bundle: selected });
      if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Neutral recorded-row replay schema " + status.state));
      yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
    }
    return yield* Effect.die(new Error("Neutral recorded-row replay schema did not activate"));
  });
  yield* activate(bundle);
  const table = (localName: string) => {
    const declaration = definition.tables.find(candidate => candidate.localName === localName);
    if (declaration === undefined) throw new Error("Missing neutral recorded-row replay table " + localName);
    return declaration.name;
  };
  const commands = [{ name: "recorded-owner-write", mode: "write" }, { name: "recorded-owner-read", mode: "read" }] as const;
  const binding = yield* database.bindNative({ definition, commands });
  const begin = Effect.fn("NativeRecordedRowReplayTest.begin")(function* (mode: "read" | "write" = "write") {
    const current = yield* database.bindNative({ definition, commands });
    return yield* database.beginNative(current, { commandName: mode === "write" ? "recorded-owner-write" : "recorded-owner-read", ...coreNativeTestBudget() });
  });
  const write = Effect.fn("NativeRecordedRowReplayTest.write")(<Value>(body: (operations: CoreNativeOperations) => Effect.Effect<Value, CoreError>) =>
    Effect.acquireUseRelease(begin(), operation => Effect.gen(function* () {
      const value = yield* body(operation.operations); yield* database.commit(yield* operation.finalize()); return value;
    }), operation => operation.abort()));
  const read = Effect.fn("NativeRecordedRowReplayTest.read")((name: string, where: JsonObject = {}) =>
    Effect.acquireUseRelease(begin("read"), operation => Effect.gen(function* () {
      const documents = yield* operation.operations.find(table(name), where); yield* operation.finishRead(); return documents;
    }), operation => operation.abort()));
  return { database, definition, bundle, handoff, options, table, binding, begin, write, read, activate };
});

const parentRow = (id = "owner", amount = "40") => ({ id, amount, raw_amount: { value: `${amount}.0000`, precision: 20 },
  created_at: created, updated_at: updated, deleted_at: null });
const failure = <Value>(result: Result.Result<Value, CoreError>) => Result.isFailure(result) ? result.failure : undefined;
const rows = Effect.fn("NativeRecordedRowReplayTest.rows")((documents: readonly DocumentObject[]) =>
  Effect.forEach(documents, document => Effect.fromResult(coreNativeRelationalRow(document))));
const childRow = (id = "historical", value = "original", parent_id = "owner") => ({ id, parent_id, value,
  created_at: created, updated_at: updated, deleted_at: null });
function nativeId(document: DocumentObject | undefined): string {
  if (typeof document?._id !== "string") throw new Error("Missing actual native internal identity");
  return document._id;
}

export function registerNativeRecordedRowReplayScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };
    it("restores an exact recorded parent-child graph through committed 40-to-77-to-88-to-77-to-40 replacements and cold reopen", async () => {
      const fixture = await createFixture();
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const graph = yield* setup(fixture);
          const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 4, maximumPreparedBytes: 8_388_608 });
          const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
            1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
          const initialization = { stepId: "neutral-recorded-row-replay-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 };
          const participant = defineAtomicCommerceParticipant("neutralRecordedRowReplay");
          const source = yield* Effect.fromResult(defineAtomicCommerceNativeSource("neutralRecordedRowReplay", graph.definition));
          let retained: typeof RecordedGraph.Type | undefined, retained77: typeof RecordedGraph.Type | undefined;
          const read = defineCommerceCommand("recordedGraphRead", "read", ctx => Effect.gen(function* () {
            return { parent: [...yield* (yield* ctx.table("parent")).find(ctx.manager, { order: { column: "id", direction: "asc" } })],
              children: [...yield* (yield* ctx.table("child")).find(ctx.manager, { order: { column: "id", direction: "asc" } })] };
          }));
          const seed = defineCommerceCommand("recordedGraphSeed", "write", ctx => Effect.gen(function* () {
            yield* (yield* ctx.table("parent")).write(ctx.manager, "insert", [{ id: "owner", amount: "40", raw_amount: { value: "40.0000", precision: 20 },
              created_at: created, updated_at: updated, deleted_at: null }]);
            yield* (yield* ctx.table("child")).write(ctx.manager, "insert", [
              { id: "historical", parent_id: "owner", value: "original", created_at: created, updated_at: updated, deleted_at: null },
              { id: "archived", parent_id: "owner", value: "archived-original", created_at: created, updated_at: updated, deleted_at: deleted },
            ]);
            return null;
          }));
          const replace = defineCommerceCommand("recordedGraphReplace", "write", ctx => Effect.gen(function* () {
            yield* (yield* ctx.table("parent")).write(ctx.manager, "upsertPreservingDeletion", [
              { id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } },
            ]);
            const children = yield* ctx.table("child");
            yield* children.delete(ctx.manager, [{ id: "historical" }]);
            yield* children.write(ctx.manager, "update", [{ id: "archived", value: "archived-changed" }]);
            yield* children.write(ctx.manager, "insert", [{ id: "replacement", parent_id: "owner", value: "replacement" }]);
            return yield* ctx.nested(read, null);
          }));
          const replaceAgain = defineCommerceCommand("recordedGraphReplaceAgain", "write", ctx => Effect.gen(function* () {
            yield* (yield* ctx.table("parent")).write(ctx.manager, "upsertPreservingDeletion", [
              { id: "owner", amount: "88", raw_amount: { value: "88.0000", precision: 13 } },
            ]);
            const children = yield* ctx.table("child");
            yield* children.delete(ctx.manager, [{ id: "replacement" }]);
            yield* children.write(ctx.manager, "insert", [{ id: "second-replacement", parent_id: "owner", value: "second-replacement" }]);
            return yield* ctx.nested(read, null);
          }));
          const restore77 = defineCommerceCommand("recordedGraphRestore77", "write", ctx => Effect.gen(function* () {
            const parents = yield* ctx.table("parent"), children = yield* ctx.table("child");
            if (parents.replay === undefined || children.replay === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            if (retained77 === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
            yield* parents.replay(ctx.manager, retained77.parent);
            yield* children.delete(ctx.manager, [{ id: "second-replacement" }]);
            yield* children.replay(ctx.manager, retained77.children);
            return yield* ctx.nested(read, null);
          }));
          const restore = defineCommerceCommand("recordedGraphRestore", "write", ctx => Effect.gen(function* () {
            const parents = yield* ctx.table("parent"), children = yield* ctx.table("child");
            if (parents.replay === undefined || children.replay === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
            if (retained === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
            yield* parents.replay(ctx.manager, retained.parent);
            yield* children.delete(ctx.manager, [{ id: "replacement" }]);
            yield* children.replay(ctx.manager, retained.children);
            return yield* ctx.nested(read, null);
          }));
          const initialCommands = [read, seed];
          const binding = yield* graph.database.bindNative({ definition: graph.definition,
            commands: yield* Effect.fromResult(commerceNativeRegistrations(initialCommands)) });
          yield* Effect.acquireUseRelease(makeCommerceNativeHost({ database: graph.database, binding, hostRuntime, commands: initialCommands,
            initialization, identityAndAccessPolicy: { profile: "neutral-recorded-row-replay-initialization" } }), host => Effect.gen(function* () {
            yield* host.initialize([]);
            yield* host.run(host.newRequestKey(), seed, null);
            retained = yield* decodeGraph(yield* host.read(read, null));
          }), host => host.close);
          const original = retained;
          if (original === undefined) return yield* Effect.die(new Error("Missing genuine recorded graph"));
          expect(original.parent).toEqual([{ id: "owner", amount: "40", raw_amount: { value: "40.0000", precision: 20 },
            created_at: created, updated_at: updated, deleted_at: null }]);
          expect(original.children).toEqual([
            { id: "archived", parent_id: "owner", value: "archived-original", created_at: created, updated_at: updated, deleted_at: deleted },
            { id: "historical", parent_id: "owner", value: "original", created_at: created, updated_at: updated, deleted_at: null },
          ]);
          const before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
          const priorHistorical = before.rows.find(row => row.table === graph.table("child") && row.value.id === "historical");
          if (priorHistorical === undefined) return yield* Effect.die(new Error("Missing genuine historical child identity"));
          const commands = [read, replace, replaceAgain, restore77, restore];
          const byName = new Map([["recordedGraphRead", read], ["recordedGraphReplace", replace], ["recordedGraphReplaceAgain", replaceAgain],
            ["recordedGraphRestore77", restore77], ["recordedGraphRestore", restore]]);
          const validated: string[] = [];
          const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => Effect.sync(() => {
            expect(command).toBe(byName.get(call.commandName));
            expect(call.events).toEqual([]);
            expect(activity.lifecycle).toEqual([]);
            expect(activity.setNull).toEqual([]);
            expect(activity.referenceReplacements).toEqual([]);
            expect(activity.mutations.every(mutation => mutation.table === "parent" || mutation.table === "child")).toBe(true);
            if (command !== read) expect(activity.mutations).toEqual(expect.arrayContaining([
              expect.objectContaining({ table: "parent", after: expect.objectContaining({ id: "owner",
                amount: command === replaceAgain ? "88" : command === restore ? "40" : "77" }) }),
            ]));
            validated.push(call.commandName);
          });
          const replaceRoot = defineAtomicCommerceCommand("recordedGraphReplaceRoot", ctx => ctx.call(participant, replace, null));
          const replaceAgainRoot = defineAtomicCommerceCommand("recordedGraphReplaceAgainRoot", ctx => ctx.call(participant, replaceAgain, null));
          const restore77Root = defineAtomicCommerceCommand("recordedGraphRestore77Root", ctx => ctx.call(participant, restore77, null));
          const restoreRoot = defineAtomicCommerceCommand("recordedGraphRestoreRoot", ctx => ctx.call(participant, restore, null));
          yield* Effect.acquireUseRelease(makeAtomicCommerceNativeHost({ database: graph.database, bundle: graph.bundle, hostRuntime,
            sources: [{ source, definition: graph.definition, initialization }], commands: [replaceRoot, replaceAgainRoot, restore77Root, restoreRoot],
            identityAndAccessPolicy: { profile: "neutral-native-recorded-row-replay" }, participants: [{ participant, nativeStorage: source, commands,
              allowRecordedRowReplay: true, allowPreservingDeletionUpsert: "preserveTimestamps", validateLogicalCall }],
          }), host => Effect.gen(function* () {
            // Prepared host facades are lazy: this genuine invocation must activate the selected profile.
            const replacement = yield* decodeGraph(yield* host.run(host.newRequestKey(), replaceRoot, null));
            retained77 = replacement;
            expect(replacement.parent).toEqual([{ ...original.parent[0], amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]);
            expect(replacement.children.map(row => row.id)).toEqual(["archived", "replacement"]);
            const retired = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
            expect(retired.revisions.filter(row => row.table === graph.table("child") && row.deleted)).toHaveLength(1);
            const secondReplacement = yield* decodeGraph(yield* host.run(host.newRequestKey(), replaceAgainRoot, null));
            expect(secondReplacement.parent).toEqual([{ ...original.parent[0], amount: "88", raw_amount: { value: "88.0000", precision: 13 } }]);
            expect(secondReplacement.children.map(row => row.id)).toEqual(["archived", "second-replacement"]);
            expect(yield* host.run(host.newRequestKey(), restore77Root, null)).toEqual(replacement);
            expect(yield* host.run(host.newRequestKey(), restoreRoot, null)).toEqual(original);
            const restored = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
            const restoredHistorical = restored.rows.find(row => row.table === graph.table("child") && row.value.id === "historical");
            expect(restoredHistorical).toBeDefined();
            expect(restoredHistorical?.value._id).not.toBe(priorHistorical.value._id);
            expect(restored.revisions).toEqual(expect.arrayContaining([...retired.revisions]));
            expect(validated).toEqual(["recordedGraphReplace", "recordedGraphReplaceAgain", "recordedGraphRestore77", "recordedGraphRestore"]);
          }), host => host.close);
          yield* graph.database.close();
          const reopened = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
          const cold = yield* Effect.acquireRelease(openCoreDatabase(reopened, graph.options), database => database.close());
          const coldBinding = yield* cold.bindNative({ definition: graph.definition,
            commands: yield* Effect.fromResult(commerceNativeRegistrations([read], { readOnly: true })) });
          yield* Effect.acquireUseRelease(makeCommerceNativeReadHost({ database: cold, binding: coldBinding, hostRuntime, commands: [read],
            initialization, identityAndAccessPolicy: { profile: "neutral-recorded-row-replay-cold-read" } }), host => Effect.gen(function* () {
            expect(yield* host.read(read, null)).toEqual(original);
          }), host => host.close);
        })));
      } finally { await fixture.close(); }
    }, 120_000);

    for (const cohort of ["recorded", "empty"] as const) {
      it(`refuses an actual index retention-floor advance while delivering a ${cohort} native history page`, run(fixture => Effect.gen(function* () {
        const fetched = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let lease: CorePersistenceLease | undefined, armed = false, end = 0n, examined = -1;
        const persistence: CorePersistence = { ...fixture.persistence,
          acquireLease: () => fixture.persistence.acquireLease().pipe(Effect.tap(value => Effect.sync(() => { lease = value; }))),
          loadIndexHistory: (request, retention) => Effect.gen(function* () {
            const page = yield* fixture.persistence.loadIndexHistory(request, retention);
            if (armed) {
              armed = false; end = request.end; examined = page.examined;
              yield* Deferred.succeed(fetched, undefined); yield* Deferred.await(release);
            }
            return page;
          }),
        };
        const graph = yield* setup(fixture, persistence);
        const inserted = yield* graph.write(operations => operations.writeRows(graph.table("parent"), "insert", [parentRow()]));
        const row = inserted[0];
        if (row === undefined) return yield* Effect.die(new Error("Missing genuine recorded retention preimage"));
        const original = yield* Effect.fromResult(coreNativeRelationalRow(row));
        yield* graph.write(operations => operations.writeRows(graph.table("parent"), "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 20 } }]));
        const before = yield* graph.database.publishedTimestamp;
        yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
          yield* Effect.gen(function* () {
            armed = true;
            const restoring = yield* Effect.forkChild(Effect.result(operation.operations.replayRows(graph.table("parent"),
              [{ ...original, ...(cohort === "empty" ? { id: "never-recorded" } : {}) }])));
            yield* Deferred.await(fetched);
            expect(examined).toBe(cohort === "empty" ? 0 : 2);
            if (lease === undefined) return yield* Effect.die(new Error("Missing the existing Core owner lease"));
            const floor = new TextEncoder().encode((end + 1n).toString());
            yield* fixture.persistence.putGlobal(lease, "min_snapshot_ts", floor);
            expect(yield* fixture.persistence.getGlobal("min_snapshot_ts")).toEqual(Option.some(floor));
            yield* Deferred.succeed(release, undefined);
            expect(failure(yield* Fiber.join(restoring))).toMatchObject({ _tag: "CorePersistenceError", reason: "outOfRetention" });
            expect(yield* graph.database.publishedTimestamp).toBe(before);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
        }), operation => operation.abort());
      })), 120_000);
    }

    it("refuses an actual document retention-floor advance while delivering historical native metadata", run(fixture => Effect.gen(function* () {
      const fetched = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
      let lease: CorePersistenceLease | undefined, armed = false, metadataTable: Uint8Array | undefined, revision = 0n;
      const persistence: CorePersistence = { ...fixture.persistence,
        acquireLease: () => fixture.persistence.acquireLease().pipe(Effect.tap(value => Effect.sync(() => { lease = value; }))),
        readSnapshot: (at, retention) => fixture.persistence.readSnapshot(at, retention).pipe(Effect.map(snapshot => ({ ...snapshot,
          get: (tableId, id) => Effect.gen(function* () {
            const document = yield* snapshot.get(tableId, id);
            if (armed && metadataTable !== undefined && bytesEqual(tableId, metadataTable)) {
              armed = false; revision = at;
              expect(document._tag).toBe("Some");
              yield* Deferred.succeed(fetched, undefined); yield* Deferred.await(release);
            }
            return document;
          }),
        }))),
      };
      const graph = yield* setup(fixture, persistence);
      const inserted = yield* graph.write(operations => operations.writeRows(graph.table("parent"), "insert", [parentRow()]));
      const row = inserted[0];
      if (row === undefined) return yield* Effect.die(new Error("Missing genuine recorded metadata preimage"));
      const original = yield* Effect.fromResult(coreNativeRelationalRow(row));
      yield* graph.write(operations => operations.writeRows(graph.table("parent"), "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 20 } }]));
      const before = yield* graph.database.publishedTimestamp;
      const registry = yield* readCoreFixtureRegistry(fixture, before);
      metadataTable = registry.table("_tables")?.definition.tabletId;
      if (metadataTable === undefined) return yield* Effect.die(new Error("Missing actual native table-metadata owner"));
      yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
        yield* Effect.gen(function* () {
          armed = true;
          const restoring = yield* Effect.forkChild(Effect.result(operation.operations.replayRows(graph.table("parent"), [original])));
          yield* Deferred.await(fetched);
          if (lease === undefined) return yield* Effect.die(new Error("Missing the existing Core owner lease"));
          const floor = new TextEncoder().encode((revision + 1n).toString());
          yield* fixture.persistence.putGlobal(lease, "document_min_snapshot_ts", floor);
          expect(yield* fixture.persistence.getGlobal("document_min_snapshot_ts")).toEqual(Option.some(floor));
          yield* Deferred.succeed(release, undefined);
          expect(failure(yield* Fiber.join(restoring))).toMatchObject({ _tag: "CorePersistenceError", reason: "outOfRetention" });
          expect(yield* graph.database.publishedTimestamp).toBe(before);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
      }), operation => operation.abort());
    })), 120_000);
    it("keeps a live destination distinct from its retired proving generation", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), table = graph.table("parent");
      const first = yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]));
      const original = (yield* rows(first))[0];
      const changed = yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
      const recorded77 = (yield* rows(changed))[0];
      if (original === undefined || recorded77 === undefined || first[0] === undefined) return yield* Effect.die(new Error("Missing actual recorded generations"));
      yield* graph.write(operations => operations.deleteRows(table, ["owner"]));
      const retired = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      const newGeneration = yield* graph.write(operations => operations.replayRows(table, [recorded77]));
      expect(newGeneration[0]?._id).not.toBe(first[0]._id);
      const restored40 = yield* graph.write(operations => operations.replayRows(table, [original]));
      expect(restored40[0]?._id).toBe(newGeneration[0]?._id);
      expect(yield* rows(restored40)).toEqual([original]);
      const after = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      expect(after.revisions).toEqual(expect.arrayContaining([...retired.revisions]));
    })), 120_000);

    it("restores repeated committed retired generations under fresh internal IDs without changing their tombstones", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), table = graph.table("parent");
      const first = yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]));
      const original = (yield* rows(first))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual recorded preimage"));
      const identities = new Set(first.map(nativeId));
      for (let generation = 0; generation < 3; generation++) {
        yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: String(77 + generation),
          raw_amount: { value: `${77 + generation}.0000`, precision: 20 } }]));
        yield* graph.write(operations => operations.deleteRows(table, ["owner"]));
        const retired = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
        const restored = yield* graph.write(operations => operations.replayRows(table, [original]));
        expect(yield* rows(restored)).toEqual([original]);
        expect(restored).toHaveLength(1);
        expect(identities.has(nativeId(restored[0]))).toBe(false);
        identities.add(nativeId(restored[0]));
        const after = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
        expect(after.revisions).toEqual(expect.arrayContaining([...retired.revisions]));
      }
      expect(identities.size).toBe(4);
    })), 120_000);

    it("replays same-root intermediate values and a pending deletion through the existing activity and original owners", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), table = graph.table("parent");
      const seeded = yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]));
      const original = (yield* rows(seeded))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual recorded preimage"));
      yield* graph.write(operations => Effect.gen(function* () {
        const cursor = operations.nativeActivityCursor();
        const changed = yield* operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]);
        const intermediate = (yield* rows(changed))[0];
        if (intermediate === undefined) return yield* Effect.die(new Error("Missing actual intermediate native body"));
        yield* operations.writeRows(table, "update", [{ id: "owner", amount: "88", raw_amount: { value: "88.0000", precision: 13 } }]);
        expect(yield* rows(yield* operations.replayRows(table, [intermediate]))).toEqual([intermediate]);
        yield* operations.deleteRows(table, ["owner"]);
        const restored = yield* operations.replayRows(table, [original]);
        expect(yield* rows(restored)).toEqual([original]);
        expect(restored[0]?._id).toBe(seeded[0]?._id);
        expect((yield* operations.nativeActivitySince(cursor)).mutations).toHaveLength(5);
      }));
      expect(yield* rows(yield* graph.read("parent"))).toEqual([original]);
    })), 120_000);

    it("restores same-source parent and child pending deletions with the same business ID to their own internal identities", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), parent = graph.table("parent"), child = graph.table("child");
      const seeded = yield* graph.write(operations => Effect.gen(function* () {
        const parents = yield* operations.writeRows(parent, "insert", [parentRow("same")]);
        const children = yield* operations.writeRows(child, "insert", [childRow("same", "original", "same")]);
        return { parents, children };
      }));
      const recordedParent = yield* rows(seeded.parents), recordedChild = yield* rows(seeded.children);
      expect(recordedParent).toEqual([parentRow("same")]);
      expect(recordedChild).toEqual([childRow("same", "original", "same")]);
      expect(nativeId(seeded.parents[0])).not.toBe(nativeId(seeded.children[0]));
      yield* graph.write(operations => Effect.gen(function* () {
        const cursor = operations.nativeActivityCursor();
        yield* operations.deleteRows(child, ["same"]);
        yield* operations.deleteRows(parent, ["same"]);
        expect(yield* operations.find(child, {})).toEqual([]);
        expect(yield* operations.find(parent, {})).toEqual([]);
        const restoredChildren = yield* operations.replayRows(child, recordedChild);
        const restoredParents = yield* operations.replayRows(parent, recordedParent);
        expect(restoredChildren).toEqual(seeded.children);
        expect(restoredParents).toEqual(seeded.parents);
        expect((yield* operations.nativeActivitySince(cursor)).mutations).toHaveLength(4);
      }));
      expect(yield* graph.read("child")).toEqual(seeded.children);
      expect(yield* graph.read("parent")).toEqual(seeded.parents);
    })), 120_000);

    it("replays a genuinely inserted pending-only intermediate body without a fabricated committed history", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), table = graph.table("parent");
      yield* graph.write(operations => Effect.gen(function* () {
        operations.nativeActivityCursor();
        const inserted = yield* operations.writeRows(table, "insert", [parentRow()]);
        const original = (yield* rows(inserted))[0];
        if (original === undefined) return yield* Effect.die(new Error("Missing actual pending insertion"));
        yield* operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]);
        const restored = yield* operations.replayRows(table, [original]);
        expect(yield* rows(restored)).toEqual([original]);
        expect(restored[0]?._id).toBe(inserted[0]?._id);
      }));
      expect(yield* rows(yield* graph.read("parent"))).toEqual([parentRow()]);
    })), 120_000);

    it("keeps primary identity immutable before any A-to-B-to-C mutation evidence can be recorded", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), table = graph.table("parent");
      const inserted = yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow("A")]));
      const original = (yield* rows(inserted))[0], id = inserted[0]?._id;
      if (original === undefined || typeof id !== "string") return yield* Effect.die(new Error("Missing actual native identity"));
      yield* graph.write(operations => Effect.gen(function* () {
        const cursor = operations.nativeActivityCursor();
        for (const next of ["B", "C"]) expect(failure(yield* Effect.result(operations.patch(id, { id: next }))))
          .toMatchObject({ reason: "documentValidation", cause: "Native primary identity is immutable" });
        expect((yield* operations.nativeActivitySince(cursor)).mutations).toEqual([]);
        expect(yield* rows(yield* operations.replayRows(table, [original]))).toEqual([original]);
      }));
      expect((yield* graph.read("parent")).map(document => document.id)).toEqual(["A"]);
    })), 120_000);

    it("preserves exact managed values and raw precision across large-decimal and fractional recorded generations", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), table = graph.table("parent");
      const huge = { ...parentRow(), amount: "9007199254740993.0000", raw_amount: { value: "9007199254740993.0000", precision: 30 } };
      const first = yield* graph.write(operations => operations.writeRows(table, "insert", [huge]));
      expect(yield* rows(first)).toEqual([huge]);
      const fraction = yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "1.25", raw_amount: { value: "1.2500", precision: 7 } }]));
      const recordedFraction = (yield* rows(fraction))[0];
      if (recordedFraction === undefined) return yield* Effect.die(new Error("Missing actual fractional native body"));
      expect(recordedFraction).toMatchObject({ amount: "1.25", raw_amount: { value: "1.2500", precision: 7 }, created_at: created, deleted_at: null });
      expect(recordedFraction.updated_at).not.toBe(updated);
      expect(yield* rows(yield* graph.write(operations => operations.replayRows(table, [huge])))).toEqual([huge]);
      expect(yield* rows(yield* graph.write(operations => operations.replayRows(table, [recordedFraction])))).toEqual([recordedFraction]);
    })), 120_000);

    for (const mode of ["created", "updated", "deleted", "amount", "raw", "partial", "extra-field", "duplicate", "changed-key", "extra-row"] as const) {
      it(`refuses ${mode} replay input without retaining an earlier successful row from the failed batch`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture), table = graph.table("parent");
        const inserted = yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]));
        const original = (yield* rows(inserted))[0];
        if (original === undefined) return yield* Effect.die(new Error("Missing actual replay preimage"));
        yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
        const before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
        const forged: Record<string, Json> = { ...original };
        if (mode === "created") forged.created_at = "2030-01-01T00:00:00.000Z";
        if (mode === "updated") forged.updated_at = "2030-01-01T00:00:00.000Z";
        if (mode === "deleted") forged.deleted_at = deleted;
        if (mode === "amount") { forged.amount = "99"; forged.raw_amount = { value: "99.0000", precision: 20 }; }
        if (mode === "raw") forged.raw_amount = { value: "40.0000", precision: 19 };
        if (mode === "partial") delete forged.updated_at;
        if (mode === "extra-field") forged.extra = "not-a-column";
        if (mode === "changed-key") forged.id = "unrecorded";
        const supplied = mode === "duplicate" ? [original, original] : mode === "extra-row" ? [original, { ...original, id: "unrecorded" }] : [forged];
        yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
          const cursor = operation.operations.nativeActivityCursor();
          expect(failure(yield* Effect.result(operation.operations.replayRows(table, supplied)))).toMatchObject(mode === "partial" || mode === "extra-field"
            ? { _tag: "CoreTransactionError", reason: "documentValidation" } : { _tag: "CoreNativeQueryError", reason: "invalidInput" });
          expect((yield* operation.operations.find(table, { id: "owner" }))[0]?.amount).toBe("77");
          expect((yield* operation.operations.nativeActivitySince(cursor)).mutations).toEqual([]);
        }), operation => operation.abort());
        expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
      })), 120_000);
    }

    it("authenticates recorded rows across a genuine unrelated Application bundle and schema-ID handoff", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, fixture.persistence, { applicationHandoff: true }), table = graph.table("parent");
      const application = yield* graph.database.begin();
      const noteId = yield* application.insert("replay_unrelated_notes", { value: "existing unrelated body" });
      yield* graph.database.commit(yield* application.finalize());
      const inserted = yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]));
      const original = (yield* rows(inserted))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual native preimage"));
      const initial = yield* graph.database.readNativeBinding(graph.binding);
      yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
      yield* graph.activate(graph.handoff);
      const binding = yield* graph.database.bindNative({ definition: graph.definition, commands: [{ name: "recorded-owner-write", mode: "write" }] });
      const current = yield* graph.database.readNativeBinding(binding);
      expect(current.schemaId).not.toBe(initial.schemaId);
      expect(current.tables.find(candidate => candidate.name === table)?.tabletId).toEqual(initial.tables.find(candidate => candidate.name === table)?.tabletId);
      expect(yield* rows(yield* graph.write(operations => operations.replayRows(table, [original])))).toEqual([original]);
      yield* Effect.acquireUseRelease(graph.database.begin(), read => Effect.gen(function* () {
        expect(yield* read.get(noteId)).toMatchObject({ _tag: "Some", value: { value: "existing unrelated body" } });
      }), read => read.abort());
    })), 120_000);

    for (const authority of ["source", "scope", "schema"] as const) {
      it(`does not treat rows recorded by a separate ${authority} installation as local history proof`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture), table = graph.table("parent");
        yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow("owner", "77")]));
        const remotePersistence = yield* Effect.tryPromise({ try: () => fixture.reopen(`recorded-foreign-${authority}`),
          catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
        const remote = yield* setup(fixture, remotePersistence, authority === "source" ? { sourceKey: "medusa.neutral-recorded-foreign-source" }
          : authority === "scope" ? { target: { scopeUuid: "21b00000-0000-4000-8000-000000000099", epochUuid: target.epochUuid } }
            : { uniqueChildren: true });
        const recorded = yield* remote.write(operations => operations.writeRows(remote.table("parent"), "insert", [parentRow()]));
        const original = (yield* rows(recorded))[0];
        if (original === undefined) return yield* Effect.die(new Error("Missing genuine separate-installation preimage"));
        const before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
        expect(failure(yield* Effect.result(graph.write(operations => operations.replayRows(table, [original]))))).toMatchObject({ reason: "invalidInput" });
        expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
        expect(yield* rows(yield* remote.read("parent"))).toEqual([original]);
      })), 120_000);
    }

    it("bounds retained revisions through real paginated native-key history before staging restoration", run(fixture => Effect.gen(function* () {
      let pages = 0;
      const persistence: CorePersistence = { ...fixture.persistence, loadIndexHistory: (request, retention) =>
        fixture.persistence.loadIndexHistory(request, retention).pipe(Effect.tap(() => Effect.sync(() => { pages++; }))) };
      const graph = yield* setup(fixture, persistence), table = graph.table("parent");
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual historical preimage"));
      for (const amount of ["41", "42", "43", "44"]) yield* graph.write(operations => operations.writeRows(table, "update", [
        { id: "owner", amount, raw_amount: { value: `${amount}.0000`, precision: 20 } },
      ]));
      const budget = coreNativeTestBudget();
      yield* Effect.acquireUseRelease(graph.database.beginNative(graph.binding, { commandName: "recorded-owner-write", ...budget,
        limits: { ...budget.limits, maxIdentities: 2 } }), operation => Effect.gen(function* () {
        expect(failure(yield* Effect.result(operation.operations.replayRows(table, [original])))).toMatchObject({ reason: "capacity" });
        expect(pages).toBeGreaterThan(0);
      }), operation => operation.abort());
      expect((yield* graph.read("parent"))[0]?.amount).toBe("44");
    })), 120_000);

    it("bounds the actual historical body independently of the current destination body", run(fixture => Effect.gen(function* () {
      let overBudget = false;
      const persistence: CorePersistence = { ...fixture.persistence, loadIndexHistory: (request, retention) =>
        fixture.persistence.loadIndexHistory(request, retention).pipe(Effect.tap(page => Effect.sync(() => { overBudget ||= page.overBudget; }))) };
      const graph = yield* setup(fixture, persistence), table = graph.table("parent");
      const historical = { ...parentRow(), raw_amount: { value: "40.0000", precision: 20, retained_note: "x".repeat(1024) } };
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(table, "insert", [historical]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual large historical preimage"));
      yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
      const budget = coreNativeTestBudget();
      yield* Effect.acquireUseRelease(graph.database.beginNative(graph.binding, { commandName: "recorded-owner-write", ...budget,
        limits: { ...budget.limits, maxDocumentBytes: 512 } }), operation => Effect.gen(function* () {
        expect(failure(yield* Effect.result(operation.operations.replayRows(table, [original])))).toMatchObject({ reason: "capacity" });
        expect(overBudget).toBe(true);
      }), operation => operation.abort());
      expect((yield* graph.read("parent"))[0]?.amount).toBe("77");
    })), 120_000);

    it("preserves unique constraints when an authentic retired child value belongs to a different live row", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, fixture.persistence, { uniqueChildren: true }), child = graph.table("child");
      yield* graph.write(operations => operations.writeRows(graph.table("parent"), "insert", [parentRow()]));
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(child, "insert", [childRow("historical", "shared")]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual unique child preimage"));
      yield* graph.write(operations => operations.deleteRows(child, ["historical"]));
      yield* graph.write(operations => operations.writeRows(child, "insert", [childRow("occupant", "shared")]));
      const before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      expect(failure(yield* Effect.result(graph.write(operations => operations.replayRows(child, [original]))))).toMatchObject({ _tag: "CoreNativeUniqueConflict" });
      expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
    })), 120_000);

    it("requires a physically present FK endpoint while retaining soft-deleted endpoint presence", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), parent = graph.table("parent"), child = graph.table("child");
      yield* graph.write(operations => operations.writeRows(parent, "insert", [parentRow()]));
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(child, "insert", [childRow()]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual child preimage"));
      yield* graph.write(operations => operations.deleteRows(child, ["historical"]));
      yield* graph.write(operations => operations.lifecycle(parent, "softDelete", ["owner"]));
      expect(yield* rows(yield* graph.write(operations => operations.replayRows(child, [original])))).toEqual([original]);
      expect((yield* graph.read("parent"))[0]?.deleted_at).not.toBeNull();
      yield* graph.write(operations => operations.deleteRows(child, ["historical"]));
      yield* graph.write(operations => operations.deleteRows(parent, ["owner"]));
      expect(failure(yield* Effect.result(graph.write(operations => operations.replayRows(child, [original])))))
        .toMatchObject({ _tag: "CoreNativeForeignKeyError", reason: "targetMissing" });
      expect(yield* graph.read("child")).toEqual([]);
    })), 120_000);

    it("rejects a destination update that commits after recorded restoration observed its current original", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), table = graph.table("parent");
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual recorded preimage"));
      yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
      yield* Effect.acquireUseRelease(graph.begin(), candidate => Effect.gen(function* () {
        expect(yield* rows(yield* candidate.operations.replayRows(table, [original]))).toEqual([original]);
        yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "88", raw_amount: { value: "88.0000", precision: 13 } }]));
        expect(failure(yield* Effect.result(graph.database.commit(yield* candidate.finalize())))).toMatchObject({ reason: "conflict" });
      }), operation => operation.abort());
      expect((yield* graph.read("parent"))[0]?.amount).toBe("88");
    })), 120_000);

    it("rejects an FK endpoint removal that commits after child restoration was staged", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), parent = graph.table("parent"), child = graph.table("child");
      yield* graph.write(operations => operations.writeRows(parent, "insert", [parentRow()]));
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(child, "insert", [childRow()]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual child preimage"));
      yield* graph.write(operations => operations.deleteRows(child, ["historical"]));
      yield* Effect.acquireUseRelease(graph.begin(), candidate => Effect.gen(function* () {
        yield* candidate.operations.replayRows(child, [original]);
        yield* graph.write(operations => operations.deleteRows(parent, ["owner"]));
        const refused = failure(yield* Effect.result(graph.database.commit(yield* candidate.finalize())));
        expect(refused).toBeDefined();
        expect(refused?._tag === "CoreNativeForeignKeyError" && refused.reason === "targetMissing"
          || refused?._tag === "CoreTransactionError" && refused.reason === "conflict").toBe(true);
      }), operation => operation.abort());
      expect(yield* graph.read("parent")).toEqual([]);
      expect(yield* graph.read("child")).toEqual([]);
    })), 120_000);

    for (const corruption of ["missing-schema-revision", "changed-source-policy", "malformed-schema-metadata"] as const) {
      it(`fails closed on disposable persisted historical ${corruption} corruption`, run(fixture => Effect.gen(function* () {
        const observed: { entry: CoreDocumentLogEntry; body: DocumentObject }[] = [];
        const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
          yield* fixture.persistence.write(lease, batch);
          for (const entry of batch.documents) if (!entry.deleted) {
            const body = yield* Effect.fromResult(readDocumentObject(entry));
            if (typeof body.native === "string" || typeof body.name === "string" && isJsonObjectFromUnknown(body.nativePolicy)) observed.push({ entry, body });
          }
        }) };
        const graph = yield* setup(fixture, persistence), table = graph.table("parent");
        const original = (yield* rows(yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]))))[0];
        if (original === undefined) return yield* Effect.die(new Error("Missing actual historical preimage"));
        yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
        const metadata = yield* graph.database.readNativeBinding(graph.binding);
        const schemaId = yield* Effect.fromResult(decodeDocumentId(metadata.schemaId));
        const record = corruption === "changed-source-policy" ? observed.findLast(value => value.body.name === table)
          : observed.findLast(value => bytesEqual(value.entry.id, schemaId.internalId) && typeof value.body.native === "string");
        if (record === undefined) return yield* Effect.die(new Error("Missing genuine persisted historical metadata observation"));
        const parameters = [fixture.instanceName, record.entry.tableId, record.entry.id, record.entry.ts.toString()];
        if (corruption === "missing-schema-revision") {
          yield* Effect.tryPromise({ try: () => fixture.query(`DELETE FROM "${fixture.namespace}".documents
            WHERE instance_name=$1 AND table_id=$2 AND id=$3 AND ts=$4`, parameters),
          catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
        } else {
          let body: DocumentObject;
          if (corruption === "changed-source-policy") {
            const policy = record.body.nativePolicy;
            if (!isJsonObjectFromUnknown(policy) || !isJsonObjectFromUnknown(policy.identity)) return yield* Effect.die(new Error("Missing genuine native policy identity"));
            body = { ...record.body, nativePolicy: { ...policy, identity: { ...policy.identity, sourceKey: "medusa.wrong-recorded-source" } } };
          } else body = { ...record.body, native: "not canonical native schema metadata" };
          const encoded = yield* Effect.fromResult(encodeDocumentValue(body));
          yield* Effect.tryPromise({ try: () => fixture.query(`UPDATE "${fixture.namespace}".documents SET json_value=$5
            WHERE instance_name=$1 AND table_id=$2 AND id=$3 AND ts=$4`, [...parameters, encoded]),
          catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
        }
        const before = yield* graph.database.publishedTimestamp;
        yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
          expect(failure(yield* Effect.result(operation.operations.replayRows(table, [original])))).toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
          expect(yield* graph.database.publishedTimestamp).toBe(before);
        }), operation => operation.abort());
      })), 120_000);
    }

    it("keeps a caught forged replay rollback-only in the selected genuine atomic native host", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), table = graph.table("parent");
      const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 2, maximumPreparedBytes: 8_388_608 });
      const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
        1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
      const initialization = { stepId: "recorded-caught-replay-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 };
      const participant = defineAtomicCommerceParticipant("neutralCaughtRecordedReplay");
      const source = yield* Effect.fromResult(defineAtomicCommerceNativeSource("neutralCaughtRecordedReplay", graph.definition));
      let original: JsonObject | undefined, caught: Cause.Cause<import("../../src/frameworks/commerceTransaction/model").CommerceTransactionError> | undefined;
      const command = defineCommerceCommand("recordedCaughtReplay", "write", ctx => Effect.gen(function* () {
        const store = yield* ctx.table("parent");
        if (store.replay === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
        if (original === undefined) return yield* ctx.refuse(commerceError("invalidInput"));
        yield* store.write(ctx.manager, "update", [{ id: "owner", amount: "88", raw_amount: { value: "88.0000", precision: 13 } }]);
        const outcome = yield* Effect.exit(store.replay(ctx.manager, [{ ...original, created_at: "2030-01-01T00:00:00.000Z" }]));
        if (Exit.isFailure(outcome)) caught = outcome.cause;
        return null;
      }));
      const binding = yield* graph.database.bindNative({ definition: graph.definition,
        commands: yield* Effect.fromResult(commerceNativeRegistrations([command])) });
      yield* Effect.acquireUseRelease(makeCommerceNativeHost({ database: graph.database, binding, hostRuntime, commands: [command], initialization,
        identityAndAccessPolicy: { profile: "recorded-caught-replay-initialization" } }), host => host.initialize([]), host => host.close);
      original = (yield* rows(yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]))))[0];
      yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
      const root = defineAtomicCommerceCommand("recordedCaughtReplayRoot", ctx => ctx.call(participant, command, null));
      const validateLogicalCall: LogicalCommerceCallValidation = (call, _activity, token) => Effect.sync(() => {
        expect(token).toBe(command); expect(call.events).toEqual([]);
      });
      yield* Effect.acquireUseRelease(makeAtomicCommerceNativeHost({ database: graph.database, bundle: graph.bundle, hostRuntime,
        sources: [{ source, definition: graph.definition, initialization }], commands: [root], identityAndAccessPolicy: { profile: "neutral-caught-recorded-replay" },
        participants: [{ participant, nativeStorage: source, commands: [command], allowRecordedRowReplay: true,
          allowPreservingDeletionUpsert: "preserveTimestamps", validateLogicalCall }] }), host => Effect.gen(function* () {
        const result = yield* Effect.exit(host.run(host.newRequestKey(), root, null));
        if (caught === undefined || Exit.isSuccess(result)) return yield* Effect.die(new Error("Expected genuine replay refusal and rollback-only settlement"));
        expect(caught.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "invalidInput")).toBe(true);
        const rollbackOnly = result.cause.reasons.find(reason => Cause.isFailReason(reason) && reason.error.reason === "rollbackOnly");
        if (rollbackOnly === undefined || !Cause.isFailReason(rollbackOnly)) return yield* Effect.die(new Error("Missing actual replay rollback-only refusal"));
        expect(rollbackOnly.error.cause).toEqual(caught);
      }), host => host.close);
      expect((yield* graph.read("parent"))[0]?.amount).toBe("77");
    })), 120_000);

    it("drains an interrupted actual history response before closing the native replay operation", run(fixture => Effect.gen(function* () {
      const fetched = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), finished = yield* Deferred.make<void>();
      let armed = false, drained = false, delivered = false;
      const persistence: CorePersistence = { ...fixture.persistence, loadIndexHistory: (request, retention) => Effect.uninterruptible(Effect.gen(function* () {
        const page = yield* fixture.persistence.loadIndexHistory(request, retention);
        if (armed) {
          armed = false; yield* Deferred.succeed(fetched, undefined); yield* Deferred.await(release); drained = true;
        }
        return page;
      })) };
      const graph = yield* setup(fixture, persistence), table = graph.table("parent");
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual history preimage"));
      yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
      yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
        yield* Effect.gen(function* () {
          armed = true;
          const restoring = yield* Effect.forkChild(operation.operations.replayRows(table, [original]).pipe(
            Effect.tap(() => Effect.sync(() => { delivered = true; })), Effect.onExit(() => Deferred.succeed(finished, undefined))));
          yield* Deferred.await(fetched);
          const interrupting = yield* Effect.forkChild(Fiber.interrupt(restoring));
          yield* Effect.yieldNow;
          expect(yield* Deferred.isDone(finished)).toBe(false);
          expect(drained).toBe(false);
          yield* Deferred.succeed(release, undefined);
          yield* Fiber.join(interrupting);
          const result = yield* Fiber.await(restoring);
          expect(Exit.isFailure(result) && result.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
          expect(drained).toBe(true); expect(delivered).toBe(false);
        }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
      }), operation => operation.abort());
      expect((yield* graph.read("parent"))[0]?.amount).toBe("77");
    })), 120_000);

    it("recovers the actual committed replay and root outcome after a lost save acknowledgement without replaying its body", run(fixture => Effect.gen(function* () {
      let armed = false, failures = 0;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        const documents = yield* Effect.forEach(batch.documents.filter(document => !document.deleted), document => Effect.fromResult(readDocumentObject(document)));
        const loseAcknowledgement = armed && documents.some(document => document.id === "owner" && document.amount === "40");
        yield* fixture.persistence.write(lease, batch);
        if (loseAcknowledgement) {
          armed = false; failures++;
          return yield* new CorePersistenceError({ reason: "uncertainWrite", cause: "Lost the real recorded replay save acknowledgement" });
        }
      }) };
      const graph = yield* setup(fixture, persistence), table = graph.table("parent");
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual recorded preimage"));
      yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
      const root = yield* graph.database.bindNativeRoot({ bundle: graph.bundle, contract: { name: "recorded-replay-lost-acknowledgement" },
        participants: [{ binding: graph.binding, commands: ["recorded-owner-write"], limits: coreNativeTestBudget().limits }], maxFinalUserDocuments: 256 });
      const metadata = yield* graph.database.readNativeRootBinding(root);
      const identity: CoreRequestIdentity = { kind: "nativeRoot", root: metadata.identity, key: "recorded-lost-acknowledgement", requestHash: "restore-original40" };
      const acquired = yield* graph.database.claimRequest(identity, root);
      if (acquired.kind !== "claimed") return yield* Effect.die(new Error("Fresh replay root was not actually claimed"));
      let invocations = 0;
      yield* Effect.acquireUseRelease(graph.database.beginNativeRoot(root, { claim: acquired.claim, ...coreNativeTestBudget() }), operation => Effect.gen(function* () {
        const operations = yield* operation.native(graph.binding); invocations++;
        expect(yield* rows(yield* operations.replayRows(table, [original]))).toEqual([original]);
        const finalized = yield* operation.finalize(); armed = true;
        expect(failure(yield* Effect.result(graph.database.commit(finalized, { claim: acquired.claim, result: { restored: true } }))))
          .toMatchObject({ reason: "uncertainWrite" });
      }), operation => operation.abort());
      expect(failures).toBe(1); expect(invocations).toBe(1);
      yield* graph.database.close();
      const reopened = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
      const cold = yield* Effect.acquireRelease(openCoreDatabase(reopened, graph.options), database => database.close());
      expect(yield* cold.recoverRequest(identity)).toMatchObject({ kind: "committed", result: { restored: true } });
      expect(yield* cold.resolveRequest(identity)).toMatchObject({ kind: "committed", result: { restored: true } });
      const inventory = yield* readCoreNativeFixtureInventory(cold, reopened);
      expect(inventory.rows.filter(row => row.table === table).map(row => row.value.amount)).toEqual(["40"]);
      expect(inventory.revisions.filter(row => row.table === table)).toHaveLength(3);
      expect(invocations).toBe(1);
    })), 120_000);

    it("withholds a replay admitted after a contributing unique-key exit when the predecessor save fails", run(fixture => Effect.gen(function* () {
      const saving = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), candidateAdmitting = yield* Deferred.make<void>();
      let armed = false, candidateAdmission = false, candidateSaved = false;
      const persistence: CorePersistence = { ...fixture.persistence, write: (lease, batch) => Effect.gen(function* () {
        const documents = yield* Effect.forEach(batch.documents.filter(document => !document.deleted), document => Effect.fromResult(readDocumentObject(document)));
        if (armed && documents.some(document => document.id === "competitor" && document.value === "released")) {
          yield* Deferred.succeed(saving, undefined); yield* Deferred.await(release);
          return yield* new CorePersistenceError({ reason: "unavailable", cause: "Actual contributing unique-key exit save failed" });
        }
        yield* fixture.persistence.write(lease, batch);
        if (armed && documents.some(document => document.id === "historical" && document.value === "shared")) candidateSaved = true;
      }) };
      const graph = yield* setup(fixture, persistence, { uniqueChildren: true, options: { now: Effect.gen(function* () {
        if (candidateAdmission) { candidateAdmission = false; yield* Deferred.succeed(candidateAdmitting, undefined); }
        return 1_793_577_600_000_000_000n;
      }) } }), parent = graph.table("parent"), child = graph.table("child");
      yield* graph.write(operations => operations.writeRows(parent, "insert", [parentRow(), parentRow("published-marker", "77")]));
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(child, "insert", [childRow("historical", "shared")]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual recorded child preimage"));
      yield* graph.write(operations => operations.deleteRows(child, ["historical"]));
      yield* Effect.acquireUseRelease(graph.begin(), candidate => Effect.gen(function* () {
        // The genuine replay is staged while the unique value is still empty.
        expect(yield* rows(yield* candidate.operations.replayRows(child, [original]))).toEqual([original]);
        const candidateFinalized = yield* candidate.finalize();
        yield* graph.write(operations => operations.writeRows(child, "insert", [childRow("competitor", "shared")]));
        yield* Effect.acquireUseRelease(graph.begin(), predecessor => Effect.gen(function* () {
          yield* predecessor.operations.writeRows(child, "update", [{ id: "competitor", value: "released" }]);
          yield* predecessor.operations.writeRows(parent, "update", [{ id: "published-marker", amount: "88", raw_amount: { value: "88.0000", precision: 13 } }]);
          const predecessorFinalized = yield* predecessor.finalize();
          yield* Effect.gen(function* () {
            armed = true;
            const savingPredecessor = yield* Effect.forkChild(Effect.result(graph.database.commit(predecessorFinalized)));
            yield* Deferred.await(saving);
            // Accepted index effects participate in validation, while bodies remain published-only.
            expect((yield* graph.read("parent", { id: "published-marker" }))[0]?.amount).toBe("77");
            candidateAdmission = true;
            const savingCandidate = yield* Effect.forkChild(Effect.result(graph.database.commit(candidateFinalized)));
            yield* Deferred.await(candidateAdmitting);
            expect(candidateSaved).toBe(false);
            yield* Deferred.succeed(release, undefined);
            const predecessorResult = yield* Fiber.join(savingPredecessor), candidateResult = yield* Fiber.join(savingCandidate);
            expect(failure(predecessorResult)).toMatchObject({ reason: "unavailable" });
            expect(candidateResult).toEqual(predecessorResult);
            expect(candidateSaved).toBe(false);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
        }), operation => operation.abort());
      }), operation => operation.abort());
      yield* graph.database.close();
      const reopened = yield* Effect.tryPromise({ try: () => fixture.reopen(), catch: cause => new CorePersistenceError({ reason: "unavailable", cause }) });
      const cold = yield* Effect.acquireRelease(openCoreDatabase(reopened, graph.options), database => database.close());
      const inventory = yield* readCoreNativeFixtureInventory(cold, reopened);
      expect(inventory.rows.find(row => row.table === parent && row.value.id === "published-marker")?.value.amount).toBe("77");
      expect(inventory.rows.filter(row => row.table === child).map(row => [row.value.id, row.value.value])).toEqual([["competitor", "shared"]]);
    })), 120_000);

    for (const floorName of ["min_snapshot_ts", "document_min_snapshot_ts"] as const) {
      it(`refuses durable ${floorName} advancement before issuing any retained-history page`, run(fixture => Effect.gen(function* () {
        let lease: CorePersistenceLease | undefined, pages = 0;
        const persistence: CorePersistence = { ...fixture.persistence,
          acquireLease: () => fixture.persistence.acquireLease().pipe(Effect.tap(value => Effect.sync(() => { lease = value; }))),
          loadIndexHistory: (request, retention) => fixture.persistence.loadIndexHistory(request, retention).pipe(Effect.tap(() => Effect.sync(() => { pages++; }))),
        };
        const graph = yield* setup(fixture, persistence), table = graph.table("parent");
        const original = (yield* rows(yield* graph.write(operations => operations.writeRows(table, "insert", [parentRow()]))))[0];
        const ownerLease = lease;
        if (original === undefined || ownerLease === undefined) return yield* Effect.die(new Error("Missing genuine replay row or owning lease"));
        yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "owner", amount: "77", raw_amount: { value: "77.0000", precision: 17 } }]));
        yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
          yield* fixture.persistence.putGlobal(ownerLease, floorName, new TextEncoder().encode("1"));
          expect(failure(yield* Effect.result(operation.operations.replayRows(table, [original])))).toMatchObject({ _tag: "CorePersistenceError", reason: "outOfRetention" });
          expect(pages).toBe(0);
        }), operation => operation.abort());
      })), 120_000);
    }

    it("rejects a live unique claimant that commits after an authentic retired child restoration was staged", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture, fixture.persistence, { uniqueChildren: true }), child = graph.table("child");
      yield* graph.write(operations => operations.writeRows(graph.table("parent"), "insert", [parentRow()]));
      const original = (yield* rows(yield* graph.write(operations => operations.writeRows(child, "insert", [childRow("historical", "shared")]))))[0];
      if (original === undefined) return yield* Effect.die(new Error("Missing actual unique child preimage"));
      yield* graph.write(operations => operations.deleteRows(child, ["historical"]));
      yield* Effect.acquireUseRelease(graph.begin(), candidate => Effect.gen(function* () {
        yield* candidate.operations.replayRows(child, [original]);
        yield* graph.write(operations => operations.writeRows(child, "insert", [childRow("occupant", "shared")]));
        const refused = failure(yield* Effect.result(graph.database.commit(yield* candidate.finalize())));
        expect(refused).toBeDefined();
        expect(refused?._tag === "CoreNativeUniqueConflict" || refused?._tag === "CoreTransactionError" && refused.reason === "conflict").toBe(true);
      }), operation => operation.abort());
      expect((yield* graph.read("child")).map(document => [document.id, document.value])).toEqual([["occupant", "shared"]]);
    })), 120_000);
  });
}
