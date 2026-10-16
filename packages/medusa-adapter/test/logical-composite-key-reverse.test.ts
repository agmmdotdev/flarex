import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import { and, eq } from "drizzle-orm";
import { normalizeRelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeCommerceHost } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { commerceError } from "../../persistence-postgres/src/frameworks/commerceTransaction/model";
import { defaultCommerceResources } from "../../persistence-postgres/src/frameworks/commerceTransaction/resources";
import { fxAppRowCurrent, fxSystemCommits, fxControlIndexes } from "../../persistence-postgres/src/database/schema";
import { prepareLogicalReadIndexReadinessWitness } from "../../persistence-postgres/test/storage/documents/logicalReadIndexReadinessTestSupport";
import { locateAppIndexDefinitionByIdEffect } from "../../persistence-postgres/src/storage/indexes/appIndexDefinitions";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const origin = { kind: "synthetic", sourceId: "neutral.composite-key-reverse" };
const implicit = { kind: "implicit", sourceId: "neutral.composite-key-reverse.lifecycle" };
const schema = Result.getOrThrow(normalizeRelationalSchema({ owner: "medusa", lineageId: "neutral-composite-reverse", capabilities: [{
  capabilityId: "pair.lifecycle", kind: "softDelete", deletedAtColumn: { tableId: "pair", columnId: "deleted_at" },
  activeRowsIndex: { tableId: "pair", indexId: "pair.active" }, origin: implicit,
}], tables: [{ tableId: "pair", origin, columns: [
  ...["left_id", "right_id", "id"].map(columnId => ({ columnId, type: "text", nullable: false, default: { kind: "none" }, origin })),
  { columnId: "deleted_at", type: "timestamptz", nullable: true, default: { kind: "none" }, origin: implicit },
], keys: [{ keyId: "pair.primary", kind: "primary", columns: ["left_id", "right_id"], origin }],
indexes: [{ indexId: "pair.right-active", kind: "btree", columns: ["right_id"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin },
  { indexId: "pair.active", kind: "btree", columns: ["deleted_at"], predicate: { kind: "isNull", columnId: "deleted_at" }, origin: implicit }],
constraints: [], relationships: [] }] }));
const evidence = { kind: "synthetic", sourceId: "neutral.composite-key-reverse" };
const sourceKey = "medusa.neutral-composite-reverse";
const tableName = "pair";
const queryInput = Schema.decodeUnknownEffect(Schema.Struct({ right: Schema.String, active: Schema.Boolean, take: Schema.Int }));
const select = (right: string, active: boolean, take = 8) => ({ fields: ["left_id", "right_id", "id", "deleted_at"], take,
  order: { column: "left_id", direction: "asc" }, predicate: { kind: "and", children: [
    { kind: "in", column: "right_id", values: [right] }, ...(active ? [{ kind: "isNull", column: "deleted_at" }] : []),
  ] } });
const seed = defineCommerceCommand("neutralReverseSeed", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.write(ctx.manager, "insert", input)];
}));
const read = defineCommerceCommand("neutralReverseRead", "read", Effect.fn(function* (ctx, input) {
  const data = yield* queryInput(input).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const table = yield* ctx.table(tableName); return [...yield* table.find(ctx.manager, select(data.right, data.active, data.take))];
}));
const remove = defineCommerceCommand("neutralReverseSoftDelete", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.lifecycle(ctx.manager, "softDelete", input)];
}));
const restore = defineCommerceCommand("neutralReverseRestore", "write", Effect.fn(function* (ctx, input) {
  const table = yield* ctx.table(tableName); return [...yield* table.lifecycle(ctx.manager, "restore", input)];
}));
const commands = [seed, read, remove, restore];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let host: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let storage: Awaited<ReturnType<typeof makeStorage>>;
async function makeStorage() {
  const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset", version: 1, rows: [] }, 1_048_576,
    { invalidInput: () => new Error("Invalid neutral reverse dataset"), hashFailure: cause => new Error("Neutral reverse dataset hash", { cause }) }));
  return { ...fixture.hostInput.logicalStorage, source: { sourceKey, writeProfile: sourceKey, schema, evidence },
    initialization: { stepId: "neutral-reverse-empty", datasetSha256: empty.sha256Hex, expectedRowCount: 0 } };
}
async function prepareSource() {
  return Effect.runPromise(captureLogicalSchemaSource({ key: sourceKey, owner: "medusa", writeProfile: sourceKey,
    evidence, definition: { kind: "relational", schema }, bindings: [{ kind: "definition", localName: tableName,
      table: { namespace: "medusa", logicalName: "neutral-composite-reverse/pair" } }] }));
}
const run = (command: typeof seed, input: Parameters<typeof host.run>[2]) => Effect.runPromise(host.run(host.newRequestKey(), command, input));
const rows = (right: string, active = false, take = 8) => Effect.runPromise(host.read(read, { right, active, take }));
const row = (left: string, right: string) => ({ left_id: left, right_id: right, id: left + ":" + right });
const snapshot = async () => ({ rows: await fixture.persistence.drizzle.select().from(fxAppRowCurrent),
  commits: await fixture.persistence.drizzle.select().from(fxSystemCommits) });

describe("neutral composite-key suffix reverse access", () => {
  beforeAll(async () => {
    // Reuse authenticated catalog/database construction only. This additional
    // source has no FK, relationship, module service or framework algorithm.
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [await prepareSource()] });
    storage = await makeStorage();
    host = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands }));
    cleanup.push(() => Effect.runPromise(host.close)); await Effect.runPromise(host.initialize([]));
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("reads active and deleted rows through the nonleading primary-key member", async () => {
    const input = [row("active-a", "visibility"), row("deleted-b", "visibility"), row("unrelated", "other")];
    await run(seed, input); await run(remove, [{ left_id: "deleted-b", right_id: "visibility" }]);
    expect(await rows("visibility", true)).toMatchObject([input[0]]);
    expect(await rows("visibility")).toMatchObject([input[0], { ...input[1], deleted_at: expect.any(String) }]);
    await run(restore, [{ left_id: "deleted-b", right_id: "visibility" }]);
    expect(await rows("visibility", true)).toMatchObject(input.slice(0, 2));
    expect(await rows("missing")).toEqual([]);
  });

  it("observes pending insertion, deletion and restoration in the same real root", async () => {
    const command = defineCommerceCommand("neutralPendingReverse", "write", Effect.fn(function* (ctx) {
      const table = yield* ctx.table(tableName);
      yield* table.write(ctx.manager, "insert", [row("pending-a", "pending"), row("pending-b", "pending")]);
      const inserted = yield* table.find(ctx.manager, select("pending", false));
      yield* table.lifecycle(ctx.manager, "softDelete", [{ left_id: "pending-a", right_id: "pending" }]);
      const all = yield* table.find(ctx.manager, select("pending", false));
      const active = yield* table.find(ctx.manager, select("pending", true));
      yield* table.lifecycle(ctx.manager, "restore", all.map(value => ({ left_id: value.left_id, right_id: value.right_id })));
      return { inserted: [...inserted], all: [...all], active: [...active], restored: [...yield* table.find(ctx.manager, select("pending", true))] };
    }));
    const writer = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [command] }));
    try {
      expect(await Effect.runPromise(writer.run(writer.newRequestKey(), command, null))).toMatchObject({
        inserted: [row("pending-a", "pending"), row("pending-b", "pending")],
        all: [{ ...row("pending-a", "pending"), deleted_at: expect.any(String) }, row("pending-b", "pending")],
        active: [row("pending-b", "pending")], restored: [row("pending-a", "pending"), row("pending-b", "pending")],
      });
    } finally { await Effect.runPromise(writer.close); }
    expect(await rows("pending", true)).toHaveLength(2);
  });

  it("preserves reverse pagination and poisons pending writes on the actual profile identity ceiling", async () => {
    await run(seed, Array.from({ length: 9 }, (_, index) => row("overflow-" + index, "overflow")));
    expect(await rows("overflow", false, 8)).toHaveLength(8);
    const logicalResources = { ...defaultCommerceResources, catalogRows: 8, queryRows: 8, writeBatchRows: 8 };
    const command = defineCommerceCommand("neutralReverseCaughtOverflow", "write", Effect.fn(function* (ctx) {
      const table = yield* ctx.table(tableName);
      yield* table.write(ctx.manager, "insert", [row("rollback", "rollback")]);
      yield* table.find(ctx.manager, select("overflow", false, 8)).pipe(Effect.catch(() => Effect.succeed([])));
      return null;
    }));
    const bounded = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage,
      logicalResources, commands: [read, command] }));
    try {
      // The default profile above permits the eight-row result window. This
      // smaller trusted profile caps actual examined identities at eight.
      await expect(Effect.runPromise(bounded.read(read, { right: "overflow", active: false, take: 8 })))
        .rejects.toMatchObject({ reason: "limitExceeded" });
      await expect(Effect.runPromise(bounded.read(read, { right: "overflow", active: false, take: 9 })))
        .rejects.toMatchObject({ reason: "limitExceeded" });
      const before = await snapshot();
      await expect(Effect.runPromise(bounded.run(bounded.newRequestKey(), command, null)))
        .rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(await snapshot()).toEqual(before); expect(await rows("rollback")).toEqual([]);
    } finally { await Effect.runPromise(bounded.close); }
  });
  it("uses the existing ordered-index family for all-row reads and refuses unavailable coverage", async () => {
    await run(seed, [row("coverage", "coverage")]);
    const readiness = await prepareLogicalReadIndexReadinessWitness({ controlDb: fixture.control.drizzle,
      targetDb: fixture.testOwner.drizzle, deploymentId: fixture.deploymentId, schemaVersionId: fixture.schemaVersionId,
      scopeId: fixture.application.authority.scopeId, sourceKey, localName: tableName, field: "right_id", visibility: "all" });
    const definition = await Effect.runPromise(locateAppIndexDefinitionByIdEffect(fixture.control.drizzle,
      fixture.application.authority.scopeId, readiness.indexDefinitionId));
    if (definition === null) throw new Error("Missing authenticated reverse definition");
    expect(definition.access.kind).toBe("developer");
    expect(definition.physicalSpec).toMatchObject({ orderedFields: [{ kind: "documentPath", path: "right_id" }, { kind: "systemCreationTime" }] });
    expect(definition.physicalSpec.predicate).toBeUndefined();
    const indexes = await fixture.control.drizzle.select().from(fxControlIndexes).where(and(
      eq(fxControlIndexes.deploymentId, fixture.deploymentId), eq(fxControlIndexes.tableId, definition.access.tableId)));
    expect(indexes.some(index => index.descriptor.endsWith("key-reverse/right_id"))).toBe(true);
    const before = await rows("coverage");
    try {
      await readiness.retire();
      await expect(rows("coverage")).rejects.toMatchObject({ reason: "invalidAuthority" });
    } finally { await readiness.restore(); }
    expect(await rows("coverage")).toEqual(before);
  });

  it("retains active partial-index selection when deleted history exceeds the live identity budget", async () => {
    const history = Array.from({ length: 9 }, (_, index) => row("history-" + index, "history"));
    await run(seed, history);
    await run(remove, history.map(value => ({ left_id: value.left_id, right_id: value.right_id })));
    const active = row("live-history", "history"); await run(seed, [active]);
    const bounded = await Effect.runPromise(makeCommerceHost({ ...fixture.hostInput, logicalStorage: storage, commands: [read],
      logicalResources: { ...defaultCommerceResources, catalogRows: 8, queryRows: 8, writeBatchRows: 8 } }));
    try {
      expect(await Effect.runPromise(bounded.read(read, { right: "history", active: true, take: 8 }))).toMatchObject([active]);
      await expect(Effect.runPromise(bounded.read(read, { right: "history", active: false, take: 8 })))
        .rejects.toMatchObject({ reason: "limitExceeded" });
    } finally { await Effect.runPromise(bounded.close); }
  });

  it("confines identical composite keys and reverse values to their actual scope", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), { resource: fixture.resource,
      fixtureIdentity: { deploymentId: "neutral_reverse_shop_b", projectId: "neutral_reverse_shop_b", uuidOffset: 230_000 },
      additionalSources: [await prepareSource()] });
    const foreign = await Effect.runPromise(makeCommerceHost({ ...other.hostInput,
      logicalStorage: { ...other.hostInput.logicalStorage, source: storage.source, initialization: storage.initialization }, commands }));
    try {
      await Effect.runPromise(foreign.initialize([]));
      const same = row("scope-shared", "scope-shared");
      await run(seed, [same]); await Effect.runPromise(foreign.run(foreign.newRequestKey(), seed, [same]));
      await run(remove, [{ left_id: same.left_id, right_id: same.right_id }]);
      expect(await rows(same.right_id, true)).toEqual([]);
      expect(await rows(same.right_id)).toMatchObject([{ ...same, deleted_at: expect.any(String) }]);
      expect(await Effect.runPromise(foreign.read(read, { right: same.right_id, active: true, take: 8 }))).toMatchObject([same]);
      await run(restore, [{ left_id: same.left_id, right_id: same.right_id }]);
      expect(await rows(same.right_id, true)).toMatchObject([same]);
    } finally { await Effect.runPromise(foreign.close); }
  }, 240_000);
});
