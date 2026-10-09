import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result, Schema } from "effect";
import type { ModuleJoinerConfig } from "@medusajs/framework/types";
import { normalizeRelationalSchema, type RelationalSchema } from "flarex-protocol/internal/relational-schema";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { makeCommerceHost, type LogicalCommerceHostInput } from "../../persistence-postgres/src/frameworks/commerceTransaction/host";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { capturePrivateCanonicalValue } from "../../persistence-postgres/src/installation/frameworkSchema/privateCanonicalValue";
import { commerceError, isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { captureLinkMetadata } from "../src/link-schema";
import { captureProductSalesChannelLinkMetadata } from "../src/product-sales-channel-link-schema";
import { prepareLinkService } from "../src/link-service";
import { linkLogicalEventPolicy } from "../src/link-events";
import { commerceServiceCommands } from "../src/service-commands";
import { commerceDecoder } from "../src/commerce-decoder";
import { lowerDmlSchema } from "../src/schema/lower";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { fxAppRowCurrent, fxControlTables } from "../../persistence-postgres/src/database/schema";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";

const definition = { serviceName: "AssetGroupLink", isLink: true,
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
const decodeRestore = commerceDecoder(Schema.Union([Id,
  Schema.Struct({ asset_ref: Id, group_ref: Id })]), "invalidInput");
const pair = (asset: string, group: string, id?: string) => ({ assets: { asset_ref: asset },
  groups: { group_ref: group }, ...(id === undefined ? {} : { data: { id } }) });
const prepare = (ctx: CommerceCommandContext, input: Json) => Effect.fromResult(decodeInput(input)).pipe(
  Effect.map(value => structuredClone(value)), Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error)));
const inspect = defineCommerceCommand("inspectNeutralLink", "read", Effect.fn(function* (ctx) {
  return yield* (yield* ctx.table("asset_group")).find(ctx.manager, { take: 256,
    order: { column: "asset_ref", direction: "asc" } });
}));
const readRows = async () => Schema.decodeUnknownSync(Schema.Array(Schema.Json))(
  await Effect.runPromise(reader.read(inspect, null)));
const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid neutral Link driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let native: Effect.Success<ReturnType<typeof prepareLinkService>>;
let reader: Effect.Success<ReturnType<typeof makeCommerceHost>>;
let commands: ReturnType<typeof makeCommands>;
let sourceSchema: RelationalSchema;
let evidence: { readonly kind: "synthetic"; readonly sourceId: string };
const linkStorage = (selectedFixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>) => ({
  ...selectedFixture.hostInput.logicalStorage,
  source: { sourceKey: "medusa.link.neutral", writeProfile: "medusa.link.neutral",
    schema: sourceSchema, evidence },
  initialization: { stepId: "neutral-link-empty", datasetSha256: emptySha256,
    expectedRowCount: 0 },
});
let emptySha256: string;

function makeCommands() {
  const factory = commerceServiceCommands(native.use);
  const create = factory.write("linkCreate", prepare, ({ link, service, context }, input) => input.direct
    ? service.create(input.links.map(item => [item.assets.asset_ref, item.groups.group_ref, item.data ?? {}] satisfies [string, string, Record<string, unknown>]), undefined, undefined, context)
    : link.create(input.links, context));
  const dismiss = factory.write("linkDismiss", prepare, ({ link, context }, input) => link.dismiss(input.links, context));
  const restore = factory.write("linkRestore", (ctx, input) => Effect.fromResult(decodeRestore(input)).pipe(
    Effect.catchTag("CommerceTransactionError", error => ctx.refuse(error))),
    async ({ service, context }, selected) => {
      await service.restore(typeof selected === "string" ? { asset_ref: selected } : selected, {}, context);
      return null;
    });
  return { create, dismiss, restore };
}

async function openHost(selectedFixture = fixture, selectedCommands: typeof commands = commands) {
  const participant = defineAtomicCommerceParticipant("neutralLink");
  const create = defineAtomicCommerceCommand("neutralLinkCreate", (ctx, input) =>
    ctx.call(participant, selectedCommands.create, input));
  const dismiss = defineAtomicCommerceCommand("neutralLinkDismiss", (ctx, input) =>
    ctx.call(participant, selectedCommands.dismiss, input));
  const restore = defineAtomicCommerceCommand("neutralLinkRestore", (ctx, input) =>
    ctx.call(participant, selectedCommands.restore, input));
  const policy = linkLogicalEventPolicy("asset_group", native.serviceName, native.entityName,
    ["asset_ref", "group_ref"]);
  const revision = "a".repeat(64);
  const attached = defineCommerceEventContract({ name: native.entityName + ".attached", revision,
    internal: true, decode: policy.capture });
  const detached = defineCommerceEventContract({ name: native.entityName + ".detached", revision,
    internal: true, decode: policy.capture });
  const select = (message: Json) => isJsonObject(message) && message.name === native.entityName + ".attached"
    ? Effect.succeed(attached) : isJsonObject(message) && message.name === native.entityName + ".detached"
      ? Effect.succeed(detached) : Effect.fail(commerceError("unadmittedEvent"));
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-neutral-link" },
    participants: [{ participant, logicalStorage: linkStorage(selectedFixture),
      commands: Object.values(selectedCommands), validateLogicalCall: policy.validateLogicalCall,
      events: { contracts: [attached, detached], select } }],
    commands: [create, dismiss, restore], events: { producerRevision: revision,
      contracts: [attached, detached], subscribers: [{ id: "logical-neutral-link", revision: "b".repeat(64) }],
      validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, create, dismiss, restore };
}

describe("native singular Link on shared logical storage", () => {
  beforeAll(async () => {
    const metadata = await Effect.runPromise(captureLinkMetadata(definition));
    native = await Effect.runPromise(prepareLinkService(metadata));
    commands = makeCommands();
    sourceSchema = Result.getOrThrow(normalizeRelationalSchema(lowerDmlSchema([metadata.frame], "native-neutral-link")));
    evidence = { kind: "synthetic", sourceId: "native-neutral-link" };
    const source = await Effect.runPromise(captureLogicalSchemaSource({
      key: "medusa.link.neutral", owner: "medusa", writeProfile: "medusa.link.neutral", evidence,
      definition: { kind: "relational", schema: sourceSchema },
      bindings: [{ kind: "definition", localName: "asset_group",
        table: { namespace: "medusa", logicalName: "neutral-link/asset_group" } }],
    }));
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { additionalSources: [source] });
    const empty = await Effect.runPromise(capturePrivateCanonicalValue({ format: "flarex.initialization-dataset",
      version: 1, rows: [] }, 1_048_576, { invalidInput: () => new Error("Invalid Link seed"),
        hashFailure: cause => new Error("Link seed hash", { cause }) }));
    emptySha256 = empty.sha256Hex;
    const readerInput: LogicalCommerceHostInput<unknown> = { ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "logical-neutral-link-reader" },
      logicalStorage: linkStorage(fixture),
      commands: [...Object.values(commands), inspect],
    };
    reader = await Effect.runPromise(makeCommerceHost(readerInput));
    await Effect.runPromise(reader.initialize([]));
  }, 180_000);
  afterAll(async () => {
    if (reader !== undefined) await Effect.runPromise(reader.close);
    for (const close of cleanup.reverse()) await close();
  }, 120_000);

  it("preserves captured native Link identity and refuses unsupported stored shapes", async () => {
    expect((await Effect.runPromise(captureProductSalesChannelLinkMetadata())).sha256Hex)
      .toBe("ac45bd894a8798c8d788e7f7616da0fa62540060e6eaf2aa9c0859ac7fedc2b0");
    for (const unsupported of [
      { ...definition, isReadOnlyLink: true },
      { ...definition, databaseConfig: { ...definition.databaseConfig, extraFields: {} } },
      { ...definition, relationships: definition.relationships.map(item => ({ ...item, foreignKey: "part_one,part_two" })) },
    ]) {
      await expect(Effect.runPromise(captureLinkMetadata(unsupported))).rejects.toMatchObject({
        _tag: "LinkSchemaError",
      });
    }
    const baseline = await Effect.runPromise(captureLinkMetadata(definition));
    const cascading = await Effect.runPromise(captureLinkMetadata({ ...definition,
      relationships: definition.relationships.map(item => ({ ...item, deleteCascade: true })) }));
    expect(cascading.joiner.relationships?.map(item => item.deleteCascade)).toEqual([true, true]);
    expect(cascading.frame).toEqual(baseline.frame);
    expect(cascading.sha256Hex).toBe(baseline.sha256Hex);
  });

  it("admits native singular Link metadata without generating a module table", async () => {
    const table = sourceSchema.tables[0];
    expect(table?.keys.find(key => key.kind === "primary")?.columns.map(column => column.columnId))
      .toEqual(["asset_ref", "group_ref"]);
    expect(table?.indexes.filter(index => index.kind === "uniqueBtree").map(index => ({
      columns: index.columns.map(column => column.columnId), predicate: index.predicate?.kind,
    })).sort((left, right) => left.columns[0]!.localeCompare(right.columns[0]!)))
      .toEqual([{ columns: ["asset_ref"], predicate: "isNull" },
        { columns: ["group_ref"], predicate: "isNull" }]);
    expect((await fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.physicalTablesBeforeCandidate);
  });

  it("runs native attach, dismiss and restore against generic rows with rollback", async () => {
    const selected = await openHost();
    try {
      const before = await logicalCurrencyInventory(fixture);
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { links: [pair("native-asset", "native-group", "ag-native")] }));
      expect(await Effect.runPromise(reader.read(inspect, null))).toMatchObject([
        { id: "ag-native", asset_ref: "native-asset", group_ref: "native-group", deleted_at: null },
      ]);
      const attached = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { direct: true, links: [pair("native-asset", "other-group")] }))).rejects.toBeDefined();
      expect(await logicalCurrencyInventory(fixture)).toEqual(attached);
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.dismiss,
        { links: [pair("native-asset", "native-group")] }));
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.restore, "native-asset"));
      expect(await Effect.runPromise(reader.read(inspect, null))).toMatchObject([
        { id: "ag-native", asset_ref: "native-asset", group_ref: "native-group", deleted_at: null },
      ]);
      expect((await logicalCurrencyInventory(fixture)).commits.length).toBe(before.commits.length + 3);
    } finally { await Effect.runPromise(selected.host.close); }
  }, 120_000);

  it("enforces both endpoint directions and atomic bulk refusal", async () => {
    const selected = await openHost();
    try {
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { links: [pair("unique-asset", "unique-group", "ag-unique")] }));
      const before = await logicalCurrencyInventory(fixture);
      for (const candidate of [pair("unique-asset", "other-group"), pair("other-asset", "unique-group")]) {
        await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
          { direct: true, links: [candidate] }))).rejects.toBeDefined();
        expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      }
      await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { direct: true, links: [pair("bulk-asset", "one"), pair("bulk-asset", "two")] })))
        .rejects.toBeDefined();
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    } finally { await Effect.runPromise(selected.host.close); }
  }, 120_000);

  it("refuses native endpoint overrides and keeps direct upsert replay stable", async () => {
    const selected = await openHost();
    try {
      const before = await logicalCurrencyInventory(fixture);
      for (const extra of [{ asset_ref: "blocked" }, { group_ref: "group" }]) {
        await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
          { direct: true, links: [pair("valid", "first"), { ...pair("blocked", "group"), data: extra }] })))
          .rejects.toBeDefined();
        expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      }
      const input = { direct: true, links: [pair("repeat-asset", "repeat-group", "ag-original")] };
      const requestKey = selected.host.newRequestKey();
      const result = await Effect.runPromise(selected.host.run(requestKey, selected.create, input));
      const first = await logicalCurrencyInventory(fixture);
      const original = (await readRows()).find(row => isJsonObject(row) && row.id === "ag-original");
      if (original === undefined || !isJsonObject(original)) throw new Error("Missing original Link row");
      expect(original).toMatchObject({ created_at: expect.anything(), updated_at: expect.anything() });
      expect(await Effect.runPromise(selected.host.run(requestKey, selected.create, input))).toEqual(result);
      expect(await logicalCurrencyInventory(fixture)).toEqual(first);
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { direct: true, links: [pair("repeat-asset", "repeat-group", "ag-replaced")] }));
      expect(await readRows()).toContainEqual(expect.objectContaining({
        id: "ag-replaced", asset_ref: "repeat-asset", group_ref: "repeat-group",
        created_at: original.created_at,
        updated_at: original.updated_at,
        deleted_at: null,
      }));
      const replaced = await logicalCurrencyInventory(fixture);
      expect(replaced.rowChanges.slice(first.rowChanges.length)).toHaveLength(1);
      await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { direct: true, links: [pair("duplicate-asset", "duplicate-group"),
          pair("duplicate-asset", "duplicate-group")] }))).rejects.toBeDefined();
    } finally { await Effect.runPromise(selected.host.close); }
  }, 120_000);

  it("keeps tombstones and refuses ambiguous restore until an exact pair is selected", async () => {
    const selected = await openHost();
    try {
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { links: [pair("history-asset", "old-group", "ag-old")] }));
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.dismiss,
        { links: [pair("history-asset", "old-group")] }));
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { links: [pair("history-asset", "new-group", "ag-new")] }));
      const before = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.restore,
        "history-asset"))).rejects.toBeDefined();
      await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        { direct: true, links: [pair("history-asset", "old-group")] }))).rejects.toBeDefined();
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.dismiss,
        { links: [pair("history-asset", "new-group")] }));
      const tombstones = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.restore,
        "history-asset"))).rejects.toBeDefined();
      expect(await logicalCurrencyInventory(fixture)).toEqual(tombstones);
      await Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.restore,
        { asset_ref: "history-asset", group_ref: "old-group" }));
      const rows = await readRows();
      expect(rows.find(row => isJsonObject(row) && row.id === "ag-old"))
        .toMatchObject({ deleted_at: null });
      expect(rows.find(row => isJsonObject(row) && row.id === "ag-new"))
        .toMatchObject({ deleted_at: expect.anything() });
    } finally { await Effect.runPromise(selected.host.close); }
  }, 120_000);

  it("keeps the root rollback-only after a caught native conflict", async () => {
    const caught = defineCommerceCommand("linkCreate", "write", Effect.fn(ctx => native.use(ctx,
      async ({ service, context }) => {
        await service.create("caught-asset", "caught-group", { id: "ag-caught" }, context);
        try { await service.create("caught-asset", "conflict-group", {}, context); }
        catch { /* The caller swallowed the native error; the owner must still refuse settlement. */ }
        return null;
      })));
    const selected = await openHost(fixture, { ...commands, create: caught });
    try {
      const before = await logicalCurrencyInventory(fixture);
      await expect(Effect.runPromise(selected.host.run(selected.host.newRequestKey(), selected.create,
        null))).rejects.toBeDefined();
      expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    } finally { await Effect.runPromise(selected.host.close); }
  }, 120_000);

  it("keeps identical endpoint identities isolated between two shops", async () => {
    const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      resource: fixture.resource,
      fixtureIdentity: { deploymentId: "deployment_neutral_link_shop_b",
        projectId: "project_neutral_link_shop_b", uuidOffset: 5_000 },
      additionalSources: [await Effect.runPromise(captureLogicalSchemaSource({
        key: "medusa.link.neutral", owner: "medusa", writeProfile: "medusa.link.neutral", evidence,
        definition: { kind: "relational", schema: sourceSchema },
        bindings: [{ kind: "definition", localName: "asset_group",
          table: { namespace: "medusa", logicalName: "neutral-link/asset_group" } }],
      }))],
    });
    const otherReader = await Effect.runPromise(makeCommerceHost({ ...other.hostInput,
      identityAndAccessPolicy: { profile: "logical-neutral-link-reader" },
      logicalStorage: linkStorage(other), commands: [...Object.values(commands), inspect],
    }));
    try { await Effect.runPromise(otherReader.initialize([])); }
    finally { await Effect.runPromise(otherReader.close); }
    const first = await openHost();
    const second = await openHost(other);
    try {
      const input = { links: [pair("shared-asset", "shared-group", "ag-shared")] };
      await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create, input));
      await Effect.runPromise(second.host.run(second.host.newRequestKey(), second.create, input));
      const firstScope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
      const secondScope = projectScopeIdUuidV1(other.application.authority.scopeId).scopeUuid;
      expect(firstScope).not.toBe(secondScope);
      const secondBefore = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope);
      await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.dismiss,
        { links: [pair("shared-asset", "shared-group")] }));
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope)).toEqual(secondBefore);
      await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.restore, "shared-asset"));
      expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
        .filter(row => row.scopeUuid === secondScope)).toEqual(secondBefore);
    } finally { await Effect.runPromise(first.host.close); await Effect.runPromise(second.host.close); }
  }, 150_000);

  it.skipIf(driver !== "postgres")("settles one winner for simultaneous same-endpoint attaches", async () => {
    const first = await openHost();
    const second = await openHost();
    try {
      const results = await Promise.allSettled([
        Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create,
          { links: [pair("race-asset", "race-group-a", "ag-race-a")] })),
        Effect.runPromise(second.host.run(second.host.newRequestKey(), second.create,
          { links: [pair("race-asset", "race-group-b", "ag-race-b")] })),
      ]);
      expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
      expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
      const rows = await readRows();
      expect(rows.filter(row => isJsonObject(row) && row.asset_ref === "race-asset"))
        .toHaveLength(1);
    } finally { await Effect.runPromise(first.host.close); await Effect.runPromise(second.host.close); }
  }, 120_000);

  it.skipIf(driver !== "postgres").each(["commit", "rollback"] as const)(
    "observes generic logical unique-claim contention when the winner will %s", async settlement => {
      if (!("pool" in fixture.persistence)) throw new Error("PostgreSQL required");
      const persistence = fixture.persistence;
      const tables = await fixture.control.drizzle.select().from(fxControlTables);
      const table = tables.find(item =>
        item.deploymentId === fixture.deploymentId && item.namespace === "medusa"
        && item.logicalName === "neutral-link/asset_group");
      if (table === undefined) throw new Error("Missing admitted Link table");
      const claims = (await logicalCurrencyInventory(fixture)).uniqueKeys;
      const candidates = claims.filter(claim => claim.scopeUuid ===
        projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid
        && claim.tableId === table.tableId);
      const group = candidates.map(first => candidates.filter(candidate =>
        candidate.constraintId === first.constraintId && candidate.localeKey === first.localeKey))
        .find(group => group.length >= 2);
      const first = group?.[0], second = group?.[1];
      if (first === undefined || second === undefined) throw new Error("Missing two Link claims");
      const targetDigest = Buffer.alloc(32, settlement === "commit" ? 0x71 : 0x72);
      const update = `update fx_app_unique_key set canonical_key_sha256=$1
        where scope_uuid=$2 and constraint_id=$3 and locale_key=$4 and canonical_key_sha256=$5`;
      const params = (claim: typeof first) => [claim.scopeUuid, claim.constraintId,
        claim.localeKey, claim.canonicalKeySha256];
      const winner = await persistence.pool.connect();
      const waiter = await persistence.pool.connect();
      let pending: Promise<{ ok: true } | { error: unknown }> | undefined;
      try {
        await winner.query("begin"); await waiter.query("begin");
        await waiter.query("set local statement_timeout='8s'");
        const winnerPid = (await winner.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
        const waiterPid = (await waiter.query<{ pid: number }>("select pg_backend_pid() as pid")).rows[0]!.pid;
        expect((await winner.query(update, [targetDigest, ...params(first)])).rowCount).toBe(1);
        pending = waiter.query(update, [targetDigest, ...params(second)])
          .then(() => ({ ok: true as const }), error => ({ error }));
        let blocked = false;
        for (let poll = 0; poll < 100; poll++) {
          blocked = (await persistence.query<{ blocked: boolean }>(
            "select $1::int = any(pg_blocking_pids($2::int)) as blocked", [winnerPid, waiterPid]))
            .rows[0]?.blocked ?? false;
          if (blocked) break;
          await new Promise(resolve => setTimeout(resolve, 10));
        }
        expect(blocked).toBe(true);
        await winner.query(settlement);
        const outcome = await pending;
        if (settlement === "commit") {
          expect(outcome).toMatchObject({ error: { code: "23505",
            constraint: "fx_app_unique_key_pk" } });
          await waiter.query("rollback");
        } else {
          expect(outcome).toEqual({ ok: true });
          await waiter.query("commit");
        }
      } finally {
        await winner.query("rollback");
        await waiter.query("rollback");
        if (pending !== undefined) await pending;
        winner.release(); waiter.release();
        const changed = settlement === "commit" ? first : second;
        await persistence.query(`update fx_app_unique_key set canonical_key_sha256=$1
          where scope_uuid=$2 and constraint_id=$3 and locale_key=$4 and canonical_key_sha256=$5`,
        [changed.canonicalKeySha256, changed.scopeUuid, changed.constraintId,
          changed.localeKey, targetDigest]);
      }
    }, 120_000);
});
