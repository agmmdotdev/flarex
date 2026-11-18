import { randomBytes } from "node:crypto";
import { Cause, Deferred, Effect, Exit, Fiber, Result } from "effect";
import { TestClock } from "effect/testing";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import type { CoreDatabaseOptions, CoreError, CoreNativeOperations } from "../../src/core/api";
import { CoreAccounting, CORE_TRANSACTION_REFERENCE_LIMITS } from "../../src/core/accounting";
import type { CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { coreNativeRelationalRows, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { executeCoreNativeRelationalRead, prepareCoreNativeRelationalRead } from "../../src/core/nativeRelationalQuery";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../src/core/schemaBundle";
import { makePreparedHostRuntime } from "../../src/execution/preparation/preparedHostRuntime";
import { defineCommerceCommand, type CommerceCommand } from "../../src/frameworks/commerceTransaction/commands";
import { commerceNativeRegistrations, makeCommerceNativeHost } from "../../src/frameworks/commerceTransaction/nativeHost";
import { commerceError, type CommerceTransactionError } from "../../src/frameworks/commerceTransaction/model";
import { capturePrivateCanonicalValue } from "../../src/installation/frameworkSchema/privateCanonicalValue";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "21a00000-0000-4000-8000-000000000001", epochUuid: "21a00000-0000-4000-8000-000000000002" };
const origin = { kind: "synthetic", sourceId: "neutral-native-postgres-predicate" } as const;
const lifecycleOrigin = { kind: "implicit", sourceId: `${origin.sourceId}.lifecycle` } as const;

const setup = Effect.fn("NativePostgresPredicateTest.setup")(function* (fixture: CorePersistenceFixture,
  input: Readonly<{ persistence?: CorePersistence; protectedMetadata?: true; options?: Partial<CoreDatabaseOptions> }> = {}) {
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: [{ tableId: "entry", origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "value", type: "text", nullable: true, default: { kind: "none" }, origin },
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
        default: { kind: "currentTimestamp" as const }, origin: lifecycleOrigin })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
    ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
      { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
    ], constraints: [], relationships: [] }], capabilities: [
      { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
        updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
      { capabilityId: "entry.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: lifecycleOrigin },
    ] }));
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-postgres-predicate", owner: "medusa",
    writeProfile: "medusa.neutral-native-postgres-predicate", evidence: { provenance: origin }, definition: { kind: "relational", schema },
    bindings: [{ kind: "definition", localName: "entry", table: { namespace: "medusa", logicalName: `${origin.sourceId}/entry` } }] });
  const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const withdrawn = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }],
    nativeBindings: [{ sourceKey: definition.source.key, selected: false }] });
  const database = yield* Effect.acquireRelease(openCoreDatabase(input.persistence ?? fixture.persistence, { schemaBundles: [bundle, withdrawn],
    now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0, ...input.options }), value => value.close());
  const activate = Effect.fn("NativePostgresPredicateTest.activate")(function* (selected: CoreSchemaBundle) {
    const proposal = yield* database.prepareSchema({ bundle: selected });
    for (let step = 0; step < 256; step++) {
      const status = yield* database.schemaStatus(proposal);
      if ((status.state === "validated" || status.state === "active") && status.indexesReady)
        return yield* database.activateSchema(proposal, { programs: [], bundle: selected });
      if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Neutral PostgreSQL predicate schema " + status.state));
      yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
    }
    return yield* Effect.die(new Error("Neutral PostgreSQL predicate schema did not activate"));
  });
  yield* activate(bundle);
  const writeBinding = yield* database.bindNative({ definition, commands: [{ name: "predicate-write", mode: "write" }] });
  const binding = yield* database.bindNative({ definition, commands: [{ name: "predicate-read", mode: "read" }],
    ...(input.protectedMetadata === true ? { protectedMetadata: true } : {}) });
  const metadata = yield* database.readNativeBinding(binding);
  const declaration = definition.tables.find(candidate => candidate.localName === "entry");
  const table = metadata.tables.find(candidate => candidate.name === declaration?.name);
  const policy = declaration === undefined ? undefined : coreNativeRelationalRows(definition, declaration.name);
  if (table === undefined || policy === undefined) return yield* Effect.die(new Error("Missing installed neutral PostgreSQL predicate table"));
  const begin = (commandName: "predicate-write" | "predicate-read" = "predicate-write") =>
    database.beginNative(commandName === "predicate-write" ? writeBinding : binding, { commandName, ...coreNativeTestBudget() });
  const write = Effect.fn("NativePostgresPredicateTest.write")(<Value>(body: (operations: CoreNativeOperations) => Effect.Effect<Value, CoreError>) =>
    Effect.acquireUseRelease(begin(), operation => Effect.gen(function* () {
      const value = yield* body(operation.operations); yield* database.commit(yield* operation.finalize()); return value;
    }), operation => operation.abort()));
  const select = Effect.fn("NativePostgresPredicateTest.select")(function* (operations: CoreNativeOperations, predicate: JsonObject,
    options: JsonObject = {}) {
    const query = yield* Effect.fromResult(prepareCoreNativeRelationalRead(policy, { fields: ["id"], includeIdentities: true,
      order: { column: "id", direction: "asc" }, ...options, predicate: { kind: "and", children: [
        { kind: "isNull", column: "deleted_at" }, predicate,
      ] } }, 32));
    return yield* executeCoreNativeRelationalRead(operations, table, policy, query);
  });
  const read = Effect.fn("NativePostgresPredicateTest.read")((predicate: JsonObject, options: JsonObject = {}) =>
    Effect.acquireUseRelease(begin("predicate-read"), operation => Effect.gen(function* () {
      const value = yield* select(operation.operations, predicate, options); yield* operation.finishRead(); return value;
    }), operation => operation.abort()));
  return { database, definition, bundle, withdrawn, binding, writeBinding, table, policy, begin, write, select, read, activate };
});

const pg = (operator: string, value: string | boolean): JsonObject => ({ kind: "postgresText", column: "value", operator, value });
const failure = <Value>(result: Result.Result<Value, CoreError>) => Result.isFailure(result) ? result.failure : undefined;
const selected = (...ids: string[]) => ({ rows: ids.map(id => ({ id })), count: ids.length, returned: ids.length,
  orderedIdentities: ids.map(id => ({ id })) });
function predicateBudget(maximumBytes: number) {
  const accounting = new CoreAccounting({ ...CORE_TRANSACTION_REFERENCE_LIMITS, bytesRead: maximumBytes });
  return { limits: { maxIdentities: 256, maxDocumentBytes: 65_536 },
    chargeRetained: (bytes: number) => Effect.fromResult(accounting.read(false, bytes)),
    remainingBytes: () => Math.max(0, maximumBytes - accounting.snapshot().user.bytesRead) };
}
const nativeHost = Effect.fn("NativePostgresPredicateTest.nativeHost")(function* (graph: Effect.Success<ReturnType<typeof setup>>,
  commands: readonly CommerceCommand[]) {
  const hostRuntime = yield* makePreparedHostRuntime({ maximumHosts: 1, maximumPreparedBytes: 8_388_608 });
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const binding = yield* graph.database.bindNative({ definition: graph.definition,
    commands: yield* Effect.fromResult(commerceNativeRegistrations(commands)) });
  const host = yield* Effect.acquireRelease(makeCommerceNativeHost({ database: graph.database, binding, hostRuntime, commands,
    initialization: { stepId: "neutral-postgres-predicate-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 },
    identityAndAccessPolicy: { profile: "neutral-native-postgres-predicate" } }), value => value.close);
  yield* host.initialize([]);
  return host;
});
const commerceQuery = (predicate: JsonObject): JsonObject => ({ fields: ["id"], order: { column: "id", direction: "asc" },
  predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, predicate] } });

export function registerNativePostgresPredicateScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };
    it("selects active nullable-text rows with a PostgreSQL regex through the installed Core read owner", async () => {
      const fixture = await createFixture();
      try {
        await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
          const graph = yield* setup(fixture);
          yield* Effect.acquireUseRelease(graph.database.beginNative(graph.writeBinding, { commandName: "predicate-write", ...coreNativeTestBudget() }),
            operation => Effect.gen(function* () {
              yield* operation.operations.writeRows(graph.table.name, "insert", [
                { id: "usd-b", value: "usd" }, { id: "other", value: "eur" }, { id: "null", value: null },
                { id: "case", value: "USD" }, { id: "deleted", value: "usd" }, { id: "usd-a", value: "usd" }, { id: "empty", value: "" },
              ]);
              yield* operation.operations.lifecycle(graph.table.name, "softDelete", ["deleted"]);
              yield* graph.database.commit(yield* operation.finalize());
            }), operation => operation.abort());
          const query = yield* Effect.fromResult(prepareCoreNativeRelationalRead(graph.policy, { fields: ["id"], includeIdentities: true,
            order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
              { kind: "isNull", column: "deleted_at" }, { kind: "postgresText", column: "value", operator: "regex", value: "^usd$" },
            ] } }, 32));
          yield* Effect.acquireUseRelease(graph.database.beginNative(graph.binding, { commandName: "predicate-read", ...coreNativeTestBudget() }),
            operation => Effect.gen(function* () {
              const selected = yield* executeCoreNativeRelationalRead(operation.operations, graph.table, graph.policy, query);
              expect(selected).toEqual({ rows: [{ id: "usd-a" }, { id: "usd-b" }], count: 2, returned: 2,
                orderedIdentities: [{ id: "usd-a" }, { id: "usd-b" }] });
              yield* operation.finishRead();
            }), operation => operation.abort());
        })));
      } finally { await fixture.close(); }
    }, 120_000);

    it("retains PostgreSQL Unicode character LIKE, case-insensitive text, SIMPLE fulltext and NULL verdicts", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [
        { id: "emoji", value: "💵" }, { id: "combining", value: "e\u0301" }, { id: "burmese", value: "မြန်မာ" },
        { id: "fox-a", value: "Ångström fox" }, { id: "fox-b", value: "lazy FOX" }, { id: "stopword", value: "the quick fox" },
        { id: "empty", value: "" }, { id: "null", value: null },
      ]));
      expect(yield* graph.read(pg("like", "_"))).toEqual(selected("emoji"));
      expect(yield* graph.read(pg("like", "__"))).toEqual(selected("combining"));
      expect(yield* graph.read(pg("like", "%မြန်မာ%"))).toEqual(selected("burmese"));
      expect(yield* graph.read(pg("ilike", "%FOX%"))).toEqual(selected("fox-a", "fox-b", "stopword"));
      expect(yield* graph.read(pg("fulltext", "the"))).toEqual(selected("stopword"));
      expect(yield* graph.read(pg("regex", "^$"))).toEqual(selected("empty"));
      expect(yield* graph.read(pg("exists", false))).toEqual(selected("null"));
      expect(yield* graph.read({ kind: "postgresText", column: "value", operator: "notIn", values: ["", "💵", "e\u0301", "မြန်မာ"] }))
        .toEqual(selected("fox-a", "fox-b", "stopword"));
      const window = yield* graph.read(pg("ilike", "%FOX%"), { skip: 1, take: 1 });
      expect(window).toEqual({ rows: [{ id: "fox-b" }], count: 3, returned: 1, orderedIdentities: [{ id: "fox-b" }] });
    })), 120_000);

    it("plans invalid regex for empty and missing cohorts while decisive Boolean constants suppress it", run(fixture => Effect.gen(function* () {
      let evaluations = 0;
      const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => {
        evaluations++; return fixture.persistence.evaluateRelational(batch);
      } };
      const graph = yield* setup(fixture, { persistence });
      expect(failure(yield* Effect.result(graph.read(pg("regex", "["))))).toMatchObject({ _tag: "CorePersistenceError", reason: "unavailable" });
      expect(evaluations).toBe(1);
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [{ id: "present", value: "usd" }]));
      expect(failure(yield* Effect.result(graph.read({ kind: "and", children: [
        { kind: "in", column: "id", values: ["missing"] }, pg("regex", "["),
      ] })))).toMatchObject({ _tag: "CorePersistenceError", reason: "unavailable" });
      expect(evaluations).toBe(2);
      expect(failure(yield* Effect.result(graph.read({ kind: "and", children: [
        { kind: "isNull", column: "id" }, pg("regex", "["),
      ] })))).toMatchObject({ _tag: "CorePersistenceError", reason: "unavailable" });
      expect(yield* graph.read({ kind: "and", children: [{ kind: "in", column: "value", values: [] }, pg("regex", "[")] }))
        .toEqual(selected());
      expect(yield* graph.read({ kind: "and", children: [{ kind: "in", column: "value", values: ["left"] },
        { kind: "in", column: "value", values: ["right"] }, pg("regex", "[")] })).toEqual(selected());
      expect(yield* graph.read({ kind: "or", children: [
        { kind: "postgresText", column: "value", operator: "notIn", values: [] }, pg("regex", "["),
      ] })).toEqual(selected("present"));
    })), 120_000);

    it("evaluates pending entry, exit and physical deletion over retained membership without refreshing its originals", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [
        { id: "enter", value: "eur" }, { id: "leave", value: "usd" }, { id: "remove", value: "usd" },
      ]));
      yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
        expect(yield* graph.select(operation.operations, pg("regex", "^usd$"))).toEqual(selected("leave", "remove"));
        yield* operation.operations.writeRows(graph.table.name, "update", [{ id: "enter", value: "usd" }, { id: "leave", value: "eur" }]);
        yield* operation.operations.deleteRows(graph.table.name, ["remove"]);
        yield* operation.operations.writeRows(graph.table.name, "insert", [{ id: "pending", value: "usd" }]);
        expect(yield* graph.select(operation.operations, pg("regex", "^usd$"))).toEqual(selected("enter", "pending"));
        expect(yield* graph.select(operation.operations, pg("regex", "^usd$"))).toEqual(selected("enter", "pending"));
        yield* operation.operations.lifecycle(graph.table.name, "softDelete", ["enter"]);
        expect(yield* graph.select(operation.operations, pg("regex", "^usd$"))).toEqual(selected("pending"));
        yield* graph.database.commit(yield* operation.finalize());
      }), operation => operation.abort());
      expect(yield* graph.read(pg("regex", "^usd$"))).toEqual(selected("pending"));
    })), 120_000);

    it("keeps nonmatching candidate observations and rejects their committed change at settlement", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [{ id: "matched", value: "usd" }, { id: "unmatched", value: "eur" }]));
      yield* Effect.acquireUseRelease(graph.begin(), observing => Effect.gen(function* () {
        expect(yield* graph.select(observing.operations, pg("regex", "^usd$"))).toEqual(selected("matched"));
        yield* observing.operations.writeRows(graph.table.name, "insert", [{ id: "must-rollback", value: "local" }]);
        yield* graph.write(operations => operations.writeRows(graph.table.name, "update", [{ id: "unmatched", value: "gbp" }]));
        expect(yield* graph.select(observing.operations, pg("regex", "^usd$"))).toEqual(selected("matched"));
        expect(failure(yield* Effect.result(graph.database.commit(yield* observing.finalize())))).toMatchObject({ reason: "conflict" });
      }), operation => operation.abort());
      expect(yield* graph.read(pg("regex", "^local$"))).toEqual(selected());
      expect(yield* graph.read(pg("regex", "^gbp$"))).toEqual(selected("unmatched"));
    })), 120_000);

    it("retains an empty active cohort's EOF dependency before a later matching insertion", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      yield* Effect.acquireUseRelease(graph.begin(), observing => Effect.gen(function* () {
        expect(yield* graph.select(observing.operations, pg("regex", "^usd$"))).toEqual(selected());
        yield* observing.operations.writeRows(graph.table.name, "insert", [{ id: "must-rollback", value: "local" }]);
        yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [{ id: "phantom", value: "usd" }]));
        expect(failure(yield* Effect.result(graph.database.commit(yield* observing.finalize())))).toMatchObject({ reason: "conflict" });
      }), operation => operation.abort());
      expect(yield* graph.read(pg("regex", "^usd$"))).toEqual(selected("phantom"));
      expect(yield* graph.read(pg("regex", "^local$"))).toEqual(selected());
    })), 120_000);

    it("bounds complete captured payloads using the same retained-byte owner before SQL admission", run(fixture => Effect.gen(function* () {
      let evaluations = 0;
      const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => {
        evaluations++; return fixture.persistence.evaluateRelational(batch);
      } };
      const graph = yield* setup(fixture, { persistence });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [{ id: "body", value: "x".repeat(512) }]));
      const budget = predicateBudget(8192);
      yield* Effect.acquireUseRelease(graph.database.beginNative(graph.binding, { commandName: "predicate-read", ...budget }), operation => Effect.gen(function* () {
        expect(yield* operation.operations.find(graph.table.name, { deleted_at: null })).toHaveLength(1);
        const remaining = budget.remainingBytes();
        expect(remaining).toBeGreaterThan(64);
        yield* budget.chargeRetained(remaining - 64);
        expect(failure(yield* Effect.result(graph.select(operation.operations, pg("regex", "x"))))).toMatchObject({ reason: "capacity" });
        expect(evaluations).toBe(0);
      }), operation => operation.abort());
    })), 120_000);

    it("charges the real decoded evaluator reply through the original retained-byte owner before delivery", run(fixture => Effect.gen(function* () {
      const budget = predicateBudget(8192);
      let evaluations = 0, exhaustResponse = false;
      const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => Effect.gen(function* () {
        const reply = yield* fixture.persistence.evaluateRelational(batch);
        evaluations++;
        if (exhaustResponse) yield* budget.chargeRetained(budget.remainingBytes()).pipe(Effect.orDie);
        return reply;
      }) };
      const graph = yield* setup(fixture, { persistence });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [{ id: "match", value: "usd" }]));
      exhaustResponse = true;
      yield* Effect.acquireUseRelease(graph.database.beginNative(graph.binding, { commandName: "predicate-read", ...budget }), operation => Effect.gen(function* () {
        expect(failure(yield* Effect.result(graph.select(operation.operations, pg("regex", "^usd$"))))).toMatchObject({ reason: "capacity" });
        expect(evaluations).toBe(1);
      }), operation => operation.abort());
    })), 120_000);

    for (const metadata of ["complete", "selective"] as const) for (const cohort of ["empty", "cached"] as const) {
      it(`refuses persisted source withdrawal before SQL for a ${cohort} cohort with ${metadata} metadata`, run(fixture => Effect.gen(function* () {
        let evaluations = 0;
        const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => {
          evaluations++; return fixture.persistence.evaluateRelational(batch);
        } };
        const graph = yield* setup(fixture, { persistence, ...(metadata === "selective" ? { protectedMetadata: true } : {}) });
        const predicate = cohort === "empty" ? { kind: "and", children: [{ kind: "isNull", column: "id" }, pg("regex", "^usd$")] } : pg("regex", "^usd$");
        if (cohort === "cached") yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [{ id: "match", value: "usd" }]));
        yield* Effect.acquireUseRelease(graph.begin("predicate-read"), operation => Effect.gen(function* () {
          expect(yield* graph.select(operation.operations, predicate)).toEqual(cohort === "empty" ? selected() : selected("match"));
          const before = evaluations;
          yield* graph.activate(graph.withdrawn);
          const persisted = yield* readCoreFixtureRegistry(fixture, yield* graph.database.publishedTimestamp);
          expect(persisted.table(graph.table.name)?.definition.nativePolicy?.bindingSelected).toBe(false);
          expect(failure(yield* Effect.result(graph.select(operation.operations, predicate)))).toMatchObject({ reason: "authorityRevoked" });
          expect(evaluations).toBe(before);
        }), operation => operation.abort());
      })), 120_000);

      it(`withholds a successful SQL reply after persisted source withdrawal for a ${cohort} cohort with ${metadata} metadata`, run(fixture => Effect.gen(function* () {
        const evaluated = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let armed = false, evaluations = 0;
        const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => Effect.gen(function* () {
          const reply = yield* fixture.persistence.evaluateRelational(batch);
          evaluations++;
          if (armed) { yield* Deferred.succeed(evaluated, undefined); yield* Deferred.await(release); }
          return reply;
        }) };
        const graph = yield* setup(fixture, { persistence, ...(metadata === "selective" ? { protectedMetadata: true } : {}) });
        const predicate = cohort === "empty" ? { kind: "and", children: [{ kind: "isNull", column: "id" }, pg("regex", "^usd$")] } : pg("regex", "^usd$");
        if (cohort === "cached") yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [{ id: "match", value: "usd" }]));
        yield* Effect.acquireUseRelease(graph.begin("predicate-read"), operation => Effect.gen(function* () {
          expect(yield* graph.select(operation.operations, predicate)).toEqual(cohort === "empty" ? selected() : selected("match"));
          armed = true;
          yield* Effect.gen(function* () {
            const reading = yield* Effect.forkChild(Effect.result(graph.select(operation.operations, predicate)));
            yield* Deferred.await(evaluated);
            yield* graph.activate(graph.withdrawn);
            const persisted = yield* readCoreFixtureRegistry(fixture, yield* graph.database.publishedTimestamp);
            expect(persisted.table(graph.table.name)?.definition.nativePolicy?.bindingSelected).toBe(false);
            yield* Deferred.succeed(release, undefined);
            expect(failure(yield* Fiber.join(reading))).toMatchObject({ reason: "authorityRevoked" });
            expect(evaluations).toBe(2);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
        }), operation => operation.abort());
      })), 120_000);
    }

    for (const metadata of ["complete", "selective"] as const) {
      it(`preserves the original SQL planner failure when source withdrawal races a failed reply with ${metadata} metadata`, run(fixture => Effect.gen(function* () {
        const evaluated = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        let original: Exit.Exit<readonly unknown[], import("../../src/core/contracts").CorePersistenceError> | undefined;
        const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => Effect.gen(function* () {
          const reply = yield* Effect.exit(fixture.persistence.evaluateRelational(batch));
          original = reply;
          yield* Deferred.succeed(evaluated, undefined);
          yield* Deferred.await(release);
          if (Exit.isFailure(reply)) return yield* Effect.failCause(reply.cause);
          return reply.value;
        }) };
        const graph = yield* setup(fixture, { persistence, ...(metadata === "selective" ? { protectedMetadata: true } : {}) });
        yield* Effect.acquireUseRelease(graph.begin("predicate-read"), operation => Effect.gen(function* () {
          yield* Effect.gen(function* () {
            const reading = yield* Effect.forkChild(Effect.exit(graph.select(operation.operations, pg("regex", "["))));
            yield* Deferred.await(evaluated);
            yield* graph.activate(graph.withdrawn);
            yield* Deferred.succeed(release, undefined);
            const result = yield* Fiber.join(reading);
            if (original === undefined || Exit.isSuccess(original) || Exit.isSuccess(result)) return yield* Effect.die(new Error("Expected the genuine SQL planner failure"));
            expect(result.cause).toEqual(original.cause);
            expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "unavailable")).toBe(true);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
        }), operation => operation.abort());
      })), 120_000);
    }

    it("keeps a caught real SQL failure rollback-only at the genuine native host and preserves its original cause", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      let caught: Cause.Cause<CommerceTransactionError> | undefined;
      const command = defineCommerceCommand("predicateCaughtSqlFailure", "write", ctx => Effect.gen(function* () {
        yield* ctx.store.write(ctx.manager, "insert", [{ id: "must-rollback", value: "usd" }]);
        const attempted = yield* Effect.exit(ctx.store.find(ctx.manager, commerceQuery(pg("regex", "["))));
        if (Exit.isFailure(attempted)) caught = attempted.cause;
        return null;
      }));
      const host = yield* nativeHost(graph, [command]);
      const result = yield* Effect.exit(host.run(host.newRequestKey(), command, null));
      if (caught === undefined || Exit.isSuccess(result)) return yield* Effect.die(new Error("Expected a caught genuine SQL failure and refused host settlement"));
      expect(caught.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "resourceFailure"
        && typeof reason.error.cause === "object" && reason.error.cause !== null && "_tag" in reason.error.cause
        && reason.error.cause._tag === "CorePersistenceError")).toBe(true);
      const rollbackOnly = result.cause.reasons.find(reason => Cause.isFailReason(reason) && reason.error.reason === "rollbackOnly");
      if (rollbackOnly === undefined || !Cause.isFailReason(rollbackOnly)) return yield* Effect.die(new Error("Expected the native host's rollback-only refusal"));
      expect(rollbackOnly.error.cause).toEqual(caught);
      expect(yield* graph.read(pg("regex", "^usd$"))).toEqual(selected());
    })), 120_000);

    it("joins an interrupted native host's actual evaluator response before closing and publishes no caught write", run(fixture => Effect.gen(function* () {
      const evaluated = yield* Deferred.make<void>(), release = yield* Deferred.make<void>(), finished = yield* Deferred.make<void>();
      let armed = false, drained = false, delivered = false;
      const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => Effect.uninterruptible(Effect.gen(function* () {
        const reply = yield* fixture.persistence.evaluateRelational(batch);
        if (armed) {
          yield* Deferred.succeed(evaluated, undefined);
          yield* Deferred.await(release);
          drained = true;
        }
        return reply;
      })) };
      const graph = yield* setup(fixture, { persistence });
      const command = defineCommerceCommand("predicateInterruptedSql", "write", ctx => Effect.gen(function* () {
        yield* ctx.store.write(ctx.manager, "insert", [{ id: "must-rollback", value: "usd" }]);
        const rows = yield* ctx.store.find(ctx.manager, commerceQuery(pg("regex", "^usd$")));
        delivered = true;
        return [...rows];
      }));
      const host = yield* nativeHost(graph, [command]);
      yield* Effect.gen(function* () {
        armed = true;
        const running = yield* Effect.forkChild(host.run(host.newRequestKey(), command, null).pipe(Effect.onExit(() => Deferred.succeed(finished, undefined))));
        yield* Deferred.await(evaluated);
        const interrupting = yield* Effect.forkChild(Fiber.interrupt(running));
        yield* Effect.yieldNow;
        expect(yield* Deferred.isDone(finished)).toBe(false);
        expect(drained).toBe(false);
        yield* Deferred.succeed(release, undefined);
        yield* Fiber.join(interrupting);
        const result = yield* Fiber.await(running);
        expect(Exit.isFailure(result) && result.cause.reasons.some(Cause.isInterruptReason)).toBe(true);
        expect(drained).toBe(true);
        expect(delivered).toBe(false);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
      armed = false;
      expect(yield* graph.read(pg("regex", "^usd$"))).toEqual(selected());
    })), 120_000);

    it("uses one original native request deadline across two genuine SQL evaluations and drains the late response", run(fixture => Effect.gen(function* () {
      const first = yield* Deferred.make<void>(), second = yield* Deferred.make<void>();
      const releaseFirst = yield* Deferred.make<void>(), releaseSecond = yield* Deferred.make<void>(), finished = yield* Deferred.make<void>();
      let armed = false, evaluations = 0, delivered = 0;
      const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => Effect.uninterruptible(Effect.gen(function* () {
        const reply = yield* fixture.persistence.evaluateRelational(batch);
        if (armed) {
          evaluations++;
          if (evaluations === 1) { yield* Deferred.succeed(first, undefined); yield* Deferred.await(releaseFirst); }
          if (evaluations === 2) { yield* Deferred.succeed(second, undefined); yield* Deferred.await(releaseSecond); }
        }
        return reply;
      })) };
      const graph = yield* setup(fixture, { persistence });
      const command = defineCommerceCommand("predicateOriginalSqlDeadline", "write", ctx => Effect.gen(function* () {
        yield* ctx.store.write(ctx.manager, "insert", [{ id: "must-rollback", value: "usd" }]);
        yield* ctx.store.find(ctx.manager, commerceQuery(pg("regex", "^usd$")));
        delivered++;
        const rows = yield* ctx.store.find(ctx.manager, commerceQuery(pg("like", "%usd%")));
        delivered++;
        return [...rows];
      }));
      const host = yield* nativeHost(graph, [command]);
      yield* Effect.gen(function* () {
        armed = true;
        const running = yield* Effect.forkChild(host.run(host.newRequestKey(), command, null).pipe(Effect.onExit(() => Deferred.succeed(finished, undefined))));
        yield* Deferred.await(first);
        yield* TestClock.adjust("9 seconds");
        yield* Deferred.succeed(releaseFirst, undefined);
        yield* Deferred.await(second);
        expect(delivered).toBe(1);
        yield* TestClock.adjust("1 second");
        expect(yield* Deferred.isDone(finished)).toBe(false);
        yield* Deferred.succeed(releaseSecond, undefined);
        const result = yield* Fiber.await(running);
        if (Exit.isSuccess(result)) return yield* Effect.die(new Error("Original native request deadline must refuse the late evaluator reply"));
        expect(result.cause.reasons.some(reason => Cause.isFailReason(reason) && reason.error.reason === "deadlineExceeded")).toBe(true);
        expect(evaluations).toBe(2);
        expect(delivered).toBe(1);
      }).pipe(Effect.ensuring(Deferred.succeed(releaseFirst, undefined)), Effect.ensuring(Deferred.succeed(releaseSecond, undefined)),
        Effect.provide(TestClock.layer()));
      armed = false;
      expect(yield* graph.read(pg("regex", "^usd$"))).toEqual(selected());
    })), 120_000);
  });
}
