import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceEventValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/atomicCommerce/host";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/atomicCommerce/events";
import { makeCommerceHost } from "../../persistence-postgres/src/commerceTransaction/host";
import { defineCommerceCommand } from "../../persistence-postgres/src/commerceTransaction/commands";
import { fxAppRowCurrent } from "../../persistence-postgres/src/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commitEvents/schema";
import { compileLogicalRelationalRead } from "../../persistence-postgres/src/logicalDocuments/relationalQuery";
import { projectScopeIdUuidV1 } from "flarex-protocol/storage-authority";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalSalesChannelHost } from "./support/logical-sales-channel-fixture";
import { prepareLogicalProductHost } from "./support/logical-product-fixture";
import { captureProductSchema } from "../src/product-schema";
import { productRuntimeMetadata } from "../src/product-runtime-metadata";
import { productLogicalCreateEventPolicy } from "../src/product-local-events";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid SalesChannel test driver");
const cleanup: Array<() => Promise<void>> = [];
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let sales: Awaited<ReturnType<typeof prepareLogicalSalesChannelHost>>;
let product: Awaited<ReturnType<typeof prepareLogicalProductHost>>;
const events = () => fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const eventName = (action: "created" | "updated" | "deleted") => buildModuleResourceEventName({
  prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action,
});

async function prepareNativeHost(selectedFixture = fixture, selectedSales = sales,
  substituteEvents?: (events: readonly Json[]) => readonly Json[]) {
  const participant = defineAtomicCommerceParticipant("salesChannel");
  const create = defineAtomicCommerceCommand("nativeSalesChannelCreate", (ctx, input) =>
    ctx.call(participant, selectedSales.runtime.create, input));
  const update = defineAtomicCommerceCommand("nativeSalesChannelUpdate", (ctx, input) =>
    ctx.call(participant, selectedSales.runtime.update, input));
  const remove = defineAtomicCommerceCommand("nativeSalesChannelDelete", (ctx, input) =>
    ctx.call(participant, selectedSales.runtime.delete, input));
  const policy = selectedSales.runtime.logicalEventPolicy();
  const validateLogical: LogicalCommerceEventValidation = substituteEvents === undefined ? policy.validateLogical
    : (calls, mutations, lifecycle, observedRows) => policy.validateLogical(calls.map(call => call.mode === "write"
      ? { ...call, events: substituteEvents(call.events) } : call), mutations, lifecycle, observedRows);
  const revision = "1".repeat(64);
  const contracts = {
    created: defineCommerceEventContract({ name: eventName("created"), revision, internal: true, decode: policy.capture }),
    updated: defineCommerceEventContract({ name: eventName("updated"), revision, internal: true, decode: policy.capture }),
    deleted: defineCommerceEventContract({ name: eventName("deleted"), revision, internal: true, decode: policy.capture }),
  };
  const eventContracts = Object.values(contracts);
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...selectedFixture.hostInput,
    identityAndAccessPolicy: { profile: "logical-sales-channel-native" },
    participants: [{ participant, logicalStorage: selectedSales.hostInput.logicalStorage,
      commands: selectedSales.runtime.commands, validateLogical,
      events: { contracts: eventContracts, select: (message: Json) => {
        const selected = (["created", "updated", "deleted"] as const).find(action =>
          isJsonObject(message) && message.name === eventName(action));
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent"))
          : Effect.succeed(contracts[selected]);
      } } }], commands: [create, update, remove],
    events: { producerRevision: revision, contracts: eventContracts,
      subscribers: [{ id: "logical-sales-channel", revision: "2".repeat(64) }],
      validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, create, update, remove };
}

describe("native SalesChannel service on shared logical storage", () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeSalesChannel: true, includeProduct: true });
    sales = await prepareLogicalSalesChannelHost(fixture);
    await Effect.runPromise(sales.host.initialize([]));
    await Effect.runPromise(sales.host.close);
    product = await prepareLogicalProductHost(fixture);
    await Effect.runPromise(product.host.initialize([]));
    await Effect.runPromise(product.host.close);
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("admits the pinned model without a generated SalesChannel table", async () => {
    expect(sales.definition.schema.tables.map(table => table.identity.tableId)).toEqual(["sales_channel"]);
    expect(sales.definition.schema.tables[0]?.keys.find(key => key.kind === "primary")?.columns
      .map(column => column.columnId)).toEqual(["id"]);
    expect((await fixture.persistence.query<{ name: string }>(
      "select tablename as name from pg_tables where schemaname = current_schema() order by tablename")).rows)
      .toEqual(fixture.physicalTablesBeforeCandidate);
  });

  it("confines a SalesChannel source even when Product is composed in the same schema", async () => {
    const unbound = defineCommerceCommand("salesChannelUnboundProductRead", "read", Effect.fn(function* (ctx) {
      const table = yield* ctx.table("product");
      return yield* table.find(ctx.manager, { fields: ["id"], take: 1,
        predicate: { kind: "eq", column: "id", value: "absent" } });
    }));
    const reader = await Effect.runPromise(makeCommerceHost({ ...sales.hostInput, commands: [unbound] }));
    try {
      await expect(Effect.runPromise(reader.read(unbound, {}))).rejects
        .toMatchObject({ _tag: "CommerceTransactionError", reason: "invalidAuthority" });
    } finally { await Effect.runPromise(reader.close); }
  });

  it("creates, updates and deletes through native methods with exact events and replay", async () => {
    const { host, create, update, remove } = await prepareNativeHost();
    const reader = await Effect.runPromise(makeCommerceHost(sales.hostInput));
    try {
      const before = await events();
      const key = host.newRequestKey();
      const created = await Effect.runPromise(host.run(key, create, { id: "logical-channel", name: "Original" }));
      expect(created).toMatchObject({ id: "logical-channel", name: "Original", is_disabled: false,
        description: null, metadata: null, deleted_at: null });
      const afterCreate = await events();
      expect(afterCreate.slice(before.length).map(event => event.envelope.contract)).toEqual([eventName("created")]);
      expect(await Effect.runPromise(host.run(key, create, { id: "logical-channel", name: "Original" }))).toEqual(created);
      expect(await events()).toEqual(afterCreate);
      const observedSql: string[] = [];
      fixture.observeSql?.(sql => { observedSql.push(sql); });
      expect(await Effect.runPromise(reader.read(sales.runtime.count, { filters: { id: "logical-channel" },
        config: { select: ["id", "name", "is_disabled"], take: 1 } })))
        .toEqual([[{ id: "logical-channel", name: "Original", is_disabled: false }], 1]);
      expect(await Effect.runPromise(reader.read(sales.runtime.count, { filters: { name: "Original" },
        config: { select: ["id", "name"], take: 1 } })))
        .toEqual([[{ id: "logical-channel", name: "Original" }], 1]);
      if (fixture.observeSql !== undefined) expect(observedSql.some(sql => sql.includes("fx_app_index_entry_current"))).toBe(true);
      fixture.observeSql?.(undefined);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), update,
        { id: "logical-channel", data: { name: "Updated", metadata: { keep: 1, remove: "old" } } })))
        .toMatchObject({ id: "logical-channel", name: "Updated", metadata: { keep: 1, remove: "old" } });
      expect(await Effect.runPromise(host.run(host.newRequestKey(), update,
        { id: "logical-channel", data: { metadata: { remove: "", added: null } } })))
        .toMatchObject({ metadata: { keep: 1, added: null } });
      expect(await Effect.runPromise(reader.read(sales.runtime.count, { filters: { name: "Original" },
        config: { select: ["id"], take: 1 } }))).toEqual([[], 0]);
      expect(await Effect.runPromise(reader.read(sales.runtime.count, { filters: { name: "Updated" },
        config: { select: ["id"], take: 1 } }))).toEqual([[{ id: "logical-channel" }], 1]);
      const afterUpdate = await events();
      expect(afterUpdate.slice(afterCreate.length).map(event => event.envelope.contract))
        .toEqual([eventName("updated"), eventName("updated")]);
      const deleteKey = host.newRequestKey();
      expect(await Effect.runPromise(host.run(deleteKey, remove, ["logical-channel"]))).toBeNull();
      const afterDelete = await events();
      expect(afterDelete.slice(afterUpdate.length).map(event => event.envelope.contract)).toEqual([eventName("deleted")]);
      expect(await Effect.runPromise(host.run(deleteKey, remove, ["logical-channel"]))).toBeNull();
      expect(await events()).toEqual(afterDelete);
      expect(await Effect.runPromise(reader.read(sales.runtime.count, { filters: { id: "logical-channel" },
        config: { select: ["id"], take: 1 } }))).toEqual([[], 0]);
      expect(await Effect.runPromise(reader.read(sales.runtime.count, { filters: { name: "Updated" },
        config: { select: ["id"], take: 1 } }))).toEqual([[], 0]);
    } finally { fixture.observeSql?.(undefined); await Effect.runPromise(reader.close); await Effect.runPromise(host.close); }
  }, 120_000);

  it("refuses missing module evidence and unmanaged fields without publication", async () => {
    const policy = sales.runtime.logicalEventPolicy();
    const attempted = [
      { commandName: "salesChannelCreate", mode: "write", input: {}, result: {},
        events: [], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 },
    ] as const;
    const mutation = [{ ordinal: 0, table: "sales_channel", operation: "insert", before: null,
      after: { id: "orphan-channel", name: "Orphan", deleted_at: null } }] as const;
    expect(await Effect.runPromise(Effect.result(policy.validateLogical(attempted, mutation, [], []))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    const attached = { name: eventName("created"), metadata: { source: Modules.SALES_CHANNEL,
      object: "sales_channel", action: "created" }, data: { id: "orphan-channel" } };
    for (const emitted of [[attached, attached], [{ ...attached, data: { id: "forged-channel" } }]]) {
      expect(await Effect.runPromise(Effect.result(policy.validateLogical([
        { ...attempted[0], events: emitted },
      ], mutation, [], [])))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
    const { host, create, update } = await prepareNativeHost();
    const reader = await Effect.runPromise(makeCommerceHost(sales.hostInput));
    try {
      const beforeRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await events();
      for (const input of [{ id: "bad-channel", name: "Bad", deleted_at: null },
        { id: "bad-channel", name: "Bad", is_disabled: "false" },
        { id: "bad-channel", name: null }]) {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), create, input))).rejects.toBeDefined();
      }
      for (const data of [{ id: "another-channel", name: "Hijacked" }, { updated_at: "2026-01-01" }]) {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), update,
          { id: "logical-channel", data }))).rejects.toBeDefined();
      }
      for (const config of [{ relations: ["products"] }, { select: ["not_a_field"] },
        { cache: true }, { take: -1 }, { order: { name: "ASC" } }]) {
        await expect(Effect.runPromise(reader.read(sales.runtime.list,
          { filters: { id: "absent" }, config }))).rejects.toBeDefined();
      }
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(reader.close); await Effect.runPromise(host.close); }
  }, 120_000);

  it("rolls back native rows and events when receipts are missing, duplicated or forged", async () => {
    const forged = { name: eventName("created"), metadata: { source: Modules.SALES_CHANNEL,
      object: "sales_channel", action: "created" }, data: { id: "not-written" } } satisfies Json;
    const substitutions: Array<(events: readonly Json[]) => readonly Json[]> = [
      () => [], emitted => [...emitted, ...emitted], () => [forged],
    ];
    const beforeRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
    const beforeEvents = await events();
    for (const substitute of substitutions) {
      const { host, create } = await prepareNativeHost(fixture, sales, substitute);
      try {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), create,
          { id: "mismatched-logical-channel", name: "Must roll back" }))).rejects
          .toMatchObject({ _tag: "CommerceTransactionError", reason: "receiptMismatch" });
        expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
        expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
  }, 120_000);

  it("retains admitted ID inequality, empty batches and bounded native count", async () => {
    const { host, create, remove } = await prepareNativeHost();
    const reader = await Effect.runPromise(makeCommerceHost(sales.hostInput));
    try {
      const before = await events();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), create, []))).toEqual([]);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), remove, []))).toBeNull();
      expect(await events()).toEqual(before);
      const rows = ["a", "b", "c"].map(id => ({ id: `logical-neq-${id}`, name: "Inequality" }));
      await Effect.runPromise(host.run(host.newRequestKey(), create, rows));
      expect(await Effect.runPromise(reader.read(sales.runtime.count, {
        filters: { name: "Inequality", id: { $ne: "logical-neq-a" } },
        config: { select: ["id"], skip: 1, take: 1 },
      }))).toEqual([[{ id: "logical-neq-c" }], 2]);
      for (const filters of [{ name: { $ne: "Inequality" } }, { is_disabled: { $ne: false } },
        { id: { $ne: null } }]) {
        await expect(Effect.runPromise(reader.read(sales.runtime.list, { filters }))).rejects.toBeDefined();
      }
      await Effect.runPromise(host.run(host.newRequestKey(), remove, rows.map(row => row.id)));
    } finally { await Effect.runPromise(reader.close); await Effect.runPromise(host.close); }
  }, 120_000);

  it("accepts a native unrestricted text name through its exact equality read", async () => {
    const { host, create, update, remove } = await prepareNativeHost();
    const reader = await Effect.runPromise(makeCommerceHost(sales.hostInput));
    const name = "a".repeat(2_047);
    const neighbor = `${"a".repeat(2_046)}b`;
    const renamed = `${"a".repeat(2_046)}c`;
    try {
      const created = await Effect.runPromise(host.run(host.newRequestKey(), create, { id: "long-name-channel", name }));
      const adjacent = await Effect.runPromise(host.run(host.newRequestKey(), create, { id: "long-name-neighbor", name: neighbor }));
      const table = sales.definition.schema.tables[0];
      if (table === undefined || !isJsonObject(created) || !isJsonObject(adjacent)) throw new Error("Missing logical SalesChannel rows");
      const exact = Result.getOrThrow(compileLogicalRelationalRead(table, sales.definition.schema.capabilities,
        { fields: ["id"], order: { column: "id", direction: "asc" },
          predicate: { kind: "in", column: "name", values: [name] } }, 128, reason => new Error(reason)));
      // Even if a digest collision selects both rows, core inspects full text.
      expect(Result.getOrThrow(exact.inspect(created)).matches).toBe(true);
      expect(Result.getOrThrow(exact.inspect(adjacent)).matches).toBe(false);
      expect(await Effect.runPromise(reader.read(sales.runtime.count,
        { filters: { name }, config: { select: ["id"], take: 1 } })))
        .toEqual([[{ id: "long-name-channel" }], 1]);
      expect(await Effect.runPromise(reader.read(sales.runtime.count,
        { filters: { name: neighbor }, config: { select: ["id"], take: 1 } })))
        .toEqual([[{ id: "long-name-neighbor" }], 1]);
      await Effect.runPromise(host.run(host.newRequestKey(), update,
        { id: "long-name-channel", data: { name: renamed } }));
      expect(await Effect.runPromise(reader.read(sales.runtime.count,
        { filters: { name }, config: { select: ["id"], take: 1 } }))).toEqual([[], 0]);
      expect(await Effect.runPromise(reader.read(sales.runtime.count,
        { filters: { name: renamed }, config: { select: ["id"], take: 1 } })))
        .toEqual([[{ id: "long-name-channel" }], 1]);
      await Effect.runPromise(host.run(host.newRequestKey(), remove, ["long-name-channel", "long-name-neighbor"]));
    } finally { await Effect.runPromise(reader.close); await Effect.runPromise(host.close); }
  }, 120_000);

  it("orders selected long and supplementary text by complete UTF-8 bytes", async () => {
    const { host, create, remove } = await prepareNativeHost();
    const rows = [
      { id: "ordered-long", name: "a".repeat(2_047) },
      { id: "ordered-bmp", name: "\ue000" },
      { id: "ordered-supplementary", name: "\ud800\udc00" },
    ];
    const orderedNames = defineCommerceCommand("salesChannelOrderNames", "read", Effect.fn(function* (ctx) {
      const table = yield* ctx.table("sales_channel");
      return yield* table.find(ctx.manager, { fields: ["id", "name"],
        predicate: { kind: "in", column: "name", values: rows.map(row => row.name) },
        order: { column: "name", direction: "asc" }, take: 3 });
    }));
    const reader = await Effect.runPromise(makeCommerceHost({ ...sales.hostInput, commands: [orderedNames] }));
    try {
      await Effect.runPromise(host.run(host.newRequestKey(), create, rows));
      const selected = await Effect.runPromise(reader.read(orderedNames, null));
      if (!Array.isArray(selected)) throw new Error("Missing ordered SalesChannel rows");
      expect(selected.map((row: unknown) => typeof row === "object" && row !== null && "id" in row ? row.id : undefined))
        .toEqual(["ordered-long", "ordered-bmp", "ordered-supplementary"]);
    } finally {
      await Effect.runPromise(host.run(host.newRequestKey(), remove, rows.map(row => row.id)));
      await Effect.runPromise(reader.close);
      await Effect.runPromise(host.close);
    }
  }, 120_000);

  it("keeps skip-only native result and count semantics within the bounded catalog", async () => {
    const { host, create, remove } = await prepareNativeHost();
    const reader = await Effect.runPromise(makeCommerceHost(sales.hostInput));
    try {
      const rows = Array.from({ length: 20 }, (_, index) => ({
        id: `logical-window-${String(index).padStart(2, "0")}`, name: "Window",
      }));
      await Effect.runPromise(host.run(host.newRequestKey(), create, rows));
      const selected = rows.map(({ id }) => ({ id }));
      expect(await Effect.runPromise(reader.read(sales.runtime.count,
        { filters: { name: "Window" }, config: { select: ["id"], skip: 1 } })))
        .toEqual([selected.slice(1), 20]);
      expect(await Effect.runPromise(reader.read(sales.runtime.list,
        { filters: { name: "Window" }, config: { select: ["id"], skip: 1, order: { id: "DESC" } } })))
        .toEqual([...selected].reverse().slice(1));
      await Effect.runPromise(host.run(host.newRequestKey(), remove, rows.map(row => row.id)));
    } finally { await Effect.runPromise(reader.close); await Effect.runPromise(host.close); }
  }, 120_000);

  it("selects one exact name across a larger shop and refuses an overflowing match set", async () => {
    const { host, create, remove } = await prepareNativeHost();
    const reader = await Effect.runPromise(makeCommerceHost(sales.hostInput));
    const filler = Array.from({ length: 129 }, (_, index) => ({
      id: `logical-large-shop-${String(index).padStart(3, "0")}`, name: "Large Shop Filler",
    }));
    const selected = { id: "logical-large-shop-target", name: "Large Shop Target" };
    try {
      for (let offset = 0; offset < filler.length; offset += 32)
        await Effect.runPromise(host.run(host.newRequestKey(), create, filler.slice(offset, offset + 32)));
      await Effect.runPromise(host.run(host.newRequestKey(), create, selected));
      expect(await Effect.runPromise(reader.read(sales.runtime.count, {
        filters: { name: selected.name }, config: { select: ["id"], take: 1 },
      }))).toEqual([[{ id: selected.id }], 1]);
      await expect(Effect.runPromise(reader.read(sales.runtime.count, {
        filters: { name: "Large Shop Filler" }, config: { select: ["id"], take: 1 },
      }))).rejects.toBeDefined();
    } finally {
      for (let offset = 0; offset < filler.length; offset += 32)
        await Effect.runPromise(host.run(host.newRequestKey(), remove, filler.slice(offset, offset + 32).map(row => row.id)));
      await Effect.runPromise(host.run(host.newRequestKey(), remove, [selected.id]));
      await Effect.runPromise(reader.close);
      await Effect.runPromise(host.close);
    }
  }, 150_000);

  it("revokes native service methods after their command lifetime", async () => {
    let escaped: Parameters<Parameters<typeof sales.runtime.withService>[1]>[0] | undefined;
    const borrow = defineCommerceCommand("salesChannelBorrowLogical", "read", ctx =>
      sales.runtime.withService(ctx, async scope => { escaped = scope; return []; }));
    const reader = await Effect.runPromise(makeCommerceHost({ ...sales.hostInput, commands: [borrow] }));
    try {
      await Effect.runPromise(reader.read(borrow, null));
      if (escaped === undefined) throw new Error("Missing borrowed SalesChannel service");
      await expect(escaped.service.listSalesChannels({}, {}, escaped.context)).rejects.toBeDefined();
      await expect(escaped.service.createSalesChannels({ name: "Escaped" }, escaped.context)).rejects.toBeDefined();
    } finally { await Effect.runPromise(reader.close); }
  });

  it("rolls back a duplicate batch and keeps two shops with colliding IDs isolated", async () => {
    const first = await prepareNativeHost();
    try {
      const beforeRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await events();
      await expect(Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create, [
        { id: "duplicate-channel", name: "First" }, { id: "duplicate-channel", name: "Second" },
      ]))).rejects.toBeDefined();
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(beforeRows);
      expect(await events()).toEqual(beforeEvents);
      const other = await logicalCurrencyFixture(driver, close => cleanup.push(close), {
        resource: fixture.resource, fixtureIdentity: { deploymentId: "deployment_sales_channel_shop_b",
          projectId: "project_sales_channel_shop_b", uuidOffset: 5_000 }, includeSalesChannel: true,
      });
      const otherSales = await prepareLogicalSalesChannelHost(other);
      await Effect.runPromise(otherSales.host.initialize([]));
      await Effect.runPromise(otherSales.host.close);
      const second = await prepareNativeHost(other, otherSales);
      try {
        const same = { id: "shared-sales-channel", name: "Same" };
        await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create, same));
        await Effect.runPromise(second.host.run(second.host.newRequestKey(), second.create, same));
        const firstScope = projectScopeIdUuidV1(fixture.application.authority.scopeId).scopeUuid;
        const secondScope = projectScopeIdUuidV1(other.application.authority.scopeId).scopeUuid;
        expect(firstScope).not.toBe(secondScope);
        const secondRows = (await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
          .filter(row => row.scopeUuid === secondScope);
        await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.remove, [same.id]));
        expect((await fixture.persistence.drizzle.select().from(fxAppRowCurrent))
          .filter(row => row.scopeUuid === secondScope)).toEqual(secondRows);
      } finally { await Effect.runPromise(second.host.close); }
    } finally { await Effect.runPromise(first.host.close); }
  }, 150_000);

  it("commits native Product and SalesChannel writes with distinct events in one logical root", async () => {
    const catalog = await Effect.runPromise(captureProductSchema("logical-sales-endpoints")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const productPolicy = productLogicalCreateEventPolicy(catalog);
    const salesPolicy = sales.runtime.logicalEventPolicy();
    const productParticipant = defineAtomicCommerceParticipant("product");
    const salesParticipant = defineAtomicCommerceParticipant("salesChannel");
    const root = defineAtomicCommerceCommand("createLogicalSalesEndpoints", Effect.fn(function* (ctx, id) {
      if (typeof id !== "string") return yield* ctx.refuse(commerceError("invalidInput"));
      yield* ctx.call(productParticipant, product.runtime.commands.create,
        { id: `prod-${id}`, title: "Shared Product" });
      yield* ctx.call(salesParticipant, sales.runtime.create,
        { id: `sc-${id}`, name: "Shared Channel" });
      return { products: yield* ctx.call(productParticipant, product.runtime.commands.list,
        { filters: { id: `prod-${id}` }, config: { select: ["id"], take: 1 } }),
        channels: yield* ctx.call(salesParticipant, sales.runtime.count,
          { filters: { id: `sc-${id}` }, config: { select: ["id"], take: 1 } }) };
    }));
    const revision = "3".repeat(64);
    const productCreated = defineCommerceEventContract({ name: catalog.product.createdEvent,
      revision, internal: true, decode: productPolicy.capture });
    const salesCreated = defineCommerceEventContract({ name: eventName("created"),
      revision, internal: true, decode: salesPolicy.capture });
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput,
      identityAndAccessPolicy: { profile: "logical-sales-endpoints" },
      participants: [
        { participant: productParticipant, logicalStorage: product.hostInput.logicalStorage,
          commands: [product.runtime.commands.create, product.runtime.commands.list],
          validateLogical: productPolicy.validateLogical,
          events: { contracts: [productCreated], select: () => Effect.succeed(productCreated) } },
        { participant: salesParticipant, logicalStorage: sales.hostInput.logicalStorage,
          commands: [sales.runtime.create, sales.runtime.count], validateLogical: salesPolicy.validateLogical,
          events: { contracts: [salesCreated], select: () => Effect.succeed(salesCreated) } },
      ], commands: [root], events: { producerRevision: revision,
        contracts: [productCreated, salesCreated], subscribers: [{ id: "logical-sales-endpoints", revision: "4".repeat(64) }],
        validate: emitted => emitted.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try {
      const beforeRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const beforeEvents = await events();
      const key = host.newRequestKey();
      const output = await Effect.runPromise(host.run(key, root, "combined-endpoints"));
      expect(output).toEqual({ products: [{ id: "prod-combined-endpoints" }],
        channels: [[{ id: "sc-combined-endpoints" }], 1] });
      const afterRows = await fixture.persistence.drizzle.select().from(fxAppRowCurrent);
      const afterEvents = await events();
      expect(afterRows.length - beforeRows.length).toBe(2);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.product.createdEvent, eventName("created")]);
      expect(await Effect.runPromise(host.run(key, root, "combined-endpoints"))).toEqual(output);
      expect(await fixture.persistence.drizzle.select().from(fxAppRowCurrent)).toEqual(afterRows);
      expect(await events()).toEqual(afterEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);
});
