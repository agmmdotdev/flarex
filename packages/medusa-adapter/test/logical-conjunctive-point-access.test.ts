import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { CatalogIndexDefinitionIdSchema } from "flarex-protocol/catalog";
import type { Json } from "flarex-protocol/json";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { makeCommerceReadHost, type CommerceReadHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/read/host";
import { captureLogicalCommerceSelection, prepareLogicalCommerceContract } from "../../persistence-postgres/src/frameworks/commerceTransaction/logicalSelection";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import type { LogicalCommerceCallValidation } from "../../persistence-postgres/src/frameworks/atomicCommerce/participants";
import { defaultCommerceResources } from "../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { logicalReadPredicateKey } from "../../persistence-postgres/src/storage/documents/logicalReadAccessQueries";
import { fxAppRowCurrent, fxSystemCommits, fxControlLogicalReadAccess } from "../../persistence-postgres/src/database/schema";
import { prepareIndexBuildReadinessWitness } from "../../persistence-postgres/test/storage/documents/logicalReadIndexReadinessTestSupport";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const origin = { kind: "synthetic", sourceId: "neutral.conjunctive-point-storage" };
const implicit = { kind: "implicit", sourceId: "neutral.conjunctive-point-storage.lifecycle" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-conjunctive-point-storage", capabilities: [{
  capabilityId: "pair.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "pair", columnId: "deleted_at" },
  activeRowsIndex: { tableId: "pair", indexId: "pair.active" }, origin: implicit,
}], tables: [{ tableId: "pair", origin, columns: [
  ...["id", "left_id", "right_id", "label"].map(columnId => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
  { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
], keys: [{ keyId: "pair.primary", kind: "primary", columns: ["id"], origin }], indexes: [
  { indexId: "pair.left", kind: "btree", columns: ["left_id"], predicate: null, origin },
  { indexId: "pair.right-active", kind: "btree", columns: ["right_id"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
  { indexId: "pair.tuple-active", kind: "uniqueBtree", columns: ["left_id", "right_id"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
  { indexId: "pair.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit },
], constraints: [], relationships: [] }] }));
const sourceKey = "medusa.neutral-conjunctive-point", tableName = "pair";
type Pair = Readonly<{ left_id: string; right_id: string }>;
const tuple = (left_id: string, right_id: string): Pair => ({ left_id, right_id });
const id = (pair: Pair) => pair.left_id + ":" + pair.right_id;
const row = (pair: Pair) => ({ id: id(pair), ...pair, label: "original" });
const select = (pairs: readonly Pair[], reverse = false, active = true) => ({ take: 8, order: { column: "id", direction: "asc" }, predicate: {
  kind: "and", children: [{ kind: "or", children: [{ kind: "in", column: "id", values: [] }, ...pairs.map(pair => ({ kind: "and", children:
    (reverse ? ["right_id", "left_id"] as const : ["left_id", "right_id"] as const).map(column => ({ kind: "in", column, values: [pair[column]] })) }))] },
    ...(active ? [{ kind: "isNull", column: "deleted_at" }] : [])],
} });
const seed = defineCommerceCommand("neutralConjunctiveSeed", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.write(ctx.manager, "insert", input)];
}));
const read = defineCommerceCommand("neutralConjunctiveRead", "read", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.find(ctx.manager, input)];
}));
const remove = defineCommerceCommand("neutralConjunctiveSoftDelete", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.lifecycle(ctx.manager, "softDelete", input)];
}));
const restore = defineCommerceCommand("neutralConjunctiveRestore", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.lifecycle(ctx.manager, "restore", input)];
}));
const participant = defineAtomicCommerceParticipant("conjunctive_probe");
const command = defineAtomicCommerceCommand("neutralConjunctiveRoot", (ctx, input) => ctx.call(participant, read, input));
const observed: Json[][] = [];
const validate: LogicalCommerceCallValidation = (_call, activity) => Effect.sync(() => {
  observed.push(activity.observedRows.map(value => value.row.id ?? null));
  expect(activity.mutations).toEqual([]); expect(activity.lifecycle).toEqual([]);
});
const boundedResources = { ...defaultCommerceResources, catalogRows: 8, queryRows: 8, writeBatchRows: 8 };
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let writer: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let probe: Effect.Success<ReturnType<typeof makeAtomicCommerceHost>>;
let managed: CommerceReadHost | undefined;
let storage: Awaited<ReturnType<typeof makeStorage>>;
async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid neutral conjunctive dataset"), hashFailure: cause => new Error("Neutral conjunctive dataset hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence: origin },
    initialization: { stepId: "neutral-conjunctive-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } };
}
async function prepareSource() {
  return Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey, evidence: origin,
    definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: tableName,
      table: { namespace: "medusa", logicalName: "neutral-conjunctive-point/pair" } }] }));
}
const run = (selected: typeof seed, input: Json) => Effect.runPromise(writer.run(writer.newRequestKey(), selected, input));
const query = (input: Json) => Effect.runPromise(probe.run(probe.newRequestKey(), command, input));
const snapshot = async () => ({ rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent),
  commits: await fixture.persistence.drizzle.select().from(fxSystemCommits) });
function reasons(cause: Cause.Cause<unknown>): string[] {
  return cause.reasons.flatMap(reason => reason._tag !== "Fail" ? [] :
    typeof reason.error === "object" && reason.error !== null && "reason" in reason.error && typeof reason.error.reason === "string"
      ? [reason.error.reason] : []);
}

describe("neutral conjunctive complete-point access", { concurrent: false }, () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [await prepareSource()], ...(driver === "postgres" ? { managedRead: true } : {}) });
    storage = await makeStorage();
    writer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [seed, read, remove, restore] }));
    cleanup.push(() => Effect.runPromise(writer.close)); await Effect.runPromise(writer.initialize([]));
    reader = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, logicalResources: boundedResources, commands: [read] }));
    cleanup.push(() => Effect.runPromise(reader.close));
    probe = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, identityAndAccessPolicy: { profile: "neutral-conjunctive-point-proof" },
      participants: [{ participant, logicalStorage: storage, logicalResources: boundedResources, commands: [read], validateLogicalCall: validate }], commands: [command] }));
    cleanup.push(() => Effect.runPromise(probe.close));
    if (driver === "postgres") {
      const installation = fixture.managedRead?.readInstallation, source = fixture.sourcePins.find(pin => pin.sourceKey === sourceKey);
      if (installation === undefined || source === undefined) throw new Error("Missing neutral managed source installation");
      const contract = await Effect.runPromise(Effect.fromResult(captureLogicalCommerceSelection(storage)).pipe(Effect.flatMap(prepareLogicalCommerceContract)));
      managed = await Effect.runPromise(makeCommerceReadHost({ ...fixture.hostInput, installation, commands: [read], logicalResources: boundedResources,
        logicalStorage: { schemaVersionId: fixture.schemaVersionId, source, initialization: { ...storage.initialization, contractSha256: contract.sha256Hex } } }));
      const managedHost = managed; cleanup.push(() => Effect.runPromise(managedHost.close));
    }
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("selects one or four exact tuples among twelve same-prefix neighbors in either conjunct order", async () => {
    const pairs = Array.from({ length: 12 }, (_, index) => tuple("left-" + String(index).padStart(2, "0"), "cohort"));
    for (let start = 0; start < pairs.length; start += 4) await run(seed, pairs.slice(start, start + 4).map(row));
    for (const reverse of [false, true]) for (const size of [1, 4]) {
      const selected = pairs.slice(0, size); observed.length = 0;
      const input = select(selected, reverse);
      expect(await query(input)).toMatchObject(selected.map(row));
      expect(observed).toHaveLength(1); expect(observed[0]?.toSorted()).toEqual(selected.map(id).toSorted());
      expect(await Effect.runPromise(reader.read(read, input))).toMatchObject(selected.map(row));
      if (managed !== undefined) expect(await Effect.runPromise(managed.read(read, input))).toMatchObject(selected.map(row));
    }
  });

  it("records complete missing-point absence without hydrating same-item or same-location neighbors", async () => {
    const missing = tuple("left-00", "missing-location"); observed.length = 0;
    expect(await query(select([missing], true))).toEqual([]); expect(observed).toEqual([[]]);
    if (managed !== undefined) expect(await Effect.runPromise(managed.read(read, select([missing], true)))).toEqual([]);
    observed.length = 0;
    const present = tuple("left-01", "cohort");
    expect(await query(select([missing, present], false))).toMatchObject([row(present)]);
    expect(observed).toEqual([[id(present)]]);
  });

  it("retains one receipt and commit when the complete tuple read is replayed", async () => {
    const key = probe.newRequestKey(), input = select([tuple("left-02", "cohort")]); observed.length = 0;
    const result = await Effect.runPromise(probe.run(key, command, input)), before = await snapshot();
    expect(await Effect.runPromise(probe.run(key, command, input))).toEqual(result);
    expect(observed).toHaveLength(1); expect(await snapshot()).toEqual(before);
  });

  it("overlays pending tuple mutations and active-row lifecycle changes in the same root", async () => {
    const pair = tuple("pending", "pending"), input = select([pair], true);
    const pending = defineCommerceCommand("neutralConjunctivePending", "write", Effect.fn(function* (ctx) {
      const table = yield* ctx.table(tableName); yield* table.write(ctx.manager, "insert", [row(pair)]);
      const inserted = [...yield* table.find(ctx.manager, input)];
      yield* table.write(ctx.manager, "update", [{ id: id(pair), label: "patched" }]);
      const patched = [...yield* table.find(ctx.manager, input)];
      yield* table.lifecycle(ctx.manager, "softDelete", [{ id: id(pair) }]);
      const deleted = [...yield* table.find(ctx.manager, input)];
      yield* table.lifecycle(ctx.manager, "restore", [{ id: id(pair) }]);
      return { inserted, patched, deleted, restored: [...yield* table.find(ctx.manager, input)] };
    }));
    const host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [pending] }));
    try { expect(await Effect.runPromise(host.run(host.newRequestKey(), pending, null))).toMatchObject({
      inserted: [row(pair)], patched: [{ ...row(pair), label: "patched" }], deleted: [], restored: [{ ...row(pair), label: "patched" }],
    }); } finally { await Effect.runPromise(host.close); }
  });

  it("keeps active partial tuple access bounded across deleted history and preserves all-row visibility", async () => {
    const pair = tuple("history", "history");
    for (let index = 0; index < 9; index++) {
      await run(seed, [{ ...row(pair), id: "history-" + index }]); await run(remove, [{ id: "history-" + index }]);
    }
    await run(seed, [row(pair)]); observed.length = 0;
    expect(await query(select([pair]))).toMatchObject([row(pair)]); expect(observed).toEqual([[id(pair)]]);
    const input = select([pair], true, false);
    // With deleted visibility the active unique pair is ineligible; the
    // unchanged all-row scalar path must still enforce its identity budget.
    await expect(Effect.runPromise(reader.read(read, input))).rejects.toMatchObject({ reason: "limitExceeded" });
    expect(await Effect.runPromise(writer.read(read, { ...input, take: 16 }))).toHaveLength(10);
  });

  it("refuses the exact compound build when its real coverage is unavailable and restores the full prior row", async () => {
    const columns = ["left_id", "right_id"], key = JSON.stringify([JSON.stringify(columns),
      logicalReadPredicateKey({ kind: "fieldIsNull", field: "deleted_at" }), JSON.stringify(columns), "eq"]);
    const access = await fixture.control.drizzle.select().from(fxControlLogicalReadAccess).where(and(
      eq(fxControlLogicalReadAccess.deploymentId, fixture.deploymentId), eq(fxControlLogicalReadAccess.schemaVersionId, fixture.schemaVersionId),
      eq(fxControlLogicalReadAccess.sourceKey, sourceKey), eq(fxControlLogicalReadAccess.localName, tableName),
      eq(fxControlLogicalReadAccess.selectorKind, "indexPoint"), eq(fxControlLogicalReadAccess.selectorKey, key)));
    expect(access).toHaveLength(1);
    const projection = access[0]?.projectionJson; if (!Schema.is(Schema.JsonObject)(projection)) throw new Error("Missing exact compound physical selector");
    expect(projection).toMatchObject({ fields: columns, predicate: { kind: "fieldIsNull", field: "deleted_at" } });
    const definitionId = Result.getOrThrow(Schema.decodeUnknownResult(CatalogIndexDefinitionIdSchema)(projection.indexDefinitionId));
    const readiness = await prepareIndexBuildReadinessWitness(fixture.testOwner.drizzle, fixture.application.authority.scopeId, definitionId);
    const input = select([tuple("left-00", "cohort")]), before = await Effect.runPromise(reader.read(read, input));
    try {
      await readiness.retire(); await expect(Effect.runPromise(reader.read(read, input))).rejects.toMatchObject({ reason: "invalidAuthority" });
      // The managed read boundary projects its existing notReady admission
      // failure as bindingChanged; borrowed commerce reports invalidAuthority.
      if (managed !== undefined) await expect(Effect.runPromise(managed.read(read, input))).rejects.toMatchObject({
        reason: "bindingChanged", cause: { reason: "notReady" },
      });
    } finally { await readiness.restore(); }
    expect(await Effect.runPromise(reader.read(read, input))).toEqual(before);
    if (managed !== undefined) expect(await Effect.runPromise(managed.read(read, input))).toEqual(before);
  });

  it.skipIf(driver !== "postgres")("rejects a stale absent tuple after another ordinary-role root inserts it", async () => {
    const pair = tuple("absent-guard", "cohort"), anchor = tuple("guard-anchor", "anchor"); await run(seed, [row(anchor)]);
    const reached = Deferred.makeUnsafe<void>(), release = Deferred.makeUnsafe<void>();
    const stale = defineCommerceCommand("neutralConjunctiveStaleAbsence", "write", Effect.fn(function* (ctx) {
      const table = yield* ctx.table(tableName); expect(yield* table.find(ctx.manager, select([pair], true))).toEqual([]);
      yield* Deferred.succeed(reached, undefined); yield* Deferred.await(release);
      return [...yield* table.write(ctx.manager, "update", [{ id: id(anchor), label: "stale" }])];
    }));
    const host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [stale] }));
    try {
      await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
        const running = yield* Effect.forkChild(Effect.exit(host.run(host.newRequestKey(), stale, null)));
        yield* Deferred.await(reached).pipe(Effect.timeout(20_000));
        yield* writer.run(writer.newRequestKey(), seed, [row(pair)]);
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(running);
        if (result._tag === "Success") throw new Error("Stale absence accepted after tuple insertion");
        expect(reasons(result.cause)).toContain("writeConflict");
      }).pipe(Effect.ensuring(Deferred.succeed(release, undefined)), Effect.timeout(40_000))));
      expect(await Effect.runPromise(writer.read(read, select([anchor])))).toMatchObject([row(anchor)]);
    } finally { await Effect.runPromise(Deferred.succeed(release, undefined)); await Effect.runPromise(host.close); }
  }, 120_000);
});
