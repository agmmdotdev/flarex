import { createHash, randomBytes } from "node:crypto";
import { Effect, Result } from "effect";
import { describe, expect, it, vi } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { encodeIndexValue } from "flarex-protocol/index-key";
import type { JsonObject } from "flarex-protocol/json";
import type { CoreNativeRootBinding } from "../../src/core/api";
import type { CorePersistence } from "../../src/core/contracts";
import { openCoreDatabase } from "../../src/core/database";
import { makeCoreRelationalNativeDefinition } from "../../src/core/nativePolicy";
import { makeCoreSchemaBundle } from "../../src/core/schemaBundle";
import { CoreFinalizationVault, type CoreFinalizedState } from "../../src/core/transaction";
import { relatedPredicateOrigin as origin, relatedPredicateSchema as schema, relatedQuery } from "../storage/documents/relatedRelationalPredicate.schema";
import type { CorePersistenceFixture } from "./fixture";
import { coreNativeTestBudget } from "./nativeTestBudget";
import { CORE_SCHEMA_WORKER_TEST_OPTIONS } from "./schemaFixture";

const target = { scopeUuid: "31a00000-0000-4000-8000-000000000001", epochUuid: "31a00000-0000-4000-8000-000000000002" };
const command = "related-read";
const sourceKey = "medusa.neutral-related-predicate";
const all = relatedQuery({ kind: "and", children: [] });
const bounds = { pageRows: 1 };
const identities = (...ids: string[]) => ids.map(id => ({ id }));
const parentRow = (id: string) => ({ id, attribute: "threshold", operator: "gte" });
const childRow = (id: string, parent_id: string, value: string) => ({ id, parent_id, value });

const setup = Effect.fn("NativeRelatedPredicateTest.setup")(function* (persistence: CorePersistence) {
  const source = yield* captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey,
    evidence: { provenance: origin }, definition: { kind: "relational", schema },
    bindings: ["parent", "child"].map(localName => ({ kind: "definition", localName,
      table: { namespace: "medusa", logicalName: origin.sourceId + "/" + localName } })) });
  const commands = [{ name: command, mode: "write" }] as const;
  const definition = yield* makeCoreRelationalNativeDefinition({ ...target, source, provenance: origin, commands });
  const bundle = yield* makeCoreSchemaBundle({ sources: [{ kind: "native", definition }] });
  const database = yield* Effect.acquireRelease(openCoreDatabase(persistence, { schemaBundles: [bundle],
    now: Effect.succeed(1_000_000_000n), randomBytes: length => Effect.sync(() => randomBytes(length)),
    schemaWorker: CORE_SCHEMA_WORKER_TEST_OPTIONS, maxConcurrentSaves: 2, maxBatchDelayMilliseconds: 0 }), owner => owner.close());
  const proposal = yield* database.prepareSchema({ bundle });
  const activate = Effect.fn("NativeRelatedPredicateTest.activate")(function* () {
    for (let step = 0; step < 256; step++) {
      const status = yield* database.schemaStatus(proposal);
      if ((status.state === "validated" || status.state === "active") && status.indexesReady)
        return yield* database.activateSchema(proposal, { bundle, programs: [] });
      if (status.state === "failed" || status.state === "overwritten") return yield* Effect.die(new Error("Related schema " + status.state));
      yield* database.advanceSchema(proposal, { pageSize: 32, maxPages: 16 });
    }
    return yield* Effect.die(new Error("Related schema did not activate"));
  });
  yield* activate();
  const binding = yield* database.bindNative({ definition, commands });
  const parent = definition.tables.find(table => table.localName === "parent");
  const child = definition.tables.find(table => table.localName === "child");
  if (parent === undefined || child === undefined) return yield* Effect.die(new Error("Missing related tables"));
  const bind = (executionIsolation?: "scopeExclusive") => database.bindNativeRoot({ bundle,
    contract: { name: "neutral-native-related-read", version: 1 },
    participants: [{ binding, commands: [command], limits: coreNativeTestBudget().limits }],
    maxFinalUserDocuments: 128, ...(executionIsolation === undefined ? {} : { executionIsolation }) });
  const start = Effect.fn("NativeRelatedPredicateTest.start")(function* (root: CoreNativeRootBinding, key: string) {
    const metadata = yield* database.readNativeRootBinding(root);
    const claimed = yield* database.claimRequest({ kind: "nativeRoot", root: metadata.identity, key,
      requestHash: createHash("sha256").update(key).digest("hex") }, root);
    if (claimed.kind !== "claimed") return yield* Effect.die(new Error("Related request was " + claimed.kind));
    const operation = yield* database.beginNativeRoot(root, { claim: claimed.claim, ...coreNativeTestBudget() });
    let settled = false;
    yield* Effect.addFinalizer(() => settled ? Effect.void : Effect.andThen(operation.abort(), database.abortRequest(claimed.claim)).pipe(Effect.orDie));
    const operations = yield* operation.native(binding);
    const settle = Effect.gen(function* () {
      const finalized = yield* operation.finalize();
      yield* operation.abort();
      yield* database.commit(finalized, { claim: claimed.claim, result: { key } });
      settled = true;
    });
    return { operations, settle };
  });
  return { parent, child, bind, start };
});

export function registerNativeRelatedPredicateScenarios(label: string, createFixture: () => Promise<CorePersistenceFixture>) {
  describe(label, () => {
    it("observes empty primary ranges and complete cohorts across pending writes and deletes", async () => {
      const fixture = await createFixture();
      const states: CoreFinalizedState[] = [];
      const originalIssue = CoreFinalizationVault.prototype.issue;
      const issue = vi.spyOn(CoreFinalizationVault.prototype, "issue").mockImplementation(function (this: CoreFinalizationVault, state) {
        states.push(state);
        return originalIssue.call(this, state);
      });
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const graph = yield* setup(fixture.persistence);
        const parent = graph.parent.name, child = graph.child.name;
        const selected = yield* graph.bind("scopeExclusive");
        yield* Effect.scoped(Effect.gen(function* () {
          const root = yield* graph.start(selected, "empty-related");
          expect(yield* root.operations.find(parent, {})).toEqual([]);
          const empty = yield* root.operations.readRelated(parent, all, bounds);
          expect([empty.parent.count, empty.child.count, empty.matched.count]).toEqual([0, 0, 0]);
          yield* root.settle;
        }));
        const state = states.findLast(candidate => candidate.scopeExclusion !== undefined && candidate.queryReads !== undefined);
        const start = Result.getOrThrow(encodeIndexValue(""));
        for (const [declaration, primaryId] of [[graph.parent, "parent.primary"], [graph.child, "child.primary"]] as const) {
          const primary = declaration.indexes?.find(index => index.nativeId === primaryId);
          const installed = state?.registry.table(declaration.name)?.definition.indexes.find(index => index.name === primary?.indexName);
          expect(installed).toBeDefined();
          const interval = { start, end: null };
          expect(state?.queryReads).toContainEqual({ indexId: installed?.ref.id, intervals: [interval] });
          expect(state?.nativeObservations?.indexes).toContainEqual(expect.objectContaining({ kind: "range",
            index: installed, interval, members: [],
          }));
        }
        yield* Effect.scoped(Effect.gen(function* () {
          const root = yield* graph.start(selected, "seed-related");
          yield* root.operations.writeRows(parent, "insert", ["split", "both", "empty"].map(parentRow));
          yield* root.operations.writeRows(child, "insert", [childRow("a", "split", "1"), childRow("b", "split", "4"), childRow("c", "both", "2")]);
          yield* root.settle;
        }));
        yield* Effect.scoped(Effect.gen(function* () {
          const root = yield* graph.start(selected, "overlay-related");
          const matches = (predicate: JsonObject) => root.operations.readRelated(parent, relatedQuery(predicate), bounds);
          const numeric = (operator: "gt" | "lt", value: number) => ({ kind: "child",
            predicate: { kind: "postgresNumericCast", column: "value", operator, value } });
          const sameChild = { kind: "and", children: [numeric("gt", 1), numeric("lt", 4)] };
          const first = yield* matches(sameChild);
          expect(first.parent.orderedIdentities).toEqual(identities("both", "empty", "split"));
          expect(first.child.orderedIdentities).toEqual(identities("a", "b", "c"));
          expect(first.matched.orderedIdentities).toEqual(identities("both"));
          const leftJoin = { kind: "child", predicate: { kind: "isNull", column: "value" } };
          expect((yield* matches(leftJoin)).matched.orderedIdentities).toEqual(identities("empty"));
          const antiMembership = { kind: "notInChild", predicate: { kind: "in", column: "value", values: ["1"] } };
          expect((yield* matches(antiMembership)).matched.orderedIdentities).toEqual(identities("both", "empty"));
          yield* root.operations.deleteRows(child, ["c"]);
          yield* root.operations.writeRows(child, "insert", [childRow("pending", "split", "3")]);
          const pending = yield* matches(sameChild);
          expect(pending.child.orderedIdentities).toEqual(identities("a", "b", "pending"));
          expect(pending.matched.orderedIdentities).toEqual(identities("split"));
        }));
        yield* Effect.scoped(Effect.gen(function* () {
          const root = yield* graph.start(selected, "read-related-again");
          expect((yield* root.operations.readRelated(parent, all, bounds)).child.orderedIdentities).toEqual(identities("a", "b", "c"));
        }));
      }))); } finally { issue.mockRestore(); await fixture.close(); }
    }, 120_000);

    it("refuses a missing scope grant, an uninstalled foreign key and excess comparisons before SQL", async () => {
      const fixture = await createFixture();
      let evaluations = 0;
      const persistence: CorePersistence = { ...fixture.persistence, evaluateRelational: batch => {
        evaluations++;
        return fixture.persistence.evaluateRelational(batch);
      } };
      try { await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const graph = yield* setup(persistence);
        const parent = graph.parent.name, child = graph.child.name;
        const ordinary = yield* graph.bind();
        const selected = yield* graph.bind("scopeExclusive");
        yield* Effect.scoped(Effect.gen(function* () {
          const root = yield* graph.start(ordinary, "ordinary-related");
          expect(yield* Effect.result(root.operations.readRelated(parent, all, bounds))).toMatchObject({
            _tag: "Failure", failure: { reason: "authorityRevoked" },
          });
        }));
        yield* Effect.scoped(Effect.gen(function* () {
          const root = yield* graph.start(selected, "wrong-related-fk");
          expect(yield* Effect.result(root.operations.readRelated(parent, { ...all, foreignKey: "child.uninstalled" }, bounds)))
            .toMatchObject({ _tag: "Failure", failure: { reason: "authorityRevoked" } });
        }));
        yield* Effect.scoped(Effect.gen(function* () {
          const root = yield* graph.start(selected, "large-related-cohorts");
          const ids = Array.from({ length: 17 }, (_, index) => String(index).padStart(2, "0"));
          yield* root.operations.writeRows(parent, "insert", ids.map(parentRow));
          yield* root.operations.writeRows(child, "insert", ids.map(id => childRow(id, id, "1")));
          expect(yield* Effect.result(root.operations.readRelated(parent, all, bounds))).toMatchObject({
            _tag: "Failure", failure: { reason: "capacity" },
          });
        }));
        expect(evaluations).toBe(0);
      }))); } finally { await fixture.close(); }
    }, 120_000);
  });
}
