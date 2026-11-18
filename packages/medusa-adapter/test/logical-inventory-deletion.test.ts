import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import { defineCommerceCommand, defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { defineCommerceEventContract } from "../../persistence-postgres/src/frameworks/atomicCommerce/events";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import { captureInventoryMetadata } from "../src/modules/inventory/schema";
import { inventoryDeletionLinkableKeys } from "../src/modules/inventory/deletion-lifecycle";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { logicalCurrencyFixture } from "./support/logical-currency-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { prepareLogicalInventoryHosts } from "./support/logical-inventory-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
const config = { returnLinkableKeys: Object.keys(inventoryDeletionLinkableKeys) };
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)])));
type Receipt = { call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] };
let receipt: Receipt | undefined;
let fixture: Awaited<ReturnType<typeof logicalCurrencyFixture>>;
let members: Awaited<ReturnType<typeof prepareLogicalInventoryHosts>>;
let deletion: Effect.Success<ReturnType<typeof makeLocalInventoryCommands>>;

async function writer(runtime: typeof deletion) {
  const participant = defineAtomicCommerceParticipant("inventory"), policy = runtime.logicalEventPolicy();
  const names = ["inventory.inventory-item.created", "inventory.inventory-item.deleted", "inventory.inventory-level.created", "inventory.inventory-level.updated",
    "inventory.inventory-level.deleted", "inventory.reservation-item.created", "inventory.reservation-item.updated", "inventory.reservation-item.deleted"];
  const declared = names.map(name => ({ name, token: defineCommerceEventContract({ name, revision: "d".repeat(64), internal: true, decode: policy.capture }) }));
  const contracts = declared.map(entry => entry.token);
  const roots = {
    create: defineAtomicCommerceCommand("inventoryDeletionSeedItems", (ctx, input) => ctx.call(participant, runtime.create, input)),
    levels: defineAtomicCommerceCommand("inventoryDeletionSeedLevels", (ctx, input) => ctx.call(participant, runtime.createLevels, input)),
    reserve: defineAtomicCommerceCommand("inventoryDeletionSeedReservation", (ctx, input) => ctx.call(participant, runtime.reserve, input)),
    release: defineAtomicCommerceCommand("inventoryDeletionReleaseReservation", (ctx, input) => ctx.call(participant, runtime.release, input)),
    read: defineAtomicCommerceCommand("inventoryDeletionRead", (ctx, input) => ctx.call(participant, runtime.count, input)),
    remove: defineAtomicCommerceCommand("inventoryDeletionRemove", (ctx, input) => runtime.softDeleteItems === undefined
      ? ctx.refuse(commerceError("unsupportedProfile")) : ctx.call(participant, runtime.softDeleteItems, input)),
    fail: defineAtomicCommerceCommand("inventoryDeletionLateRefusal", (ctx, input) => runtime.softDeleteItems === undefined
      ? ctx.refuse(commerceError("unsupportedProfile")) : ctx.call(participant, runtime.softDeleteItems, input).pipe(Effect.andThen(ctx.refuse(commerceError("invalidInput"))))),
  };
  const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, requestCallLimit: 512,
    participants: [{ participant, logicalStorage: members.inventory.hostInput.logicalStorage, commands: runtime.commands,
      validateLogicalCall: (call, activity) => policy.validateLogicalCall(call, activity).pipe(Effect.tap(() => Effect.sync(() => {
        if (call.commandName === "inventorySoftDeleteItems") receipt = { call, activity };
      }))), events: { contracts, select: message => {
        const selected = declared.find(contract => contract.name === (typeof message === "object" && message !== null && "name" in message ? message.name : undefined));
        return selected === undefined ? Effect.fail(commerceError("unadmittedEvent")) : Effect.succeed(selected.token);
      } } }], commands: Object.values(roots),
    events: { producerRevision: "d".repeat(64), contracts, subscribers: [{ id: "inventory-deletion-owner", revision: "e".repeat(64) }],
      validate: events => events.some(event => !event.internal) ? Effect.fail(commerceError("unadmittedEvent")) : Effect.void },
  }));
  cleanup.push(() => Effect.runPromise(host.close));
  return { host, ...roots };
}
let stock: Awaited<ReturnType<typeof writer>>, selected: Awaited<ReturnType<typeof writer>>;
const run = (value: typeof selected, command: typeof selected.create, input: Json) => Effect.runPromise(value.host.run(value.host.newRequestKey(), command, input));
const read = (ids: readonly string[]) => run(selected, selected.read, { filters: { id: [...ids] }, config: { select: ["id", "reserved_quantity"] } });
const remove = (ids: readonly string[]) => run(selected, selected.remove, { selector: [...ids], config });
async function seed(ids: string[], levels = 0) {
  for (let offset = 0; offset < ids.length; offset += 4) await run(stock, stock.create, ids.slice(offset, offset + 4).map(id => ({ id, sku: id })));
  const input = ids.flatMap(id => Array.from({ length: levels }, (_, index) => ({ inventory_item_id: id, location_id: id + "-loc-" + index, stocked_quantity: 100 })));
  const created: Array<ReturnType<typeof decodeRows>[number]> = [];
  for (let offset = 0; offset < input.length; offset += 8) created.push(...decodeRows(await run(stock, stock.levels, input.slice(offset, offset + 8))));
  return created;
}
async function reserve(id: string, location: string, quantity: number) {
  const result = decodeRows(await run(stock, stock.reserve, [{ inventory_item_id: id, location_id: location, quantity }]));
  const first = result[0]; if (first === undefined) throw new Error("Missing native Reservation result"); return first;
}
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : []);
  if (!(value instanceof Error)) return [];
  return [...("reason" in value && typeof value.reason === "string" ? [value.reason] : []), ...reasons(value.cause)];
}
async function refuses(effect: ReturnType<typeof selected.host.run>, reason: string) {
  const exit = await Effect.runPromise(Effect.exit(effect)); expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) expect(reasons(exit.cause)).toContain(reason);
}

describe("named native Inventory deletion lifecycle and computed read", () => {
  beforeAll(async () => {
    fixture = await logicalCurrencyFixture(driver, close => cleanup.push(close), { includeProduct: true, includePricing: true, includeVariantInventory: true });
    members = await prepareLogicalInventoryHosts(fixture, { stock: true });
    deletion = await Effect.runPromise(makeLocalInventoryCommands("product-deletions"));
    stock = await writer(members.inventory.runtime); selected = await writer(deletion);
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("keeps lifecycle and computed graph fields absent from existing profiles and the stored schema", async () => {
    for (const admission of ["items", "levels", "stock"] as const) {
      const runtime = await Effect.runPromise(makeLocalInventoryCommands(admission));
      expect(runtime.workflow.methods).not.toHaveProperty("softDeleteInventoryItems"); expect(runtime).not.toHaveProperty("softDeleteItems");
      expect(runtime.graph.reads[0]?.table.columns).not.toContain("reserved_quantity");
    }
    const metadata = await Effect.runPromise(captureInventoryMetadata());
    expect(metadata.frame.tables.find(table => table.name === "inventory_item")?.columns.map(column => column.name)).not.toContain("reserved_quantity");
    expect(deletion.graph.reads[0]?.table.columns).toContain("reserved_quantity");
    expect(deletion.workflow.methods).toHaveProperty("softDeleteInventoryItems");
    expect(deletion.workflow.methods).not.toHaveProperty("restoreInventoryItems");
  });

  it("reads complete empty and two-level native reserved sums, excluding soft-deleted levels", async () => {
    await seed(["computed-empty"]);
    expect(await read(["computed-empty", "computed-missing"])).toEqual([[{ id: "computed-empty", reserved_quantity: 0 }], 1]);
    const levels = await seed(["computed-pair"], 2);
    await reserve("computed-pair", "computed-pair-loc-0", 0.1); await reserve("computed-pair", "computed-pair-loc-1", 0.2);
    expect(await read(["computed-pair"])).toEqual([[{ id: "computed-pair", reserved_quantity: 0.3 }], 1]);
    const first = levels[0]; if (first === undefined) throw new Error("Missing authentic Level ID");
    // Explicit fixture arrangement uses the real core lifecycle owner. It
    // establishes persisted history without implementing Inventory deletion.
    const arrange = defineCommerceCommand("inventoryDeletedLevelArrangement", "write", Effect.fn(function* (ctx) {
      yield* (yield* ctx.table("inventory_level")).lifecycle(ctx.manager, "softDelete", [{ id: first.id }]); return null;
    }));
    const participant = defineAtomicCommerceParticipant("inventory_arrangement");
    const root = defineAtomicCommerceCommand("inventoryDeletedLevelArrangementRoot", ctx => ctx.call(participant, arrange, null));
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...fixture.hostInput, participants: [{ participant,
      logicalStorage: members.inventory.hostInput.logicalStorage, commands: [arrange] }], commands: [root] }));
    try { await Effect.runPromise(host.run(host.newRequestKey(), root, null)); } finally { await Effect.runPromise(host.close); }
    expect(await read(["computed-pair"])).toEqual([[{ id: "computed-pair", reserved_quantity: 0.2 }], 1]);
  });

  it("refuses a third active level and ninth Item instead of truncating computed evidence", async () => {
    await seed(["computed-overfull"], 3);
    const before = await logicalCurrencyInventory(fixture);
    await refuses(selected.host.run(selected.host.newRequestKey(), selected.read, { filters: { id: ["computed-overfull"] },
      config: { select: ["id", "reserved_quantity"] } }), "limitExceeded");
    await refuses(selected.host.run(selected.host.newRequestKey(), selected.read, { filters: { id: Array.from({ length: 9 }, (_, index) => "missing-" + index) },
      config: { select: ["id", "reserved_quantity"] } }), "unsupportedProfile");
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
  });

  it("soft-deletes the complete eight-Item closure with native linkable output and 32 authenticated transitions", async () => {
    const ids = Array.from({ length: 8 }, (_, index) => "maximum-item-" + index);
    await seed(ids, 2);
    for (const id of ids) await reserve(id, id + "-loc-0", 0);
    expect(await read(ids)).toEqual([ids.map(id => ({ id, reserved_quantity: 0 })), 8]);
    const before = await logicalCurrencyInventory(fixture), key = selected.host.newRequestKey();
    const result = await Effect.runPromise(selected.host.run(key, selected.remove, { selector: ids, config }));
    expect(result).toMatchObject({ inventory_item_id: ids });
    const observed = receipt; if (observed === undefined) throw new Error("Missing native lifecycle receipt");
    expect(observed.activity.lifecycle).toHaveLength(32); expect(observed.activity.mutations).toHaveLength(32);
    expect(observed.call.events).toHaveLength(32);
    expect(observed.activity.mutations.every(change => change.operation === "patch" && typeof change.after?.deleted_at === "string")).toBe(true);
    expect(observed.activity.mutations.filter(change => change.table === "inventory_level").every(change =>
      JSON.stringify(change.before?.raw_reserved_quantity) === JSON.stringify(change.after?.raw_reserved_quantity))).toBe(true);
    const after = await logicalCurrencyInventory(fixture);
    expect(after.commits).toHaveLength(before.commits.length + 1); expect(after.events).toHaveLength(before.events.length + 32);
    expect(await Effect.runPromise(selected.host.run(key, selected.remove, { selector: ids, config }))).toEqual(result);
    expect(await logicalCurrencyInventory(fixture)).toEqual(after);
    expect(await read(ids)).toEqual([[], 0]);
  }, 120_000);

  it("preserves empty, missing and duplicate membership semantics and selected returnLinkableKeys", async () => {
    expect(await remove([])).toEqual({}); expect(await remove(["missing-item"])).toEqual({});
    await seed(["duplicate-item"], 1);
    expect(await run(selected, selected.remove, { selector: ["duplicate-item", "duplicate-item"], config: { returnLinkableKeys: ["inventory_item_id"] } }))
      .toEqual({ inventory_item_id: ["duplicate-item"] });
    expect(receipt?.activity.lifecycle).toHaveLength(2);
    expect(await remove(["duplicate-item"])).toEqual({});
  });

  it("checks complete Level and Reservation history before writes and rolls back late root refusal", async () => {
    await seed(["lifecycle-overfull"], 3);
    let before = await logicalCurrencyInventory(fixture);
    await refuses(selected.host.run(selected.host.newRequestKey(), selected.remove, { selector: ["lifecycle-overfull"], config }), "limitExceeded");
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    await seed(["reservation-history"], 1);
    const first = await reserve("reservation-history", "reservation-history-loc-0", 0);
    await run(stock, stock.release, [first.id]); await reserve("reservation-history", "reservation-history-loc-0", 0);
    before = await logicalCurrencyInventory(fixture);
    await refuses(selected.host.run(selected.host.newRequestKey(), selected.remove, { selector: ["reservation-history"], config }), "limitExceeded");
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    await seed(["late-item"], 2); await reserve("late-item", "late-item-loc-0", 0);
    before = await logicalCurrencyInventory(fixture);
    await refuses(selected.host.run(selected.host.newRequestKey(), selected.fail, { selector: ["late-item"], config }), "invalidInput");
    expect(await logicalCurrencyInventory(fixture)).toEqual(before);
    expect(await read(["late-item"])).toEqual([[{ id: "late-item", reserved_quantity: 0 }], 1]);
  }, 120_000);
});
