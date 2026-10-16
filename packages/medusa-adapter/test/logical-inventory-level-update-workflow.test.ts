import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { InventoryModuleService, InventoryLevelService } from "@medusajs/inventory/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryLevelUpdateInput, prepareInventoryLevelUpdateWorkflow } from "../src/workflows/inventory/update-levels";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import * as levelEventPolicy from "../src/modules/inventory/update-level-events";
import { prepareLogicalInventoryLevelUpdate } from "./support/logical-inventory-level-update-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { registerNativeInventoryLevelUpdateTests, type NativeInventoryLevelUpdateTestService } from "./support/inventory-level-update-native-tests";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryLevelUpdate>>;
const snapshot = () => logicalCurrencyInventory(connected.fixture);
const updated = "inventory.inventory-level.updated";
const raw = (value: number) => ({ value: value.toPrecision(20), precision: 20 });
function failurePath(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? failurePath(reason.error)
    : reason._tag === "Die" ? failurePath(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failurePath(value.cause)];
  return value instanceof Error ? [value.message, ...failurePath(value.cause)] : [];
}
function nativeFailure(value: unknown): unknown {
  if (Cause.isCause(value)) return nativeFailure(Cause.squash(value));
  return value instanceof Error && value.cause !== undefined ? nativeFailure(value.cause) : value;
}

describe("native absolute Inventory Level updates on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalInventoryLevelUpdate(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("resolves the required Inventory module for empty input without listing or updating", async () => {
    const list = vi.spyOn(InventoryModuleService.prototype, "listInventoryLevels"), update = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels");
    const host = await connected.prepare();
    try {
      const before = await snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, { updates: [] }))).toEqual([]);
      expect(list).not.toHaveBeenCalled(); expect(update).not.toHaveBeenCalled();
      const after = await snapshot(); expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
      expect(after.commits.length - before.commits.length).toBe(1);
      expect(await Effect.runPromise(host.run(key, { updates: [] }))).toEqual([]); expect(await snapshot()).toEqual(after);
    } finally { list.mockRestore(); update.mockRestore(); }
  });

  it("updates four levels with exact companions, preserves reserved stock and connected records, and replays once", async () => {
    const graph = await connected.seed("level-update-four", 4, true), host = await connected.prepare(), otherRevision = await connected.prepare("d".repeat(64));
    const quantities = [-2.25, 0, 9_007_199_254_740_992, 1.125];
    const input: typeof InventoryLevelUpdateInput.Type = { updates: graph.pairs.map((pair, index) => ({ ...pair,
      stocked_quantity: quantities[index]!, incoming_quantity: index === 1 ? -0.5 : index + 0.25 })) };
    const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels");
    try {
      const retained = await connected.preserved();
      for (const family of Object.values(retained)) expect(family.length).toBeGreaterThan(0);
      const before = await snapshot(), key = host.newRequestKey(), result = await Effect.runPromise(host.run(key, input));
      expect(result).toHaveLength(4);
      for (const [index, level] of result.entries()) {
        const reserved = index === 0 ? 2 : 0, incoming = index === 1 ? -0.5 : index + 0.25;
        expect(level).toMatchObject({ ...graph.pairs[index], stocked_quantity: quantities[index], incoming_quantity: incoming,
          reserved_quantity: reserved, available_quantity: quantities[index]! - reserved,
          raw_stocked_quantity: raw(quantities[index]!), raw_incoming_quantity: raw(incoming), raw_reserved_quantity: raw(reserved) });
      }
      expect(result[0]?.available_quantity).toBe(-4.25);
      const stored = await Effect.runPromise(connected.probe(graph.items));
      for (const [index, pair] of graph.pairs.entries()) expect(stored.find(row => row.inventory_item_id === pair.inventory_item_id))
        .toMatchObject({ stocked_quantity: raw(quantities[index]!).value, incoming_quantity: raw(index === 1 ? -0.5 : index + 0.25).value,
          reserved_quantity: raw(index === 0 ? 2 : 0).value, raw_stocked_quantity: raw(quantities[index]!) });
      expect(await connected.preserved()).toEqual(retained);
      const after = await snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.rowChanges.length - before.rowChanges.length).toBe(4); expect(after.commits.length - before.commits.length).toBe(1);
      expect(emitted.map(event => event.envelope.contract)).toEqual(graph.items.map(() => updated));
      expect(emitted.map(event => event.envelope.message)).toEqual(result.map(row => expect.objectContaining({ data: { id: row.id } })));
      expect(emitted.every(event => event.envelope.internal)).toBe(true); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(await Effect.runPromise(host.run(key, input))).toEqual(result); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { updates: [{ ...graph.pairs[0]!, stocked_quantity: 99 }] }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(otherRevision.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(after);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("keeps one and four tuple reads exact among twelve same-location neighbors in both native field orders", async () => {
    const cohort = await connected.seedCohort("level-update-compound-cohort");
    expect(cohort.levels).toHaveLength(12);
    const receipts: Array<{ name: string; ids: readonly string[] }> = [], fieldOrders = new Set<string>();
    const decodeIds = Schema.decodeUnknownSync(Schema.Array(Schema.String));
    const actualPolicy = levelEventPolicy.inventoryLevelUpdateEventPolicy;
    const policy = vi.spyOn(levelEventPolicy, "inventoryLevelUpdateEventPolicy").mockImplementation(contracts => {
      const selected = actualPolicy(contracts);
      return { ...selected, validateLogicalCall: Effect.fn("LevelCohort.observeValidatedReceipt")(function* (
        call: Parameters<typeof selected.validateLogicalCall>[0], activity: Parameters<typeof selected.validateLogicalCall>[1]) {
        // The production policy always authenticates the complete evidence
        // first. Observation grants no relaxed receipt or resource allowance.
        yield* selected.validateLogicalCall(call, activity);
        expect(activity.observedRows.every(entry => entry.table === "inventory_level")).toBe(true);
        receipts.push({ name: call.commandName, ids: decodeIds(activity.observedRows.map(entry => entry.row.id)) });
      }) };
    });
    const module = await Effect.runPromise(makeLocalInventoryCommands("level-updates").pipe(
      Effect.ensuring(Effect.sync(() => { policy.mockRestore(); })),
    ));
    const originalList = InventoryLevelService.prototype.list;
    const list = vi.spyOn(InventoryLevelService.prototype, "list").mockImplementation(async function (this: InventoryLevelService, ...args) {
      const selector = args[0];
      if (Schema.is(Schema.JsonObject)(selector) && Array.isArray(selector.$or)) for (const pair of selector.$or) {
        if (Schema.is(Schema.JsonObject)(pair) && typeof pair.inventory_item_id === "string" && typeof pair.location_id === "string")
          fieldOrders.add(Object.keys(pair).join(","));
      }
      return await Reflect.apply(originalList, this, args);
    });
    const host = await Effect.runPromise(prepareInventoryLevelUpdateWorkflow({ ...connected.options,
      modules: { inventory: { module: module.workflow, logicalStorage: connected.members.inventory.hostInput.logicalStorage } } }));
    try {
      for (const positions of [[0], [1, 4, 7, 10]]) {
        const pairs = positions.map(index => cohort.pairs[index]!);
        const expected = pairs.map(pair => cohort.levels.find(row => row.inventory_item_id === pair.inventory_item_id)?.id);
        if (expected.some(id => id === undefined)) throw new Error("Missing genuine cohort identities");
        const before = await connected.probeCohort(cohort.items), selectedIds = new Set(expected);
        receipts.length = 0; fieldOrders.clear();
        const result = await Effect.runPromise(host.run(host.newRequestKey(), { updates: pairs.map((pair, index) => ({ ...pair, stocked_quantity: 1.25 + index })) }));
        expect(result.map(row => row.id)).toEqual(expected);
        expect(receipts.map(receipt => receipt.name)).toEqual(["inventoryLevelListForUpdate", "inventoryLevelUpdateForWorkflow"]);
        for (const receipt of receipts) {
          expect(new Set(receipt.ids)).toEqual(selectedIds);
          expect(new Set(receipt.ids).size).toBe(positions.length);
        }
        expect(fieldOrders.has("inventory_item_id,location_id")).toBe(true);
        expect(fieldOrders.has("location_id,inventory_item_id")).toBe(true);
        const after = await connected.probeCohort(cohort.items);
        expect(after.filter(row => !selectedIds.has(row.id))).toEqual(before.filter(row => !selectedIds.has(row.id)));
      }
      // This Item has a Level at the cohort location, but none at the requested
      // location. The point miss must reach the genuine native NOT_FOUND path.
      receipts.length = 0;
      const missing = { ...cohort.pairs[0]!, location_id: "not-stocked-in-cohort" }, before = await snapshot();
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [{ ...missing, incoming_quantity: 2 }] })));
      if (Result.isSuccess(result)) throw new Error("Missing cohort tuple was admitted");
      expect(nativeFailure(result.failure)).toMatchObject({ type: "not_found",
        message: `Item ${missing.inventory_item_id} is not stocked at location ${missing.location_id}` });
      expect(failurePath(result.failure)).not.toContain("receiptMismatch");
      expect(receipts).toEqual([{ name: "inventoryLevelListForUpdate", ids: [] }]);
      expect(await snapshot()).toEqual(before);
    } finally { list.mockRestore(); await Effect.runPromise(host.close); }
  }, 240_000);
  it("retains duplicate final patches and native last-occurrence result/event order", async () => {
    const graph = await connected.seed("level-update-duplicates", 3), host = await connected.prepare();
    const before = await snapshot();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { updates: [
      { ...graph.pairs[2]!, stocked_quantity: 30 }, { ...graph.pairs[0]!, stocked_quantity: 11.5 }, { ...graph.pairs[2]!, incoming_quantity: 3.25 },
    ] }));
    expect(result.map(row => row.inventory_item_id)).toEqual([graph.items[0], graph.items[2]]);
    expect(result).toMatchObject([{ ...graph.pairs[0], stocked_quantity: 11.5 }, { ...graph.pairs[2], stocked_quantity: 10, incoming_quantity: 3.25 }]);
    const after = await snapshot(); expect(after.rowChanges.length - before.rowChanges.length).toBe(2);
    expect(after.events.slice(before.events.length).map(event => event.envelope.message)).toEqual(result.map(row => expect.objectContaining({ data: { id: row.id } })));
  });

  it("performs native tuple-only writes and emits their update event even when quantities are omitted", async () => {
    const graph = await connected.seed("level-update-tuple"), host = await connected.prepare(), before = await snapshot();
    const result = await Effect.runPromise(host.run(host.newRequestKey(), { updates: [graph.pairs[0]!] }));
    expect(result).toMatchObject([{ ...graph.pairs[0], stocked_quantity: 10, incoming_quantity: 0, reserved_quantity: 0, available_quantity: 10 }]);
    const after = await snapshot(); expect(after.rowChanges.length - before.rowChanges.length).toBe(1);
    expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([updated]);
  });

  it("honors matching caller IDs and checks missing pairs before final-ID selection", async () => {
    const graph = await connected.seed("level-update-identities"), host = await connected.prepare(), level = graph.levels[0];
    if (level === undefined) throw new Error("Missing native seeded Level");
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { updates: [{ ...graph.pairs[0]!, id: level.id, incoming_quantity: 2.5 }] })))
      .toMatchObject([{ id: level.id, incoming_quantity: 2.5 }]);
    const before = await snapshot();
    for (const input of [{ ...graph.pairs[0]!, location_id: "not-stocked", id: level.id }, { ...graph.pairs[0]!, id: "missing-final-level" }]) {
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [input] })));
      if (Result.isSuccess(result)) throw new Error("Missing native pair/ID was admitted");
      expect(nativeFailure(result.failure)).toMatchObject({ type: "not_found" });
      if (input.location_id === "not-stocked") expect(nativeFailure(result.failure)).toMatchObject({ message: `Item ${input.inventory_item_id} is not stocked at location not-stocked` });
      expect(await snapshot()).toEqual(before);
    }
  });

  it("observes the eight-row requested-pair/final-ID union and retains the genuine tuple uniqueness refusal", async () => {
    const requested = await connected.seed("level-update-union-pairs", 4), targets = await connected.seed("level-update-union-ids", 4), host = await connected.prepare();
    const targetIds = targets.items.map(item => targets.levels.find(row => row.inventory_item_id === item)?.id);
    if (targetIds.some(id => id === undefined)) throw new Error("Missing caller override targets");
    const original = InventoryLevelService.prototype.list, seen = new Set<string>();
    const list = vi.spyOn(InventoryLevelService.prototype, "list").mockImplementation(async function (this: InventoryLevelService, ...args) {
      const result = await Reflect.apply(original, this, args);
      if (Array.isArray(result)) for (const row of result) if (typeof row.id === "string") seen.add(row.id);
      return result;
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: requested.pairs.map((pair, index) => ({
        ...pair, id: targetIds[index]!, stocked_quantity: index + 1,
      })) })));
      expect(Result.isFailure(result)).toBe(true);
      expect(seen).toEqual(new Set([...requested.levels, ...targets.levels].map(row => row.id)));
      expect(await snapshot()).toEqual(before);
    } finally { list.mockRestore(); }
  }, 120_000);

  it("rejects soft-deleted levels without changing live peers", async () => {
    const graph = await connected.seed("level-update-deleted", 2), host = await connected.prepare();
    await Effect.runPromise(connected.remove([graph.items[1]!])); const before = await snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: graph.pairs.map(pair => ({ ...pair, stocked_quantity: 4 })) }))))).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it("refuses excess raw entries, caller raw/reserved quantities, metadata and nonfinite values before native updates", async () => {
    const graph = await connected.seed("level-update-input"), host = await connected.prepare(), pair = graph.pairs[0]!;
    const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels");
    try {
      const before = await snapshot();
      for (const input of [{ updates: Array.from({ length: 5 }, () => pair) }, { updates: [{ ...pair, reserved_quantity: 2 }] },
        { updates: [{ ...pair, raw_stocked_quantity: raw(2) }] }, { updates: [{ ...pair, metadata: {} }] },
        { updates: [{ ...pair, stocked_quantity: Infinity }] }, { updates: [{ ...pair, incoming_quantity: null }] }]) {
        // @ts-expect-error Deliberately malformed public update contract.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("rolls back late throws, malformed DTOs/companions and forged or malformed events", async () => {
    const graph = await connected.seed("level-update-late"), host = await connected.prepare();
    for (const mode of ["throw", "result", "raw", "event", "malformed-event"] as const) {
      const original = InventoryModuleService.prototype.updateInventoryLevels; let completed = false;
      const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
        const result = await Reflect.apply(original, this, args); completed = true;
        if (mode === "throw") throw new Error("Late native absolute-Level failure");
        if (mode === "result" || mode === "raw") {
          if (!Array.isArray(result) || result[0] === undefined) throw new Error("Missing native array update result");
          Object.defineProperty(result[0], mode === "raw" ? "raw_stocked_quantity" : "stocked_quantity", {
            value: mode === "raw" ? raw(999) : "invalid", enumerable: true, writable: true, configurable: true });
        } else {
          const bus: unknown = Reflect.get(this, "eventBusModuleService_");
          if (typeof bus !== "object" || bus === null) throw new Error("Missing native event bus");
          const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing native emitter");
          await Reflect.apply(emit, bus, [[{ name: updated, data: { id: mode === "malformed-event" ? 42 : "forged-level" },
            metadata: { source: "inventory", object: "inventory_level", action: "updated" } }], { internal: true }]);
        }
        return result;
      });
      try {
        const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [{ ...graph.pairs[0]!, stocked_quantity: 3.25 }] })));
        if (Result.isSuccess(result)) throw new Error("Corrupt absolute update committed");
        expect(completed).toBe(true); expect(failurePath(result.failure)).toContain(mode === "throw" ? "adapterFailure" : mode === "malformed-event" ? "unadmittedEvent" : "receiptMismatch");
        expect(await snapshot()).toEqual(before);
      } finally { native.mockRestore(); }
    }
  }, 180_000);

  it("preserves sticky refusal after native code catches a denied Item mutation", async () => {
    const graph = await connected.seed("level-update-poison"), host = await connected.prepare();
    const original = InventoryModuleService.prototype.updateInventoryLevels; let caught = false;
    const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args);
      try { await this.updateInventoryItems({ id: graph.items[0]!, title: "Forbidden" }); } catch { caught = true; }
      return result;
    });
    try {
      const before = await snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [{ ...graph.pairs[0]!, stocked_quantity: 4 }] }))))).toBe(true);
      expect(caught).toBe(true); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("rolls back cancellation and rejects an escaped native Level continuation", async () => {
    const graph = await connected.seed("level-update-cancel"), host = await connected.prepare(), reached = await Effect.runPromise(Deferred.make<void>());
    const original = InventoryModuleService.prototype.updateInventoryLevels; let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { updates: [{ ...graph.pairs[0]!, stocked_quantity: 2 }] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing native continuation"); await expect(escaped()).rejects.toBeDefined();
      expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it.skipIf(driver !== "postgres").each(["adjustment", "reservation"] as const)("rejects a stale absolute update after a competing native %s commits", async kind => {
    const graph = await connected.seed("level-update-race-" + kind), host = await connected.prepare(), reached = await Effect.runPromise(Deferred.make<void>());
    const original = InventoryModuleService.prototype.updateInventoryLevels; let finish: (() => void) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    const pending = Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { updates: [{ ...graph.pairs[0]!, stocked_quantity: 2 }] })));
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      if (kind === "adjustment") await Effect.runPromise(connected.adjust.run(connected.adjust.newRequestKey(), [{ ...graph.pairs[0]!, adjustment: 1 }]).pipe(Effect.timeout(30_000)));
      else await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...graph.pairs[0]!, quantity: 3 }] }).pipe(Effect.timeout(30_000)));
      const committed = await snapshot(); finish?.(); const result = await pending;
      if (Result.isSuccess(result)) throw new Error("Stale absolute Level update overwrote committed stock/reservation");
      expect(failurePath(result.failure)).toContain("writeConflict"); expect(await snapshot()).toEqual(committed);
      expect(await Effect.runPromise(connected.probe(graph.items))).toMatchObject([{ stocked_quantity: raw(kind === "adjustment" ? 11 : 10).value,
        reserved_quantity: raw(kind === "reservation" ? 3 : 0).value }]);
    } finally { finish?.(); await pending; native.mockRestore(); }
  }, 120_000);

  it("isolates identical item/location pairs and request keys across actual scopes", async () => {
    const other = await prepareLogicalInventoryLevelUpdate(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "inventory_level_update_shop_b", projectId: "inventory_level_update_shop_b", uuidOffset: 310_000 } });
    const graph = await connected.seed("level-update-scope"), foreign = await other.seed("level-update-scope");
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    const input = { updates: [{ ...graph.pairs[0]!, stocked_quantity: 4 }] }, otherInput = { updates: [{ ...foreign.pairs[0]!, stocked_quantity: 7 }] };
    const a = await Effect.runPromise(left.run(key, input)), b = await Effect.runPromise(right.run(key, otherInput));
    expect(await Effect.runPromise(connected.probe(graph.items))).toMatchObject([{ stocked_quantity: raw(4).value }]);
    expect(await Effect.runPromise(other.probe(foreign.items))).toMatchObject([{ stocked_quantity: raw(7).value }]);
    const before = await snapshot(); expect(await Effect.runPromise(left.run(key, input))).toEqual(a); expect(await Effect.runPromise(right.run(key, otherInput))).toEqual(b);
    expect(await snapshot()).toEqual(before);
  }, 240_000);

  describe("retained pinned absolute-Level assertions through the actual scalar update command", () => {
    const created: string[] = [];
    const Row = Schema.StructWithRest(Schema.Struct({ id: Schema.String, incoming_quantity: Schema.optionalKey(Schema.Number) }), [Schema.Record(Schema.String, Schema.Json)]);
    const decode = Schema.decodeUnknownSync(Row);
    afterEach(async () => { if (created.length) await Effect.runPromise(connected.remove([...created])); created.length = 0; });
    const service: NativeInventoryLevelUpdateTestService = {
      createInventoryItems: async input => { const row = decode(await connected.nativeCreate(input)); created.push(row.id); return row; },
      createInventoryLevels: input => connected.nativeCreateLevel(input),
      updateInventoryLevels: input => Effect.runPromise(connected.nativeUpdate(input)).then(decode).catch(error => { throw nativeFailure(error); }),
    };
    registerNativeInventoryLevelUpdateTests(service);
  });
});
