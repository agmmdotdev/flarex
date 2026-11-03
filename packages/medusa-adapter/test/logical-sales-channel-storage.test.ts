import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Effect, Result } from "effect";
import { Modules, buildModuleResourceEventName } from "@medusajs/framework/utils/portable";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommerceTransactionError, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCommerceCallValidation } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { CoreNativeUniqueConflict } from "../../persistence-postgres/src/core/api";
import { defineCommerceCommand } from "../../persistence-postgres/src/frameworks/commerceTransaction/commands";
import { compileLogicalRelationalRead } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery";
import { captureProductSchema } from "../src/modules/product/schema";
import { productRuntimeMetadata } from "../src/modules/product/runtime-metadata";


import { prepareCoreSalesChannel } from "./support/core-sales-channel-fixture";
import { expectWorkflowRefusal, expectWorkflowTypedFailures } from "./support/workflow-failure-assertions";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid SalesChannel test driver");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreSalesChannel>>;
let fixture: Awaited<ReturnType<typeof prepareCoreSalesChannel>>["fixture"];
let sales: Awaited<ReturnType<typeof prepareCoreSalesChannel>>["sales"];
let product: NonNullable<Awaited<ReturnType<typeof prepareCoreSalesChannel>>["product"]>;
const events = async () => (await fixture.snapshot()).events;
const rows = async () => (await fixture.snapshot()).rows;
const openSalesRead = () => fixture.openReadHost("sales_channel", [sales.runtime.list, sales.runtime.count, sales.runtime.retrieve]);
const eventName = (action: "created" | "updated" | "deleted") => buildModuleResourceEventName({
  prefix: Modules.SALES_CHANNEL, objectName: "sales_channel", action,
});

async function prepareNativeHost(selectedFixture = fixture, selectedSales = sales,
  substituteEvents?: (events: readonly Json[]) => readonly Json[],
  observe?: LogicalCommerceCallValidation) {
  const caught: CommerceTransactionError[] = [];
  const participant = defineAtomicCommerceParticipant("salesChannel");
  const create = defineAtomicCommerceCommand("nativeSalesChannelCreate", (ctx, input) =>
    ctx.call(participant, selectedSales.runtime.create, input));
  const update = defineAtomicCommerceCommand("nativeSalesChannelUpdate", (ctx, input) =>
    ctx.call(participant, selectedSales.runtime.update, input));
  const remove = defineAtomicCommerceCommand("nativeSalesChannelDelete", (ctx, input) =>
    ctx.call(participant, selectedSales.runtime.delete, input));
  const compose = defineAtomicCommerceCommand("nativeSalesChannelCompose", (ctx, input) => Effect.gen(function* () {
    if (typeof input !== "string") return yield* Effect.fail(commerceError("invalidInput"));
    yield* ctx.call(participant, selectedSales.runtime.create, { id: input, name: "First" });
    yield* ctx.call(participant, selectedSales.runtime.create, { id: `${input}-second`, name: "Second" });
    const pending = yield* ctx.call(participant, selectedSales.runtime.count,
      { filters: { id: input }, config: { select: ["id", "name"], take: 1 } });
    yield* ctx.call(participant, selectedSales.runtime.update, { id: input, data: { name: "Updated" } });
    const result = yield* ctx.call(participant, selectedSales.runtime.update, { id: input, data: { name: "Final" } });
    yield* ctx.call(participant, selectedSales.runtime.delete, [`${input}-second`]);
    return { pending, result };
  }).pipe(Effect.catch(error => Effect.sync(() => { caught.push(error); return "caught"; }))));
  const policy = selectedSales.runtime.logicalEventPolicy();
  const validateLogicalCall: LogicalCommerceCallValidation = (call, activity, command) => policy.validateLogicalCall(
    substituteEvents !== undefined && call.mode === "write" ? { ...call, events: substituteEvents(call.events) } : call,
    activity).pipe(Effect.andThen(() => observe?.(call, activity, command) ?? Effect.void));
  const revision = "1".repeat(64);
  const contracts = {
    created: defineCommerceEventContract({ name: eventName("created"), revision, internal: true, decode: policy.capture }),
    updated: defineCommerceEventContract({ name: eventName("updated"), revision, internal: true, decode: policy.capture }),
    deleted: defineCommerceEventContract({ name: eventName("deleted"), revision, internal: true, decode: policy.capture }),
  };
  const eventContracts = Object.values(contracts);
  const host = await Effect.runPromise(selectedFixture.execution.prepare({
    identityAndAccessPolicy: { profile: "logical-sales-channel-native" },
    participants: [{ participant, nativeStorage: selectedSales.source,
      commands: selectedSales.runtime.commands, validateLogicalCall,
      events: { contracts: eventContracts, select: (message: Json) => {
        const selected = (["created", "updated", "deleted"] as const).find(action =>
          isJsonObject(message) && message.name === eventName(action));
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent"))
          : Effect.succeed(contracts[selected]);
      } } }], commands: [create, update, remove, compose],
    events: { producerRevision: revision, contracts: eventContracts,
      subscribers: [{ id: "logical-sales-channel", revision: "2".repeat(64) }],
      validate: emitted => emitted.some(event => !event.internal)
        ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  return { host, create, update, remove, compose, caught };
}

describe("native SalesChannel service on shared logical storage", () => {
  beforeAll(async () => {
    connected = await prepareCoreSalesChannel(driver, close => cleanup.push(close), { includeProduct: true });
    fixture = connected.fixture; sales = connected.sales;
    if (connected.product === undefined) throw new Error("Missing selected Product source");
    product = connected.product;
  }, 150_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("composes repeated scalar writes with call-local evidence, pending reads and replay", async () => {
    const observations: Array<Parameters<LogicalCommerceCallValidation>[1]> = [];
    const { host, compose } = await prepareNativeHost(fixture, sales, undefined,
      (_call, activity) => Effect.sync(() => { observations.push(activity); }));
    const before = await events();
    try {
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, compose, "composed-channel"));
      expect(result).toMatchObject({ pending: [[{ id: "composed-channel", name: "First" }], 1],
        result: { id: "composed-channel", name: "Final" } });
      expect(observations.map(activity => activity.mutations.map(mutation => mutation.ordinal)))
        .toEqual([[0], [0], [], [0], [0], [0]]);
      expect(observations[0]?.observedRows.map(value => value.row.name)).toEqual(["First"]);
      expect(observations[3]?.mutations[0]?.before?.name).toBe("First");
      expect(observations[4]?.mutations[0]?.before?.name).toBe("Updated");
      const after = await events();
      expect(after.slice(before.length).map(event => event.envelope.contract))
        .toEqual((["created", "created", "updated", "updated", "deleted"] as const).map(eventName));
      expect(new Set(after.slice(before.length).map(event => event.timestamp)).size).toBe(1);
      expect(await Effect.runPromise(host.run(key, compose, "composed-channel"))).toEqual(result);
      expect(observations).toHaveLength(6);
      expect(await events()).toEqual(after);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("preserves native empty-update rows and timestamps without writes or update events", async () => {
    const observations: Array<Parameters<LogicalCommerceCallValidation>[1]> = [];
    const { host, create, update } = await prepareNativeHost(fixture, sales, undefined,
      (_call, activity) => Effect.sync(() => { observations.push(activity); }));
    try {
      const created = await Effect.runPromise(host.run(host.newRequestKey(), create,
        { id: "sales-native-empty-update", name: "Unchanged", metadata: { keep: true } }));
      const beforeRows = await rows();
      const beforeEvents = await events();
      const key = host.newRequestKey();
      const result = await Effect.runPromise(host.run(key, update,
        { id: "sales-native-empty-update", data: {} }));
      // Pinned Drizzle's update branch (medusa.ts:509) returns the existing
      // entity when scalar updateData is empty and does not dispatch afterUpdate.
      expect(result).toEqual(created);
      expect(observations.at(-1)?.mutations).toEqual([]);
      expect(await rows()).toEqual(beforeRows);
      expect(await events()).toEqual(beforeEvents);
      const replayed = await Effect.runPromise(host.run(key, update,
        { id: "sales-native-empty-update", data: {} }));
      expect(replayed).toEqual(created);
      expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("rolls back earlier scalar calls when a caught second-call receipt fails", async () => {
    let calls = 0;
    const { host, compose, caught } = await prepareNativeHost(fixture, sales, emitted => ++calls === 2 ? [] : emitted);
    const before = { rows: await rows(), events: await events() };
    try {
      await expect(Effect.runPromise(host.run(host.newRequestKey(), compose, "refused-composed-channel")))
        .rejects.toMatchObject({ reason: "rollbackOnly" });
      expect(caught).toMatchObject([{ reason: "receiptMismatch" }]);
      expect(calls).toBe(2);
      expect({ rows: await rows(), events: await events() }).toEqual(before);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("admits the pinned model without a generated SalesChannel table", async () => {
    expect(sales.schema.tables.map(table => table.identity.tableId)).toEqual(["sales_channel"]);
    expect(sales.schema.tables[0]?.keys.find(key => key.kind === "primary")?.columns
      .map(column => column.columnId)).toEqual(["id"]);
    expect(await connected.readPhysicalTables()).toEqual(connected.physicalTablesBeforeCandidate);
    expect(await connected.readPhysicalTables())
      .toEqual(["documents", "indexes", "leases", "persistence_globals", "read_only"].map(name => ({ name })));
  });

  it("confines a SalesChannel source even when Product is composed in the same schema", async () => {
    const unbound = defineCommerceCommand("salesChannelUnboundProductRead", "read", Effect.fn(function* (ctx) {
      const table = yield* ctx.table("product");
      return yield* table.find(ctx.manager, { fields: ["id"], take: 1,
        predicate: { kind: "eq", column: "id", value: "absent" } });
    }));
    const reader = await Effect.runPromise(fixture.openReadHost("sales_channel", [unbound]));
    try {
      await expect(Effect.runPromise(reader.read(unbound, {}))).rejects
        .toMatchObject({ _tag: "CommerceTransactionError", reason: "invalidAuthority" });
    } finally { await Effect.runPromise(reader.close); }
  });

  it("creates, updates and deletes through native methods with exact events and replay", async () => {
    const { host, create, update, remove } = await prepareNativeHost();
    const reader = await Effect.runPromise(openSalesRead());
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

      expect(await Effect.runPromise(reader.read(sales.runtime.count, { filters: { id: "logical-channel" },
        config: { select: ["id", "name", "is_disabled"], take: 1 } })))
        .toEqual([[{ id: "logical-channel", name: "Original", is_disabled: false }], 1]);
      expect(await Effect.runPromise(reader.read(sales.runtime.count, { filters: { name: "Original" },
        config: { select: ["id", "name"], take: 1 } })))
        .toEqual([[{ id: "logical-channel", name: "Original" }], 1]);
      expect((await fixture.snapshot()).indexes.some(entry => entry.table === sales.definition.tables[0]?.name)).toBe(true);
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
    } finally { await Effect.runPromise(reader.close); await Effect.runPromise(host.close); }
  }, 120_000);

  it("refuses missing module evidence and unmanaged fields without publication", async () => {
    const policy = sales.runtime.logicalEventPolicy();
    const attempted = [
      { commandName: "salesChannelCreate", mode: "write", input: {}, result: {},
        events: [], fromAttempt: 0, toAttempt: 1, fromLifecycle: 0, toLifecycle: 0 },
    ] as const;
    const mutation = [{ ordinal: 0, table: "sales_channel", operation: "insert", before: null,
      after: { id: "orphan-channel", name: "Orphan", deleted_at: null } }] as const;
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(attempted[0], { mutations: mutation, lifecycle: [], observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    const attached = { name: eventName("created"), metadata: { source: Modules.SALES_CHANNEL,
      object: "sales_channel", action: "created" }, data: { id: "orphan-channel" } };
    for (const emitted of [[attached, attached], [{ ...attached, data: { id: "forged-channel" } }]]) {
      expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...attempted[0], events: emitted },
        { mutations: mutation, lifecycle: [], observedRows: [], setNull: [], relationalReads: [], referenceReplacements: [] })))).toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    }
    const { host, create, update } = await prepareNativeHost();
    const reader = await Effect.runPromise(openSalesRead());
    try {
      const beforeRows = await rows();
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
      expect(await rows()).toEqual(beforeRows);
      expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(reader.close); await Effect.runPromise(host.close); }
  }, 120_000);

  it("rolls back native rows and events when receipts are missing, duplicated or forged", async () => {
    const forged = { name: eventName("created"), metadata: { source: Modules.SALES_CHANNEL,
      object: "sales_channel", action: "created" }, data: { id: "not-written" } } satisfies Json;
    const substitutions: Array<(events: readonly Json[]) => readonly Json[]> = [
      () => [], emitted => [...emitted, ...emitted], () => [forged],
    ];
    const beforeRows = await rows();
    const beforeEvents = await events();
    for (const substitute of substitutions) {
      const { host, create } = await prepareNativeHost(fixture, sales, substitute);
      try {
        await expect(Effect.runPromise(host.run(host.newRequestKey(), create,
          { id: "mismatched-logical-channel", name: "Must roll back" }))).rejects
          .toMatchObject({ _tag: "CommerceTransactionError", reason: "receiptMismatch" });
        expect(await rows()).toEqual(beforeRows);
        expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
  }, 120_000);

  it("retains admitted ID inequality, empty batches and bounded native count", async () => {
    const { host, create, remove } = await prepareNativeHost();
    const reader = await Effect.runPromise(openSalesRead());
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
    const reader = await Effect.runPromise(openSalesRead());
    const name = "a".repeat(2_047);
    const neighbor = `${"a".repeat(2_046)}b`;
    const renamed = `${"a".repeat(2_046)}c`;
    try {
      const created = await Effect.runPromise(host.run(host.newRequestKey(), create, { id: "long-name-channel", name }));
      const adjacent = await Effect.runPromise(host.run(host.newRequestKey(), create, { id: "long-name-neighbor", name: neighbor }));
      const table = sales.schema.tables[0];
      if (table === undefined || !isJsonObject(created) || !isJsonObject(adjacent)) throw new Error("Missing logical SalesChannel rows");
      const exact = Result.getOrThrow(compileLogicalRelationalRead(table, sales.schema.capabilities,
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
    const reader = await Effect.runPromise(fixture.openReadHost("sales_channel", [orderedNames]));
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
    const reader = await Effect.runPromise(openSalesRead());
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
    const reader = await Effect.runPromise(openSalesRead());
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
    const reader = await Effect.runPromise(fixture.openReadHost("sales_channel", [borrow]));
    try {
      await Effect.runPromise(reader.read(borrow, null));
      if (escaped === undefined) throw new Error("Missing borrowed SalesChannel service");
      await expect(escaped.service.listSalesChannels({}, {}, escaped.context)).rejects.toBeDefined();
      await expect(escaped.service.createSalesChannels({ name: "Escaped" }, escaped.context)).rejects.toBeDefined();
    } finally { await Effect.runPromise(reader.close); }
  });

  it("preserves fresh repeated-ID aliases, rolls back persisted-ID conflicts and isolates colliding IDs", async () => {
    const first = await prepareNativeHost();
    try {
      const before = await fixture.snapshot();
      // The old Drizzle raw-insert primary-key rejection is a separate
      // baseline. Native scalar creation retains one canonical row and every
      // response position; the first non-null supplied name wins.
      const result = await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create, [
        { id: "duplicate-channel", name: "First" }, { id: "duplicate-channel", name: "Second" },
      ]));
      if (!Array.isArray(result) || !isJsonObject(result[0])) throw new Error("Missing canonical native Sales Channel aliases");
      const canonical = result[0];
      expect(result).toEqual([canonical, canonical]);
      expect(canonical).toEqual({ id: "duplicate-channel", name: "First", description: null,
        is_disabled: false, metadata: null, created_at: expect.any(String), updated_at: expect.any(String), deleted_at: null });
      const committed = await fixture.snapshot();
      expect(await fixture.readRows("sales_channel", ["duplicate-channel"])).toEqual([canonical]);
      expect(committed.rows.length - before.rows.length).toBe(1);
      expect(committed.revisions.length - before.revisions.length).toBe(1);
      expect(committed.outcomes.length - before.outcomes.length).toBe(1);
      const emitted = committed.events.slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual([eventName("created")]);
      expect(emitted.map(event => event.envelope.internal)).toEqual([true]);
      expect(emitted.map(event => event.envelope.message)).toEqual([{ name: eventName("created"),
        metadata: { source: Modules.SALES_CHANNEL, object: "sales_channel", action: "created" }, data: { id: canonical.id } }]);
      const primary = sales.schema.tables.find(table => table.identity.tableId === "sales_channel")?.keys.find(key => key.kind === "primary");
      if (primary === undefined) throw new Error("Missing native Sales Channel primary key declaration");
      for (const data of [
        [{ id: "duplicate-channel", name: "Conflicting persisted row" }],
        [{ id: "duplicate-new-pending", name: "Must roll back" }, { id: "duplicate-channel", name: "Conflicting persisted row" }],
      ]) {
        const refusal = expectWorkflowRefusal(await Effect.runPromiseExit(first.host.run(first.host.newRequestKey(), first.create, data)), "invalidInput");
        expect(refusal.cause).toBeInstanceOf(CoreNativeUniqueConflict);
        expect(refusal.cause).toMatchObject({ descriptor: primary.identity.keyId, fields: ["id"] });
        expect(await fixture.snapshot()).toEqual(committed);
      }
      const other = await prepareCoreSalesChannel(driver, close => cleanup.push(close), { physical: fixture.physical });
      const second = await prepareNativeHost(other.fixture, other.sales);
      try {
        const same = { id: "shared-sales-channel", name: "Same" };
        await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.create, same));
        await Effect.runPromise(second.host.run(second.host.newRequestKey(), second.create, same));
        expect(connected.target.scopeUuid).not.toBe(other.target.scopeUuid);
        expect(fixture.physical.instanceName).not.toBe(other.fixture.physical.instanceName);
        const secondRows = (await other.fixture.snapshot()).rows;
        await Effect.runPromise(first.host.run(first.host.newRequestKey(), first.remove, [same.id]));
        expect((await other.fixture.snapshot()).rows).toEqual(secondRows);
      } finally { await Effect.runPromise(second.host.close); }
    } finally { await Effect.runPromise(first.host.close); }
  }, 150_000);

  it("commits native Product and SalesChannel writes with distinct events in one logical root", async () => {
    const catalog = await Effect.runPromise(captureProductSchema("logical-sales-endpoints")
      .pipe(Effect.flatMap(value => productRuntimeMetadata(value.metadata.frame))));
    const productPolicy = product.runtime.logicalPolicy;
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
    const host = await Effect.runPromise(fixture.execution.prepare({
      identityAndAccessPolicy: { profile: "logical-sales-endpoints" },
      participants: [
        { participant: productParticipant, nativeStorage: product.source,
          commands: [product.runtime.commands.create, product.runtime.commands.list],
          validateLogicalCall: productPolicy.validateLogicalCall,
          events: { contracts: [productCreated], select: () => Effect.succeed(productCreated) } },
        { participant: salesParticipant, nativeStorage: sales.source,
          commands: [sales.runtime.create, sales.runtime.count], validateLogicalCall: salesPolicy.validateLogicalCall,
          events: { contracts: [salesCreated], select: () => Effect.succeed(salesCreated) } },
      ], commands: [root], events: { producerRevision: revision,
        contracts: [productCreated, salesCreated], subscribers: [{ id: "logical-sales-endpoints", revision: "4".repeat(64) }],
        validate: emitted => emitted.some(event => !event.internal)
          ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
    }));
    try {
      const beforeRows = await rows();
      const beforeEvents = await events();
      const key = host.newRequestKey();
      const output = await Effect.runPromise(host.run(key, root, "combined-endpoints"));
      expect(output).toEqual({ products: [{ id: "prod-combined-endpoints" }],
        channels: [[{ id: "sc-combined-endpoints" }], 1] });
      const afterRows = await rows();
      const afterEvents = await events();
      expect(afterRows.length - beforeRows.length).toBe(2);
      expect(afterEvents.slice(beforeEvents.length).map(event => event.envelope.contract))
        .toEqual([catalog.product.createdEvent, eventName("created")]);
      expect(await Effect.runPromise(host.run(key, root, "combined-endpoints"))).toEqual(output);
      expect(await rows()).toEqual(afterRows);
      expect(await events()).toEqual(afterEvents);
    } finally { await Effect.runPromise(host.close); }
  }, 120_000);

  it("selects sparse native disabled-channel reads beyond the complete-set bound", async () => {
    const { host, create, update, remove } = await prepareNativeHost();
    const reader = await Effect.runPromise(openSalesRead());
    try {
      const unrelated = Array.from({ length: 129 }, (_, index) => ({
        id: `boolean-unrelated-${index}`, name: `Boolean unrelated ${index}`, is_disabled: false,
      }));
      for (let start = 0; start < unrelated.length; start += 32) {
        await Effect.runPromise(host.run(host.newRequestKey(), create, unrelated.slice(start, start + 32)));
      }
      await Effect.runPromise(host.run(host.newRequestKey(), create,
        { id: "boolean-selected", name: "Boolean selected", is_disabled: true }));
      const selection = { filters: { is_disabled: true }, config: { select: ["id"], take: 2 } };
      expect(await Effect.runPromise(reader.read(sales.runtime.count, selection)))
        .toEqual([[{ id: "boolean-selected" }], 1]);
      await Effect.runPromise(host.run(host.newRequestKey(), update,
        { id: "boolean-selected", data: { is_disabled: false } }));
      expect(await Effect.runPromise(reader.read(sales.runtime.count, selection))).toEqual([[], 0]);
      await Effect.runPromise(host.run(host.newRequestKey(), update,
        { id: unrelated[0]!.id, data: { is_disabled: true } }));
      expect(await Effect.runPromise(reader.read(sales.runtime.count, selection)))
        .toEqual([[{ id: unrelated[0]!.id }], 1]);
      await Effect.runPromise(host.run(host.newRequestKey(), remove, [unrelated[0]!.id]));
      expect(await Effect.runPromise(reader.read(sales.runtime.count, selection))).toEqual([[], 0]);
      const before = await fixture.snapshot();
      const result = await Effect.runPromiseExit(reader.read(sales.runtime.count,
        { filters: { is_disabled: false }, config: { select: ["id"], take: 2 } }));
      const failures = expectWorkflowTypedFailures(result, "limitExceeded");
      expect(failures.map(failure => failure.reason)).toEqual(["limitExceeded"]);
      expect(await fixture.snapshot()).toEqual(before);
    } finally { await Effect.runPromise(reader.close); await Effect.runPromise(host.close); }
  }, 180_000);
});
