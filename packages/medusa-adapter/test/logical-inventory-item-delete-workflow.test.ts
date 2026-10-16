import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { MathBN } from "@medusajs/framework/utils/portable";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { projectExactNumericColumns } from "../src/value/exact-numeric";
import { InventoryItemDeletionInput, prepareInventoryItemDeletionWorkflow } from "../src/workflows/inventory/delete-items";
import { prepareLogicalInventoryItemDeletion } from "./support/logical-inventory-item-delete-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryItemDeletion>>;
const snapshot = () => logicalCurrencyInventory(connected.fixture);
const decodeIds = Schema.decodeUnknownSync(InventoryItemDeletionInput);
const tables = ["inventory_item", "inventory_level", "reservation_item", "product_variant_inventory_item"] as const;
const bodies = async (ids: readonly string[]) => Promise.all(tables.map(table => Effect.runPromise(connected.probe(table, ids))));
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
  if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native lifecycle event identity");
  return Array.isArray(message.data.id) ? message.data.id : [message.data.id];
});
/** medusaLifecycle loads roots by ID and each root's children by ID, then
 * retains traversal insertion order. Pinned Drizzle UPDATE RETURNING and native
 * mapObjectTo impose no global child-ID sort. Compare that exact issued order. */
function childIdsInLifecycleOrder(items: readonly string[], rows: readonly (typeof Schema.JsonObject.Type & { readonly id: string })[]) {
  return [...items].sort().flatMap(item => rows.filter(row => row.inventory_item_id === item).map(row => row.id).sort());
}
/** Native LinkModuleService sends all returned Link rows to one event builder;
 * Inventory's cascaded mutation subscriber builds one message per row. Envelope
 * count and complete identity coverage are separate native contracts. */
function expectLifecycleEvents(events: Awaited<ReturnType<typeof snapshot>>["events"], expected: Awaited<ReturnType<typeof bodies>>, action: "deleted" | "restored") {
  const roots = expected[0]!.map(row => row.id), inventoryIds = [roots,
    childIdsInLifecycleOrder(roots, expected[1]!), childIdsInLifecycleOrder(roots, expected[2]!)];
  const inventoryNames = ["inventory.inventory-item", "inventory.inventory-level", "inventory.reservation-item"];
  for (const [index, name] of inventoryNames.entries()) {
    const messages = events.filter(event => event.envelope.contract === name + "." + action);
    expect(messages).toHaveLength(inventoryIds[index]!.length); expect(eventIds(messages)).toEqual(inventoryIds[index]);
  }
  const linkIds = expected[3]!.map(row => row.id), linkEvents = events.filter(event => event.envelope.contract ===
    "LinkProductVariantInventoryItem." + (action === "deleted" ? "detached" : "attached"));
  expect(linkEvents).toHaveLength(linkIds.length === 0 ? 0 : 1);
  // Native UPDATE RETURNING promises no global ID order. Complete count and
  // unique membership authenticate this one native message independently of
  // the strict issued-lifecycle/result-map order enforced by command receipts.
  expect(eventIds(linkEvents)).toHaveLength(linkIds.length); expect(new Set(eventIds(linkEvents))).toEqual(new Set(linkIds));
  expect(events).toHaveLength(inventoryIds.flat().length + linkEvents.length);
  expect(eventIds(events)).toHaveLength(expected.flat().length);
  expect(new Set(eventIds(events))).toEqual(new Set(expected.flat().map(row => row.id)));
}

function unchangedFields(row: typeof Schema.JsonObject.Type) {
  const { updated_at: _updated, deleted_at: _deleted, ...rest } = row; return rest;
}

describe("native Inventory Item deletion on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalInventoryItemDeletion(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("returns the genuine empty array and preserves empty native lifecycle and Link behavior", async () => {
    const host = await connected.prepare(), native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems");
    try {
      const before = await snapshot(), key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, []))).toEqual([]);
      expect(native).toHaveBeenCalledTimes(1); expect(native.mock.calls[0]?.[0]).toEqual([]); expect(await native.mock.results[0]?.value).toEqual({});
      const after = await snapshot(); expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
      expect(after.commits.length - before.commits.length).toBe(1);
      expect(await Effect.runPromise(host.run(key, []))).toEqual([]); expect(native).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(after);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("deletes the complete four-Item graph with eight rich Links, authentic native maps, preserved endpoint data and one replayable settlement", async () => {
    const graph = await connected.seed("item-delete-maximum", 2, 0, 2, true), host = await connected.prepare(), otherRevision = await connected.prepare("2".repeat(64));
    const beforeBodies = await bodies(graph.items), beforeOutside = await bodies(graph.outsideItems), preserved = await connected.preserved();
    expect(beforeBodies.map(rows => rows.length)).toEqual([4, 8, 4, 8]); expect(preserved.length).toBeGreaterThan(0);
    const before = await snapshot(), ids = [...graph.items].reverse(), native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems");
    let calls = 0;
    try {
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, ids).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("Native Item deletion maximum calls", calls)))))).toEqual(ids);
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
      expect(decodeIds(native.mock.calls[0]?.[0])).toEqual(ids);
      expect(await native.mock.results[0]?.value).toEqual({ inventory_item_id: [...graph.items].sort(),
        inventory_level_id: childIdsInLifecycleOrder(graph.items, beforeBodies[1]!), reservation_item_id: childIdsInLifecycleOrder(graph.items, beforeBodies[2]!) });
      const afterBodies = await bodies(graph.items);
      for (const [index, rows] of afterBodies.entries()) for (const row of rows) {
        expect(typeof row.deleted_at).toBe("string"); expect(unchangedFields(row)).toEqual(unchangedFields(beforeBodies[index]!.find(before => before.id === row.id)!));
      }
      expect(await bodies(graph.outsideItems)).toEqual(beforeOutside); expect(await connected.preserved()).toEqual(preserved);
      const after = await snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.commits.length - before.commits.length).toBe(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(24);
      expect(emitted).toHaveLength(17); expectLifecycleEvents(emitted, beforeBodies, "deleted"); expect(emitted.length).toBeLessThanOrEqual(64);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(eventIds(emitted.filter(event => event.envelope.contract.startsWith("inventory.")))).toHaveLength(16);
      expect(await Effect.runPromise(host.run(key, ids))).toEqual(ids); expect(native).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(after);
      await expect(Effect.runPromise(host.run(key, [...ids].reverse()))).rejects.toMatchObject({ reason: "requestConflict" });
      await expect(Effect.runPromise(otherRevision.run(key, ids))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await snapshot()).toEqual(after);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("keeps raw missing, repeated and already-deleted IDs in output while lifecycle membership is actual", async () => {
    const graph = await connected.seed("item-delete-raw"), host = await connected.prepare(), ids = [graph.items[1]!, "absent-raw-item", graph.items[0]!, graph.items[1]!];
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems");
    try {
      expect(await Effect.runPromise(host.run(host.newRequestKey(), ids))).toEqual(ids); expect(native.mock.calls[0]?.[0]).toEqual(ids);
      for (const input of [[graph.items[0]!], ["absent-raw-item"], [graph.items[0]!, graph.items[0]!, "absent-raw-item"]]) {
        const before = await snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), input))).toEqual(input);
        const after = await snapshot(); expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
        expect(after.commits.length - before.commits.length).toBe(1);
      }
    } finally { native.mockRestore(); }
  }, 180_000);

  it("uses actual active-Level computed reservation sums and refuses before deleting Items or Links", async () => {
    const graph = await connected.seed("item-delete-reserved", 1, 1), host = await connected.prepare(), native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems");
    try {
      const before = await snapshot(), ids = [...graph.items].reverse();
      const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), ids)));
      if (Result.isSuccess(result)) throw new Error("Positive active-Level reservations bypassed native guard");
      expect(nativeFailure(result.failure)).toMatchObject({ type: "invalid_data", message:
        `Cannot remove following inventory item(s) since they have reservations: [${ids.join(", ")}].` });
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("retains positive stocked and incoming quantities without inventing additional deletion guards", async () => {
    const graph = await connected.seed("item-delete-stock"), host = await connected.prepare();
    await Effect.runPromise(connected.updater.run(connected.updater.newRequestKey(), { updates: graph.pairs.map(pair => ({ ...pair, stocked_quantity: 12.5, incoming_quantity: 6.25 })) }));
    const before = await bodies(graph.items); expect(await Effect.runPromise(host.run(host.newRequestKey(), graph.items))).toEqual(graph.items);
    const after = await bodies(graph.items);
    for (const row of after[1]!) expect(unchangedFields(row)).toEqual(unchangedFields(before[1]!.find(level => level.id === row.id)!));
    const reservations = await Effect.runPromise(projectExactNumericColumns(after[2]!, [{ name: "quantity" }], "exact"));
    if (!Array.isArray(reservations)) throw new Error("Missing reservation array");
    for (const row of reservations) {
      if (!isJsonObject(row)) throw new Error("Missing reservation row");
      expect(typeof row.quantity).toBe("string");
      if (typeof row.quantity !== "string") throw new Error("Missing exact reservation quantity");
      expect(MathBN.eq(row.quantity, 0)).toBe(true);
      expect(typeof row.deleted_at).toBe("string");
      expect(unchangedFields(row)).toEqual(unchangedFields(before[2]!.find(reservation => reservation.id === row.id)!));
    }
  }, 180_000);

  it("authenticates direct lifecycle maps and restores all children and rich Links through retained native inverses", async () => {
    const graph = await connected.seed("item-delete-inverse"), host = await connected.prepare(), restore = await connected.prepareRestore();
    const original = await bodies(graph.items);
    expect(await Effect.runPromise(connected.nativeDelete([]))).toEqual({}); expect(await Effect.runPromise(connected.nativeRestore([]))).toEqual({});
    expect(await Effect.runPromise(host.run(host.newRequestKey(), graph.items))).toEqual(graph.items);
    expect(await Effect.runPromise(connected.nativeDelete(graph.items))).toEqual({});
    const native = vi.spyOn(InventoryModuleService.prototype, "restoreInventoryItems");
    try {
      for (const alreadyActive of [false, true]) {
        const before = await snapshot(); expect(await Effect.runPromise(restore.run(restore.newRequestKey(), graph.items))).toBeNull();
        expect(native.mock.calls.at(-1)?.[0]).toEqual(graph.items);
        expect(await native.mock.results.at(-1)?.value).toEqual({ inventory_item_id: [...graph.items].sort(),
          inventory_level_id: childIdsInLifecycleOrder(graph.items, original[1]!), reservation_item_id: childIdsInLifecycleOrder(graph.items, original[2]!) });
        const after = await snapshot(), restored = await bodies(graph.items);
        expect(after.rowChanges.length - before.rowChanges.length).toBe(alreadyActive ? 0 : original.flat().length);
        expectLifecycleEvents(after.events.slice(before.events.length), original, "restored");
        for (const [index, rows] of restored.entries()) for (const row of rows) {
          expect(row.deleted_at).toBeNull(); expect(unchangedFields(row)).toEqual(unchangedFields(original[index]!.find(before => before.id === row.id)!));
        }
      }
      native.mockClear(); const beforeEmpty = await snapshot(); expect(await Effect.runPromise(restore.run(restore.newRequestKey(), []))).toBeNull();
      expect(native).not.toHaveBeenCalled(); const afterEmpty = await snapshot(); expect(afterEmpty.rows).toEqual(beforeEmpty.rows); expect(afterEmpty.events).toEqual(beforeEmpty.events);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("restores predeleted descendant and Link history through endpoint membership rather than only forward changed IDs", async () => {
    const graph = await connected.seed("item-delete-history"), host = await connected.prepare(), restore = await connected.prepareRestore();
    const levels = await Effect.runPromise(connected.probe("inventory_level", graph.items));
    await Effect.runPromise(connected.levelDeleter.run(connected.levelDeleter.newRequestKey(), { id: levels[0]!.id, force: true }));
    const linkDelete = await connected.prepareLinkDelete(); await Effect.runPromise(linkDelete.run(linkDelete.newRequestKey(), graph.items));
    const before = await bodies(graph.items), deletedBefore = before.flat().filter(row => row.deleted_at !== null).map(row => row.id);
    expect(deletedBefore.length).toBeGreaterThan(1);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), graph.items))).toEqual(graph.items);
    const fullyDeleted = await bodies(graph.items); expect(fullyDeleted.flat().every(row => typeof row.deleted_at === "string")).toBe(true);
    expect(await Effect.runPromise(restore.run(restore.newRequestKey(), graph.items))).toBeNull();
    const active = await bodies(graph.items); expect(active.flat().every(row => row.deleted_at === null)).toBe(true);
    for (const [index, rows] of active.entries()) for (const row of rows)
      expect(unchangedFields(row)).toEqual(unchangedFields(before[index]!.find(old => old.id === row.id)!));
  }, 240_000);

  it.each(["levels", "reservations", "links"] as const)("refuses complete persisted %s overflow without partial publication", async kind => {
    const graph = await connected.seed("item-delete-overflow-" + kind, kind === "links" ? 2 : 1, 0, kind === "levels" ? 3 : 2, kind === "links");
    if (kind === "levels") {
      const levels = await Effect.runPromise(connected.probe("inventory_level", [graph.items[0]!]));
      await Effect.runPromise(connected.levelDeleter.run(connected.levelDeleter.newRequestKey(), { id: levels[0]!.id, force: true }));
    }
    if (kind === "reservations") await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), {
      reservations: [{ ...graph.pairs[0]!, quantity: 0, metadata: { second: true } }] }));
    if (kind === "links") {
      // Complete history includes eight deleted matches plus the ninth active one.
      const linkDelete = await connected.prepareLinkDelete();
      await Effect.runPromise(linkDelete.run(linkDelete.newRequestKey(), graph.items));
      const extra = await connected.appendVariant("item-delete-overflow-link-extra", graph.products[0]!.id);
      const variant = extra[0]; if (variant === undefined) throw new Error("Missing actual extra Variant");
      await connected.attachInventory(variant.id, graph.items[0]!);
    }
    const host = await connected.prepare(), before = await snapshot();
    expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.items))))).toBe(true); expect(await snapshot()).toEqual(before);
  }, 240_000);

  it("refuses malformed and fifth raw IDs before querying or native deletion", async () => {
    const host = await connected.prepare(), native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems"), list = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryItems");
    try {
      const before = await snapshot();
      for (const input of [["duplicate", "duplicate", "duplicate", "duplicate", "duplicate"], "single", { ids: [] }, [""], [42]]) {
        // @ts-expect-error Deliberate malformed public boundary witness.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(native).not.toHaveBeenCalled(); expect(list).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); list.mockRestore(); }
  });

  it("rolls back late native errors, forged ignored maps and forged lifecycle events", async () => {
    const graph = await connected.seed("item-delete-late"), host = await connected.prepare();
    for (const mode of ["throw", "map", "event", "malformed-event"] as const) {
      const original = InventoryModuleService.prototype.softDeleteInventoryItems; let completed = false;
      const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
        const result = await Reflect.apply(original, this, args); completed = true;
        if (mode === "throw") throw new Error("Late native Item deletion failure");
        if (mode === "map") return { ...result, inventory_level_id: ["forged-level"] };
        const bus: unknown = Reflect.get(this, "eventBusModuleService_"); if (typeof bus !== "object" || bus === null) throw new Error("Missing genuine event bus");
        const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing genuine emitter");
        await Reflect.apply(emit, bus, [[{ name: "inventory.inventory-item.deleted", data: { id: mode === "malformed-event" ? 42 : "forged-item" },
          metadata: { source: "inventory", object: "inventory_item", action: "deleted" } }], { internal: true }]); return result;
      });
      try {
        const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.items)));
        if (Result.isSuccess(result)) throw new Error("Invalid native Item deletion committed");
        expect(completed).toBe(true); expect(failurePath(result.failure)).toContain(mode === "throw" ? "adapterFailure" : mode === "malformed-event" ? "unadmittedEvent" : "receiptMismatch");
        expect(await snapshot()).toEqual(before);
      } finally { native.mockRestore(); }
    }
  }, 240_000);

  it("authenticates computed reservation projection before allowing the native guard to consume it", async () => {
    const graph = await connected.seed("item-delete-forged-read", 1, 1), host = await connected.prepare();
    const original = InventoryModuleService.prototype.listAndCountInventoryItems;
    const list = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const [rows, count] = await Reflect.apply(original, this, args);
      return [rows.map(row => ({ ...row, reserved_quantity: 0 })), count];
    });
    try {
      const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.items))))).toBe(true);
      expect(await snapshot()).toEqual(before);
    } finally { list.mockRestore(); }
  }, 180_000);

  it("keeps a caught forbidden sibling write sticky and revokes escaped callback access", async () => {
    const graph = await connected.seed("item-delete-poison"), host = await connected.prepare(), original = InventoryModuleService.prototype.softDeleteInventoryItems;
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.updateInventoryItems({ id: graph.items[0]!, title: "Forbidden sibling" }); } catch { caught = true; } return result;
    });
    try {
      const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.items))))).toBe(true);
      expect(caught).toBe(true); expect(await snapshot()).toEqual(before);
      if (escaped === undefined) throw new Error("Missing escaped native callback"); await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("rolls back cancellation after native cascade and revokes the pending continuation", async () => {
    const graph = await connected.seed("item-delete-cancel"), host = await connected.prepare(), reached = Deferred.makeUnsafe<void>();
    const original = InventoryModuleService.prototype.softDeleteInventoryItems; let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot(); await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), graph.items));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await snapshot()).toEqual(before); finish?.(); if (escaped === undefined) throw new Error("Missing revoked continuation");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it.skipIf(driver !== "postgres").each(["reservation", "adjustment", "absolute"] as const)("rejects stale Item deletion after competing native %s commits", async kind => {
    const graph = await connected.seed("item-delete-race-" + kind), host = await connected.prepare(), reached = Deferred.makeUnsafe<void>();
    const original = InventoryModuleService.prototype.softDeleteInventoryItems; let finish: (() => void) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    const pending = Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.items)));
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      if (kind === "reservation") await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), {
        reservations: [{ ...graph.pairs[0]!, quantity: 3 }] }).pipe(Effect.timeout(30_000)));
      else if (kind === "adjustment") await Effect.runPromise(connected.adjust.run(connected.adjust.newRequestKey(), [{ ...graph.pairs[0]!, adjustment: 1 }]).pipe(Effect.timeout(30_000)));
      else await Effect.runPromise(connected.updater.run(connected.updater.newRequestKey(), { updates: [{ ...graph.pairs[0]!, stocked_quantity: 7 }] }).pipe(Effect.timeout(30_000)));
      const committed = await snapshot(); finish?.(); const result = await pending;
      if (Result.isSuccess(result)) throw new Error("Stale native Item deletion committed after competing quantity change");
      expect(failurePath(result.failure)).toContain("writeConflict"); expect(await snapshot()).toEqual(committed);
      expect((await Effect.runPromise(connected.probe("inventory_item", graph.items))).every(row => row.deleted_at === null)).toBe(true);
    } finally { finish?.(); await pending; native.mockRestore(); }
  }, 180_000);

  it("isolates identical raw IDs and request keys across actual scopes", async () => {
    const other = await prepareLogicalInventoryItemDeletion(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "inventory_item_deletion_shop_b", projectId: "inventory_item_deletion_shop_b", uuidOffset: 440_000 } });
    const leftGraph = await connected.seed("item-delete-scope"), rightGraph = await other.seed("item-delete-scope");
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey();
    expect(await Effect.runPromise(left.run(key, leftGraph.items))).toEqual(leftGraph.items);
    expect((await Effect.runPromise(other.probe("inventory_item", rightGraph.items))).every(row => row.deleted_at === null)).toBe(true);
    expect(await Effect.runPromise(right.run(key, rightGraph.items))).toEqual(rightGraph.items);
    const before = await snapshot(); expect(await Effect.runPromise(left.run(key, leftGraph.items))).toEqual(leftGraph.items);
    expect(await Effect.runPromise(right.run(key, rightGraph.items))).toEqual(rightGraph.items); expect(await snapshot()).toEqual(before);
  }, 240_000);

  it("refuses a different Inventory or Link profile before native execution", async () => {
    const before = await snapshot();
    const result = await Effect.runPromise(Effect.result(prepareInventoryItemDeletionWorkflow({ ...connected.options,
      // @ts-expect-error Deliberately wrong authentic module profile.
      modules: { ...connected.options.modules, inventory: { ...connected.options.modules.inventory, module: connected.inventoryDeletion.workflow } },
    })));
    expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
  });
});
