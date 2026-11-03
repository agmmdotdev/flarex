import { randomBytes } from "node:crypto";
import { Deferred, Effect, Exit, Fiber, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { DocumentObject } from "flarex-protocol/document-value";
import type { Json, JsonObject } from "flarex-protocol/json";
import type { CoreError, CoreNativeOperations } from "../../src/core/api";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { coreNativeRelationalRow } from "../../src/core/nativeRelationalQuery";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import type { CorePersistenceFixture } from "./fixture";
import { readCoreNativeFixtureInventory } from "./nativeFixtureInventory";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const created = "2020-01-02T03:04:05.000Z", updated = "2021-02-03T04:05:06.000Z";
const deleted = "2022-03-04T05:06:07.000Z";
const origin = { kind: "synthetic", sourceId: "neutral-same-root-reconstitution" } as const;
const lifecycle = { kind: "implicit", sourceId: `${origin.sourceId}.lifecycle` } as const;
const names = ["parent", "child", "sibling"] as const;

const setup = Effect.fn("NativeReconstitutionTest.setup")(function* (fixture: CorePersistenceFixture) {
  const schema = yield* Effect.fromResult(normalizeRelationalSchema({ owner: "medusa", lineageId: origin.sourceId,
    tables: names.map(tableId => ({ tableId, origin, columns: [
      { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
      ...(tableId === "parent" ? [] : [
        { columnId: "parent_id", type: "text", nullable: false, default: { kind: "none" }, origin },
        { columnId: "value", type: "text", nullable: false, default: { kind: "none" }, origin },
      ]),
      ...["created_at", "updated_at"].map(columnId => ({ columnId, type: "timestamptz", nullable: false,
        default: { kind: "currentTimestamp" }, origin: lifecycle })),
      { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: lifecycle },
    ], keys: [{ keyId: `${tableId}.primary`, kind: "primary", columns: ["id"], origin },
      ...(tableId === "parent" ? [] : [{ keyId: `${tableId}.value.unique`, kind: "unique", columns: ["value"], origin }])],
    indexes: [{ indexId: `${tableId}.active`, kind: "btree", columns: ["deleted_at"],
      predicate: { kind: "isNull", columnId: "deleted_at" }, origin: lifecycle }],
    constraints: tableId === "parent" ? [] : [{ constraintId: `${tableId}.parent`, kind: "foreignKey", sourceColumns: ["parent_id"],
      targetColumns: [{ tableId: "parent", columnId: "id" }], onDelete: "noAction", onUpdate: "noAction", origin }], relationships: [],
    })), capabilities: names.flatMap(tableId => [
      { capabilityId: `${tableId}.timestamps`, kind: "managedTimestamps", createdAtColumn: { tableId, columnId: "created_at" },
        updatedAtColumn: { tableId, columnId: "updated_at" }, updateBehavior: "currentTimestampOnUpdate", origin: lifecycle },
      { capabilityId: `${tableId}.lifecycle`, kind: "softDelete", deletedAtColumn: { tableId, columnId: "deleted_at" },
        activeRowsIndex: { tableId, indexId: `${tableId}.active` }, origin: lifecycle },
    ]) }));
  const source = yield* captureLogicalSchemaSource({ key: "medusa.neutral-same-root-reconstitution", owner: "medusa",
    writeProfile: "medusa.neutral-same-root-reconstitution", evidence: { provenance: origin }, definition: { kind: "relational", schema },
    bindings: schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
      table: { namespace: "medusa", logicalName: `${origin.sourceId}/${table.identity.tableId}` } })) });
  const definition = yield* makeCoreRelationalNativeDefinition({ scopeUuid: "23000000-0000-4000-8000-000000000001",
    epochUuid: "23000000-0000-4000-8000-000000000002", source, provenance: origin, commands: [] });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const database = yield* Effect.acquireRelease(openCoreDatabase(fixture.persistence, { schemaBundles: [bundle],
    now: Effect.succeed(1_793_577_600_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 }), value => value.close());
  const proposal = yield* database.prepareSchema({ bundle });
  let active = false;
  for (let step = 0; step < 256; step++) {
    const status = yield* database.schemaStatus(proposal);
    if ((status.state === "validated" || status.state === "active") && status.indexesReady) {
      yield* database.activateSchema(proposal, { programs: [], bundle }); active = true; break;
    }
    if (status.state === "failed" || status.state === "overwritten")
      return yield* Effect.die(new Error("Reconstitution fixture schema " + status.state));
    yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
  }
  if (!active) return yield* Effect.die(new Error("Reconstitution fixture schema did not activate"));
  const table = (name: typeof names[number]) => {
    const found = definition.tables.find(candidate => candidate.localName === name);
    if (found === undefined) throw new Error("Missing actual reconstitution table " + name);
    return found.name;
  };
  const commands = [{ name: "reconstitution-write", mode: "write" }, { name: "reconstitution-read", mode: "read" }] as const;
  const begin = Effect.fn("NativeReconstitutionTest.begin")(function* (mode: "read" | "write" = "write", budget = coreNativeTestBudget()) {
    const binding = yield* database.bindNative({ definition, commands });
    return yield* database.beginNative(binding, { commandName: mode === "write" ? "reconstitution-write" : "reconstitution-read", ...budget });
  });
  const write = Effect.fn("NativeReconstitutionTest.write")(<Value>(body: (operations: CoreNativeOperations, unixTime: number) => Effect.Effect<Value, CoreError>) =>
    Effect.acquireUseRelease(begin(), operation => Effect.gen(function* () {
      const value = yield* body(operation.operations, operation.unixTime);
      yield* database.commit(yield* operation.finalize()); return value;
    }), operation => operation.abort()));
  const read = Effect.fn("NativeReconstitutionTest.read")((name: typeof names[number]) =>
    Effect.acquireUseRelease(begin("read"), operation => Effect.gen(function* () {
      const documents = yield* operation.operations.find(table(name), {}); yield* operation.finishRead(); return documents;
    }), operation => operation.abort()));
  return { database, table, begin, write, read };
});

const nativeRows = Effect.fn("NativeReconstitutionTest.nativeRows")((documents: readonly DocumentObject[]) =>
  Effect.forEach(documents, document => Effect.fromResult(coreNativeRelationalRow(document))));
const parentRow = (id = "owner") => ({ id, created_at: created, updated_at: updated, deleted_at: null });
const childRow = (id = "original", value = "first", parent_id = "owner") => ({ id, parent_id, value,
  created_at: created, updated_at: updated, deleted_at: null });
const seed = Effect.fn("NativeReconstitutionTest.seed")((graph: Effect.Success<ReturnType<typeof setup>>, row: JsonObject = childRow()) =>
  graph.write(operations => Effect.gen(function* () {
    yield* operations.writeRows(graph.table("parent"), "insert", [parentRow()]);
    return yield* operations.writeRows(graph.table("child"), "insert", [row]);
  })));
const failure = <Value>(result: Result.Result<Value, CoreError>) => Result.isFailure(result) ? result.failure : undefined;

export function registerNativeReconstitutionScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    const run = <Failure>(body: (fixture: CorePersistenceFixture) => Effect.Effect<void, Failure, import("effect").Scope.Scope>) => async () => {
      const fixture = await createFixture();
      try { await Effect.runPromise(Effect.scoped(body(fixture))); } finally { await fixture.close(); }
    };

    for (const policy of ["advanceUpdatedAt", "preserveTimestamps"] as const) {
      it(`reconstitutes exact same-root children with ${policy}, immutable first originals and restored index membership`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture), child = graph.table("child");
        const initial = yield* seed(graph), original = initial[0];
        if (original === undefined) return yield* Effect.die(new Error("Missing actual child"));
        const before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
        const final = yield* graph.write((operations, unixTime) => Effect.gen(function* () {
          const cursor = operations.nativeActivityCursor();
          const preimages = yield* nativeRows(initial);
          yield* operations.deleteRows(child, ["original"]);
          expect(yield* operations.find(child, { deleted_at: null })).toEqual([]);
          const restored = yield* operations.reconstituteRows(child, preimages, policy);
          expect(restored[0]).toEqual({ ...original, updated_at: policy === "preserveTimestamps"
            ? original.updated_at : new Date(unixTime).toISOString() });
          expect(restored[0]?.updated_at === original.updated_at).toBe(policy === "preserveTimestamps");
          expect(restored[0]?._id).toBe(original._id);
          expect(restored[0]?._creationTime).toBe(original._creationTime);
          expect(yield* operations.find(child, { deleted_at: null })).toEqual(restored);
          const activity = yield* operations.nativeActivitySince(cursor);
          expect(activity.mutations.map(entry => entry.operation)).toEqual(["delete", "insert"]);
          expect(activity.mutations[0]?.before).toEqual(preimages[0]);
          expect(activity.mutations[1]?.before).toBeNull();
          expect(activity.mutations[1]?.after).toEqual((yield* nativeRows(restored))[0]);
          return restored;
        }));
        expect(yield* graph.read("child")).toEqual(final);
        const after = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
        const previous = before.revisions.filter(entry => entry.table === child), revisions = after.revisions.filter(entry => entry.table === child);
        expect(previous).toHaveLength(1); expect(revisions).toHaveLength(2);
        expect(revisions[0]).toEqual(previous[0]);
        expect(revisions[1]).toMatchObject({ id: previous[0]?.id, previous: previous[0]?.timestamp, deleted: false, value: final[0] });
      })), 120_000);
    }

    it("proves the latest physical deletion while retaining the first committed original through intermediate updates", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), child = graph.table("child");
      const initial = yield* seed(graph), before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      const restored = yield* graph.write(operations => Effect.gen(function* () {
        const cursor = operations.nativeActivityCursor();
        yield* operations.writeRows(child, "update", [{ id: "original", value: "second" }]);
        const latest = yield* operations.writeRows(child, "update", [{ id: "original", value: "third" }]);
        yield* operations.deleteRows(child, ["original"]);
        const rows = yield* operations.reconstituteRows(child, yield* nativeRows(latest), "preserveTimestamps");
        expect(rows).toEqual(latest); expect(rows[0]?._id).toBe(initial[0]?._id);
        expect((yield* operations.nativeActivitySince(cursor)).mutations.map(entry => entry.operation)).toEqual(["patch", "patch", "delete", "insert"]);
        return rows;
      }));
      const after = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      const originals = before.revisions.filter(entry => entry.table === child), revisions = after.revisions.filter(entry => entry.table === child);
      expect(originals).toHaveLength(1); expect(revisions).toHaveLength(2); expect(revisions[0]).toEqual(originals[0]);
      expect(revisions[1]).toMatchObject({ id: originals[0]?.id, previous: originals[0]?.timestamp, deleted: false, value: restored[0] });
    })), 120_000);

    it("keeps the same native business ID in separate admitted tables bound to its actual deletion", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), child = graph.table("child"), sibling = graph.table("sibling");
      const children = yield* seed(graph, childRow("same"));
      const siblings = yield* graph.write(operations => operations.writeRows(sibling, "insert", [childRow("same")]));
      expect(children[0]?._id).not.toBe(siblings[0]?._id);
      yield* graph.write(operations => Effect.gen(function* () {
        yield* operations.deleteRows(child, ["same"]); yield* operations.deleteRows(sibling, ["same"]);
        expect(yield* operations.reconstituteRows(sibling, yield* nativeRows(siblings), "preserveTimestamps")).toEqual(siblings);
        expect(yield* operations.reconstituteRows(child, yield* nativeRows(children), "preserveTimestamps")).toEqual(children);
      }));
      expect(yield* graph.read("child")).toEqual(children); expect(yield* graph.read("sibling")).toEqual(siblings);
    })), 120_000);

    for (const mode of ["body", "owner", "key", "created", "updated", "deleted", "partial", "extra", "duplicate", "extra-row"] as const) {
      it(`refuses ${mode} reconstitution without publishing any deleted or partial batch state`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture), child = graph.table("child");
        const preimage = (yield* nativeRows(yield* seed(graph)))[0];
        if (preimage === undefined) return yield* Effect.die(new Error("Missing actual preimage"));
        const before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
        const forged: Record<string, Json> = { ...preimage };
        if (mode === "body") forged.value = "forged";
        if (mode === "owner") forged.parent_id = "forged-owner";
        if (mode === "key") forged.id = "forged-key";
        if (mode === "created") forged.created_at = "2030-01-01T00:00:00.000Z";
        if (mode === "updated") forged.updated_at = "2030-01-01T00:00:00.000Z";
        if (mode === "deleted") forged.deleted_at = deleted;
        if (mode === "partial") delete forged.updated_at;
        if (mode === "extra") forged.unknown = "not-a-column";
        const input = mode === "duplicate" ? [preimage, preimage] : mode === "extra-row" ? [preimage, { ...preimage, id: "unrecorded" }] : [forged];
        yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
          const cursor = operation.operations.nativeActivityCursor();
          yield* operation.operations.deleteRows(child, ["original"]);
          expect(failure(yield* Effect.result(operation.operations.reconstituteRows(child, input, "advanceUpdatedAt"))))
            .toMatchObject(mode === "partial" || mode === "extra" ? { _tag: "CoreTransactionError", reason: "documentValidation" }
              : { _tag: "CoreNativeQueryError", reason: "invalidInput" });
          expect(yield* operation.operations.find(child, {})).toEqual([]);
          expect((yield* operation.operations.nativeActivitySince(cursor)).mutations.map(entry => entry.operation)).toEqual(["delete"]);
        }), operation => operation.abort());
        expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
      })), 120_000);
    }

    for (const mode of ["live", "replacement", "repeated", "missing", "historical", "soft-delete-only", "deleted-preimage", "stale", "other-table"] as const) {
      it(`refuses ${mode} evidence instead of granting broader restoration authority`, run(fixture => Effect.gen(function* () {
        const graph = yield* setup(fixture), child = graph.table("child"), sibling = graph.table("sibling");
        const initial = yield* seed(graph, mode === "deleted-preimage" ? { ...childRow(), deleted_at: deleted } : childRow());
        const preimages = yield* nativeRows(initial);
        if (mode === "historical") yield* graph.write(operations => operations.deleteRows(child, ["original"]));
        const before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
        yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
          const operations = operation.operations;
          if (mode === "stale") yield* operations.writeRows(child, "update", [{ id: "original", value: "newer" }]);
          if (mode === "soft-delete-only") yield* operations.lifecycle(child, "softDelete", ["original"]);
          else if (mode !== "live" && mode !== "missing" && mode !== "historical") yield* operations.deleteRows(child, ["original"]);
          if (mode === "replacement") yield* operations.writeRows(child, "insert", [{ ...childRow(), value: "replacement" }]);
          if (mode === "repeated") yield* operations.reconstituteRows(child, preimages, "preserveTimestamps");
          const rows = mode === "missing" ? [{ ...childRow(), id: "never-seen" }] : preimages;
          expect(failure(yield* Effect.result(operations.reconstituteRows(mode === "other-table" ? sibling : child, rows, "advanceUpdatedAt"))))
            .toMatchObject({ _tag: "CoreNativeQueryError", reason: "invalidInput" });
        }), operation => operation.abort());
        expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
      })), 120_000);
    }

    it("retains normal unique-key validation and rolls back the refused operation's pending changes", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), child = graph.table("child");
      const preimages = yield* nativeRows(yield* seed(graph)), before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
        const operations = operation.operations, cursor = operations.nativeActivityCursor();
        yield* operations.deleteRows(child, ["original"]);
        yield* operations.writeRows(child, "insert", [childRow("claimant")]);
        expect(failure(yield* Effect.result(operations.reconstituteRows(child, preimages, "preserveTimestamps"))))
          .toMatchObject({ _tag: "CoreNativeUniqueConflict", fields: ["value"] });
        expect((yield* operations.find(child, {})).map(row => row.id)).toEqual(["claimant"]);
        expect((yield* operations.nativeActivitySince(cursor)).mutations.map(entry => entry.operation)).toEqual(["delete", "insert"]);
      }), operation => operation.abort());
      expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
    })), 120_000);

    it("retains final foreign-key validation after a child is reconstituted without its removed parent", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), child = graph.table("child");
      const preimages = yield* nativeRows(yield* seed(graph)), before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      yield* Effect.acquireUseRelease(graph.begin(), operation => Effect.gen(function* () {
        yield* operation.operations.deleteRows(child, ["original"]);
        yield* operation.operations.deleteRows(graph.table("parent"), ["owner"]);
        yield* operation.operations.reconstituteRows(child, preimages, "advanceUpdatedAt");
        expect(failure(yield* Effect.result(Effect.gen(function* () {
          return yield* graph.database.commit(yield* operation.finalize());
        })))).toMatchObject({ _tag: "CoreNativeForeignKeyError", reason: "targetMissing" });
      }), operation => operation.abort());
      expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
    })), 120_000);

    it("charges failed batches and enforces the selected native identity limit before reconstitution", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), child = graph.table("child");
      const preimages = yield* nativeRows(yield* seed(graph));
      const budget = coreNativeTestBudget(); let charged = 0;
      const limited = { ...budget, limits: { ...budget.limits, maxIdentities: 1 }, chargeRetained: (bytes: number) =>
        Effect.andThen(Effect.sync(() => { charged += bytes; }), budget.chargeRetained(bytes)) };
      const before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      yield* Effect.acquireUseRelease(graph.begin("write", limited), operation => Effect.gen(function* () {
        const cursor = operation.operations.nativeActivityCursor();
        yield* operation.operations.deleteRows(child, ["original"]);
        const previousCharge = charged;
        expect(failure(yield* Effect.result(operation.operations.reconstituteRows(child, [...preimages, childRow("excess")], "advanceUpdatedAt"))))
          .toMatchObject({ _tag: "CoreTransactionError", reason: "capacity" });
        expect(charged).toBeGreaterThan(previousCharge);
        expect(yield* operation.operations.find(child, {})).toEqual([]);
        expect((yield* operation.operations.nativeActivitySince(cursor)).mutations.map(entry => entry.operation)).toEqual(["delete"]);
      }), operation => operation.abort());
      expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
    })), 120_000);

    it("aborts all restored pending state when the accepting body is cancelled", run(fixture => Effect.gen(function* () {
      const graph = yield* setup(fixture), child = graph.table("child");
      const preimages = yield* nativeRows(yield* seed(graph)), before = yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence);
      const staged = yield* Deferred.make<void>();
      const fiber = yield* Effect.forkChild(graph.write(operations => Effect.gen(function* () {
        yield* operations.deleteRows(child, ["original"]);
        yield* operations.reconstituteRows(child, preimages, "advanceUpdatedAt");
        yield* Deferred.succeed(staged, undefined); return yield* Effect.never;
      })));
      yield* Deferred.await(staged);
      yield* Fiber.interrupt(fiber);
      expect(Exit.isFailure(yield* Fiber.await(fiber))).toBe(true);
      expect(yield* readCoreNativeFixtureInventory(graph.database, fixture.persistence)).toEqual(before);
      expect(yield* nativeRows(yield* graph.read("child"))).toEqual(preimages);
    })), 120_000);
  });
}
