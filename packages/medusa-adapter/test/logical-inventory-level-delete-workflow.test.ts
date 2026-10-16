import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import * as localGraph from "../src/local-graph/query";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryLevelDeletionInput, prepareInventoryLevelDeletionWorkflow } from "../src/workflows/inventory/delete-levels";
import { InventoryLevelDeletionIds } from "../src/modules/inventory/delete-level-input";
import { prepareLogicalInventoryLevelDeletion } from "./support/logical-inventory-level-delete-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryLevelDeletion>>;
const snapshot = () => logicalCurrencyInventory(connected.fixture);
const deleted = "inventory.inventory-level.deleted", restored = "inventory.inventory-level.restored";
const decodeIds = Schema.decodeUnknownSync(InventoryLevelDeletionIds);
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
const eventIds = (events: Awaited<ReturnType<typeof snapshot>>["events"]) => events.flatMap(event => {
  const message = event.envelope.message;
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Level lifecycle identity");
  return Array.isArray(message.data.id) ? message.data.id : [message.data.id];
});
const ids = (graph: Awaited<ReturnType<typeof connected.seed>>) => graph.levels.map(level => level.id);

describe("native Inventory Level deletion on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalInventoryLevelDeletion(driver, close => cleanup.push(close)); }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("queries empty selectors completely, skips empty deletion, and retains projected incoming omission on four actual Levels", async () => {
    const projected: JsonObject[][] = [], originalGraph = localGraph.prepareLocalGraph;
    const graph = vi.spyOn(localGraph, "prepareLocalGraph").mockImplementation((...args) => originalGraph(...args).pipe(Result.map(prepared => ({
      ...prepared, bind: context => {
        const bound = prepared.bind(context);
        return { ...bound, graph: input => bound.graph(input).pipe(Effect.tap(result => Effect.sync(() => { projected.push([...result.data]); }))) };
      },
    }))));
    const host = await connected.prepare(), softDelete = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels");
    const list = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryLevels");
    try {
      const beforeEmpty = await snapshot(), emptyKey = host.newRequestKey();
      expect(await Effect.runPromise(host.run(emptyKey, {}))).toBeNull();
      expect(list).toHaveBeenCalledTimes(1); expect(softDelete).not.toHaveBeenCalled();
      const afterEmpty = await snapshot(); expect(afterEmpty.rows).toEqual(beforeEmpty.rows); expect(afterEmpty.rowChanges).toEqual(beforeEmpty.rowChanges);
      expect(afterEmpty.events).toEqual(beforeEmpty.events); expect(afterEmpty.commits.length - beforeEmpty.commits.length).toBe(1);
      expect(await Effect.runPromise(host.run(emptyKey, {}))).toBeNull(); expect(await snapshot()).toEqual(afterEmpty);
      const graph = await connected.seed("level-delete-all-four", 4); await Effect.runPromise(connected.setQuantities(graph.pairs, 0, 5.25));
      const original = await Effect.runPromise(connected.probe(graph.items)), before = await snapshot(); list.mockClear(); softDelete.mockClear();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), {}))).toBeNull();
      expect(softDelete).toHaveBeenCalledTimes(1); expect(new Set(decodeIds(softDelete.mock.calls[0]?.[0]))).toEqual(new Set(ids(graph)));
      expect(await softDelete.mock.results[0]?.value).toEqual({ inventory_level_id: ids(graph).sort() });
      expect(list.mock.calls[0]?.[1]?.select).toEqual(expect.arrayContaining(["id", "stocked_quantity", "reserved_quantity", "location_id"]));
      expect(list.mock.calls[0]?.[1]?.select).not.toContain("incoming_quantity");
      expect(projected.at(-1)).toHaveLength(4);
      for (const level of projected.at(-1) ?? []) expect(Object.keys(level).sort()).toEqual(["id", "location_id", "reserved_quantity", "stocked_quantity"]);
      const nativeResult = await list.mock.results[0]?.value;
      expect(nativeResult?.[0]).toHaveLength(4);
      for (const level of nativeResult?.[0] ?? []) expect(Object.hasOwn(level, "incoming_quantity")).toBe(false);
      const remaining = await Effect.runPromise(connected.probe(graph.items));
      for (const level of original) expect(remaining.find(row => row.id === level.id))
        .toEqual({ ...level, deleted_at: expect.any(String), updated_at: expect.any(String) });
      const after = await snapshot(); expect(after.rowChanges.length - before.rowChanges.length).toBe(4);
      expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual(Array.from({ length: 4 }, () => deleted));
    } finally { graph.mockRestore(); list.mockRestore(); softDelete.mockRestore(); }
  }, 180_000);

  it("soft deletes four actual selected Levels while preserving every quantity and nonempty connected endpoint family, then replays once", async () => {
    await connected.seedProtected("level-delete-retained-graph");
    const graph = await connected.seed("level-delete-maximum", 4), host = await connected.prepare(), otherRevision = await connected.prepare("a".repeat(64));
    await Effect.runPromise(connected.setQuantities(graph.pairs, -1.25, -2.5));
    const selected = ids(graph).reverse(), original = await Effect.runPromise(connected.probe(graph.items)), preserved = await connected.preserved();
    for (const rows of Object.values(preserved)) expect(rows.length).toBeGreaterThan(0);
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels");
    try {
      const before = await snapshot(), key = host.newRequestKey(), input = { id: selected };
      expect(await Effect.runPromise(host.run(key, input))).toBeNull();
      expect(native.mock.calls[0]?.[0]).toEqual(selected);
      expect(await native.mock.results[0]?.value).toEqual({ inventory_level_id: [...selected].sort() });
      const stored = await Effect.runPromise(connected.probe(graph.items));
      for (const row of original) expect(stored.find(level => level.id === row.id)).toEqual({ ...row, deleted_at: expect.any(String), updated_at: expect.any(String) });
      expect(await connected.preserved()).toEqual(preserved);
      const after = await snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.rowChanges.length - before.rowChanges.length).toBe(4); expect(after.commits.length - before.commits.length).toBe(1);
      expect(emitted.map(event => event.envelope.contract)).toEqual(selected.map(() => deleted));
      expect(eventIds(emitted)).toEqual([...selected].sort()); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(native).toHaveBeenCalledTimes(1);
      await expect(Effect.runPromise(host.run(key, { id: [...selected].reverse() }))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(otherRevision.run(key, input))).rejects.toMatchObject({ reason: "requestConflict" });
      expect(await snapshot()).toEqual(after);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("refuses a fifth actual match before any lifecycle call and preserves all five rows", async () => {
    const graph = await connected.seedMany("level-delete-fifth"), host = await connected.prepare();
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels");
    try {
      expect(graph.levels).toHaveLength(5); const before = await snapshot();
      expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { location_id: graph.location }))))).toBe(true);
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
      for (const level of await connected.probeCohort(graph.items)) expect(level.deleted_at).toBeNull();
    } finally { native.mockRestore(); }
  }, 180_000);

  it("preserves native reservation-before-stock errors, force behavior and location deduplication", async () => {
    const protectedGraph = await connected.seed("level-delete-reserved", 2, true), host = await connected.prepare();
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels");
    try {
      const before = await snapshot();
      for (const force of [false, true]) {
        const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: ids(protectedGraph), force })));
        if (Result.isSuccess(result)) throw new Error("Native positive reservation guard was bypassed");
        expect(nativeFailure(result.failure)).toMatchObject({ type: "not_allowed", message:
          `Cannot remove Inventory Levels for ${protectedGraph.location} because there are reserved or incoming items at the locations` });
        expect(await snapshot()).toEqual(before);
      }
      expect(native).not.toHaveBeenCalled();
      const graph = await connected.seed("level-delete-stocked", 2), stocked = await snapshot();
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: ids(graph) })));
      if (Result.isSuccess(result)) throw new Error("Native positive-stock guard was bypassed");
      expect(nativeFailure(result.failure)).toMatchObject({ type: "not_allowed", message:
        `Cannot remove Inventory Levels for ${graph.location} because there are stocked items at the locations. Use force flag to delete anyway.` });
      expect(await snapshot()).toEqual(stocked);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: ids(graph), force: true }))).toBeNull();
      expect(native).toHaveBeenCalledTimes(1);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("supports Item and Location scalar/array combinations and bounded native OR tuples", async () => {
    const host = await connected.prepare();
    for (const kind of ["item", "location", "combination", "tuple"] as const) {
      const graph = await connected.seed("level-delete-filter-" + kind, 2); await Effect.runPromise(connected.setQuantities(graph.pairs));
      const input: typeof InventoryLevelDeletionInput.Type = kind === "item" ? { inventory_item_id: graph.items }
        : kind === "location" ? { location_id: graph.location } : kind === "combination" ? {
          id: ids(graph), inventory_item_id: graph.items[0]!, location_id: [graph.location],
        } : { $or: graph.pairs.map(pair => ({ ...pair })) };
      const selected = kind === "combination" ? graph.levels.filter(level => level.inventory_item_id === graph.items[0]) : graph.levels;
      const before = await snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toBeNull();
      expect((await snapshot()).rowChanges.length - before.rowChanges.length).toBe(selected.length);
      const stored = await Effect.runPromise(connected.probe(graph.items)), selectedIds = new Set(selected.map(level => level.id));
      for (const level of stored) expect(typeof level.deleted_at === "string").toBe(selectedIds.has(level.id));
    }
  }, 240_000);

  it("deduplicates repeated IDs and treats empty, missing and already-deleted selections as no-op roots", async () => {
    const graph = await connected.seed("level-delete-membership", 2), host = await connected.prepare(); await Effect.runPromise(connected.setQuantities(graph.pairs));
    const selected = ids(graph), native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels");
    try {
      const before = await snapshot();
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: [selected[1]!, "missing-native-level", selected[0]!, selected[1]!] }))).toBeNull();
      // Native buildQuery deduplicates ID-array values at their first occurrence.
      expect(native.mock.calls[0]?.[0]).toEqual([selected[1], selected[0]]);
      expect((await snapshot()).rowChanges.length - before.rowChanges.length).toBe(2);
      native.mockClear();
      for (const input of [{ id: [] }, { id: "missing-native-level" }, { id: selected }]) {
        const beforeNoop = await snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toBeNull();
        const after = await snapshot(); expect(after.rows).toEqual(beforeNoop.rows); expect(after.rowChanges).toEqual(beforeNoop.rowChanges);
        expect(after.events).toEqual(beforeNoop.events); expect(after.commits.length - beforeNoop.commits.length).toBe(1);
      }
      expect(native).not.toHaveBeenCalled();
    } finally { native.mockRestore(); }
  }, 120_000);

  it("authenticates complete direct native lifecycle maps including empty calls and retained compensators", async () => {
    const graph = await connected.seed("level-delete-compensate", 2), selected = ids(graph), host = await connected.prepare(), restore = await connected.prepareRestore();
    await Effect.runPromise(connected.setQuantities(graph.pairs));
    const beforeEmpty = await snapshot(); expect(await Effect.runPromise(connected.nativeDelete([]))).toEqual({});
    expect(await Effect.runPromise(connected.nativeRestore([]))).toEqual({});
    const empty = await snapshot(); expect(empty.rows).toEqual(beforeEmpty.rows); expect(empty.rowChanges).toEqual(beforeEmpty.rowChanges); expect(empty.events).toEqual(beforeEmpty.events);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { id: selected }))).toBeNull();
    expect(await Effect.runPromise(connected.nativeDelete([selected[0]!, "missing-level"]))).toEqual({});
    const native = vi.spyOn(InventoryModuleService.prototype, "restoreInventoryLevels");
    try {
      for (const alreadyActive of [false, true]) {
        const before = await snapshot(); expect(await Effect.runPromise(restore.run(restore.newRequestKey(), selected))).toBeNull();
        expect(native.mock.calls.at(-1)?.[0]).toEqual(selected);
        expect(await native.mock.results.at(-1)?.value).toEqual({ inventory_level_id: [...selected].sort() });
        expect((await Effect.runPromise(connected.probe(graph.items))).every(level => level.deleted_at === null)).toBe(true);
        const after = await snapshot(); expect(after.rowChanges.length - before.rowChanges.length).toBe(alreadyActive ? 0 : 2);
        expect(after.events.slice(before.events.length).map(event => event.envelope.contract)).toEqual([restored, restored]);
      }
      native.mockClear(); const before = await snapshot();
      expect(await Effect.runPromise(restore.run(restore.newRequestKey(), []))).toBeNull(); expect(native).not.toHaveBeenCalled();
      const after = await snapshot(); expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("rejects raw fifth entries, unsupported fields/operators and malformed tuple branches before native callbacks", async () => {
    const host = await connected.prepare(), native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels"), list = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryLevels");
    const invalid: readonly unknown[] = [{ id: Array.from({ length: 5 }, () => "duplicate") }, { force: "yes" }, { stocked_quantity: 0 },
      { id: { $in: ["id"] } }, { $and: [] }, { $or: [{}] }, { $or: Array.from({ length: 5 }, () => ({ inventory_item_id: "item", location_id: "location" })) },
      { metadata: {} }, { id: "" }];
    try {
      const before = await snapshot();
      for (const input of invalid) {
        // @ts-expect-error Deliberately malformed public deletion boundary.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(native).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); list.mockRestore(); }
  });

  it("rolls back late native failure, forged result maps and forged or malformed lifecycle events", async () => {
    const graph = await connected.seed("level-delete-late"), host = await connected.prepare(); await Effect.runPromise(connected.setQuantities(graph.pairs));
    for (const mode of ["throw", "map", "event", "malformed-event"] as const) {
      const original = InventoryModuleService.prototype.softDeleteInventoryLevels; let completed = false;
      const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
        const result = await Reflect.apply(original, this, args); completed = true;
        if (mode === "throw") throw new Error("Late native Level deletion failure");
        if (mode === "map") return { ...result, inventory_level_id: ["forged-level-result"] };
        const bus: unknown = Reflect.get(this, "eventBusModuleService_");
        if (typeof bus !== "object" || bus === null) throw new Error("Missing native event bus");
        const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing native emitter");
        await Reflect.apply(emit, bus, [[{ name: deleted, data: { id: mode === "malformed-event" ? 42 : "forged-level-event" },
          metadata: { source: "inventory", object: "inventory_level", action: "deleted" } }], { internal: true }]);
        return result;
      });
      try {
        const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: ids(graph) })));
        if (Result.isSuccess(result)) throw new Error("Invalid native deletion committed");
        expect(completed).toBe(true); expect(failurePath(result.failure)).toContain(mode === "throw" ? "adapterFailure" : mode === "malformed-event" ? "unadmittedEvent" : "receiptMismatch");
        expect(await snapshot()).toEqual(before);
      } finally { native.mockRestore(); }
    }
  }, 180_000);

  it("rejects a forged native reservation projection instead of bypassing the genuine guard", async () => {
    const graph = await connected.seed("level-delete-forged-read", 1, true), host = await connected.prepare();
    const original = InventoryModuleService.prototype.listAndCountInventoryLevels;
    const list = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const [rows, count] = await Reflect.apply(original, this, args);
      return [rows.map(row => ({ ...row, reserved_quantity: 0 })), count];
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: ids(graph), force: true })));
      expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
    } finally { list.mockRestore(); }
  }, 120_000);

  it("keeps a caught sibling mutation sticky and revokes the escaped native callback", async () => {
    const graph = await connected.seed("level-delete-poison"), host = await connected.prepare(); await Effect.runPromise(connected.setQuantities(graph.pairs));
    const original = InventoryModuleService.prototype.softDeleteInventoryLevels; let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.updateInventoryItems({ id: graph.items[0]!, title: "Forbidden sibling" }); } catch { caught = true; }
      return result;
    });
    try {
      const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: ids(graph) }))))).toBe(true);
      expect(caught).toBe(true); expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing escaped native callback"); await expect(escaped()).rejects.toBeDefined();
      expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("rolls back cancellation after native deletion and refuses its revoked continuation", async () => {
    const graph = await connected.seed("level-delete-cancel"), host = await connected.prepare(), reached = Deferred.makeUnsafe<void>();
    await Effect.runPromise(connected.setQuantities(graph.pairs));
    const original = InventoryModuleService.prototype.softDeleteInventoryLevels; let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { id: ids(graph) }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing revoked Level continuation"); await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it.skipIf(driver !== "postgres").each(["reservation", "adjustment", "absolute"] as const)("rejects stale deletion after a competing native %s commits", async kind => {
    const graph = await connected.seed("level-delete-race-" + kind), host = await connected.prepare(), updater = await connected.prepareUpdate();
    const reached = Deferred.makeUnsafe<void>(), original = InventoryModuleService.prototype.softDeleteInventoryLevels; let finish: (() => void) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    const pending = Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { id: ids(graph), force: true })));
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      if (kind === "reservation") await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), {
        reservations: [{ ...graph.pairs[0]!, quantity: 3 }] }).pipe(Effect.timeout(30_000)));
      else if (kind === "adjustment") await Effect.runPromise(connected.adjust.run(connected.adjust.newRequestKey(), [{ ...graph.pairs[0]!, adjustment: 1 }]).pipe(Effect.timeout(30_000)));
      else await Effect.runPromise(updater.run(updater.newRequestKey(), { updates: [{ ...graph.pairs[0]!, stocked_quantity: 7 }] }).pipe(Effect.timeout(30_000)));
      const committed = await snapshot(); finish?.(); const result = await pending;
      if (Result.isSuccess(result)) throw new Error("Stale native deletion committed after quantity change");
      expect(failurePath(result.failure)).toContain("writeConflict"); expect(await snapshot()).toEqual(committed);
      expect((await Effect.runPromise(connected.probe(graph.items)))[0]?.deleted_at).toBeNull();
    } finally { finish?.(); await pending; native.mockRestore(); }
  }, 120_000);

  it("isolates identical Item/Location selectors and request keys across actual scopes", async () => {
    const other = await prepareLogicalInventoryLevelDeletion(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "inventory_level_deletion_shop_b", projectId: "inventory_level_deletion_shop_b", uuidOffset: 410_000 } });
    const leftGraph = await connected.seed("level-delete-scope"), rightGraph = await other.seed("level-delete-scope");
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input = { inventory_item_id: leftGraph.items, force: true };
    expect(await Effect.runPromise(left.run(key, input))).toBeNull();
    expect((await Effect.runPromise(other.probe(rightGraph.items))).every(row => row.deleted_at === null)).toBe(true);
    expect(await Effect.runPromise(right.run(key, input))).toBeNull();
    expect((await Effect.runPromise(connected.probe(leftGraph.items))).every(row => typeof row.deleted_at === "string")).toBe(true);
    expect((await Effect.runPromise(other.probe(rightGraph.items))).every(row => typeof row.deleted_at === "string")).toBe(true);
    const before = await snapshot(); expect(await Effect.runPromise(left.run(key, input))).toBeNull(); expect(await Effect.runPromise(right.run(key, input))).toBeNull();
    expect(await snapshot()).toEqual(before);
  }, 240_000);

  it("refuses a different module profile before preparing native callbacks", async () => {
    const before = await snapshot();
    const result = await Effect.runPromise(Effect.result(prepareInventoryLevelDeletionWorkflow({ ...connected.options,
      // @ts-expect-error Deliberately provide a structurally wrong named module.
      modules: { inventory: { ...connected.options.modules.inventory, module: connected.update.workflow } },
    })));
    expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
  });
});
