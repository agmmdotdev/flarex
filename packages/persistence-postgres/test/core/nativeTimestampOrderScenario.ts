import { randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { encodeDocumentId } from "flarex-protocol/document-id";
import type { CoreDatabaseOptions, CoreError, CoreNativeOperations } from "../../src/core/api";
import { openCoreDatabase } from "../../src/core/database";
import { coreNativeRelationalRows, makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { executeCoreNativeRelationalPage, executeCoreNativeRelationalRead, prepareCoreNativeRelationalRead } from "../../src/core/nativeRelationalQuery";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { createTransactionIdGenerator } from "../../src/core/transactionIdGenerator";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const origin = { kind: "synthetic", sourceId: "neutral-native-timestamp-order" } as const;
const target = { scopeUuid: "8a700000-0000-4000-8000-000000000001", epochUuid: "8a700000-0000-4000-8000-000000000002" };
const relational = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
  tables: [{ tableId: "record", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "occurred_at", type: "timestamptz", nullable: false, default: { kind: "none" }, origin },
    { columnId: "optional_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "record.primary", kind: "primary", columns: ["id"], origin }],
  indexes: [{ indexId: "record.occurred-at", kind: "btree", columns: ["occurred_at"], predicate: null, origin }],
  constraints: [], relationships: [] }], capabilities: [] }));

const setup = Effect.fn("NativeTimestampOrderTest.setup")(function* (fixture: CorePersistenceFixture) {
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-native-timestamp-order", owner: "medusa",
    writeProfile: "medusa.neutral-native-timestamp-order", evidence: { provenance: origin },
    definition: { kind: "relational", schema: relational }, bindings: [{ kind: "definition", localName: "record",
      table: { namespace: "medusa", logicalName: origin.sourceId + "/record" } }] });
  const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands: [] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  let latestSeed: Uint8Array | undefined;
  const options: CoreDatabaseOptions = { schemaBundles: [bundle], now: Effect.succeed(1_000_000_000n),
    randomBytes: length => Effect.sync(() => {
      const bytes = randomBytes(length);
      if (length === 32) latestSeed = bytes.slice();
      return bytes;
    }), schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS,
    maxBatchDelayMilliseconds: 0 };
  const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, options), db => db.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let active = false;
  for (let step = 0; step < 256; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); active = true; break;
    }
    if (status.state === "failed" || status.state === "overwritten")
      return yield* Effect.die(new Error("Timestamp order schema " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  if (!active) return yield* Effect.die(new Error("Timestamp order schema did not activate"));
  const binding = yield* database.bindNative({ definition, commands: [{ name: "write", mode: "write" }, { name: "read", mode: "read" }] });
  const metadata = yield* database.readNativeBinding(binding);
  const declaration = definition.tables[0], table = metadata.tables.find(candidate => candidate.name === declaration?.name);
  const policy = declaration === undefined ? undefined : coreNativeRelationalRows(definition, declaration.name);
  if (declaration === undefined || table === undefined || policy === undefined)
    return yield* Effect.die(new Error("Missing neutral timestamp table"));
  const use = Effect.fn("NativeTimestampOrderTest.use")(<A>(mode: "write" | "read", body: (operations: CoreNativeOperations) => Effect.Effect<A, CoreError>) =>
    Effect.acquireUseRelease(database.beginNative(binding, { commandName: mode, ...coreNativeTestBudget() }), operation => Effect.gen(function* () {
      const result = yield* body(operation.operations);
      if (mode === "write") yield* database.commit(yield* operation.finalize());
      else yield* operation.finishRead();
      return result;
    }), operation => operation.abort()));
  const prepare = (direction: "asc" | "desc", skip = 0, take = 32, column = "occurred_at") =>
    prepareCoreNativeRelationalRead(policy, { fields: ["id", "occurred_at"], skip, take, order: { column, direction } }, 32);
  const read = (direction: "asc" | "desc", skip = 0, take = 32) => use("read", operations => Effect.gen(function* () {
    const query = yield* Effect.fromResult(prepare(direction, skip, take));
    return yield* executeCoreNativeRelationalRead(operations, table, policy, query);
  }));
  return { table, declaration, policy, prepare, read, use, previewIds: (count: number) => {
    if (latestSeed === undefined) throw new Error("Timestamp test transaction has no ID seed");
    const generator = Result.getOrThrow(createTransactionIdGenerator(latestSeed, 1_000_000_000n));
    return Array.from({ length: count }, () => Result.getOrThrow(encodeDocumentId(table.number, generator.nextInternalId())));
  } };
});

export function registerNativeTimestampOrderScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    it("orders canonical instants and partitions duplicate timestamps by native primary identity in both directions", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      const tied = "2026-11-01T00:00:00.123Z";
      yield* graph.use("write", operations => Effect.gen(function* () {
        // Preview through the actual allocation owner, then choose native keys
        // opposite to the Core IDs before immutable identities are inserted.
        const preview = graph.previewIds(3);
        const nativeByInternal = new Map(preview.toSorted().map((id, position) => [id, ["tie-c", "tie-b", "tie-a"][position]]));
        const inserted = yield* operations.writeRows(graph.table.name, "insert", [
          ...preview.map(id => ({ id: nativeByInternal.get(id), occurred_at: tied })),
          { id: "future", occurred_at: "9999-12-31T23:59:59.999Z" },
          { id: "ancient", occurred_at: "0001-01-01T00:00:00.000Z" },
          { id: "fraction", occurred_at: "1970-01-01T00:00:00.001Z" },
          { id: "before", occurred_at: "1969-12-31T23:59:59.999Z" },
          { id: "zero", occurred_at: "1970-01-01T00:00:00.000Z" },
        ]);
        const duplicates: { id: string; native: unknown }[] = [];
        for (const row of inserted) if (row.occurred_at === tied) {
          if (typeof row._id !== "string") return yield* Effect.die(new Error("Missing inserted timestamp identity"));
          duplicates.push({ id: row._id, native: row.id });
        }
        expect(duplicates.map(row => row.id)).toEqual(preview);
        expect(duplicates.toSorted((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
          .map(row => row.native)).toEqual(["tie-c", "tie-b", "tie-a"]);
      }));
      for (const direction of ["asc", "desc"] as const) {
        const expected = direction === "asc"
          ? ["ancient", "before", "zero", "fraction", "tie-a", "tie-b", "tie-c", "future"]
          : ["future", "tie-a", "tie-b", "tie-c", "fraction", "zero", "before", "ancient"];
        const complete = yield* graph.read(direction);
        expect(complete.rows.map(row => row.id)).toEqual(expected);
        expect(complete).toMatchObject({ count: 8, returned: 8 });
        const adjacent: unknown[] = [];
        for (let skip = 0; skip < 8; skip += 2) {
          const page = yield* graph.read(direction, skip, 2);
          expect(page).toMatchObject({ count: 8, returned: 2 });
          adjacent.push(...page.rows);
        }
        expect(adjacent).toEqual(complete.rows);
        expect(yield* graph.read(direction, 8, 2)).toMatchObject({ rows: [], count: 8, returned: 0 });
      }
    })), 120_000);

    it("retains canonical millisecond transport and nullable and examined-page refusals", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture);
      // These remain invalid transport values, including extra precision.
      for (const occurred_at of ["2026-11-01T00:00:00Z", "2026-11-01T01:00:00.000+01:00",
        "2026-11-01T00:00:00.000001Z", "+010000-01-01T00:00:00.000Z", "0000-01-01T00:00:00.000Z"]) {
        expect(yield* Effect.result(graph.use("write", operations => operations.writeRows(graph.table.name, "insert", [{ id: "invalid", occurred_at }]))))
          .toMatchObject({ _tag: "Failure", failure: { reason: "documentValidation" } });
      }
      expect(graph.prepare("asc", 0, 2, "optional_at")).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(graph.table.indexes.some(index => index.fields[0] === "occurred_at")).toBe(true);
      yield* graph.use("read", operations => Effect.gen(function* () {
        const query = yield* Effect.fromResult(graph.prepare("asc", 0, 2));
        let pageReads = 0;
        const result = yield* Effect.result(executeCoreNativeRelationalPage({ findPage: (...args) => {
          pageReads++; return operations.findPage(...args);
        } }, graph.table, graph.declaration, graph.policy, query));
        expect(result).toMatchObject({ _tag: "Failure", failure: { reason: "invalidQuery" } });
        expect(pageReads).toBe(0);
      }));
    })), 120_000);
  });
}
