import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import type { Json, JsonObject } from "flarex-protocol/json";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError, CommerceTransactionError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import type { LogicalCommerceCallValidation, LogicalCommerceEventValidation } from "../../persistence-postgres/src/frameworks/atomicCommerce/participants";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const origin = { kind: "synthetic", sourceId: "neutral.call-local-observations" };
const implicit = { kind: "implicit", sourceId: "neutral.call-local-observations.lifecycle" };
const authored = { kind: "authored", sourceId: "neutral.call-local-observations.search" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-call-observations", capabilities: [{
  capabilityId: "record.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "record", columnId: "deleted_at" },
  activeRowsIndex: { tableId: "record", indexId: "record.active" }, origin: implicit,
}, { capabilityId: "record.search", kind: "searchableText",
  columns: [{ tableId: "record", columnId: "search_text" }], origin: authored,
}], tables: [{ tableId: "record", origin, columns: [
  ...["id", "label"].map(columnId => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
  { columnId: "search_text", type: "text", nullable: false, default: { kind: "textLiteral", value: "outside" }, origin: authored },
  { columnId: "search_json", type: "jsonb", nullable: false, default: { kind: "emptyJsonArray" }, origin },
  { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
], keys: [{ keyId: "record.primary", kind: "primary", columns: ["id"], origin }], indexes: [
  { indexId: "record.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit },
  { indexId: "record.json", kind: "jsonContainment", columns: ["search_json"],
    predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
], constraints: [], relationships: [] }] }));
const sourceKey = "medusa.neutral-call-observations", tableName = "record";
const select = (ids: readonly string[], residual = false) => ({ take: 8, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
  { kind: "in", column: "id", values: ids }, ...(residual ? [{ kind: "textNotEqual", column: "label", value: "excluded" }] : []),
] } });
const read = defineCommerceCommand("neutralCallObservationRead", "read", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.find(ctx.manager, input)];
}));
const seed = defineCommerceCommand("neutralCallObservationInsert", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.write(ctx.manager, "insert", input)];
}));
const update = defineCommerceCommand("neutralCallObservationUpdate", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.write(ctx.manager, "update", input)];
}));
const remove = defineCommerceCommand("neutralCallObservationDelete", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.lifecycle(ctx.manager, "softDelete", input)];
}));
const restore = defineCommerceCommand("neutralCallObservationRestore", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.lifecycle(ctx.manager, "restore", input)];
}));
const commands = [read, seed, update, remove, restore], participant = defineAtomicCommerceParticipant("observation_probe");
const Input = Schema.Struct({ left: Schema.String, right: Schema.String });
const decodeInput = Schema.decodeUnknownEffect(Input);
const decodeIds = Schema.decodeUnknownSync(Schema.Array(Schema.String));
const calls: Array<{ name: string; ids: readonly string[]; mutations: number; lifecycle: number }> = [];
const aggregates: Array<readonly string[]> = [];
const validate: LogicalCommerceCallValidation = (_call, activity) => Effect.sync(() => {
  expect(activity.observedRows.every(entry => entry.table === tableName)).toBe(true);
  calls.push({ name: _call.commandName, ids: [...decodeIds(activity.observedRows.map(entry => entry.row.id))].sort(),
    mutations: activity.mutations.length, lifecycle: activity.lifecycle.length });
});
const validateAggregate: LogicalCommerceEventValidation = (_calls, _mutations, _lifecycle, observed) => Effect.sync(() => {
  aggregates.push([...decodeIds(observed.map(entry => entry.row.id))].sort());
});
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let writer: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let storage: Awaited<ReturnType<typeof makeStorage>>;
async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid neutral observation dataset"), hashFailure: cause => new Error("Neutral observation dataset hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence: origin },
    initialization: { stepId: "neutral-observation-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } };
}
async function prepareSource() {
  return Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence: origin,
    definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: tableName,
      table: { namespace: "medusa", logicalName: "neutral-call-observations/record" } }] }));
}
const run = (command: typeof seed, input: Json) => Effect.runPromise(writer.run(writer.newRequestKey(), command, input));
async function open(command: Parameters<typeof makeAtomicCommerceHost>[0]["commands"][number]) {
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
    participants: [{ participant, logicalStorage: storage, commands, validateLogicalCall: validate, validateLogical: validateAggregate }], commands: [command] }));
  cleanup.push(() => Effect.runPromise(host.close)); return host;
}
const snapshot = () => logicalCurrencyInventory(fixture);
const readSnapshot = Effect.tryPromise({ try: snapshot,
  catch: cause => new Error("Observation snapshot failed", { cause }) });
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : []);
  return value instanceof CommerceTransactionError ? [value.reason, ...reasons(value.cause)] : [];
}

describe("neutral call-local row observations", { concurrent: false }, () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [await prepareSource()] });
    storage = await makeStorage(); writer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands }));
    cleanup.push(() => Effect.runPromise(writer.close)); await Effect.runPromise(writer.initialize([]));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("keeps broad read candidates in their read call, deletes only A, then observes cached B in its later call", async () => {
    const input = { left: "local-a", right: "local-b" };
    await run(seed, [{ id: input.left, label: "selected" }, { id: input.right, label: "excluded" }]);
    const root = defineAtomicCommerceCommand("neutralSequentialObservationRoot", Effect.fn(function* (ctx, args) {
      const ids = yield* decodeInput(args).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      const selected = yield* ctx.call(participant, read, select([ids.left, ids.right], true));
      const deleted = yield* ctx.call(participant, remove, [{ id: ids.left }]);
      const cached = yield* ctx.call(participant, read, select([ids.right]));
      const restored = yield* ctx.call(participant, restore, [{ id: ids.left }]);
      return { selected, deleted, cached, restored };
    }));
    const host = await open(root); calls.length = 0; aggregates.length = 0;
    const before = await snapshot(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, root, input))).toMatchObject({ selected: [{ id: input.left }],
      deleted: [{ id: input.left, deleted_at: expect.any(String) }], cached: [{ id: input.right }], restored: [{ id: input.left, deleted_at: null }] });
    expect(calls).toEqual([
      { name: "neutralCallObservationRead", ids: [input.left, input.right], mutations: 0, lifecycle: 0 },
      { name: "neutralCallObservationDelete", ids: [input.left], mutations: 1, lifecycle: 1 },
      { name: "neutralCallObservationRead", ids: [input.right], mutations: 0, lifecycle: 0 },
      { name: "neutralCallObservationRestore", ids: [input.left], mutations: 1, lifecycle: 1 },
    ]);
    expect(aggregates).toEqual([[input.left, input.right]]);
    const after = await snapshot(); expect(after.commits.length - before.commits.length).toBe(1);
    await Effect.runPromise(host.run(key, root, input)); expect(calls).toHaveLength(4); expect(aggregates).toHaveLength(1);
    expect(await snapshot()).toEqual(after);
  });

  it("does not re-observe an unrelated pending overlay when a later call reads and deletes another key", async () => {
    const input = { left: "pending-a", right: "pending-b" };
    await run(seed, [{ id: input.left, label: "A" }, { id: input.right, label: "B" }]);
    const root = defineAtomicCommerceCommand("neutralPendingObservationRoot", Effect.fn(function* (ctx, args) {
      const ids = yield* decodeInput(args).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      yield* ctx.call(participant, read, select([ids.left, ids.right]));
      yield* ctx.call(participant, update, [{ id: ids.right, label: "pending-B" }]);
      yield* ctx.call(participant, read, select([ids.left]));
      yield* ctx.call(participant, remove, [{ id: ids.left }]);
      return yield* ctx.call(participant, read, select([ids.right]));
    }));
    const host = await open(root); calls.length = 0; aggregates.length = 0;
    expect(await Effect.runPromise(host.run(host.newRequestKey(), root, input))).toMatchObject([{ id: input.right, label: "pending-B" }]);
    expect(calls.map(call => call.ids)).toEqual([[input.left, input.right], [input.right], [input.left], [input.left], [input.right]]);
    expect(aggregates).toEqual([[input.left, input.right]]);
  });

  it("retains pending insertion, write preimages and restore lifecycle observations in their actual calls", async () => {
    const id = "inserted-in-root";
    const root = defineAtomicCommerceCommand("neutralInsertedObservationRoot", Effect.fn(function* (ctx) {
      yield* ctx.call(participant, seed, [{ id, label: "created" }]);
      yield* ctx.call(participant, update, [{ id, label: "patched" }]);
      yield* ctx.call(participant, read, select([id]));
      yield* ctx.call(participant, remove, [{ id }]);
      return yield* ctx.call(participant, restore, [{ id }]);
    }));
    const host = await open(root); calls.length = 0; aggregates.length = 0;
    expect(await Effect.runPromise(host.run(host.newRequestKey(), root, null))).toMatchObject([{ id, label: "patched", deleted_at: null }]);
    expect(calls.map(call => call.ids)).toEqual(Array.from({ length: 5 }, () => [id]));
    expect(calls.map(call => [call.mutations, call.lifecycle])).toEqual([[1, 0], [1, 0], [0, 0], [1, 1], [1, 1]]);
    expect(aggregates).toEqual([[id]]);
  });

  for (const kind of ["text", "json"] as const) it(`observes pending ${kind} anchor members before residuals and honors the selected null qualifier`, async () => {
    const prefix = `search-${kind}`, a = `${prefix}-a`, d = `${prefix}-d`, e = `${prefix}-e`;
    const anchor: JsonObject = kind === "text" ? { search_text: prefix } : { search_json: [prefix] };
    const outside: JsonObject = kind === "text" ? { search_text: "outside" } : { search_json: [] };
    await run(seed, [{ id: a, label: "selected", ...anchor }]);
    const query: Json = { fields: ["id"], take: 4, order: { column: "id", direction: "asc" }, predicate: { kind: "and", children: [
      { kind: "isNull", column: "deleted_at" },
      kind === "text" ? { kind: "textLikeAscii", column: "search_text", pattern: `%${prefix}%` }
        : { kind: "jsonContains", column: "search_json", value: prefix },
      { kind: "textNotEqual", column: "label", value: "excluded" },
    ] } };
    const root = defineAtomicCommerceCommand(`neutral${kind}AnchorObservationRoot`, Effect.fn(function* (ctx) {
      // A later call's cursor must authenticate E through search, rather than
      // inheriting the earlier insertion's observed rows.
      yield* ctx.call(participant, seed, [{ id: d, label: "excluded", ...outside }, { id: e, label: "excluded", ...anchor }]);
      const first = yield* ctx.call(participant, read, query);
      yield* ctx.call(participant, update, [{ id: d, ...anchor, deleted_at: "2000-01-01T00:00:00.000Z" }]);
      const qualified = yield* ctx.call(participant, read, query);
      // Search storage still lends A's original membership after its current
      // pending search value moves out of the requested anchor.
      yield* ctx.call(participant, update, [{ id: a, ...outside }]);
      const moved = yield* ctx.call(participant, read, query);
      return { first, qualified, moved };
    }));
    const host = await open(root); calls.length = 0; aggregates.length = 0;
    const before = await snapshot(), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, root, null))).toEqual({ first: [{ id: a }], qualified: [{ id: a }], moved: [] });
    // Text search is unconditional: D belongs to its anchor even though the
    // query's null residual rejects it. The JSON index is explicitly active.
    const qualifiedIds = kind === "text" ? [a, d, e] : [a, e];
    expect(calls.map(call => call.ids)).toEqual([[d, e], [a, e], [d], qualifiedIds, [a], qualifiedIds]);
    expect(aggregates).toEqual([[a, d, e]]);
    const after = await snapshot(); expect(after.commits.length - before.commits.length).toBe(1);
    await Effect.runPromise(host.run(key, root, null)); expect(calls).toHaveLength(6); expect(aggregates).toHaveLength(1);
    expect(await snapshot()).toEqual(after);
  }, 120_000);

  it.skipIf(driver !== "postgres")("keeps an earlier B observation in OCC even when the final deletion call only observes A", async () => {
    const input = { left: "guard-a", right: "guard-b" };
    await run(seed, [{ id: input.left, label: "A" }, { id: input.right, label: "B" }]);
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const root = defineAtomicCommerceCommand("neutralObservationGuardRoot", Effect.fn(function* (ctx, args) {
      const ids = yield* decodeInput(args).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
      yield* ctx.call(participant, read, select([ids.left, ids.right]));
      yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release);
      return yield* ctx.call(participant, remove, [{ id: ids.left }]);
    }));
    const host = await open(root); calls.length = 0;
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const pending = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), root, input)));
        yield* Deferred.await(reached).pipe(Effect.timeout(20_000));
        yield* writer.run(writer.newRequestKey(), update, [{ id: input.right, label: "committed-B" }]);
        const committed = yield* readSnapshot; yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(pending);
        if (result._tag === "Success") throw new Error("Earlier unrelated read dependency was discarded");
        expect(reasons(result.cause)).toContain("writeConflict");
        expect(yield* readSnapshot).toEqual(committed);
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(40_000))));
      expect(calls.map(call => call.ids)).toEqual([[input.left, input.right], [input.left]]);
      expect(await Effect.runPromise(writer.read(read, select([input.left])))).toMatchObject([{ id: input.left, deleted_at: null }]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); }
  }, 120_000);
});
