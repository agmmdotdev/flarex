import { randomBytes } from "node:crypto";
import { Deferred, Effect, Fiber, Option, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import type { CoreDatabaseOptions, CoreError, CoreNativeLimits, CoreNativeOperations } from "../../src/core/api";
import { CorePersistenceError, type CorePersistence, type CorePersistenceSnapshot, type CoreRetentionValidator } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { coreNativeRelationalRows, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { executeCoreNativeRelationalRead, prepareCoreNativeRelationalRead } from "../../src/core/nativeRelationalQuery";
import { makeCoreSchemaBundle, type CoreSchemaBundle } from "../../src/core/schemaBundle";
import { readCoreFixtureRegistry, type CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "5a900000-0000-4000-8000-000000000001", epochUuid: "5a900000-0000-4000-8000-000000000002" };
const origin = { kind: "synthetic", sourceId: "neutral-native-snapshot-pushdown" } as const;
const lifecycleOrigin = { kind: "implicit", sourceId: `${origin.sourceId}.lifecycle` } as const;

type Budget = Readonly<{ limits: CoreNativeLimits; remainingBytes: () => number; chargeRetained: (bytes: number) => Effect.Effect<void, CoreError> }>;
/** Counts and optionally intercepts the pushed statement and its retention checks. */
interface Probe {
  filters: number;
  afterFilter?: Effect.Effect<void>;
  retention?: (validations: number) => Effect.Effect<void, CorePersistenceError>;
  withoutFilter?: true;
}
function probed(inner: CorePersistence, probe: Probe): CorePersistence {
  return { ...inner, readSnapshot: (at, retention) => Effect.gen(function* () {
    let validations = 0;
    const base = retention ?? inner.retentionValidator;
    const counted: CoreRetentionValidator = { validateDocument: base.validateDocument,
      validateIndex: timestamp => Effect.andThen(base.validateIndex(timestamp), Effect.suspend(() => probe.retention?.(++validations) ?? Effect.void)) };
    const snapshot = yield* inner.readSnapshot(at, counted);
    const { filter, ...rest } = snapshot;
    if (filter === undefined || probe.withoutFilter === true) return rest;
    const wrapped: CorePersistenceSnapshot = { ...rest, filter: request => Effect.gen(function* () {
      probe.filters++;
      validations = 0;
      const page = yield* filter(request);
      if (probe.afterFilter !== undefined) yield* probe.afterFilter;
      return page;
    }) };
    return wrapped;
  }) };
}

export const setupSnapshotPushdown = Effect.fn("NativeSnapshotPushdownTest.setup")(function* (fixture: CorePersistenceFixture,
  input: Readonly<{ probe?: Probe; protectedMetadata?: true; options?: Partial<CoreDatabaseOptions> }> = {}) {
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: [{ tableId: "entry", origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "rank", type: "text", nullable: false, default: { kind: "none" }, origin },
      { columnId: "title", type: "text", nullable: true, default: { kind: "none" }, origin },
      { columnId: "flag", type: "boolean", nullable: true, default: { kind: "none" }, origin },
      { columnId: "qty", type: "integer", nullable: true, default: { kind: "none" }, origin },
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz" as const, nullable: false,
        default: { kind: "currentTimestamp" as const }, origin: lifecycleOrigin })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycleOrigin },
    ], keys: [{ keyId: "entry.primary", kind: "primary", columns: ["id"], origin }], indexes: [
      { indexId: "entry.rank", kind: "btree", columns: ["rank"], predicate: null, origin },
      { indexId: "entry.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycleOrigin },
    ], constraints: [], relationships: [] }], capabilities: [
      { capabilityId: "entry.timestamps", kind: "managedTimestamps", createdAtColumn: { tableId: "entry", columnId: "created_at" },
        updatedAtColumn: { tableId: "entry", columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycleOrigin },
      { capabilityId: "entry.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "entry", columnId: "deleted_at" },
        activeRowsIndex: { tableId: "entry", indexId: "entry.active" }, origin: lifecycleOrigin },
    ] }));
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-snapshot-pushdown", owner: "medusa",
    writeProfile: "medusa.neutral-native-snapshot-pushdown", evidence: { provenance: origin }, definition: { kind: "relational", schema },
    bindings: [{ kind: "definition", localName: "entry", table: { namespace: "medusa", logicalName: `${origin.sourceId}/entry` } }] });
  const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const withdrawn = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }],
    nativeBindings: [{ sourceKey: definition.source.key, selected: false }] });
  const persistence = input.probe === undefined ? fixture.persistence : probed(fixture.persistence, input.probe);
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, { schemaBundles: [bundle, withdrawn],
    now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0, ...input.options }), value => value.close());
  const activate = Effect.fn("NativeSnapshotPushdownTest.activate")(function* (selected: CoreSchemaBundle) {
    const proposal = yield* database.prepareSchema({ bundle: selected });
    for (let step = 0; step < 256; step++) {
      const status = yield* database.schemaStatus(proposal);
      if ((status.state === "validated" || status.state === "active") && status.indexesReady)
        return yield* database.activateSchema(proposal, { programs: [], bundle: selected });
      if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Neutral snapshot pushdown schema " + status.state));
      yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
    }
    return yield* Effect.die(new Error("Neutral snapshot pushdown schema did not activate"));
  });
  yield* activate(bundle);
  const writeBinding = yield* database.bindNative({ definition, commands: [{ name: "pushdown-write", mode: "write" }] });
  const binding = yield* database.bindNative({ definition, commands: [{ name: "pushdown-read", mode: "read" }],
    ...(input.protectedMetadata === true ? { protectedMetadata: true } : {}) });
  const metadata = yield* database.readNativeBinding(binding);
  const declaration = definition.tables.find(candidate => candidate.localName === "entry");
  const table = metadata.tables.find(candidate => candidate.name === declaration?.name);
  const policy = declaration === undefined ? undefined : coreNativeRelationalRows(definition, declaration.name);
  if (declaration === undefined || table === undefined || policy === undefined) return yield* Effect.die(new Error("Missing installed neutral snapshot pushdown table"));
  const begin = (mode: "read" | "write", budget: Budget = coreNativeTestBudget()) =>
    database.beginNative(mode === "write" ? writeBinding : binding, { commandName: `pushdown-${mode}`, ...budget });
  const write = Effect.fn("NativeSnapshotPushdownTest.write")(<Value>(body: (operations: CoreNativeOperations) => Effect.Effect<Value, CoreError>) =>
    Effect.acquireUseRelease(begin("write"), operation => Effect.gen(function* () {
      const value = yield* body(operation.operations); yield* database.commit(yield* operation.finalize()); return value;
    }), operation => operation.abort()));
  /** `pushed` hands the read to PostgreSQL where the operation admits it; otherwise the complete captured path runs. */
  const select = (operations: CoreNativeOperations, input: JsonObject, path: "pushed" | "complete", purpose: "rows" | "count" = "rows") =>
    Effect.gen(function* () {
      const query = yield* Effect.fromResult(prepareCoreNativeRelationalRead(policy, input, 256));
      return yield* executeCoreNativeRelationalRead(operations, table, policy, query, purpose,
        path === "pushed" ? Option.some(operations.filterSnapshot) : Option.none());
    });
  const reading = <Value>(body: (operations: CoreNativeOperations) => Effect.Effect<Value, CoreError>, budget: Budget = coreNativeTestBudget()) =>
    Effect.acquireUseRelease(begin("read", budget), operation => Effect.gen(function* () {
      const value = yield* body(operation.operations); yield* operation.finishRead(); return value;
    }), operation => operation.abort());
  return { database, definition, declaration, bundle, withdrawn, binding, writeBinding, table, policy, begin, write, select, reading, activate };
});
type Graph = Effect.Success<ReturnType<typeof setupSnapshotPushdown>>;

const TITLES = ["abc", "ABC", "aXc", "a_c", "a%c", "back\\slash", "", "Ångström", "ÅNGSTRÖM", "ångström", "straße", "İstanbul",
  "💵 note", "é", "é", "Kelvin", "kelvin", "မြန်မာ", "x", "💵", null, null];
// Shared and prefix-related ranks force the identity tie-break; two exceed the physical key prefix.
const longRank = (tail: string) => "L".repeat(2600) + tail;
const RANKS = ["a", "a", "a", "ab", "b", "B", "é", "é", "💵", "z", "", longRank("a"), longRank("b"), longRank("a")];
const seedRow = (ordinal: number): JsonObject => ({ id: `row-${String(ordinal).padStart(3, "0")}`, rank: RANKS[(ordinal * 5) % RANKS.length] ?? "",
  title: TITLES[ordinal % TITLES.length] ?? null, flag: ordinal % 3 === 0 ? true : ordinal % 3 === 1 ? false : null, qty: ordinal % 4 === 0 ? null : ordinal % 5 });
const active = (predicate: JsonObject): JsonObject => ({ kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, predicate] });
const like = (pattern: string, column = "title"): JsonObject => ({ kind: "textLikeAscii", column, pattern });
const PREDICATES: readonly JsonObject[] = [
  { kind: "and", children: [] },
  ...["%a%", "%A%", "a_c", "a\\_c", "%å%", "%Å%", "%é%", "_", "__", "%", "", "%💵%", "k%", "%ß%", "%မြန်%"].map(pattern => like(pattern)),
  { kind: "or", children: [like("%row-00%", "id"), like("%ABC%")] },
  { kind: "in", column: "flag", values: [true] }, { kind: "in", column: "flag", values: [false, true] },
  { kind: "isNull", column: "title" }, { kind: "isNull", column: "flag" },
  { kind: "textNotEqual", column: "title", value: "abc" },
  { kind: "greaterThan", column: "title", value: "a" },
  { kind: "or", children: [like("%a%"), { kind: "isNull", column: "title" }] },
  { kind: "and", children: [like("%a%"), { kind: "in", column: "flag", values: [true] }] },
  like("%zzz-none%"),
];
const WINDOWS: readonly JsonObject[] = [{}, { take: 0 }, { take: 3 }, { skip: 2, take: 5 }, { skip: 500, take: 4 }];
const ORDERS = [{ column: "rank", direction: "asc" }, { column: "rank", direction: "desc" }, { column: "id", direction: "asc" },
  { column: "id", direction: "desc" }, { column: "created_at", direction: "asc" }] as const;

/** Every statement charges its examined entries and returned bodies again, so
 * the comparison gives each order its own operation and a wide caller budget. */
function wideBudget(): Budget {
  let retained = 0;
  return { limits: { maxIdentities: 256, maxDocumentBytes: 65_536 }, remainingBytes: () => Math.max(0, 268_435_456 - retained),
    chargeRetained: (bytes: number) => Effect.sync(() => { retained += bytes; }) };
}

/** The two paths over one operation: equal rows, order, count and window, with the statement actually used. */
const compare = Effect.fnUntraced(function* (graph: Graph, operations: CoreNativeOperations, probe: Probe, label: string,
  order: typeof ORDERS[number]) {
  for (const predicate of PREDICATES) for (const window of WINDOWS) {
    const input: JsonObject = { fields: ["id", "rank", "title"], order, ...window, predicate: active(predicate) };
    const before = probe.filters;
    const pushed = yield* graph.select(operations, input, "pushed");
    // `created_at` has no complete single-field index here, so that order keeps the complete path.
    expect(probe.filters - before, `${label} ${JSON.stringify(input)}`).toBe(order.column === "created_at" ? 0 : 1);
    expect(pushed, `${label} ${JSON.stringify(input)}`).toEqual(yield* graph.select(operations, input, "complete"));
  }
  for (const predicate of PREDICATES) {
    const input: JsonObject = { fields: ["id"], order, skip: 1, take: 2, predicate: active(predicate) };
    expect(yield* graph.select(operations, input, "pushed", "count"), `${label} count ${JSON.stringify(predicate)}`)
      .toEqual(yield* graph.select(operations, input, "complete", "count"));
  }
});

const failure = <Value>(result: Result.Result<Value, CoreError>) => Result.isFailure(result) ? result.failure : undefined;
const search: JsonObject = { fields: ["id"], order: { column: "id", direction: "asc" }, take: 20, predicate: active(like("%a%")) };

export function registerNativeSnapshotPushdownScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    it("agrees with the complete read on match set, order, tie-break, count and window, at the current and an earlier snapshot", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe });
      const rows = Array.from({ length: 66 }, (_, ordinal) => seedRow(ordinal));
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", rows.slice(0, 40)));
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", rows.slice(40)));
      yield* graph.write(operations => operations.lifecycle(graph.table.name, "softDelete", ["row-003", "row-020", "row-041"]));
      const held = yield* Effect.forEach(ORDERS, () => Effect.acquireRelease(graph.begin("read", wideBudget()), operation => operation.abort()));
      yield* Effect.acquireUseRelease(graph.begin("read"), earlier => Effect.gen(function* () {
        // Later commits move rows between ranks, rewrite titles and remove rows; the earlier operations keep their snapshot.
        yield* graph.write(operations => operations.writeRows(graph.table.name, "update", [
          { id: "row-001", rank: "moved", title: "Revised ABC" }, { id: "row-010", rank: "", title: null }, { id: "row-030", title: "ångström" },
        ]));
        yield* graph.write(operations => operations.deleteRows(graph.table.name, ["row-002", "row-011", "row-050"]));
        yield* graph.write(operations => operations.lifecycle(graph.table.name, "softDelete", ["row-004"]));
        yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [{ ...seedRow(70), title: "late abc" }]));
        for (const [position, order] of ORDERS.entries()) {
          yield* graph.reading(operations => compare(graph, operations, probe, "current", order), wideBudget());
          const operation = held[position];
          if (operation === undefined) return yield* Effect.die(new Error("Missing held operation"));
          yield* compare(graph, operation.operations, probe, "earlier", order);
          yield* operation.finishRead();
        }
        const all: JsonObject = { fields: ["id"], order: { column: "id", direction: "asc" }, predicate: active({ kind: "and", children: [] }) };
        const then = yield* graph.select(earlier.operations, all, "pushed"), now = yield* graph.reading(operations => graph.select(operations, all, "pushed"));
        expect(then.count).toBe(63);
        expect(now.count).toBe(60);
        expect(then.rows).toContainEqual({ id: "row-002" });
        expect(now.rows).not.toContainEqual({ id: "row-002" });
        expect(now.rows).toContainEqual({ id: "row-070" });
        yield* earlier.finishRead();
      }), operation => operation.abort());
    })), 600_000);

    it("returns an empty window and a zero count for an empty table", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe });
      expect(yield* graph.reading(operations => graph.select(operations, search, "pushed"))).toEqual({ rows: [], count: 0, returned: 0 });
      expect(yield* graph.reading(operations => graph.select(operations, search, "pushed", "count"))).toEqual({ rows: [], count: 0, returned: 0 });
      expect(probe.filters).toBe(2);
    })), 120_000);

    it("keeps a write-mode operation, an unproven leaf, an indexed selection and a snapshot without an evaluator on the complete read", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", Array.from({ length: 12 }, (_, ordinal) => seedRow(ordinal))));
      yield* Effect.acquireUseRelease(graph.begin("write"), operation => Effect.gen(function* () {
        yield* operation.operations.writeRows(graph.table.name, "insert", [{ ...seedRow(90), title: "pending abc" }]);
        const selected = yield* graph.select(operation.operations, search, "pushed");
        expect(selected.rows).toContainEqual({ id: "row-090" });
        expect(selected).toEqual(yield* graph.select(operation.operations, search, "complete"));
      }), operation => operation.abort());
      expect(probe.filters).toBe(0);
      yield* graph.reading(operations => Effect.gen(function* () {
        for (const predicate of [
          { kind: "postgresText", column: "title", operator: "regex", value: "^a" }, { kind: "numberIn", column: "qty", values: [1, 2] },
          { kind: "in", column: "id", values: ["row-001", "row-005"] },
        ] satisfies JsonObject[]) {
          const input = { ...search, predicate: active(predicate) };
          const selected = yield* graph.select(operations, input, "pushed");
          expect(selected.count, JSON.stringify(predicate)).toBeGreaterThan(0);
          expect(selected, JSON.stringify(predicate)).toEqual(yield* graph.select(operations, input, "complete"));
        }
        expect(probe.filters).toBe(0);
        const pushed = yield* graph.select(operations, search, "pushed");
        expect(probe.filters).toBe(1);
        probe.withoutFilter = true;
        return pushed;
      }));
      const fallback = yield* graph.reading(operations => graph.select(operations, search, "pushed"));
      expect(probe.filters).toBe(1);
      expect(fallback.count).toBeGreaterThan(0);
      expect(fallback).toEqual(yield* graph.reading(operations => graph.select(operations, search, "complete")));
    })), 240_000);

    it("admits each statement against the fixed Source read limit, charges only returned rows, and leaves the rest to the complete path", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe, options: { transactionLimits: { documentsRead: 30 } } });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", Array.from({ length: 30 }, (_, ordinal) => seedRow(ordinal))));
      const all = { ...search, predicate: active({ kind: "and", children: [] }) };
      // Thirty examined documents are admitted by every statement; twenty returned rows are charged once.
      const served = yield* graph.reading(operations => Effect.gen(function* () {
        const rows = yield* graph.select(operations, all, "pushed");
        return { rows, counted: yield* graph.select(operations, all, "pushed", "count"), again: yield* graph.select(operations, { ...all, take: 10 }, "pushed", "rows") };
      }));
      expect(probe.filters).toBe(3);
      expect({ rows: served.rows.rows.length, count: served.counted.count, again: served.again.rows.length }).toEqual({ rows: 20, count: 30, again: 10 });
      // A window the remaining budget cannot take is not refused here: the complete read decides, and exhausts the budget itself.
      expect(failure(yield* Effect.result(graph.reading(operations => Effect.andThen(graph.select(operations, all, "pushed"),
        graph.select(operations, all, "pushed")))))).toMatchObject({ _tag: "CoreTransactionError", reason: "capacity", cause: { budget: "documentsRead" } });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [seedRow(30)]));
      for (const path of ["pushed", "complete"] as const)
        expect(failure(yield* Effect.result(graph.reading(operations => graph.select(operations, { ...all, take: 1 }, path)))), path)
          .toMatchObject({ _tag: "CoreTransactionError", reason: "capacity", cause: { budget: "documentsRead" } });
    })), 240_000);

    it("never spends more of the operation's Source budget than the complete read: forty documents, thirty-six live, eight active", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe, options: { transactionLimits: { documentsRead: 40 } } });
      const rows = Array.from({ length: 36 }, (_, ordinal) => seedRow(ordinal));
      for (let start = 8; start < 36; start += 7) {
        const batch = rows.slice(start, start + 7);
        yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", batch));
        yield* graph.write(operations => operations.lifecycle(graph.table.name, "softDelete", batch.map(row => String(row.id))));
      }
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", rows.slice(0, 8)));
      const all = { ...search, predicate: active({ kind: "and", children: [] }) };
      const both = (path: "pushed" | "complete") => graph.reading(operations => Effect.gen(function* () {
        const selected = yield* graph.select(operations, all, path);
        return { selected, counted: yield* graph.select(operations, all, path, "count") };
      }));
      const complete = yield* both("complete");
      expect(complete.counted.count).toBe(8);
      const pushed = yield* both("pushed");
      expect(probe.filters).toBe(2);
      expect(pushed).toEqual(complete);
    })), 240_000);

    it("serves live rows whose order key changed more often than the examined budget, because tombstones are not examined", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe, options: { transactionLimits: { documentsRead: 12 } } });
      const rows = Array.from({ length: 6 }, (_, ordinal) => seedRow(ordinal));
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", rows));
      // Five rewrites of every rank leave thirty tombstoned keys beside six live ones.
      for (let round = 0; round < 5; round++) yield* graph.write(operations => operations.writeRows(graph.table.name, "update",
        rows.map(row => ({ id: row.id ?? "", rank: `round-${round}-${String(row.id)}` }))));
      const input = { ...search, order: { column: "rank", direction: "asc" }, predicate: active(like("%a%")) };
      const pushed = yield* graph.reading(operations => graph.select(operations, input, "pushed"));
      expect(probe.filters).toBe(1);
      expect(pushed.count).toBeGreaterThan(0);
      expect(pushed).toEqual(yield* graph.reading(operations => graph.select(operations, input, "complete")));
    })), 240_000);

    it("leaves a table of mostly soft-deleted rows to the complete read's null-anchored cohort when the statement is over budget", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe, options: { transactionLimits: { documentsRead: 20 } } });
      const rows = Array.from({ length: 36 }, (_, ordinal) => seedRow(ordinal));
      // Small batches keep each write inside the same narrowed Source budget.
      for (let start = 8; start < 36; start += 7) {
        const batch = rows.slice(start, start + 7);
        yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", batch));
        yield* graph.write(operations => operations.lifecycle(graph.table.name, "softDelete", batch.map(row => String(row.id))));
      }
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", rows.slice(0, 8)));
      // Thirty-six live documents exceed twenty; the eight active ones do not.
      const complete = yield* graph.reading(operations => graph.select(operations, search, "complete"));
      expect(complete.count).toBeGreaterThan(0);
      const pushed = yield* graph.reading(operations => graph.select(operations, search, "pushed"));
      expect(probe.filters).toBe(1);
      expect(pushed).toEqual(complete);
      expect(yield* graph.reading(operations => graph.select(operations, search, "pushed", "count"))).toEqual(
        yield* graph.reading(operations => graph.select(operations, search, "complete", "count")));
      expect(probe.filters).toBe(2);
    })), 240_000);

    it("offers the statement to a read-mode operation that still cannot write", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [seedRow(0)]));
      yield* Effect.acquireUseRelease(graph.begin("read"), operation => Effect.gen(function* () {
        expect((yield* graph.select(operation.operations, search, "pushed")).count).toBe(1);
        expect(probe.filters).toBe(1);
        expect(failure(yield* Effect.result(operation.operations.writeRows(graph.table.name, "insert", [seedRow(1)]))))
          .toMatchObject({ _tag: "CoreTransactionError", reason: "readonly" });
        expect(failure(yield* Effect.result(operation.operations.deleteRows(graph.table.name, ["row-000"]))))
          .toMatchObject({ _tag: "CoreTransactionError", reason: "readonly" });
        expect((yield* graph.select(operation.operations, search, "pushed")).count).toBe(1);
        yield* operation.finishRead();
      }), operation => operation.abort());
    })), 120_000);

    it("charges returned documents to the native identity and retained-byte budgets", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", Array.from({ length: 12 }, (_, ordinal) => seedRow(ordinal))));
      const all = { ...search, predicate: active({ kind: "and", children: [] }) };
      const narrow = { ...coreNativeTestBudget(), limits: { maxIdentities: 5, maxDocumentBytes: 65_536 } };
      expect((yield* graph.reading(operations => graph.select(operations, { ...all, take: 5 }, "pushed"), narrow)).rows).toHaveLength(5);
      expect(failure(yield* Effect.result(graph.reading(operations => graph.select(operations, { ...all, take: 6 }, "pushed"), narrow))))
        .toMatchObject({ _tag: "CoreTransactionError", reason: "capacity" });
      // A default window wider than the budget is no refusal while the matching rows fit it.
      const unwindowed: JsonObject = { fields: ["id"], order: { column: "id", direction: "asc" }, predicate: active({ kind: "and", children: [] }) };
      expect((yield* graph.reading(operations => graph.select(operations,
        { ...unwindowed, predicate: active({ kind: "in", column: "flag", values: [true] }) }, "pushed"), narrow)).rows).toHaveLength(4);
      expect(failure(yield* Effect.result(graph.reading(operations => graph.select(operations, unwindowed, "pushed"), narrow))))
        .toMatchObject({ _tag: "CoreTransactionError", reason: "capacity" });
      // A second window of new identities exceeds the same request's identity budget.
      expect(failure(yield* Effect.result(graph.reading(operations => Effect.andThen(graph.select(operations, { ...all, take: 5 }, "pushed"),
        graph.select(operations, { ...all, skip: 5, take: 5 }, "pushed")), narrow)))).toMatchObject({ _tag: "CoreTransactionError", reason: "capacity" });
      const small = { ...coreNativeTestBudget(), limits: { maxIdentities: 256, maxDocumentBytes: 64 } };
      expect(failure(yield* Effect.result(graph.reading(operations => graph.select(operations, { ...all, take: 1 }, "pushed"), small))))
        .toMatchObject({ _tag: "CoreTransactionError", reason: "capacity" });
      // No returned document: the count needs neither budget.
      expect((yield* graph.reading(operations => graph.select(operations, all, "pushed", "count"), small)).count).toBe(12);
    })), 240_000);

    it("withholds a successful statement when retention advances before its release", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", Array.from({ length: 6 }, (_, ordinal) => seedRow(ordinal))));
      expect((yield* graph.reading(operations => graph.select(operations, search, "pushed"))).count).toBeGreaterThan(0);
      // The first validation of a statement precedes its SQL; the second follows it.
      const seen: number[] = [];
      probe.retention = validations => { seen.push(validations);
        return validations === 2 ? Effect.fail(new CorePersistenceError({ reason: "outOfRetention" })) : Effect.void; };
      expect(failure(yield* Effect.result(graph.reading(operations => graph.select(operations, search, "pushed")))))
        .toMatchObject({ _tag: "CorePersistenceError", reason: "outOfRetention" });
      expect(probe.filters).toBe(2);
      expect(seen.slice(-2)).toEqual([1, 2]);
    })), 120_000);

    for (const metadata of ["complete", "selective"] as const) {
      it(`refuses persisted source withdrawal before the statement with ${metadata} metadata`, run(fixture => Effect.gen(function* () {
        const probe: Probe = { filters: 0 };
        const graph = yield* setupSnapshotPushdown(fixture, { probe, ...(metadata === "selective" ? { protectedMetadata: true } : {}) });
        yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [seedRow(0), seedRow(1)]));
        yield* Effect.acquireUseRelease(graph.begin("read"), operation => Effect.gen(function* () {
          expect((yield* graph.select(operation.operations, search, "pushed")).count).toBe(2);
          yield* graph.activate(graph.withdrawn);
          const persisted = yield* readCoreFixtureRegistry(fixture, yield* graph.database.publishedTimestamp);
          expect(persisted.table(graph.table.name)?.definition.nativePolicy?.bindingSelected).toBe(false);
          expect(failure(yield* Effect.result(graph.select(operation.operations, search, "pushed")))).toMatchObject({ reason: "authorityRevoked" });
          expect(probe.filters).toBe(1);
        }), operation => operation.abort());
      })), 120_000);

      it(`withholds a successful statement after persisted source withdrawal with ${metadata} metadata`, run(fixture => Effect.gen(function* () {
        const evaluated = yield* Deferred.make<void>(), release = yield* Deferred.make<void>();
        const probe: Probe = { filters: 0 };
        const graph = yield* setupSnapshotPushdown(fixture, { probe, ...(metadata === "selective" ? { protectedMetadata: true } : {}) });
        yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [seedRow(0), seedRow(1)]));
        yield* Effect.acquireUseRelease(graph.begin("read"), operation => Effect.gen(function* () {
          probe.afterFilter = Effect.andThen(Deferred.succeed(evaluated, undefined), Deferred.await(release));
          yield* Effect.gen(function* () {
            const reading = yield* Effect.forkChild(Effect.result(graph.select(operation.operations, search, "pushed")));
            yield* Deferred.await(evaluated);
            yield* graph.activate(graph.withdrawn);
            yield* Deferred.succeed(release, undefined);
            expect(failure(yield* Fiber.join(reading))).toMatchObject({ reason: "authorityRevoked" });
            expect(probe.filters).toBe(1);
          }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout("30 seconds"));
        }), operation => operation.abort());
      })), 120_000);
    }

    it("fails a corrupt returned row exactly as the complete read does, and no longer inspects a row it does not return", run(fixture => Effect.gen(function* () {
      const probe: Probe = { filters: 0 };
      const graph = yield* setupSnapshotPushdown(fixture, { probe });
      yield* graph.write(operations => operations.writeRows(graph.table.name, "insert", [
        { ...seedRow(0), id: "row-a", title: "abc" }, { ...seedRow(1), id: "row-b", title: "corrupt-me abc" }, { ...seedRow(2), id: "row-c", title: "abc" },
      ]));
      // The stored body now carries a column the relational row contract does not admit.
      const changed = yield* Effect.promise(() => fixture.query(`UPDATE "${fixture.namespace}".documents
        SET json_value = convert_to(replace(convert_from(json_value, 'UTF8'), '"title":"corrupt-me abc"', '"title":"corrupt-me abc","unknown":1'), 'UTF8')
        WHERE convert_from(json_value, 'UTF8') LIKE '%corrupt-me%' RETURNING 1`));
      expect(changed).toHaveLength(1);
      const fresh = yield* setupSnapshotPushdown(fixture, { probe });
      const complete = failure(yield* Effect.result(fresh.reading(operations => fresh.select(operations, search, "complete"))));
      expect(complete).toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
      const pushed = failure(yield* Effect.result(fresh.reading(operations => fresh.select(operations, search, "pushed"))));
      expect(pushed).toMatchObject({ _tag: complete?._tag, reason: "corruptData" });
      // The approved change: a window or count that does not return the row no longer reads its body in JavaScript.
      expect(yield* fresh.reading(operations => fresh.select(operations, { ...search, take: 1 }, "pushed"))).toEqual({ rows: [{ id: "row-a" }], count: 3, returned: 1 });
      expect((yield* fresh.reading(operations => fresh.select(operations, search, "pushed", "count"))).count).toBe(3);
      expect(failure(yield* Effect.result(fresh.reading(operations => fresh.select(operations, { ...search, take: 1 }, "complete")))))
        .toMatchObject({ _tag: "CorePersistenceError", reason: "corruptData" });
    })), 240_000);
  });
}
