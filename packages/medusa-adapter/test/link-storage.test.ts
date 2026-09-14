import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineCommerceCommand } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureRelationalSchemaArtifact } from "@flarex/persistence-postgres/internal/relational-schema-values";
import { captureRelationalPhysicalLayout, registerLocalCommerceProfile } from "@flarex/persistence-postgres/internal/commerce-profile";
import { captureLinkMetadata } from "../src/link-schema";
import { captureProductSalesChannelLinkMetadata } from "../src/product-sales-channel-link-schema";
import { prepareLinkService } from "../src/link-service";
import { linkEventPolicy } from "../src/link-events";
import { commerceServiceCommands } from "../src/service-commands";
import { commerceDecoder } from "../src/commerce-decoder";
import { lowerDmlSchema } from "../src/schema/lower";
import { ScopeIdSchema } from "flarex-protocol/storage-authority";
import { fxSystemScopeClocks } from "../../persistence-postgres/src/schema";
import { commerceHostFixture, type CommerceHostTestFixture } from "../../persistence-postgres/test/commerceHostFixture";
import { createRelationalPGliteFixture } from "../../persistence-postgres/test/relationalPGliteWorkerTestSupport";
import { createMigratedPGlitePersistence } from "../../persistence-postgres/test/pgliteTestFixture";
import { createFileScopedPostgresFixture } from "../../persistence-postgres/test/postgresHelpers";
import { makePostgresRelationalSession } from "../../persistence-postgres/src/relationalTransaction/session";
import { makeLocalCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { commerceInventory } from "../../persistence-postgres/test/commerceInventory";
import { runEffect, runEffectFailure } from "../../persistence-postgres/test/effectTestRuntime";

// Authored neutral one-to-one definition, not Fulfillment or a promoted module.
const definition = {
  serviceName: "AssetGroupLink", isLink: true,
  relationships: [
    { serviceName: "assets", primaryKey: "id", foreignKey: "asset_ref", alias: "asset" },
    { serviceName: "groups", primaryKey: "id", foreignKey: "group_ref", alias: "group" },
  ], databaseConfig: { tableName: "asset_group", idPrefix: "ag" },
} satisfies ModuleJoinerConfig;
const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Pair = Schema.Struct({ assets: Schema.Struct({ asset_ref: Id }), groups: Schema.Struct({ group_ref: Id }),
  data: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Id),
    asset_ref: Schema.optionalKey(Id), group_ref: Schema.optionalKey(Id) })) });
const Input = Schema.Struct({ links: Schema.Array(Pair).pipe(Schema.mutable), direct: Schema.optionalKey(Schema.Boolean) });
const decodeInput = commerceDecoder(Input, "invalidInput");
const decodeId = commerceDecoder(Id, "invalidInput");
const pair = (asset: string, group: string, id?: string) => ({ assets: { asset_ref: asset }, groups: { group_ref: group }, ...(id === undefined ? {} : { data: { id } }) });
const prepare = (ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decodeInput(input)).pipe(
  Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Link test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: CommerceHostTestFixture;
let native: Effect.Success<ReturnType<typeof prepareLinkService>>;
let commands: ReturnType<typeof makeCommands>;
function makeCommands() {
  const factory = commerceServiceCommands(native.use);
  const create = factory.write("linkCreate", prepare, ({ link, service, context }, input) => input.direct
    ? service.create(input.links.map(item => [item.assets.asset_ref, item.groups.group_ref, item.data ?? {}] satisfies [string, string, Record<string, unknown>]), undefined, undefined, context)
    : link.create(input.links, context));
  const dismiss = factory.write("linkDismiss", prepare, ({ link, context }, input) => link.dismiss(input.links, context));
  const restoreSelected = factory.write("linkRestore", (ctx, input) => Effect.fromResult(decodeId(input)).pipe(
    Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))),
    async ({ service, context }, asset) => { await service.restore({ asset_ref: asset }, {}, context); return null; });
  return { create, dismiss, restore: restoreSelected };
}
beforeAll(async () => {
  const metadata = await runEffect(captureLinkMetadata(definition));
  native = await runEffect(prepareLinkService(metadata));
  commands = makeCommands();
  const registerCleanup = (close: () => Promise<void>) => cleanup.push(close);
  const resource = driver === "pglite" ? await createRelationalPGliteFixture({ registerCleanup }) : await (async () => {
    const database = await createFileScopedPostgresFixture(); registerCleanup(database.dispose);
    return { persistence: database.persistence, session: makePostgresRelationalSession(database.persistence) };
  })();
  const control = driver === "pglite" ? await createMigratedPGlitePersistence(registerCleanup) : resource.persistence;
  fixture = await commerceHostFixture(resource.persistence, resource.session, Effect.fn(function* (deploymentId, target) {
    const captured = yield* captureRelationalSchemaArtifact({ deploymentId,
      provenance: { kind: "sourceSnapshot", repository: "fixture:native-neutral-link", revision: "preflight-63",
        paths: ["packages/medusa-adapter/test/link-storage.test.ts", "packages/medusa-link-modules/src/utils/generate-entity.ts"] },
      schema: lowerDmlSchema([metadata.frame], "native-neutral-link") });
    const layout = yield* captureRelationalPhysicalLayout({ ...target, artifact: captured.artifact });
    const key = layout.frame.tables[0]?.keys.find(key => key.kind === "primary");
    if (key === undefined) throw new Error("Missing Link key");
    const profile = yield* registerLocalCommerceProfile(captured.artifact, layout, "native-neutral-link",
      [{ tableId: "asset_group", keyId: key.identity.keyId, update: "existingPrimaryKey", remove: "declaredKey",
        lifecycle: "managedSoftDelete", upsert: "activeRow", observeRows: true }]);
    return { profile, initialization: { rows: undefined } };
  }), Object.values(commands), control, descriptor => linkEventPolicy("asset_group", native.serviceName, native.entityName, descriptor, () => Effect.void));
}, 120000);
afterAll(async () => {
  const failures: unknown[] = [];
  for (const close of cleanup.reverse()) await close().catch(error => { failures.push(error); });
  if (failures.length) throw new AggregateError(failures, "Link fixture cleanup failed");
}, 120000);
const attach = (links: Array<ReturnType<typeof pair>>, direct = false) => runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create, { links, direct }));
const dismiss = (links: Array<ReturnType<typeof pair>>) => runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.dismiss, { links }));
const restore = (asset: string) => runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.restore, asset));

describe("native singular Link storage", () => {
  it("preserves the pre-extraction ProductSalesChannel canonical metadata identity", async () => {
    // Baseline from the preflight-63 parent's original named capture, including
    // column/index ordering and nonunique many-to-many index flags.
    expect((await runEffect(captureProductSalesChannelLinkMetadata())).sha256Hex)
      .toBe("ac45bd894a8798c8d788e7f7616da0fa62540060e6eaf2aa9c0859ac7fedc2b0");
  });

  it("refuses unsupported stored shapes without granting module capabilities", async () => {
    for (const unsupported of [
      { ...definition, isReadOnlyLink: true },
      { ...definition, databaseConfig: { ...definition.databaseConfig, extraFields: {} } },
      { ...definition, relationships: definition.relationships.map(item => ({ ...item, foreignKey: "part_one,part_two" })) },
    ]) {
      expect(await runEffectFailure(captureLinkMetadata(unsupported))).toMatchObject({ _tag: "LinkSchemaError" });
    }
  });

  it("retains native cascade metadata without changing the physical Link identity", async () => {
    const baseline = await runEffect(captureLinkMetadata(definition));
    const captured = await runEffect(captureLinkMetadata({ ...definition,
      relationships: definition.relationships.map(item => ({ ...item, deleteCascade: true })),
    }));
    expect(captured.joiner.relationships?.map(item => item.deleteCascade)).toEqual([true, true]);
    expect(captured.frame).toEqual(baseline.frame);
    expect(captured.sha256Hex).toBe(baseline.sha256Hex);
  });

  it("installs native active uniqueness with scope prefixes and unchanged pair identity", () => {
    const table = fixture.descriptor.layout.frame.tables[0]!;
    expect(table.keys.find(key => key.kind === "primary")?.columns).toHaveLength(3);
    const indexes = table.indexes.filter(index => index.kind === "uniqueBtree");
    expect(indexes).toHaveLength(2);
    for (const index of indexes) {
      expect(index.columns[0]).toBe("scope_uuid");
      expect(index.columns).toHaveLength(2);
      expect(index.predicate?.kind).toBe("isNull");
    }
  });

  it("enforces both directions even through direct native service calls", async () => {
    await attach([pair("a", "g", "ag-first")]);
    const before = await commerceInventory(fixture);
    for (const conflicting of [pair("a", "other"), pair("other", "g")]) {
      const error = await runEffectFailure(fixture.host.run(fixture.host.newRequestKey(), commands.create, { links: [conflicting], direct: true }));
      // The failed statement poisons the lifetime; the DAL's checked refusal
      // then reports that existing rollback-only state at the service boundary.
      expect(error).toMatchObject({ reason: "rollbackOnly" });
      expect(await commerceInventory(fixture)).toEqual(before);
    }
  });

  it("keeps tombstones, refuses conflicting restore/reattach, then restores after replacement dismissal", async () => {
    await attach([pair("history", "old", "ag-old")]);
    await dismiss([pair("history", "old")]);
    await attach([pair("history", "new", "ag-new")]);
    const before = await commerceInventory(fixture);
    await expect(restore("history")).rejects.toBeDefined();
    await expect(attach([pair("history", "old")], true)).rejects.toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(before);
    await dismiss([pair("history", "new")]);
    const tombstones = await commerceInventory(fixture);
    await expect(restore("history")).rejects.toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(tombstones);
    // Select the exact pair; endpoint-wide restore would revive both tombstones.
    const exact = defineCommerceCommand("linkRestore", "write", Effect.fn(ctx => native.use(ctx, async ({ service, context }) => {
      await service.restore({ asset_ref: "history", group_ref: "old" }, {}, context); return null;
    })));
    const local = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, commands: [exact] },
      linkEventPolicy("asset_group", native.serviceName, native.entityName, fixture.descriptor, () => Effect.void)));
    await runEffect(local.host.run(local.host.newRequestKey(), exact, null));
    const rows = (await commerceInventory(fixture)).rows;
    expect(rows.find(row => row.id === "ag-old")?.deleted_at).toBeNull();
    expect(rows.find(row => row.id === "ag-new")?.deleted_at).not.toBeNull();
  });

  it("rolls back a bulk conflict and a caught native refusal without facts or event delivery", async () => {
    const before = await commerceInventory(fixture);
    await expect(attach([pair("batch", "one"), pair("batch", "two")], true)).rejects.toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(before);
    const caught = defineCommerceCommand("linkCreate", "write", Effect.fn(ctx => native.use(ctx, async ({ service, context }) => {
      await service.create("caught", "ok", { id: "ag-caught" }, context);
      try { await service.create("caught", "conflict", {}, context); } catch { /* Witness caller suppression, not recovery. */ }
      return null;
    })));
    const local = await runEffect(makeLocalCommerceHost({ ...fixture.hostInput, commands: [caught] },
      linkEventPolicy("asset_group", native.serviceName, native.entityName, fixture.descriptor, () => Effect.void)));
    await expect(runEffect(local.host.run(local.host.newRequestKey(), caught, null))).rejects.toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(before);
    expect(local.takeDeliveries()).toEqual([]);
  });

  it("rejects native extra endpoint overrides, including same-value overrides and later bulk members", async () => {
    const before = await commerceInventory(fixture);
    for (const extra of [{ asset_ref: "blocked" }, { group_ref: "g" }]) {
      await expect(runEffect(fixture.host.run(fixture.host.newRequestKey(), commands.create,
        { direct: true, links: [pair("valid", "first"), { ...pair("blocked", "g"), data: extra }] }))).rejects.toBeDefined();
      expect(await commerceInventory(fixture)).toEqual(before);
    }
  });

  it("retains direct pair-upsert IDs, created time, replay and duplicate-batch refusal", async () => {
    const input = { direct: true, links: [pair("repeat", "repeat", "ag-original")] };
    const key = fixture.host.newRequestKey();
    const result = await runEffect(fixture.host.run(key, commands.create, input));
    const first = await commerceInventory(fixture);
    expect(await runEffect(fixture.host.run(key, commands.create, input))).toEqual(result);
    expect(await commerceInventory(fixture)).toEqual(first);
    await expect(attach([pair("repeat", "repeat")])).rejects.toBeDefined(); // Native one-to-one router semantics.
    expect(await commerceInventory(fixture)).toEqual(first);
    await attach([pair("repeat", "repeat", "ag-replaced")], true);
    const replaced = await commerceInventory(fixture);
    expect(replaced.rows.find(row => row.id === "ag-replaced")).toMatchObject({
      created_at: first.rows.find(row => row.id === "ag-original")?.created_at,
      updated_at: first.rows.find(row => row.id === "ag-original")?.updated_at, deleted_at: null,
    });
    expect(replaced.facts.slice(first.facts.length).map(fact => fact.operation)).toEqual(["update"]);
    await expect(attach([pair("duplicate", "duplicate"), pair("duplicate", "duplicate")], true)).rejects.toBeDefined();
    expect(await commerceInventory(fixture)).toEqual(replaced);
  });

  it("keeps unique endpoints and lifecycle scope-local", async () => {
    const foreign = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const clock = (await fixture.persistence.drizzle.select().from(fxSystemScopeClocks))[0];
    if (!clock) throw new Error("Missing scope clock");
    await fixture.persistence.drizzle.insert(fxSystemScopeClocks).values({ scopeId: ScopeIdSchema.make("scope_" + foreign), epoch: clock.epoch, storageGeneration: clock.storageGeneration });
    const table = fixture.descriptor.layout.frame.tables[0]!;
    const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const column = (id: string) => {
      const field = table.columns.find(column => column.identity.columnId === id);
      if (!field) throw new Error("Missing physical field");
      return quote(field.name);
    };
    const target = quote(fixture.descriptor.layout.frame.targetNamespace.schemaName) + "." + quote(table.name);
    // Intentional physical-layout fixture DML, not an adapter write path.
    await fixture.persistence.query(`insert into ${target} (scope_uuid, ${column("asset_ref")}, ${column("group_ref")}, ${column("id")}) values ($1::uuid, 'isolated', 'isolated', 'ag-foreign')`, [foreign]);
    try {
      await attach([pair("isolated", "isolated", "ag-owned")]);
      const foreignBefore = (await commerceInventory(fixture)).rows.find(row => row.id === "ag-foreign");
      expect(foreignBefore).toMatchObject({ id: "ag-foreign", deleted_at: null });
      await dismiss([pair("isolated", "isolated")]);
      const dismissed = (await commerceInventory(fixture)).rows;
      expect(dismissed.find(row => row.id === "ag-foreign")).toEqual(foreignBefore);
      // Physical inspectors expose PG timestamps as Date and PGlite as text;
      // this witness requires a present tombstone, not an adapter output type.
      expect(dismissed.find(row => row.id === "ag-owned")).toMatchObject({ deleted_at: expect.anything() });
      await restore("isolated");
      const rows = (await commerceInventory(fixture)).rows;
      expect(rows.find(row => row.id === "ag-foreign")).toEqual(foreignBefore);
      expect(rows.find(row => row.id === "ag-owned")).toMatchObject({ deleted_at: null });
    } finally {
      await fixture.persistence.query(`delete from ${target} where scope_uuid = $1::uuid`, [foreign]);
    }
  });

  it.skipIf(driver !== "postgres").each(["commit", "rollback"] as const)("observes physical unique-index contention when the winner will %s", async settlement => {
    if (!("pool" in fixture.persistence)) throw new Error("Postgres required");
    const persistence = fixture.persistence;
    const role = (await persistence.query<{ rolsuper: boolean; rolcreaterole: boolean; rolreplication: boolean }>(
      "select rolsuper, rolcreaterole, rolreplication from pg_roles where rolname=current_user")).rows[0];
    expect(role).toEqual({ rolsuper: false, rolcreaterole: false, rolreplication: false });
    const clock = (await persistence.drizzle.select().from(fxSystemScopeClocks))
      .find(clock => clock.scopeId === fixture.candidate.frame.application.scopeId);
    if (!clock?.scopeUuid) throw new Error("Missing scope");
    const layout = fixture.descriptor.layout.frame;
    const table = layout.tables[0]!;
    const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
    const column = (id: string) => {
      const field = table.columns.find(column => column.identity.columnId === id);
      if (!field) throw new Error("Missing physical field");
      return quote(field.name);
    };
    const target = quote(layout.targetNamespace.schemaName) + "." + quote(table.name);
    // Two test-owned sessions reach the installed index directly, without the
    // host's scope-clock serialization. This is a physical constraint proof only.
    const insert = `insert into ${target} (scope_uuid, ${column("asset_ref")}, ${column("group_ref")}, ${column("id")}) values ($1, $2, $3, $4)`;
    const winner = await persistence.pool.connect();
    const waiter = await persistence.pool.connect();
    let pending: Promise<unknown> | undefined;
    try {
      await winner.query("begin"); await waiter.query("begin");
      await waiter.query("set local statement_timeout='8s'");
      const winnerPid = (await winner.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      const waiterPid = (await waiter.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
      await winner.query(insert, [clock.scopeUuid, settlement, "winner-" + settlement, "winner-" + settlement]);
      pending = waiter.query(insert, [clock.scopeUuid, settlement, "waiter-" + settlement, "waiter-" + settlement]).then(() => ({ ok: true }), error => ({ error }));
      let blocked = false;
      for (let poll = 0; poll < 100; poll++) {
        const row = (await persistence.query<{ waiting: boolean }>(
          "select exists(select 1 from pg_stat_activity where pid=$1 and wait_event_type='Lock' and wait_event='transactionid' and $2=any(pg_blocking_pids(pid))) as waiting", [waiterPid, winnerPid])).rows[0];
        if (row?.waiting) { blocked = true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      expect(blocked).toBe(true);
      await winner.query(settlement);
      const outcome = await pending;
      if (settlement === "commit") {
        expect(outcome).toMatchObject({ error: { code: "23505", constraint: table.indexes.find(index => index.kind === "uniqueBtree" && index.columns.includes(table.columns.find(column => column.identity.columnId === "asset_ref")!.name))?.name } });
        await waiter.query("rollback");
      } else {
        expect(outcome).toEqual({ ok: true });
        await waiter.query("commit");
      }
      const final = await persistence.query(`select ${column("id")} as id from ${target} where scope_uuid=$1 and ${column("asset_ref")}=$2`, [clock.scopeUuid, settlement]);
      expect(final.rows).toEqual([{ id: (settlement === "commit" ? "winner-" : "waiter-") + settlement }]);
    } finally {
      await winner.query("rollback");
      await pending;
      await waiter.query("rollback");
      winner.release(); waiter.release();
      await persistence.query(`delete from ${target} where scope_uuid=$1 and ${column("asset_ref")}=$2`, [clock.scopeUuid, settlement]);
    }
  });
});
