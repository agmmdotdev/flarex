import { Effect, Result, Schema } from "effect";
import { expect } from "vitest";
import { isJsonObject, type Json, type JsonObject } from "flarex-protocol/json";
import type { CatalogSchemaVersionId } from "flarex-protocol/schema-manifest";
import type { ApplicationNativeMutationFixture, ApplicationNativeMutationPersistence } from "../../application/applicationNativeMutationTestFixture";
import type { FrameworkSchemaTarget } from "../../../src/installation/frameworkSchema/target";
import type { RelationalSession } from "../../../src/database/relationalTransaction/session";
import type { LogicalCommerceSelectionInput } from "../../../src/frameworks/commerceTransaction/logicalSelection";
import { defineCommerceCommand, makeCommerceHost } from "../../../src/frameworks/commerceTransaction/host";
import { commerceError } from "../../../src/frameworks/commerceTransaction/model";
import { makeAtomicCommerceHost } from "../../../src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../../src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../../src/frameworks/atomicCommerce/participants";
import { preparedHostTestRuntime } from "../../execution/preparation/preparedHostRuntimeTestSupport";
import { capturePrivateCanonicalValue } from "../../../src/installation/frameworkSchema/privateCanonicalValue";

const Mode = Schema.Literals(["matched", "empty", "zeroWindow", "retained", "invalid"]);
const mode = Schema.decodeUnknownResult(Mode);
const queryFor = (value: typeof Mode.Type) => ({ fields: value === "invalid" ? ["not_a_field"] : ["entry_key", "text"],
  order: { column: "entry_key", direction: "asc" }, skip: 0, take: value === "zeroWindow" ? 0 : 8,
  predicate: { kind: "in", column: "folio_key", values: value === "empty" ? ["absent-owner"] : ["evidence-owner", "missing", "evidence-owner"] },
});

/** Real committed neutral rows exercise the ordinary atomic owner. No Medusa
 * module, custom row store, fake query execution or alternate proof issuer. */
export const logicalRelationalReadEvidenceScenario = Effect.fn("LogicalReadEvidence.scenario")(function* <Persistence extends ApplicationNativeMutationPersistence>(
  fixture: ApplicationNativeMutationFixture<Persistence>, target: FrameworkSchemaTarget,
  schemaVersionId: CatalogSchemaVersionId, source: unknown, session: RelationalSession,
) {
  const dataset = yield* capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
    1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) });
  const logicalStorage: LogicalCommerceSelectionInput = { ports: { controlDb: fixture.control.drizzle, authority: fixture.authorityPorts },
    unique: fixture.uniqueConstraintEligibility, schemaVersionId, source,
    initialization: { stepId: "folio.empty", datasetSha256: dataset.sha256Hex, expectedRowCount: 0 } };
  const hostInput = { hostRuntime: preparedHostTestRuntime(fixture.target.drizzle), database: fixture.target.drizzle,
    session, target, deploymentId: fixture.deploymentId, scopeId: fixture.authority.scopeId,
    authority: fixture.authorityPorts, application: fixture.activation, identityAndAccessPolicy: { profile: "neutral-read-evidence" } };
  const participant = defineAtomicCommerceParticipant("neutralReadEvidence");
  const seed = defineCommerceCommand("neutralReadEvidenceSeed", "write", ctx => Effect.gen(function* () {
    yield* (yield* ctx.table("folio")).write(ctx.manager, "insert", [{ folio_key: "evidence-owner" }, { folio_key: "outside-owner" }, { folio_key: "predicate-owner" }]);
    return [...yield* (yield* ctx.table("entry")).write(ctx.manager, "insert", [
      { entry_key: "b", folio_key: "evidence-owner", text: "second" },
      { entry_key: "a", folio_key: "evidence-owner", text: "first" },
      { entry_key: "outside", folio_key: "outside-owner", text: "unselected" },
      { entry_key: "predicate-a", folio_key: "predicate-owner", text: "Ångström fox" },
      { entry_key: "predicate-b", folio_key: "predicate-owner", text: "ångström βeta" },
      { entry_key: "predicate-c", folio_key: "predicate-owner", text: "fox jumped" },
      { entry_key: "predicate-d", folio_key: "predicate-owner", text: "lazy FOX" },
    ])];
  }));
  const read = defineCommerceCommand("neutralReadEvidenceSelection", "read", (ctx, input) => Effect.gen(function* () {
    const selected = yield* Effect.fromResult(mode(input).pipe(Result.mapError(cause => commerceError("invalidInput", cause))));
    const query = queryFor(selected), store = yield* ctx.table("entry"), program = store.prepareRead(query);
    const rows = yield* program.find(ctx.manager);
    if (selected === "retained") { query.take = 0; query.predicate.values.splice(0, query.predicate.values.length, "outside-owner"); }
    return { rows: [...rows], count: yield* program.count(ctx.manager) };
  }));
  const predicateRead = defineCommerceCommand("neutralPostgresPredicateSelection", "read", (ctx, input) => Effect.gen(function* () {
    const query = yield* Schema.decodeUnknownEffect(Schema.Struct({ operation: Schema.Literals(["find", "page", "aggregate"]), query: Schema.JsonObject }))(input)
      .pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
    const store = yield* ctx.table("entry");
    if (query.operation === "page") {
      const page = yield* store.findPage(ctx.manager, query.query);
      return { rows: [...page.rows], hasMore: page.hasMore };
    }
    if (query.operation === "aggregate") return yield* store.aggregate(ctx.manager, query.query);
    const program = store.prepareRead(query.query);
    return { rows: [...yield* program.find(ctx.manager)], count: yield* program.count(ctx.manager) };
  }));
  const overlayQuery = { includeIdentities: true, fields: ["entry_key"], order: { column: "entry_key", direction: "asc" }, predicate: { kind: "and", children: [
    { kind: "in", column: "folio_key", values: ["predicate-owner"] },
    { kind: "postgresText", column: "text", operator: "like", value: "%βeta%" },
  ] } };
  const predicateOverlay = defineCommerceCommand("neutralPostgresPredicateOverlay", "write", ctx => Effect.gen(function* () {
    const store = yield* ctx.table("entry"), program = store.prepareRead(overlayQuery);
    const before = yield* program.find(ctx.manager);
    yield* store.write(ctx.manager, "update", [{ entry_key: "predicate-a", text: "the βeta" }, { entry_key: "predicate-b", text: "left membership" }]);
    const after = yield* program.find(ctx.manager), count = yield* program.count(ctx.manager);
    const page = yield* store.findPage(ctx.manager, { fields: overlayQuery.fields, order: overlayQuery.order, predicate: { kind: "and", children: [
      { kind: "isNull", column: "deleted_at" }, { kind: "postgresText", column: "text", operator: "like", value: "%βeta%" },
    ] } });
    return { before: [...before], after: [...after], count, page: { rows: [...page.rows], hasMore: page.hasMore } };
  }));
  const caughtPredicateFailure = defineCommerceCommand("neutralPostgresPredicateCaughtFailure", "write", ctx => Effect.gen(function* () {
    const store = yield* ctx.table("entry");
    yield* store.write(ctx.manager, "update", [{ entry_key: "predicate-c", text: "must roll back" }]);
    yield* store.find(ctx.manager, { order: { column: "entry_key", direction: "asc" }, predicate: { kind: "and", children: [
      { kind: "in", column: "folio_key", values: ["predicate-owner"] },
      { kind: "postgresText", column: "text", operator: "regex", value: "[" },
    ] } }).pipe(Effect.result);
    return null;
  }));
  yield* Effect.acquireUseRelease(makeCommerceHost({ ...hostInput, logicalStorage, commands: [read] }),
    host => host.initialize([]), host => host.close);
  const receipts: string[] = [];
  const identityReceipts: Array<Parameters<LogicalCommerceCallValidation>[1]> = [];
  const validateLogicalCall: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
    expect(call.events).toEqual([]);
    if ((call.commandName === "neutralPostgresPredicateSelection" && isJsonObject(call.input) &&
      call.input.query !== undefined && isJsonObject(call.input.query) && call.input.query.includeIdentities === true) || call.commandName === "neutralPostgresPredicateOverlay")
      identityReceipts.push(activity);
    if (call.commandName !== "neutralReadEvidenceSelection") return;
    const selected = Result.getOrThrow(mode(call.input)), query = queryFor(selected);
    const total = selected === "empty" ? 0 : 2, returned = selected === "zeroWindow" ? 0 : total;
    expect(activity.mutations).toEqual([]); expect(activity.lifecycle).toEqual([]);
    expect(activity.relationalReads).toEqual([0, 1].map(() => ({ table: "entry", query, total, returned })));
    expect(call.result).toEqual({ rows: returned === 0 ? [] : [{ entry_key: "a", text: "first" }, { entry_key: "b", text: "second" }], count: total });
    const ownedQuery = activity.relationalReads[0]?.query;
    if (ownedQuery === undefined || !isJsonObject(ownedQuery)) throw new Error("Missing captured query object");
    expect(Reflect.set(ownedQuery, "take", 100)).toBe(false);
    receipts.push(selected);
  });
  const seedRoot = defineAtomicCommerceCommand("neutralReadEvidenceSeedRoot", ctx => ctx.call(participant, seed, null));
  const readRoot = defineAtomicCommerceCommand("neutralReadEvidenceRoot", (ctx, input) => Effect.gen(function* () {
    if (input !== "chain") return yield* ctx.call(participant, read, input);
    const results = [];
    for (const input of ["matched", "empty", "zeroWindow", "retained"]) results.push(yield* ctx.call(participant, read, input));
    return results;
  }));
  const predicateRoot = defineAtomicCommerceCommand("neutralPostgresPredicateRoot", (ctx, input) => ctx.call(participant, predicateRead, input));
  const overlayRoot = defineAtomicCommerceCommand("neutralPostgresPredicateOverlayRoot", ctx => ctx.call(participant, predicateOverlay, null));
  const caughtRoot = defineAtomicCommerceCommand("neutralPostgresPredicateCaughtRoot", ctx => ctx.call(participant, caughtPredicateFailure, null));
  yield* Effect.acquireUseRelease(makeAtomicCommerceHost({ ...hostInput, commands: [seedRoot, readRoot, predicateRoot, overlayRoot, caughtRoot],
    participants: [{ participant, logicalStorage, commands: [seed, read, predicateRead, predicateOverlay, caughtPredicateFailure], validateLogicalCall }],
  }), host => Effect.gen(function* () {
    yield* host.run(host.newRequestKey(), seedRoot, null);
    const request = host.newRequestKey();
    const value = yield* host.run(request, readRoot, "chain");
    expect(receipts).toEqual(["matched", "empty", "zeroWindow", "retained"]);
    expect(yield* host.run(request, readRoot, "chain")).toEqual(value);
    expect(receipts).toHaveLength(4);
    expect(yield* Effect.result(host.run(host.newRequestKey(), readRoot, "invalid")))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(receipts).toHaveLength(4);
    yield* host.run(host.newRequestKey(), readRoot, "empty");
    expect(receipts).toEqual(["matched", "empty", "zeroWindow", "retained", "empty"]);
    const pg = (operator: string, value: string): JsonObject => ({ kind: "postgresText", column: "text", operator, value });
    const selected = (predicate: Json): JsonObject => ({ fields: ["entry_key"], order: { column: "entry_key", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "in", column: "folio_key", values: ["predicate-owner"] }, predicate] } });
    const select = (query: JsonObject) => host.run(host.newRequestKey(), predicateRoot, { operation: "find", query });
    // Call-local observations deliberately include access candidates. Selected
    // identities authenticate actual membership independently of those rows,
    // projection and pagination, for both pure and PostgreSQL residuals.
    for (const predicate of [
      { kind: "textNotEqual", column: "text", value: "Ångström fox" }, pg("fulltext", "fox"),
    ] satisfies JsonObject[]) {
      const query = { ...selected(predicate), fields: ["text"], includeIdentities: true, skip: 1, take: 1 };
      const value = yield* select(query);
      expect(value).toEqual({ rows: [{ text: "fox jumped" }], count: 3 });
      const activity = identityReceipts.at(-1);
      expect(activity?.relationalReads).toEqual([0, 1].map(() => ({ table: "entry", query, total: 3, returned: 1,
        orderedIdentities: [{ entry_key: "predicate-c" }] })));
      expect(activity?.observedRows.some(row => row.table === "entry" && row.row.entry_key === "predicate-b")).toBe(true);
    }
    for (const query of [
      { ...selected(pg("fulltext", "fox")), fields: ["text"], includeIdentities: true, take: 0 },
      { ...selected(pg("fulltext", "absent-proof-word")), fields: ["text"], includeIdentities: true },
    ]) {
      const value = yield* select(query);
      const total = "take" in query && query.take === 0 ? 3 : 0;
      expect(value).toEqual({ rows: [], count: total });
      expect(identityReceipts.at(-1)?.relationalReads).toEqual([0, 1].map(() => ({ table: "entry", query,
        total, returned: 0, orderedIdentities: [] })));
    }
    expect(yield* Effect.result(select({ ...selected(pg("fulltext", "fox")), includeIdentities: false })))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    expect(yield* Effect.result(host.run(host.newRequestKey(), predicateRoot, { operation: "page", query: {
      ...selected(pg("fulltext", "fox")), includeIdentities: true,
    } }))).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
    for (const [predicate, keys] of [
      [pg("like", "%Ångström%"), ["predicate-a"]],
      [pg("ilike", "%FOX%"), ["predicate-a", "predicate-c", "predicate-d"]],
      [pg("regex", "^[Åå]ngström"), ["predicate-a", "predicate-b"]],
      [pg("fulltext", "fox"), ["predicate-a", "predicate-c", "predicate-d"]],
      [pg("fulltext", "jump"), []],
      [pg("fulltext", "jumped"), ["predicate-c"]],
      [{ kind: "postgresText", column: "entry_key", operator: "gte", value: "predicate-c" }, ["predicate-c", "predicate-d"]],
      [{ kind: "postgresText", column: "entry_key", operator: "gt", value: "predicate-c" }, ["predicate-d"]],
      [{ kind: "postgresText", column: "entry_key", operator: "lte", value: "predicate-b" }, ["predicate-a", "predicate-b"]],
      [{ kind: "postgresText", column: "entry_key", operator: "lt", value: "predicate-b" }, ["predicate-a"]],
      [{ kind: "and", children: [pg("like", "%fox%"), { kind: "isNull", column: "deleted_at" }] }, ["predicate-a", "predicate-c"]],
      [{ kind: "or", children: [pg("like", "%βeta%"), pg("like", "lazy%") ] }, ["predicate-b", "predicate-d"]],
      [{ kind: "postgresText", column: "text", operator: "notIn", values: ["Ångström fox", "lazy FOX"] }, ["predicate-b", "predicate-c"]],
      [{ kind: "postgresText", column: "text", operator: "exists", value: true }, ["predicate-a", "predicate-b", "predicate-c", "predicate-d"]],
    ] satisfies Array<readonly [JsonObject, readonly string[]]>)
      expect(yield* select(selected(predicate))).toEqual({ rows: keys.map(entry_key => ({ entry_key })), count: keys.length });
    expect(yield* select({ ...selected(pg("fulltext", "fox")), skip: 1, take: 1 }))
      .toEqual({ rows: [{ entry_key: "predicate-c" }], count: 3 });
    expect(yield* host.run(host.newRequestKey(), predicateRoot, { operation: "aggregate", query: { predicate: selected(pg("fulltext", "fox")).predicate! } }))
      .toEqual({ count: 3 });
    // Paging uses the intrinsic entry-key access path while SQL remains a
    // residual. The committed successor/EOF still protects its negative gap.
    expect(yield* host.run(host.newRequestKey(), predicateRoot, { operation: "page", query: {
      fields: ["entry_key"], order: { column: "entry_key", direction: "asc" }, skip: 1, take: 1,
      predicate: { kind: "and", children: [{ kind: "isNull", column: "deleted_at" }, pg("fulltext", "fox")] } } }))
      .toEqual({ rows: [{ entry_key: "predicate-c" }], hasMore: true });
    // Native WHERE planning still rejects an invalid regex when indexed
    // acquisition finds no rows. Only complete-tree structural simplification
    // may suppress it; the owner never validates leaves independently.
    const beforeEmptyFailure = yield* select(selected(pg("like", "%fox%")));
    expect((yield* Effect.result(select({ ...selected(pg("regex", "[")), predicate: { kind: "and", children: [
      { kind: "in", column: "folio_key", values: ["no-candidates"] }, pg("regex", "[") ] } })))._tag).toBe("Failure");
    expect(yield* select(selected(pg("like", "%fox%")))).toEqual(beforeEmptyFailure);
    // A schema-derived empty candidate set does not make the complete SQL
    // expression structurally false: PostgreSQL still plans its regex leaf.
    // Both APIs must reach that owner rather than treating selection as verdict.
    for (const impossible of [
      { kind: "isNull", column: "entry_key" },
      { kind: "postgresText", column: "entry_key", operator: "exists", value: false },
    ] satisfies JsonObject[]) for (const operation of ["find", "page"]) {
      const result = yield* Effect.result(host.run(host.newRequestKey(), predicateRoot, { operation, query: {
        fields: ["entry_key"], order: { column: "entry_key", direction: "asc" },
        predicate: { kind: "and", children: [impossible, pg("regex", "[")] },
      } }));
      expect(result._tag, operation + " must retain PostgreSQL planning failure for " + impossible.kind).toBe("Failure");
    }
    expect(yield* host.run(host.newRequestKey(), predicateRoot, { operation: "page", query: {
      fields: ["entry_key"], order: { column: "entry_key", direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "in", column: "entry_key", values: [] }, pg("regex", "[")] },
    } })).toEqual({ rows: [], hasMore: false });
    for (const predicate of [
      { kind: "and", children: [{ kind: "in", column: "text", values: [] }, pg("regex", "[")] },
      { kind: "and", children: [{ kind: "in", column: "text", values: ["left"] },
        { kind: "in", column: "text", values: ["right"] }, pg("regex", "[")] },
    ] satisfies JsonObject[])
      expect(yield* select(selected(predicate))).toEqual({ rows: [], count: 0 });
    expect(yield* select(selected({ kind: "or", children: [
      { kind: "postgresText", column: "text", operator: "notIn", values: [] }, pg("regex", "[") ] })))
      .toEqual({ rows: ["predicate-a", "predicate-b", "predicate-c", "predicate-d"].map(entry_key => ({ entry_key })), count: 4 });
    expect(yield* host.run(host.newRequestKey(), overlayRoot, null)).toEqual({ before: [{ entry_key: "predicate-b" }],
      after: [{ entry_key: "predicate-a" }], count: 1, page: { rows: [{ entry_key: "predicate-a" }], hasMore: false } });
    expect(identityReceipts.at(-1)?.relationalReads.map(read => read.orderedIdentities)).toEqual([
      [{ entry_key: "predicate-b" }], [{ entry_key: "predicate-a" }], [{ entry_key: "predicate-a" }],
    ]);
    expect(yield* select(selected(pg("fulltext", "the")))).toEqual({ rows: [{ entry_key: "predicate-a" }], count: 1 });
    const beforeRefusal = yield* select(selected(pg("like", "%fox%")));
    expect((yield* Effect.result(host.run(host.newRequestKey(), caughtRoot, null)))._tag).toBe("Failure");
    expect(yield* select(selected(pg("like", "%fox%")))).toEqual(beforeRefusal);
  }), host => host.close);
});
