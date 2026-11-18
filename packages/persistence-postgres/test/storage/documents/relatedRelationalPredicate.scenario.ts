import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import type { JsonObject } from "flarex-protocol/json";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../relationalSchema/neutralLogicalFixture";
import { relatedPredicateSchema as schema, relatedPredicateOrigin as evidence, relatedQuery } from "./relatedRelationalPredicate.schema";

const sourceKey = "medusa.neutral-related-predicate";
const cast: JsonObject = { kind: "child", predicate: { kind: "postgresNumericCast", column: "value", operator: "gt", value: 2 } };
const guarded: JsonObject = { kind: "and", children: [
  { kind: "notInChild", predicate: { kind: "postgresText", column: "value", operator: "notIn", values: ["2"] } }, cast,
] };

/** Actual admitted source, both indexed cohorts, pending overlay, native PG
 * predicate and protected capture. No test-owned query/settlement algorithm. */
export async function relatedRelationalPredicateScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence,
      definition: { kind: "relational", schema }, bindings: ["parent", "child"].map(localName => ({ kind: "definition", localName,
        table: { namespace: "medusa", logicalName: evidence.sourceId + "/" + localName } })) }));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close),
      { name: "neutral-related-predicate", sources: [source], finiteCapture: true });
    if (driver === "postgres") expect((await fixture.persistence.query(
      "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
      .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    const seed = defineCommerceCommand("relatedPredicateSeed", "write", ctx => Effect.gen(function* () {
      yield* (yield* ctx.table("parent")).write(ctx.manager, "insert", ["multi", "single", "empty", "exact"].map(id => ({ id, attribute: "threshold", operator: "gte" })));
      yield* (yield* ctx.table("child")).write(ctx.manager, "insert", [
        { id: "a", parent_id: "multi", value: "1" }, { id: "b", parent_id: "multi", value: "4" },
        { id: "c", parent_id: "single", value: "2" }, { id: "d", parent_id: "exact", value: "9007199254740993" },
        { id: "e", parent_id: "exact", value: "9007199254740993" },
      ]);
      return null;
    }));
    const read = defineCommerceCommand("relatedPredicateRead", "read", (ctx, input) => Effect.gen(function* () {
      const table = yield* ctx.table("parent");
      if (table.related === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      return [...yield* table.related(ctx.manager, input)];
    }));
    const overlay = defineCommerceCommand("relatedPredicateOverlay", "write", (ctx, input) => Effect.gen(function* () {
      const parent = yield* ctx.table("parent"), child = yield* ctx.table("child");
      if (parent.related === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      const before = [...yield* parent.related(ctx.manager, relatedQuery(cast))];
      yield* child.write(ctx.manager, "update", [{ id: "b", value: "2" }]);
      const after = [...yield* parent.related(ctx.manager, relatedQuery(cast))];
      yield* parent.write(ctx.manager, "insert", [{ id: "pending", attribute: "threshold", operator: "gte" }]);
      yield* child.write(ctx.manager, "insert", [{ id: "pending-child", parent_id: "pending", value: "3" }]);
      const inserted = [...yield* parent.related(ctx.manager, relatedQuery(cast))];
      if (input === "rollback") return yield* ctx.refuse(commerceError("invalidInput"));
      return { before, after, inserted };
    }));
    const caught = defineCommerceCommand("relatedPredicateCaughtCast", "write", ctx => Effect.gen(function* () {
      const parent = yield* ctx.table("parent"), child = yield* ctx.table("child");
      if (parent.related === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      yield* child.write(ctx.manager, "update", [{ id: "a", value: "bad" }]);
      expect(yield* parent.related(ctx.manager, relatedQuery(cast)).pipe(Effect.result))
        .toMatchObject({ _tag: "Failure", failure: { reason: "resourceFailure" } });
      return null;
    }));
    const accessor = defineCommerceCommand("relatedPredicateAccessor", "read", ctx => Effect.gen(function* () {
      const parent = yield* ctx.table("parent");
      if (parent.related === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      let invoked = false;
      const refused = yield* parent.related(ctx.manager, { childTable: "child", foreignKey: "child.parent",
        get predicate() { invoked = true; return cast; } }).pipe(Effect.result);
      expect(invoked).toBe(false);
      expect(refused).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      return null;
    }));
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
      initialization: { stepId: "related-predicate-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
    const identityAndAccessPolicy = { profile: "neutral-related-predicate" };
    await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput, logicalStorage, identityAndAccessPolicy, commands: [read] }),
      host => host.initialize([]), host => host.close));
    const participant = defineAtomicCommerceParticipant("relatedPredicate");
    const seedRoot = defineAtomicCommerceCommand("relatedPredicateSeedRoot", ctx => ctx.call(participant, seed, null));
    const readRoot = defineAtomicCommerceCommand("relatedPredicateReadRoot", (ctx, input) => ctx.call(participant, read, input));
    const overlayRoot = defineAtomicCommerceCommand("relatedPredicateOverlayRoot", (ctx, input) => ctx.call(participant, overlay, input));
    const caughtRoot = defineAtomicCommerceCommand("relatedPredicateCaughtRoot", ctx => ctx.call(participant, caught, null));
    const accessorRoot = defineAtomicCommerceCommand("relatedPredicateAccessorRoot", ctx => ctx.call(participant, accessor, null));
    const receipts: Array<Parameters<LogicalCommerceCallValidation>[1]> = [];
    const validateLogicalCall: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
      expect(call.events).toEqual([]); if (call.commandName === "relatedPredicateRead") receipts.push(activity);
    });
    const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String, attribute: Schema.String, operator: Schema.String })));
    const ids = (values: unknown) => decodeRows(values).map(value => value.id);
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy,
      commands: [seedRoot, readRoot, overlayRoot, caughtRoot, accessorRoot],
      participants: [{ participant, logicalStorage, commands: [seed, read, overlay, caught, accessor], validateLogicalCall }] }), host => Effect.gen(function* () {
      yield* host.run(host.newRequestKey(), seedRoot, null);
      const queries: Array<readonly [JsonObject, readonly string[]]> = [
        [cast, ["exact", "multi"]], [guarded, []],
        [{ kind: "child", predicate: { kind: "isNull", column: "value" } }, ["empty"]],
        [{ kind: "notInChild", predicate: { kind: "in", column: "value", values: [] } }, ["empty", "exact", "multi", "single"]],
        [{ kind: "and", children: [] }, ["empty", "exact", "multi", "single"]],
        [{ kind: "or", children: [] }, []],
      ];
      for (const [predicate, expected] of queries) {
        const query = relatedQuery(predicate);
        expect(ids(yield* host.run(host.newRequestKey(), readRoot, query))).toEqual(expected);
        expect(receipts.at(-1)?.relationalReads.at(-1)).toEqual({ table: "parent", query, total: expected.length, returned: expected.length,
          orderedIdentities: expected.map(id => ({ id })), related: { childTable: "child", foreignKeyConstraintId: "child.parent" } });
      }
      expect(yield* Effect.result(host.run(host.newRequestKey(), overlayRoot, "rollback")))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      expect(ids(yield* host.run(host.newRequestKey(), readRoot, relatedQuery(cast)))).toEqual(["exact", "multi"]);
      expect(yield* Effect.result(host.run(host.newRequestKey(), caughtRoot, null)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
      expect(yield* Effect.result(host.run(host.newRequestKey(), accessorRoot, null)))
        .toMatchObject({ _tag: "Failure", failure: { reason: "rollbackOnly" } });
      expect(ids(yield* host.run(host.newRequestKey(), readRoot, relatedQuery(cast)))).toEqual(["exact", "multi"]);
      const key = host.newRequestKey(), changedValue = yield* host.run(key, overlayRoot, null);
      const changed = Schema.decodeUnknownSync(Schema.Struct({ before: Schema.Array(Schema.JsonObject), after: Schema.Array(Schema.JsonObject), inserted: Schema.Array(Schema.JsonObject) }))(changedValue);
      expect(ids(changed.before)).toEqual(["exact", "multi"]); expect(ids(changed.after)).toEqual(["exact"]);
      expect(ids(changed.inserted)).toEqual(["exact", "pending"]);
      expect(yield* host.run(key, overlayRoot, null)).toEqual(changed);
    }), host => host.close));
    // The complete parent and child cohorts count before selective SQL results.
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy, commands: [readRoot],
      participants: [{ participant, logicalStorage, commands: [read], validateLogicalCall,
        logicalResources: { ...defaultCommerceResources, catalogRows: 4, queryRows: 4, writeBatchRows: 4 } }] }), host => Effect.gen(function* () {
      expect(yield* Effect.result(host.run(host.newRequestKey(), readRoot, relatedQuery({ kind: "or", children: [] }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    }), host => host.close));
  } finally { for (const close of cleanup.reverse()) await close(); }
}
