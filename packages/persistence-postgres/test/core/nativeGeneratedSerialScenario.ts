import { Buffer } from "node:buffer";
import { randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { CoreDatabaseOptions, CoreError, CoreNativeOperations, CoreRequestIdentity } from "../../src/core/api";
import { CorePersistenceError, type CoreIndexPage, type CoreIndexScan, type CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const origin = { kind: "synthetic", sourceId: "neutral-core-generated-serial" } as const;
const lifecycle = { kind: "implicit", sourceId: "neutral-core-generated-serial.lifecycle" } as const;
const target = { scopeUuid: "8a600000-0000-4000-8000-000000000001", epochUuid: "8a600000-0000-4000-8000-000000000002" };
const commands = [{ name: "write", mode: "write" }, { name: "read", mode: "read" }] as const;
const columns = ["ticket", "other"] as const;
const serialSchema = (requireMarker: boolean) => normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  tables: [{ tableId: "record", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    ...columns.map(columnId => ({ columnId, type: "integer", nullable: false, default: { kind: "serialNext" }, origin })),
    ...(requireMarker ? [{ columnId: "marker", type: "text", nullable: false, default: { kind: "none" }, origin }] : []),
    ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false,
      default: { kind: "currentTimestamp" }, origin: lifecycle })),
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycle },
  ], keys: [{ keyId: "record.primary", kind: "primary", columns: ["id"], origin }],
  indexes: [{ indexId: "record.active", kind: "btree", columns: ["deleted_at"],
    predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycle }],
  constraints: [], relationships: [] }],
  capabilities: [
    { capabilityId: "record.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "record", columnId: "created_at" },
      updatedAtColumn: { tableId: "record", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycle },
    { capabilityId: "record.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "record", columnId: "deleted_at" },
      activeRowsIndex: { tableId: "record", indexId: "record.active" }, origin: lifecycle },
  ] });

const setup = Effect.fn("NativeGeneratedSerialTest.setup")(function* (persistence: CorePersistence, requireMarker = false) {
  const relational = yield* Effect.fromResult(serialSchema(requireMarker));
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-core-generated-serial", owner: "medusa",
    writeProfile: "medusa.neutral-core-generated-serial", evidence: { provenance: origin },
    definition: { kind: "relational", schema: relational }, bindings: [{ kind: "definition", localName: "record",
      table: { namespace: "medusa", logicalName: origin.sourceId + "/record" } }] });
  const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const options: CoreDatabaseOptions = { schemaBundles: [bundle], now: Effect.succeed(1_000_000_000n),
    randomBytes: length => Effect.sync(() => randomBytes(length)), schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 };
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, options), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  for (let step = 0; step < 256; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle });
      break;
    }
    if (status.state === "failed" || status.state === "overwritten" || step === 255)
      return yield* Effect.die(new Error("Generated serial schema did not activate: " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  const binding = yield* database.bindNative({ definition, commands });
  const metadata = yield* database.readNativeBinding(binding);
  const declaration = definition.tables[0], installed = metadata.tables.find(table => table.name === declaration?.name);
  const command = metadata.commands.find(candidate => candidate.name === "write");
  if (declaration === undefined || installed === undefined || command === undefined)
    return yield* Effect.die(new Error("Missing installed generated serial table or command"));
  const table = installed.name;
  const begin = Effect.fn("NativeGeneratedSerialTest.begin")((maxIdentities = coreNativeTestBudget().limits.maxIdentities) => {
    const budget = coreNativeTestBudget();
    return database.beginNative(binding, { commandName: "write", ...budget, limits: { ...budget.limits, maxIdentities } });
  });
  const write = Effect.fn("NativeGeneratedSerialTest.write")(<A>(body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>,
    maxIdentities?: number) => Effect.acquireUseRelease(begin(maxIdentities), operation => Effect.gen(function* () {
      const result = yield* body(operation.operations);
      yield* database.commit(yield* operation.finalize());
      return result;
    }), operation => operation.abort()));
  const insert = (rows: unknown, maxIdentities?: number) => write(operations => operations.writeRows(table, "insert", rows), maxIdentities);
  const read = (id?: string) => Effect.acquireUseRelease(database.beginNative(binding, { commandName: "read", ...coreNativeTestBudget() }),
    operation => Effect.gen(function* () {
      const rows = yield* operation.operations.find(table, id === undefined ? {} : { id });
      yield* operation.finishRead();
      return rows;
    }), operation => operation.abort());
  return { database, definition, binding, command, options, installed, table, begin, write, insert, read };
});

const failed = <A>(result: Result.Result<A, CoreError>) => Result.isFailure(result) ? result.failure : undefined;

export function registerNativeGeneratedSerialScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    it("allocates omitted and null values independently in batch order", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence);
      expect(yield* graph.insert([{ id: "one" }, { id: "two", ticket: null },
        { id: "explicit", ticket: 17, other: -10 }, { id: "four" }])).toMatchObject([
        { ticket: 1, other: 1 }, { ticket: 2, other: 2 }, { ticket: 17, other: -10 }, { ticket: 18, other: 3 },
      ]);
      expect(yield* graph.read("four")).toMatchObject([{ ticket: 18, other: 3 }]);
    })), 120_000);

    it("increments the signed maximum including a soft-deleted committed row", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence);
      yield* graph.insert([{ id: "low", ticket: -12, other: -2147483648 }, { id: "high", ticket: -10, other: -20 }]);
      yield* graph.write(operations => operations.lifecycle(graph.table, "softDelete", [{ id: "high" }]));
      expect(yield* graph.insert([{ id: "negative", other: null }])).toMatchObject([{ ticket: -9, other: -19 }]);
    })), 120_000);

    it("merges lowered, deleted, newly staged and soft-deleted pending maxima", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence), table = graph.table;
      yield* graph.insert([{ id: "first", ticket: 30, other: 31 }, { id: "second", ticket: 20, other: 21 },
        { id: "third", ticket: 10, other: 11 }]);
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.writeRows(table, "update", [{ id: "first", ticket: 1, other: 2 }]);
        yield* operations.deleteRows(table, [{ id: "second" }]);
        expect(yield* operations.writeRows(table, "insert", [{ id: "pending" }])).toMatchObject([{ ticket: 11, other: 12 }]);
        yield* operations.deleteRows(table, [{ id: "pending" }]);
        expect(yield* operations.writeRows(table, "insert", [{ id: "soft" }])).toMatchObject([{ ticket: 11, other: 12 }]);
        yield* operations.lifecycle(table, "softDelete", [{ id: "soft" }]);
        expect(yield* operations.writeRows(table, "insert", [{ id: "last" }])).toMatchObject([{ ticket: 12, other: 13 }]);
      }));
      expect((yield* graph.read()).map(row => row.id).toSorted()).toEqual(["first", "last", "soft", "third"]);
    })), 120_000);

    it("validates required fields before allocation, rolls back overflow and reuses the range after hard deletion", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence, true), table = graph.table;
      yield* graph.insert([{ id: "max", ticket: 2147483647, marker: "set" }]);
      const before = yield* graph.database.publishedTimestamp;
      const required = { reason: "documentValidation", cause: { reason: "missingColumn", column: "marker" } };
      const incomplete = { id: "incomplete", other: 0 };
      expect(failed(yield* Effect.result(graph.write(operations => operations.insert(table, incomplete))))).toMatchObject(required);
      expect(failed(yield* Effect.result(graph.write(operations => operations.writeRows(table, "upsert", [incomplete])))))
        .toMatchObject(required);
      expect(failed(yield* Effect.result(graph.write(operations => operations.writeRows(table, "insert", [
        { id: "would-overflow", marker: "set", other: 0 }, { ...incomplete, ticket: 4 },
      ], { insertValidation: "entityBatch" }))))).toMatchObject(required);
      expect(failed(yield* Effect.result(graph.insert([
        { id: "rolled-back", ticket: 3, other: 4, marker: "set" }, { id: "overflow", marker: "set" },
      ])))).toMatchObject({ reason: "capacity", cause: "Native generated serial exhausted" });
      expect(yield* graph.database.publishedTimestamp).toBe(before);
      expect(yield* graph.read()).toMatchObject([{ id: "max", ticket: 2147483647, other: 1 }]);
      yield* graph.write(operations => operations.deleteRows(table, [{ id: "max" }]));
      expect(yield* graph.insert([{ id: "reused", marker: "set" }])).toMatchObject([{ ticket: 1, other: 1 }]);
    })), 120_000);

    it("replays the same committed result after a cold reopen", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence);
      const identity: CoreRequestIdentity = { kind: "native", native: graph.command.identity,
        key: "neutral/generated-serial/once", requestHash: "neutral/generated-serial/input" };
      const acquired = yield* graph.database.claimRequest(identity, graph.binding);
      if (acquired.kind !== "claimed") return yield* Effect.die(new Error("Missing generated serial request claim"));
      const operation = yield* Effect.acquireRelease(graph.database.beginNative(graph.binding, {
        commandName: "write", claim: acquired.claim, ...coreNativeTestBudget(),
      }), value => value.abort());
      const rows = yield* operation.operations.writeRows(graph.table, "insert", [{ id: "once" }]);
      expect(rows).toMatchObject([{ ticket: 1, other: 1 }]);
      const timestamp = yield* graph.database.commit(yield* operation.finalize(), { claim: acquired.claim, result: rows });
      const outcome = { kind: "committed", timestamp, result: rows };
      expect(yield* graph.database.claimRequest(identity, graph.binding)).toEqual(outcome);
      yield* graph.database.close();
      const persistence = yield* Effect.tryPromise({
        try: () => fixture.reopen(),
        catch: cause => new CorePersistenceError({ reason: "unavailable", cause }),
      });
      const cold = yield* Effect.acquireRelease(openCoreDatabase(persistence, graph.options), database => database.close());
      const binding = yield* cold.bindNative({ definition: graph.definition, commands });
      expect(yield* cold.claimRequest(identity, binding)).toEqual(outcome);
      const next = yield* Effect.acquireRelease(cold.beginNative(binding, {
        commandName: "write", ...coreNativeTestBudget(),
      }), value => value.abort());
      expect(yield* next.operations.writeRows(graph.table, "insert", [{ id: "twice" }])).toMatchObject([{ ticket: 2, other: 2 }]);
      yield* cold.commit(yield* next.finalize());
    })), 120_000);

    for (const scenario of ["empty", "same maximum", "lower tail"] as const) {
      it(`settles overlapping generated reads when a competitor changes the ${scenario}`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture.persistence), table = graph.table;
        if (scenario !== "empty") yield* graph.insert([{ id: "low", ticket: 5, other: 6 }, { id: "max", ticket: 10, other: 11 }]);
        const held = yield* Effect.acquireRelease(graph.begin(), operation => operation.abort());
        const expected = scenario === "empty" ? { ticket: 1, other: 1 } : { ticket: 11, other: 12 };
        expect(yield* held.operations.writeRows(table, "insert", [{ id: "held" }])).toMatchObject([expected]);
        const finalized = yield* held.finalize();
        if (scenario === "lower tail")
          yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "low", ticket: 7, other: 8 }]));
        else expect(yield* graph.insert([{ id: "winner" }])).toMatchObject([expected]);
        const settled = yield* Effect.result(graph.database.commit(finalized));
        if (scenario === "lower tail") {
          expect(Result.isSuccess(settled)).toBe(true);
          expect(yield* graph.read("held")).toMatchObject([expected]);
        } else {
          expect(failed(settled)).toMatchObject({ reason: "conflict" });
          expect(yield* graph.read("held")).toEqual([]);
          expect(yield* graph.read("winner")).toMatchObject([expected]);
        }

        // Restore the original live maximum (or EOF), then keep the losing
        // operation open through its next allocation rather than finalizing it.
        yield* graph.write(operations => operations.deleteRows(table, [{ id: scenario === "lower tail" ? "held" : "winner" }]));
        const open = yield* Effect.acquireRelease(graph.begin(), operation => operation.abort());
        expect(yield* open.operations.writeRows(table, "insert", [{ id: "first" }])).toMatchObject([expected]);
        if (scenario === "lower tail") {
          yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "low", ticket: 9, other: 10 }]));
          expect(yield* open.operations.writeRows(table, "insert", [{ id: "second" }])).toMatchObject([{ ticket: 12, other: 13 }]);
          yield* graph.database.commit(yield* open.finalize());
          expect(yield* graph.read("second")).toMatchObject([{ ticket: 12, other: 13 }]);
        } else {
          yield* graph.insert([{ id: "explicit-upper", ticket: 100, other: 101 }]);
          expect(yield* Effect.result(open.operations.writeRows(table, "insert", [{ id: "second" }])))
            .toMatchObject({ _tag: "Failure", failure: { reason: "conflict" } });
          yield* open.abort();
          expect(yield* graph.read("first")).toEqual([]);
          expect(yield* graph.read("second")).toEqual([]);
          expect(yield* graph.read("explicit-upper")).toMatchObject([{ ticket: 100, other: 101 }]);
        }
      })), 120_000);
    }

    for (const movement of ["below the previous runner-up", "above a pending maximum"] as const) {
      it(`refuses a fresh allocation before returning a value when a remembered key moves ${movement}`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture.persistence), table = graph.table;
        yield* graph.insert([{ id: "remembered", ticket: 30, other: 31 }, { id: "runner-up", ticket: 20, other: 21 }]);
        const held = yield* Effect.acquireRelease(graph.begin(), operation => operation.abort());
        expect(yield* held.operations.find(table, { id: "remembered" })).toMatchObject([{ ticket: 30 }]);
        if (movement === "above a pending maximum")
          yield* held.operations.writeRows(table, "insert", [{ id: "pending", ticket: 35, other: 36 }]);
        const ticket = movement === "below the previous runner-up" ? 1 : 40;
        yield* graph.write(operations => operations.writeRows(table, "update", [{ id: "remembered", ticket }]));
        expect(failed(yield* Effect.result(held.operations.writeRows(table, "insert", [{ id: "refused" }]))))
          .toMatchObject({ reason: "conflict" });
        expect(yield* graph.read("refused")).toEqual([]);
      })), 120_000);
    }

    it("never incorporates a competitor into a previously complete empty table view", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture.persistence);
      const held = yield* Effect.acquireRelease(graph.begin(), operation => operation.abort());
      expect(yield* held.operations.find(graph.table, {})).toEqual([]);
      expect(yield* graph.insert([{ id: "competitor" }])).toMatchObject([{ ticket: 1, other: 1 }]);
      const allocation = yield* Effect.result(held.operations.writeRows(graph.table, "insert", [{ id: "held" }]));
      if (Result.isFailure(allocation)) expect(allocation.failure).toMatchObject({ reason: "conflict" });
      else {
        expect(allocation.success).toMatchObject([{ ticket: 1, other: 1 }]);
        expect(failed(yield* Effect.result(graph.database.commit(yield* held.finalize())))).toMatchObject({ reason: "conflict" });
      }
      expect(yield* graph.read("held")).toEqual([]);
    })), 120_000);

    it("consumes a bounded descending prefix over a larger tail and protects both backing names", run(fixture => Effect.gen(function* () {
      const observed: Array<Readonly<{ request: CoreIndexScan; page: CoreIndexPage }>> = [];
      const persistence: CorePersistence = { ...fixture.persistence, readSnapshot: (...args) =>
        fixture.persistence.readSnapshot(...args).pipe(Effect.map(snapshot => ({ ...snapshot, scan: request =>
          snapshot.scan(request).pipe(Effect.tap(page => Effect.sync(() => { observed.push({ request, page }); }))),
        }))) };
      const graph = yield* setup(persistence), table = graph.table;
      const backings = graph.installed.indexes.filter(index => /^s_[a-z0-9]{52}$/.test(index.name));
      expect(backings.map(index => index.fields).toSorted()).toEqual([["other"], ["ticket"]]);
      const seed = Array.from({ length: 24 }, (_, value) => ({ id: `tail-${value}`, ticket: value, other: value }));
      yield* graph.insert(seed);
      const held = yield* Effect.acquireRelease(graph.begin(3), operation => operation.abort());
      const cursor = held.operations.nativeActivityCursor();
      observed.length = 0;
      expect(yield* held.operations.writeRows(table, "insert", [{ id: "one", other: -20 }])).toMatchObject([{ ticket: 24, other: -20 }]);
      const allocatorScans = () => observed.filter(entry => backings.some(index => Buffer.from(index.ref.id).equals(entry.request.index.id)));
      expect(allocatorScans().map(({ request, page }) => ({ order: request.order, requested: request.maxResults, read: page.entries.length })))
        .toEqual([{ order: "desc", requested: 1, read: 1 }]);
      const activity = yield* held.operations.nativeActivitySince(cursor);
      expect(activity.observedRows.map(entry => entry.row.id)).toEqual(["one"]);
      expect(activity.mutations.map(entry => entry.operation)).toEqual(["insert"]);
      yield* graph.database.commit(yield* held.finalize());
      expect(yield* graph.read("one")).toMatchObject([{ ticket: 24, other: -20 }]);

      for (const backing of backings) {
        const read = yield* Effect.acquireRelease(graph.database.beginNative(graph.binding, {
          commandName: "read", ...coreNativeTestBudget(),
        }), operation => operation.abort());
        expect(failed(yield* Effect.result(read.operations.findPage(table, {}, {
          indexName: backing.name, offset: 0, limit: 1,
        })))).toMatchObject({ reason: "missingIndex" });
      }

      const masked = yield* Effect.acquireRelease(graph.begin(3), operation => operation.abort());
      yield* masked.operations.deleteRows(table, [{ id: "one" }, { id: "tail-23" }, { id: "tail-22" }]);
      observed.length = 0;
      expect(failed(yield* Effect.result(masked.operations.writeRows(table, "insert", [{ id: "masked", other: -20 }]))))
        .toMatchObject({ reason: "capacity", cause: "Native generated serial examined identity limit" });
      expect(allocatorScans().map(({ request, page }) => ({ order: request.order, requested: request.maxResults, read: page.entries.length })))
        .toEqual(Array.from({ length: 4 }, () => ({ order: "desc", requested: 1, read: 1 })));
      yield* masked.abort();
      expect(yield* graph.read("one")).toMatchObject([{ ticket: 24 }]);
      expect(yield* graph.read("masked")).toEqual([]);
    })), 120_000);
  });
}
