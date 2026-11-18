import { Effect, Schema } from "effect";
import { expect } from "vitest";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../../../src/frameworks/commerceTransaction/resources";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";
import { prepareNeutralLogicalFixture } from "../relationalSchema/neutralLogicalFixture";
import { relatedQuery } from "./relatedRelationalPredicate.schema";
import { relatedPredicateNodes } from "./relatedPredicateBudget.programs";
import { relatedBudgetDefinitions } from "./relatedPredicateBudget.schema";

const ids = (value: unknown) => Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(value).map(row => row.id);

/** Two genuinely distinct sources exercise captured per-participant resources,
 * source-local SQL evaluation, durable identity and the existing outer owner. */
export async function relatedPredicateBudgetScenario(driver: "pglite" | "postgres") {
  const cleanup: Array<() => Promise<void>> = [];
  try {
    const sources = [];
    for (const { key, evidence, schema } of relatedBudgetDefinitions) sources.push(await Effect.runPromise(captureLogicalSchemaSource({
      key, owner: "medusa", writeProfile: key, evidence, definition: { kind: "relational", schema },
      bindings: ["parent", "child"].map(localName => ({ kind: "definition", localName, table: { namespace: "medusa", logicalName: key + "/" + localName } })),
    })));
    const fixture = await prepareNeutralLogicalFixture(driver, close => cleanup.push(close), { name: "neutral-related-predicate", sources, finiteCapture: true });
    if (driver === "postgres") expect((await fixture.persistence.query(
      "select rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls from pg_roles where rolname=current_user")).rows)
      .toEqual([{ rolsuper: false, rolcreatedb: false, rolcreaterole: false, rolreplication: false, rolbypassrls: false }]);
    const dataset = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
      { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const storage = relatedBudgetDefinitions.map(({ key, schema, evidence }) => ({ ...fixture.hostInput.logicalStorage,
      source: { sourceKey: key, writeProfile: key, schema, evidence },
      initialization: { stepId: "related-budget-empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } }));
    const firstStorage = storage[0], secondStorage = storage[1];
    if (firstStorage === undefined || secondStorage === undefined) throw new Error("Missing neutral budget sources");
    let callbacks = 0;
    const seed = defineCommerceCommand("relatedBudgetSeed", "write", ctx => Effect.gen(function* () {
      yield* (yield* ctx.table("parent")).write(ctx.manager, "insert", [{ id: "same-id", attribute: "threshold", operator: "gte" }]);
      yield* (yield* ctx.table("child")).write(ctx.manager, "insert", [{ id: "same-child", parent_id: "same-id", value: "4" }]);
      return null;
    }));
    const read = defineCommerceCommand("relatedBudgetRead", "read", (ctx, input) => Effect.gen(function* () {
      callbacks++;
      const parent = yield* ctx.table("parent");
      if (parent.related === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
      return [...yield* parent.related(ctx.manager, input)];
    }));
    for (const logicalStorage of storage) await Effect.runPromise(Effect.acquireUseRelease(makeCommerceHost({ ...fixture.hostInput,
      logicalStorage, identityAndAccessPolicy: { profile: "neutral-related-budget" }, commands: [seed, read] }), host => host.initialize([]), host => host.close));
    const first = defineAtomicCommerceParticipant("relatedBudgetFirst"), second = defineAtomicCommerceParticipant("relatedBudgetSecond");
    const seedRoot = defineAtomicCommerceCommand("relatedBudgetSeedRoot", ctx => Effect.gen(function* () {
      yield* ctx.call(first, seed, null); yield* ctx.call(second, seed, null); return null;
    }));
    const firstRoot = defineAtomicCommerceCommand("relatedBudgetFirstRoot", (ctx, input) => ctx.call(first, read, input));
    const secondRoot = defineAtomicCommerceCommand("relatedBudgetSecondRoot", (ctx, input) => ctx.call(second, read, input));
    const validation = () => Effect.void;
    const selected = { ...defaultCommerceResources, relatedPredicateNodes: 256 };
    const configuration = { ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-related-budget" },
      commands: [seedRoot, firstRoot, secondRoot], participants: [
        { participant: first, logicalStorage: firstStorage, commands: [seed, read], validateLogicalCall: validation, logicalResources: selected },
        { participant: second, logicalStorage: secondStorage, commands: [seed, read], validateLogicalCall: validation },
      ] };
    let replayKey: string | undefined;
    const query = relatedQuery(relatedPredicateNodes(188));
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost(configuration), host => Effect.gen(function* () {
      selected.relatedPredicateNodes = 1;
      yield* host.run(host.newRequestKey(), seedRoot, null);
      expect(ids(yield* host.run(host.newRequestKey(), firstRoot, relatedQuery(relatedPredicateNodes(256))))).toEqual(["same-id"]);
      expect(yield* Effect.result(host.run(host.newRequestKey(), firstRoot, relatedQuery(relatedPredicateNodes(257)))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(ids(yield* host.run(host.newRequestKey(), secondRoot, relatedQuery(relatedPredicateNodes(64))))).toEqual(["same-id"]);
      expect(yield* Effect.result(host.run(host.newRequestKey(), secondRoot, relatedQuery(relatedPredicateNodes(65)))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
      expect(yield* Effect.result(host.run(host.newRequestKey(), firstRoot, { ...query, relatedPredicateNodes: 256 })))
        .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
      replayKey = host.newRequestKey();
      expect(ids(yield* host.run(replayKey, firstRoot, query))).toEqual(["same-id"]);
      const beforeReplay = callbacks;
      expect(ids(yield* host.run(replayKey, firstRoot, query))).toEqual(["same-id"]);
      expect(callbacks).toBe(beforeReplay);
    }), host => host.close));
    if (replayKey === undefined) throw new Error("Missing durable budget request");
    const key = replayKey;
    const firstMember = configuration.participants[0], secondMember = configuration.participants[1];
    if (firstMember === undefined || secondMember === undefined) throw new Error("Missing neutral budget registrations");
    const beforeChangedIdentity = callbacks;
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...configuration, participants: [
      { ...firstMember, logicalResources: { ...defaultCommerceResources, relatedPredicateNodes: 255 } }, secondMember,
    ] }), host => Effect.gen(function* () {
      expect(yield* Effect.result(host.run(key, firstRoot, query))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
      expect(callbacks).toBe(beforeChangedIdentity);
    }), host => host.close));
    // A larger grammar allowance grants no additional cohort capacity, even
    // when the complete predicate selects no parents.
    await Effect.runPromise(Effect.acquireUseRelease(makeAtomicCommerceHost({ ...configuration, participants: [
      { ...firstMember, logicalResources: { ...defaultCommerceResources, relatedPredicateNodes: 256, catalogRows: 1, queryRows: 1, writeBatchRows: 1 } }, secondMember,
    ] }), host => Effect.gen(function* () {
      expect(yield* Effect.result(host.run(host.newRequestKey(), firstRoot, relatedQuery({ kind: "or", children: [] }))))
        .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    }), host => host.close));
  } finally { for (const close of cleanup.reverse()) await close(); }
}
