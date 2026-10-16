import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { fxAppRowCurrent, fxSystemCommits, fxSystemCommitAppRowChanges } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { InventoryItemUpdateInput } from "../src/workflows/inventory/update-items";
import { prepareLogicalInventoryItemUpdate } from "./support/logical-inventory-item-update-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { registerNativeInventoryUpdateTests, type NativeInventoryUpdateTestService } from "./support/inventory-update-native-tests";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryItemUpdate>>;
const rows = () => connected.fixture.persistence.drizzle.select().from(fxAppRowCurrent).orderBy(fxAppRowCurrent.tableId, fxAppRowCurrent.rowId);
const facts = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges).orderBy(fxSystemCommitAppRowChanges.commitSeq, fxSystemCommitAppRowChanges.changeOrdinal);
const commits = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommits).orderBy(fxSystemCommits.commitSeq);
const events = () => connected.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
const snapshot = async () => {
  const inventory = await logicalCurrencyInventory(connected.fixture);
  return { ...inventory, facts: inventory.rowChanges };
};
const eventName = "inventory.inventory-item.updated";
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}

describe("native Inventory Item attribute updates on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalInventoryItemUpdate(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("requires the authentic Inventory resource for empty input and publishes no item facts or events", async () => {
    const list = vi.spyOn(InventoryModuleService.prototype, "listInventoryItems");
    const update = vi.spyOn(InventoryModuleService.prototype, "updateInventoryItems");
    const host = await connected.prepare();
    try {
      const before = await snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { updates: [] }))).toEqual([]);
      expect(list).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
      expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
      expect((await commits()).length - before.commits.length).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, { updates: [] }))).toEqual([]); expect(await snapshot()).toEqual(committed);
    } finally { list.mockRestore(); update.mockRestore(); }
  }, 120_000);

  it("updates four entries including fractional and large dimensions while preserving real levels, reservation and rich Links", async () => {
    const ids = await connected.seed("item-update-four", 4, true), host = await connected.prepare(), changed = await connected.prepare("a".repeat(64));
    const input: typeof InventoryItemUpdateInput.Type = { updates: [
      { id: ids[0]!, title: "First", sku: null, weight: 2.5, length: 0.25, width: 4_294_967_296, description: null, metadata: null },
      { id: ids[1]!, title: "Second", height: null, requires_shipping: false, origin_country: "MM", metadata: { drop: "", nested: { after: true } } },
      { id: ids[2]!, sku: "updated-third-sku", hs_code: null, mid_code: "MID", material: "Cotton", thumbnail: null, metadata: {} },
      { id: ids[3]!, title: "Fourth", description: "Changed", weight: null, length: 0, metadata: { added: true } },
    ] };
    const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryItems");
    try {
      const before = await snapshot(), retained = await connected.preserved(), key = host.newRequestKey();
      expect(retained).toHaveLength(9);
      const result = await Effect.runPromise(host.run(key, input));
      expect(result).toMatchObject([
        { ...input.updates[0], metadata: null },
        { ...input.updates[1], metadata: { keep: ids[1], nested: { after: true } } },
        { ...input.updates[2], metadata: {} },
        { ...input.updates[3], metadata: { keep: ids[3], drop: "old", nested: { before: 3 }, added: true } },
      ]);
      expect(result.map(row => row.id)).toEqual(ids);
      expect(await Effect.runPromise(connected.list(ids))).toEqual(result);
      expect(await connected.preserved()).toEqual(retained);
      const emitted = (await events()).slice(before.events.length);
      expect(emitted.map(event => event.envelope.contract)).toEqual(ids.map(() => eventName));
      expect(emitted.map(event => event.envelope.message)).toEqual(ids.map(id => expect.objectContaining({ data: { id } })));
      expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect((await facts()).length - before.facts.length).toBe(4); expect((await commits()).length - before.commits.length).toBe(1);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      const committed = await snapshot();
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { updates: [{ id: ids[0]!, title: "Conflict" }] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(changed.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(committed);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("preserves native duplicate last-patch semantics and distinct preimage versus update order", async () => {
    const ids = await connected.seed("item-update-order", 3), host = await connected.prepare();
    const originalList = InventoryModuleService.prototype.listInventoryItems;
    const configs: unknown[] = [];
    const list = vi.spyOn(InventoryModuleService.prototype, "listInventoryItems").mockImplementation(function (this: InventoryModuleService, ...args) {
      configs.push(structuredClone(args[1]));
      return Reflect.apply(originalList, this, args);
    });
    try {
      const before = await snapshot();
      const result = await Effect.runPromise(host.run(host.newRequestKey(), { updates: [
        { id: ids[2]!, title: "Discarded first patch", metadata: { discarded: true } },
        { id: ids[0]!, title: "First selected", metadata: { drop: "", added: "first" } },
        { id: ids[2]!, description: "Final third patch", metadata: { added: "third" } },
      ] }));
      expect(list.mock.calls[0]?.[0]).toEqual({ id: [ids[2], ids[0], ids[2]] }); expect(configs[0]).toEqual({});
      const preimages = await list.mock.results[0]?.value;
      if (!Array.isArray(preimages)) throw new Error("Missing native preimage list");
      expect(preimages.map(row => row.id)).toEqual([ids[2], ids[0]]);
      expect(result.map(row => row.id)).toEqual([ids[0], ids[2]]);
      expect(result).toMatchObject([
        { id: ids[0], title: "First selected", metadata: { keep: ids[0], nested: { before: 0 }, added: "first" } },
        { id: ids[2], title: "Before 2", description: "Final third patch", metadata: { keep: ids[2], drop: "old", nested: { before: 2 }, added: "third" } },
      ]);
      expect((await facts()).length - before.facts.length).toBe(2);
      expect((await events()).slice(before.events.length).map(event => event.envelope.message)).toEqual([ids[0], ids[2]].map(id => expect.objectContaining({ data: { id } })));
    } finally { list.mockRestore(); }
  }, 120_000);

  it("returns ID-only patches unchanged without timestamps, facts or module events", async () => {
    const ids = await connected.seed("item-update-noop", 2), host = await connected.prepare();
    const original = await Effect.runPromise(connected.list(ids)), before = await snapshot();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { updates: ids.map(id => ({ id })) }))).toEqual(original);
    expect(await Effect.runPromise(connected.list(ids))).toEqual(original);
    expect(await rows()).toEqual(before.rows); expect(await facts()).toEqual(before.facts); expect(await events()).toEqual(before.events);
    expect((await commits()).length - before.commits.length).toBe(1);
  });

  it("refuses missing and soft-deleted targets without partial updates", async () => {
    const ids = await connected.seed("item-update-missing", 2), host = await connected.prepare();
    await Effect.runPromise(connected.remove([ids[1]!]));
    for (const missing of ["never-existing-item", ids[1]!]) {
      const before = await snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [
        { id: ids[0]!, title: "Must roll back" }, { id: missing, title: "Refused" },
      ] }))))).toBe(true);
      expect(await snapshot()).toEqual(before);
    }
  }, 120_000);

  it("enforces active SKU uniqueness and permits reuse after native soft deletion", async () => {
    const ids = await connected.seed("item-update-sku", 2), host = await connected.prepare();
    const before = await snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [
      { id: ids[0]!, title: "Rollback uniqueness" }, { id: ids[1]!, sku: ids[0] + "-sku" },
    ] }))))).toBe(true); expect(await snapshot()).toEqual(before);
    await Effect.runPromise(connected.remove([ids[0]!]));
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { updates: [{ id: ids[1]!, sku: ids[0] + "-sku" }] })))
      .toMatchObject([{ id: ids[1], sku: ids[0] + "-sku" }]);
  }, 120_000);

  it("refuses fifth raw entries, relation and managed fields, and nonfinite dimensions before native calls", async () => {
    const ids = await connected.seed("item-update-input"), host = await connected.prepare();
    const update = vi.spyOn(InventoryModuleService.prototype, "updateInventoryItems"), before = await snapshot();
    try {
      for (const input of [{ updates: Array.from({ length: 5 }, () => ({ id: ids[0], title: "Too many duplicates" })) },
        { updates: [{ id: ids[0], location_levels: [] }] }, { updates: [{ id: ids[0], stocked_quantity: 2 }] },
        { updates: [{ id: ids[0], deleted_at: null }] }, { updates: [{ id: ids[0], updated_at: "2000-01-01T00:00:00Z" }] },
        { updates: [{ id: ids[0], weight: Infinity }] }, { updates: [{ id: ids[0], requires_shipping: null }] }]) {
        // @ts-expect-error Deliberately malformed public input exercises capture/decoding, not caller typing.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(update).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { update.mockRestore(); }
  });

  it("rolls back late native throws, malformed complete outputs and forged module events", async () => {
    const ids = await connected.seed("item-update-late"), host = await connected.prepare();
    for (const mode of ["throw", "result", "event", "malformed-event"] as const) {
      const original = InventoryModuleService.prototype.updateInventoryItems;
      let completed = false;
      const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
        const result = await Reflect.apply(original, this, args); completed = true;
        if (mode === "throw") throw new Error("Late Inventory Item update failure");
        if (mode === "result") {
          if (!Array.isArray(result) || result[0] === undefined) throw new Error("Missing genuine array output");
          Object.defineProperty(result[0], "requires_shipping", { value: "invalid", enumerable: true, writable: true, configurable: true });
        } else {
          // The generated native class erases this internal field from its
          // exported type. Inspect the actual instance before using this test
          // injection port, preserving the genuine emitter and its receiver.
          const bus: unknown = Reflect.get(this, "eventBusModuleService_");
          if (typeof bus !== "object" || bus === null) throw new Error("Missing genuine native event bus");
          const emit: unknown = Reflect.get(bus, "emit");
          if (typeof emit !== "function") throw new Error("Missing genuine native event emitter");
          await Reflect.apply(emit, bus, [[{ name: eventName, data: { id: mode === "malformed-event" ? 42 : "forged-item" },
            metadata: { source: "inventory", object: "inventory_item", action: "updated" } }], { internal: true }]);
        }
        return result;
      });
      try {
        const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [{ id: ids[0]!, title: "Rollback" }] })));
        if (Result.isSuccess(result)) throw new Error("Corrupt update unexpectedly committed");
        expect(completed).toBe(true); expect(failurePath(result.failure)).toContain(mode === "throw" ? "adapterFailure" : mode === "malformed-event" ? "unadmittedEvent" : "receiptMismatch");
        expect(await snapshot()).toEqual(before);
      } finally { native.mockRestore(); }
    }
  }, 180_000);

  it("retains rollback-only state when native code catches a denied sibling mutation", async () => {
    const ids = await connected.seed("item-update-poison"), host = await connected.prepare();
    const original = InventoryModuleService.prototype.updateInventoryItems;
    let caught = false, completed = false;
    const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); completed = true;
      try { await this.deleteInventoryItems(ids); } catch { caught = true; }
      return result;
    });
    try {
      const before = await snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [{ id: ids[0]!, title: "Poisoned" }] }))))).toBe(true);
      expect(completed).toBe(true); expect(caught).toBe(true); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("rolls back cancellation and revokes an escaped genuine native continuation", async () => {
    const ids = await connected.seed("item-update-cancel"), host = await connected.prepare(), reached = await Effect.runPromise(Deferred.make<void>());
    const original = InventoryModuleService.prototype.updateInventoryItems;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { updates: [{ id: ids[0]!, title: "Cancelled" }] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing native continuation");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it("isolates identical IDs, SKU values and request keys across two authentic scopes", async () => {
    const other = await prepareLogicalInventoryItemUpdate(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "inventory_item_update_shop_b", projectId: "inventory_item_update_shop_b", uuidOffset: 270_000 } });
    const ids = await connected.seed("item-update-scope"), otherIds = await other.seed("item-update-scope");
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    const leftInput = { updates: [{ id: ids[0]!, title: "First scope", sku: "same-updated-sku" }] },
      rightInput = { updates: [{ id: otherIds[0]!, title: "Second scope", sku: "same-updated-sku" }] };
    const leftResult = await Effect.runPromise(left.run(key, leftInput)), rightResult = await Effect.runPromise(right.run(key, rightInput));
    expect(await Effect.runPromise(connected.list(ids))).toMatchObject(leftInput.updates);
    expect(await Effect.runPromise(other.list(otherIds))).toMatchObject(rightInput.updates);
    const before = await snapshot();
    expect(await Effect.runPromise(left.run(key, leftInput))).toEqual(leftResult);
    expect(await Effect.runPromise(right.run(key, rightInput))).toEqual(rightResult); expect(await snapshot()).toEqual(before);
  }, 240_000);

  describe("retained pinned Inventory update assertions through the actual scalar and array service command", () => {
    const created: string[] = [];
    const NativeRow = Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)]);
    const decodeNativeRow = Schema.decodeUnknownSync(NativeRow), decodeNativeRows = Schema.decodeUnknownSync(Schema.Array(NativeRow));
    afterEach(async () => {
      if (created.length) await Effect.runPromise(connected.remove([...created]));
      created.length = 0;
    });
    const createInventoryItems: NativeInventoryUpdateTestService["createInventoryItems"] = async input => {
      const result = decodeNativeRow(await connected.nativeCreate(input)); created.push(result.id); return result;
    };
    function updateInventoryItems(input: { id: string; sku: string }): Promise<{ readonly id: string }>;
    function updateInventoryItems(input: { id: string; sku: string }[]): Promise<readonly { readonly id: string }[]>;
    async function updateInventoryItems(input: { id: string; sku: string } | { id: string; sku: string }[]) {
      const result = await Effect.runPromise(connected.nativeUpdate(input));
      return Array.isArray(input) ? decodeNativeRows(result) : decodeNativeRow(result);
    }
    registerNativeInventoryUpdateTests({ createInventoryItems, updateInventoryItems });
  });
});
