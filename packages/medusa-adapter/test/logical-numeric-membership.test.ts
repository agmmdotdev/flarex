import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { commerceError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import type { LogicalCommerceCallValidation } from "../../persistence-postgres/src/frameworks/atomicCommerce/participants";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const origin = { kind: "synthetic", sourceId: "neutral-numeric-membership155" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "numeric-membership155", capabilities: [], tables: [{
  tableId: "measurements", origin, columns: [
    { columnId: "id", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "amount", type: "numeric", nullable: true, default: { kind: "none" }, origin },
    { columnId: "label", type: "text", nullable: false, default: { kind: "none" }, origin },
    { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin },
  ], keys: [{ keyId: "measurements.primary", kind: "primary", columns: ["id"], origin }], indexes: [], constraints: [], relationships: [],
}] }));
const sourceKey = "medusa.neutral-numeric-membership155";
const initialRows: JsonObject[] = [
  { id: "a", amount: 1, label: "one", deleted_at: null },
  { id: "b", amount: "1.0000", label: "one alias", deleted_at: null },
  { id: "c", amount: "9007199254740993.125", label: "precise left", deleted_at: null },
  { id: "d", amount: "9007199254740993.126", label: "precise right", deleted_at: null },
  { id: "e", amount: "0", label: "zero", deleted_at: null },
  { id: "f", amount: null, label: "absent", deleted_at: null },
  { id: "g", amount: 1, label: "historical", deleted_at: "2020-01-02T03:04:05.000Z" },
];
const seed = defineCommerceCommand("neutralNumericMembershipSeed", "write", Effect.fn(function* (ctx) {
  yield* (yield* ctx.table("measurements")).write(ctx.manager, "insert", initialRows);
  return null;
}));
const read = defineCommerceCommand("neutralNumericMembershipRead", "read", Effect.fn(function* (ctx, input) {
  const store = yield* ctx.table("measurements"), prepared = store.prepareRead(input);
  return { rows: [...yield* prepared.find(ctx.manager)], count: yield* prepared.count(ctx.manager) };
}));
const overlay = defineCommerceCommand("neutralNumericMembershipOverlay", "write", Effect.fn(function* (ctx, input) {
  const store = yield* ctx.table("measurements"), prepared = store.prepareRead(input);
  const before = [...yield* prepared.find(ctx.manager)];
  yield* store.write(ctx.manager, "update", [{ id: "b", amount: 2 }, { id: "f", amount: 1 }]);
  return { before, after: [...yield* prepared.find(ctx.manager)], count: yield* prepared.count(ctx.manager) };
}));
const participant = defineAtomicCommerceParticipant("neutralNumericMembership");
const readRoot = defineAtomicCommerceCommand("neutralNumericMembershipReadRoot", (ctx, input) => ctx.call(participant, read, input));
const overlayRoot = defineAtomicCommerceCommand("neutralNumericMembershipOverlayRoot", (ctx, input) => ctx.call(participant, overlay, input));
const receipts: Parameters<LogicalCommerceCallValidation>[1][] = [];
const validate: LogicalCommerceCallValidation = (call, activity) => Effect.sync(() => {
  expect(call.events).toEqual([]); expect(activity.lifecycle).toEqual([]); expect(activity.setNull).toEqual([]);
  expect(activity.referenceReplacements).toEqual([]);
  if (call.mode === "read") expect(activity.mutations).toEqual([]);
  receipts.push(activity);
});
const anchoredQuery = (values: readonly Json[], postgres = false): JsonObject => ({ fields: ["id"], order: { column: "id", direction: "asc" },
  predicate: { kind: "and", children: [
    { kind: "in", column: "id", values: ["a", "b", "c", "d", "e", "f", "g"] },
    { kind: "numericIn", column: "amount", values: [...values] }, { kind: "isNull", column: "deleted_at" },
    ...(postgres ? [{ kind: "postgresText", column: "label", operator: "like", value: "%" }] : []),
  ] },
});
const cleanup: Array<() => Promise<void>> = [];
let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let atomic: Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>;
describe(`neutral exact numeric relational membership - ${driver}`, { concurrent: false }, () => {
  beforeAll(async () => {
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey,
      evidence: origin, definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: "measurements",
        table: { namespace: "medusa", logicalName: "neutral-numeric-membership155/measurements" } }] }));
    const fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] },
      1_048_576, { invalidInput: () => commerceError("invalidInput"), hashFailure: cause => commerceError("resourceFailure", cause) }));
    const logicalStorage = {
      ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence: origin },
      initialization: { stepId: "numeric.empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 },
    };
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, commands: [seed, read], logicalStorage }));
    cleanup.push(() => Effect.runPromise(host.close));
    await Effect.runPromise(host.initialize([]));
    await Effect.runPromise(host.run(host.newRequestKey(), seed, null));
    atomic = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, commands: [readRoot, overlayRoot],
      participants: [{ participant, logicalStorage, commands: [read, overlay], validateLogicalCall: validate }],
    }));
    cleanup.push(() => Effect.runPromise(atomic.close));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("matches exact numeric membership through an existing indexed identity anchor", async () => {
    expect(await Effect.runPromise(host.read(read, { fields: ["id"], order: { column: "id", direction: "asc" }, predicate: {
      kind: "and", children: [
        { kind: "in", column: "id", values: ["a", "b", "c", "d", "e", "f", "g"] },
        { kind: "numericIn", column: "amount", values: [1] },
        { kind: "isNull", column: "deleted_at" },
      ],
    } }))).toEqual({ rows: [{ id: "a" }, { id: "b" }], count: 2 });
  }, 180_000);

  it.each([false, true])("preserves exact precision, zero, null and historical membership with PostgreSQL residual=%s", async postgres => {
    const select = (values: readonly Json[]) => Effect.runPromise(host.read(read, anchoredQuery(values, postgres)));
    expect(await select(["1.0000", 1, "1e0"])).toEqual({ rows: [{ id: "a" }, { id: "b" }], count: 2 });
    expect(await select(["9007199254740993.125"])).toEqual({ rows: [{ id: "c" }], count: 1 });
    expect(await select(["9007199254740993.126"])).toEqual({ rows: [{ id: "d" }], count: 1 });
    expect(await select([-0, "-0.000"])).toEqual({ rows: [{ id: "e" }], count: 1 });
    expect(await select([])).toEqual({ rows: [], count: 0 });
    expect(await Effect.runPromise(host.read(read, { fields: ["id"], order: { column: "id", direction: "asc" }, predicate: {
      kind: "and", children: [{ kind: "in", column: "id", values: ["f"] }, { kind: "isNull", column: "amount" }],
    } }))).toEqual({ rows: [{ id: "f" }], count: 1 });
  }, 180_000);

  it.each([false, true])("authenticates selected identities before projection and offset with PostgreSQL residual=%s", async postgres => {
    const query = { ...anchoredQuery([1], postgres), fields: ["label"], includeIdentities: true, skip: 1, take: 1 };
    expect(await Effect.runPromise(atomic.run(atomic.newRequestKey(), readRoot, query)))
      .toEqual({ rows: [{ label: "one alias" }], count: 2 });
    const activity = receipts.at(-1);
    expect(activity?.relationalReads).toEqual([0, 1].map(() => ({ table: "measurements", query, total: 2, returned: 1,
      orderedIdentities: [{ id: "b" }] })));
    expect(activity?.observedRows.some(row => row.table === "measurements" && row.row.id === "d")).toBe(true);
  }, 180_000);

  it("keeps legacy in strict and refuses malformed numeric operands before results or mutations", async () => {
    for (const predicate of [
      { kind: "in", column: "amount", values: [1] }, { kind: "in", column: "amount", values: ["1"] },
      { kind: "numericIn", column: "label", values: [1] },
      ...[null, true, "NaN", " 1", "1\n", "1e999999"].map(value => ({ kind: "numericIn", column: "amount", values: [value] })),
    ]) expect(await Effect.runPromise(Effect.result(host.read(read, { order: { column: "id", direction: "asc" }, predicate }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  }, 180_000);

  it("re-evaluates exact numeric membership over pending writes and retains one replayable read/mutation proof", async () => {
    const query = { ...anchoredQuery([1], true), includeIdentities: true }, key = atomic.newRequestKey(), start = receipts.length;
    const result = await Effect.runPromise(atomic.run(key, overlayRoot, query));
    expect(result).toEqual({ before: [{ id: "a" }, { id: "b" }], after: [{ id: "a" }, { id: "f" }], count: 2 });
    const activity = receipts.at(-1);
    expect(activity?.relationalReads.map(read => read.orderedIdentities))
      .toEqual([[{ id: "a" }, { id: "b" }], [{ id: "a" }, { id: "f" }], [{ id: "a" }, { id: "f" }]]);
    expect(activity?.mutations.map(mutation => [mutation.table, mutation.operation, mutation.before?.id, mutation.after?.amount]))
      .toEqual([["measurements", "patch", "b", 2], ["measurements", "patch", "f", 1]]);
    expect(await Effect.runPromise(atomic.run(key, overlayRoot, query))).toEqual(result);
    expect(receipts).toHaveLength(start + 1);
  }, 180_000);
});
