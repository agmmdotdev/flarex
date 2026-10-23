import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryItemCreationInput, prepareInventoryItemCreationWorkflow } from "../src/workflows/inventory/create-items";
import { projectExactNumericColumns } from "../src/value/exact-numeric";
import { prepareLogicalInventoryItemCreation } from "./support/logical-inventory-item-create-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryItemCreation>>;
let sharedCleanupCount = 0;
const snapshot = () => logicalCurrencyInventory(connected.fixture);
const decodeIds = Schema.decodeUnknownSync(Schema.Array(Schema.String));
function reasons(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => reason._tag === "Fail" ? reasons(reason.error) : reason._tag === "Die" ? reasons(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...reasons(value.cause)];
  return value instanceof Error ? [value.message, ...reasons(value.cause)] : [];
}
function nativeFailure(value: unknown): unknown {
  if (Cause.isCause(value)) return nativeFailure(Cause.squash(value));
  return value instanceof Error && value.cause !== undefined ? nativeFailure(value.cause) : value;
}
function eventIds(events: Awaited<ReturnType<typeof snapshot>>["events"], entity: "item" | "level", action: "created" | "deleted") {
  return events.filter(event => event.envelope.contract === "inventory.inventory-" + entity + "." + action).flatMap(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Inventory creation event");
    return decodeIds(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  });
}
function changedTombstones(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>, count: number) {
  const commits = after.commits.slice(before.commits.length); expect(commits).toHaveLength(1);
  const sequences = new Set(commits.map(commit => commit.commitSeq)), revisions = after.revisions.filter(row => sequences.has(row.commitSeq));
  expect(after.rowChanges.length - before.rowChanges.length).toBe(count); expect(revisions).toHaveLength(count);
  expect(revisions.every(row => row.isTombstone && row.valueBytes === null && row.valueSha256 === null)).toBe(true);
}

describe("native standalone Inventory Item creation on shared logical storage", { concurrent: false }, () => {
  it("preserves repeated Item identities through native creation and retained physical inverse", async () => {
    const probes = await connected.prepareProbes(), before = await snapshot();
    const input = [{ id: "item-create-shared", sku: null, title: "First", metadata: null },
      { id: "item-create-between", sku: "item-create-between" },
      { id: "item-create-shared", sku: "item-create-filled", title: "Ignored", metadata: { retained: true } }];
    const key = probes.create.newRequestKey(), result = await Effect.runPromise(probes.create.run(key, input));
    expect(result.compensation).toEqual(["item-create-shared", "item-create-between", "item-create-shared"]);
    expect(result.output[0]).toEqual(result.output[2]);
    expect(result.output[0]).toMatchObject({ title: "First", sku: "item-create-filled", metadata: { retained: true } });
    expect(await Effect.runPromise(connected.probeItems(["item-create-shared"]))).toEqual([result.output[0]]);
    const after = await snapshot();
    expect(after.rows.length - before.rows.length).toBe(2);
    expect(eventIds(after.events.slice(before.events.length), "item", "created")).toEqual(["item-create-shared", "item-create-between"]);
    expect(await Effect.runPromise(probes.create.run(key, input))).toEqual(result);
    expect(await snapshot()).toEqual(after);
    await expect(Effect.runPromise(probes.create.run(probes.create.newRequestKey(), input))).rejects.toBeDefined();
    expect(await snapshot()).toEqual(after);
    expect(await Effect.runPromise(probes.undo.run(probes.undo.newRequestKey(), result.compensation))).toBeNull();
    expect(await Effect.runPromise(connected.probeItems(result.compensation))).toEqual([]);
  }, 180_000);

  beforeAll(async () => {
    connected = await prepareLogicalInventoryItemCreation(driver, close => cleanup.push(close));
    sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => {
    for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close();
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("preserves every empty callback and the required read-only Stock Location query", async () => {
    const host = await connected.prepare(), items = vi.spyOn(InventoryModuleService.prototype, "createInventoryItems"), levels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    const query = vi.spyOn(StockLocationModuleService.prototype, "listAndCountStockLocations");
    try {
      for (const input of [{}, { items: [] }]) {
        const before = await snapshot(), key = host.newRequestKey(); expect(await Effect.runPromise(host.run(key, input))).toEqual([]);
        expect(items.mock.calls.at(-1)?.[0]).toEqual([]); expect(levels.mock.calls.at(-1)?.[0]).toEqual([]);
        expect(query.mock.calls.at(-1)?.[0]).toEqual({ id: [] });
        const after = await snapshot(); expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.rowChanges).toEqual(before.rowChanges);
        expect(after.commits.length - before.commits.length).toBe(1); expect(await Effect.runPromise(host.run(key, input))).toEqual([]); expect(await snapshot()).toEqual(after);
      }
      expect(items).toHaveBeenCalledTimes(2); expect(levels).toHaveBeenCalledTimes(2); expect(query).toHaveBeenCalledTimes(2);
    } finally { items.mockRestore(); levels.mockRestore(); query.mockRestore(); }
  }, 120_000);

  it("creates four complete Items and eight ordinal Levels with all endpoints preserved and one replayable settlement", async () => {
    const protectedGraph = await connected.seedProtected("item-create-protected"), protectedItems = await Effect.runPromise(connected.probeItems(protectedGraph.items));
    const graph = await connected.maximum("item-create-max"), host = await connected.prepare(), otherRevision = await connected.prepare("8".repeat(64));
    const inputBefore = structuredClone(graph.input), preserved = await connected.preserved(); for (const rows of Object.values(preserved)) expect(rows.length).toBeGreaterThan(0);
    const before = await snapshot(), key = host.newRequestKey(); let calls = 0;
    const output = await Effect.runPromise(host.run(key, graph.input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("Native Item creation maximum calls", calls)))));
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); expect(output).toHaveLength(4); expect(output.map(row => row.id)).toEqual(graph.ids);
    for (const [index, row] of output.entries()) {
      const { location_levels: _levels, ...fields } = graph.input.items![index]!;
      expect(row).toMatchObject({ ...fields, deleted_at: null }); expect(Object.keys(row).sort()).toEqual([
        "id", "sku", "origin_country", "hs_code", "mid_code", "material", "weight", "length", "height", "width", "requires_shipping", "description", "title", "thumbnail", "metadata", "created_at", "updated_at", "deleted_at",
      ].sort()); expect(typeof row.created_at).toBe("string"); expect(typeof row.updated_at).toBe("string");
    }
    expect(graph.input).toEqual(inputBefore); expect(await Effect.runPromise(connected.probeItems(graph.ids))).toEqual([...output].sort((a, b) => a.id.localeCompare(b.id)));
    const stored = await connected.probeCohort(graph.ids); expect(stored).toHaveLength(8);
    for (const [index, item] of output.entries()) for (const level of graph.input.items![index]!.location_levels!) {
      const row = stored.find(row => row.inventory_item_id === item.id && row.location_id === level.location_id); if (row === undefined) throw new Error("Native ordinal Level missing");
      const exact = await Effect.runPromise(projectExactNumericColumns(row, [{ name: "stocked_quantity" }, { name: "incoming_quantity" }, { name: "reserved_quantity" }], "exact"));
      if (level.stocked_quantity === undefined || level.incoming_quantity === undefined) throw new Error("Missing maximum fixture quantities");
      const stocked = new BigNumber(level.stocked_quantity), incoming = new BigNumber(level.incoming_quantity), reserved = new BigNumber(0);
      expect(exact).toMatchObject({ stocked_quantity: stocked.raw?.value, incoming_quantity: incoming.raw?.value,
        reserved_quantity: reserved.raw?.value, deleted_at: null });
      expect(row).toMatchObject({ raw_stocked_quantity: stocked.raw, raw_incoming_quantity: incoming.raw, raw_reserved_quantity: reserved.raw });
    }
    expect(await connected.preserved()).toEqual(preserved); expect(await Effect.runPromise(connected.probeItems(protectedGraph.items))).toEqual(protectedItems);
    const after = await snapshot(), emitted = after.events.slice(before.events.length);
    expect(after.commits.length - before.commits.length).toBe(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(12); expect(emitted).toHaveLength(12);
    expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1); expect(emitted.every(event => event.envelope.internal)).toBe(true);
    expect(eventIds(emitted, "item", "created")).toEqual(graph.ids); expect(eventIds(emitted, "level", "created")).toHaveLength(8);
    expect(new Set(eventIds(emitted, "level", "created"))).toEqual(new Set(stored.map(row => row.id)));
    expect(await Effect.runPromise(host.run(key, graph.input))).toEqual(output); expect(await snapshot()).toEqual(after);
    await expect(Effect.runPromise(host.run(key, { items: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
    await expect(Effect.runPromise(otherRevision.run(key, graph.input))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await snapshot()).toEqual(after);
  }, 240_000);

  it("retains generated identities, Item defaults, absent nested arrays and signed Level quantities", async () => {
    const [location] = await connected.seedLocations("item-create-default", 1); if (location === undefined) throw new Error("Missing Location");
    const host = await connected.prepare(), output = await Effect.runPromise(host.run(host.newRequestKey(), { items: [{ sku: "item-create-default-a" },
      { sku: "item-create-default-b", location_levels: [] }, { sku: "item-create-default-c", weight: -1.5, requires_shipping: false,
        location_levels: [{ location_id: location, stocked_quantity: -3.125, incoming_quantity: 2.75 }] }] }));
    expect(output).toHaveLength(3); expect(new Set(output.map(row => row.id)).size).toBe(3);
    expect(output[0]).toMatchObject({ requires_shipping: true, weight: null, title: null, metadata: null, deleted_at: null });
    const levels = await connected.probeCohort(output.map(row => row.id)); expect(levels).toHaveLength(1);
    const exact = await Effect.runPromise(projectExactNumericColumns(levels[0]!, [{ name: "stocked_quantity" }, { name: "incoming_quantity" }, { name: "reserved_quantity" }], "exact"));
    const stocked = new BigNumber(-3.125), incoming = new BigNumber(2.75), reserved = new BigNumber(0);
    expect(exact).toMatchObject({ inventory_item_id: output[2]!.id, stocked_quantity: stocked.raw?.value,
      incoming_quantity: incoming.raw?.value, reserved_quantity: reserved.raw?.value });
    expect(levels[0]).toMatchObject({ raw_stocked_quantity: stocked.raw, raw_incoming_quantity: incoming.raw, raw_reserved_quantity: reserved.raw });
  }, 120_000);

  it.each(["missing", "deleted"] as const)("rolls back staged Items for a genuinely %s Location", async mode => {
    const host = await connected.prepare(), location = "item-create-" + mode + "-location";
    if (mode === "deleted") { const [created] = await connected.seedLocations("item-create-deleted", 1); expect(created).toBe(location + "-0"); const deletion = await connected.prepareLocationDeletion(); await Effect.runPromise(deletion.run(deletion.newRequestKey(), [created!])); }
    const selected = mode === "deleted" ? location + "-0" : location, before = await snapshot();
    const result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { items: [{ sku: "item-create-location-" + mode, location_levels: [{ location_id: selected }] }] })));
    expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(nativeFailure(result.failure)).toMatchObject({ type: "not_found", message: "Stock locations with ids: " + selected + " was not found" });
    expect(await snapshot()).toEqual(before);
  }, 180_000);

  it.each(["reordered", "metadata", "missing-field", "missing-row"] as const)("authenticates %s Item results before ordinal child association", async mode => {
    const graph = await connected.maximum("item-create-item-forged-" + mode), host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryItems;
    let changed = false; const levels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    const forged = vi.spyOn(InventoryModuleService.prototype, "createInventoryItems").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (!Array.isArray(result)) throw new Error("Expected native array Item result"); changed = true;
      if (mode === "reordered") return [...result].reverse();
      if (mode === "missing-row") return result.slice(1);
      for (const [index, row] of result.entries()) { if (index !== 0) continue; if (mode === "metadata") Reflect.set(row, "metadata", { forged: true }); else Reflect.deleteProperty(row, "title"); } return result;
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.input)));
      expect(Result.isFailure(result)).toBe(true); expect(changed).toBe(true); expect(levels).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { forged.mockRestore(); levels.mockRestore(); }
  }, 240_000);

  it.each(["reordered", "quantity", "metadata", "missing-field"] as const)("authenticates ignored %s nested Level results", async mode => {
    const graph = await connected.maximum("item-create-level-forged-" + mode), host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryLevels;
    let changed = false; const forged = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (!Array.isArray(result)) throw new Error("Expected native array Level result"); changed = true;
      if (mode === "reordered") return [...result].reverse();
      for (const [index, row] of result.entries()) { if (index !== 0) continue; if (mode === "quantity") Reflect.set(row, "available_quantity", 9999); else if (mode === "metadata") Reflect.set(row, "metadata", { forged: true }); else Reflect.deleteProperty(row, "deleted_at"); } return result;
    });
    try { const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.input))))).toBe(true); expect(changed).toBe(true); expect(await snapshot()).toEqual(before); }
    finally { forged.mockRestore(); }
  }, 240_000);

  it.each(["requested-missing", "other-existing", "count"] as const)("authenticates Stock Location %s before the native existence guard", async mode => {
    const [known, other] = await connected.seedLocations("item-create-forged-location-" + mode, 2), host = await connected.prepare();
    if (known === undefined || other === undefined) throw new Error("Missing genuine Stock Location identities");
    const requested = mode === "requested-missing" ? "item-create-forged-missing" : known, original = StockLocationModuleService.prototype.listAndCountStockLocations;
    let changed = false; const forged = vi.spyOn(StockLocationModuleService.prototype, "listAndCountStockLocations").mockImplementation(async function (this: StockLocationModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); changed = true;
      if (mode === "count") result[1]++; else { Reflect.set(result, 0, [{ id: mode === "requested-missing" ? requested : other }]); result[1] = 1; } return result;
    });
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { items: [{ sku: "item-create-forged-location-sku-" + mode, location_levels: [{ location_id: requested }] }] })));
      expect(Result.isFailure(result)).toBe(true); if (Result.isFailure(result)) expect(reasons(result.failure)).toContain("receiptMismatch"); expect(changed).toBe(true); expect(await snapshot()).toEqual(before);
    } finally { forged.mockRestore(); }
  }, 180_000);

  it("keeps native Level-before-Item physical inverse methods and generated IDs", async () => {
    const graph = await connected.maximum("item-create-inverse-order"), host = await connected.prepare(), probes = await connected.prepareProbes();
    const output = await Effect.runPromise(host.run(host.newRequestKey(), graph.input)), ids = output.map(row => row.id), levels = await connected.probeCohort(ids);
    const beforeLevels = await snapshot(); let calls = 0;
    expect(await Effect.runPromise(probes.undoChild.run(probes.undoChild.newRequestKey(), levels.map(row => row.id)).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    })))).toBeNull(); expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    const afterLevels = await snapshot(); changedTombstones(beforeLevels, afterLevels, 8);
    expect(new Set(eventIds(afterLevels.events.slice(beforeLevels.events.length), "level", "deleted"))).toEqual(new Set(levels.map(row => row.id)));
    const beforeItems = await snapshot(); expect(await Effect.runPromise(probes.undo.run(probes.undo.newRequestKey(), ids))).toBeNull();
    const afterItems = await snapshot(); changedTombstones(beforeItems, afterItems, 4); expect(eventIds(afterItems.events.slice(beforeItems.events.length), "item", "deleted")).toEqual([...ids].sort());
    expect(await Effect.runPromise(connected.probeItems(ids))).toEqual([]); expect(await connected.probeCohort(ids)).toEqual([]);
    const beforeEmpty = await snapshot(); for (const input of [[], ids]) expect(await Effect.runPromise(probes.undo.run(probes.undo.newRequestKey(), input))).toBeNull();
    const afterEmpty = await snapshot(); expect(afterEmpty.rows).toEqual(beforeEmpty.rows); expect(afterEmpty.events).toEqual(beforeEmpty.events); expect(afterEmpty.rowChanges).toEqual(beforeEmpty.rowChanges);
  }, 240_000);

  it("physically cascades complete active and deleted Item history while emitting only native root Item events", async () => {
    const graph = await connected.maximum("item-create-inverse-cascade"), host = await connected.prepare(), probes = await connected.prepareProbes();
    const output = await Effect.runPromise(host.run(host.newRequestKey(), graph.input)), ids = output.map(row => row.id), rows = await connected.probeCohort(ids);
    const pairs = rows.map(row => ({ inventory_item_id: row.inventory_item_id, location_id: row.location_id }));
    for (let offset = 0; offset < pairs.length; offset += 4) await Effect.runPromise(connected.nativeUpdate(pairs.slice(offset, offset + 4).map(pair => ({ ...pair, stocked_quantity: 10, incoming_quantity: 0 }))));
    for (const [index, inventory_item_id] of ids.entries()) await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), {
      reservations: [{ inventory_item_id, location_id: graph.locations[index * 2]!, quantity: 1 }] }));
    await Effect.runPromise(connected.remove([ids[0]!]));
    const before = await snapshot(); let calls = 0; expect(await Effect.runPromise(probes.undo.run(probes.undo.newRequestKey(), ids).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("Native Item-only cascade inverse calls", calls)))))).toBeNull();
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); const after = await snapshot(); changedTombstones(before, after, 16);
    const emitted = after.events.slice(before.events.length); expect(emitted).toHaveLength(4); expect(eventIds(emitted, "item", "deleted")).toEqual([...ids].sort()); expect(eventIds(emitted, "level", "deleted")).toEqual([]);
    expect(await Effect.runPromise(connected.probeItems(ids))).toEqual([]); expect(await connected.probeCohort(ids)).toEqual([]);
  }, 240_000);

  it.each(["levels", "reservations"] as const)("refuses complete physical inverse history overflow for %s without truncation", async mode => {
    const [location] = await connected.seedLocations("item-create-inverse-overflow-" + mode, 1); if (location === undefined) throw new Error("Missing Location");
    const host = await connected.prepare(), probes = await connected.prepareProbes(), output = await Effect.runPromise(host.run(host.newRequestKey(), { items: [{ sku: "item-create-overflow-" + mode, location_levels: [{ location_id: location, stocked_quantity: 10 }] }] }));
    const id = output[0]!.id;
    if (mode === "levels") { for (const suffix of ["b", "c"]) await connected.nativeCreateLevel({ inventory_item_id: id, location_id: "historical-unresolved-" + suffix }); }
    else for (let index = 0; index < 2; index++) await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), {
      reservations: [{ inventory_item_id: id, location_id: location, quantity: 1 }] }));
    const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(probes.undo.run(probes.undo.newRequestKey(), [id]))))).toBe(true); expect(await snapshot()).toEqual(before);
  }, 240_000);

  it.each(["sku", "tuple"] as const)("preserves native duplicate %s refusal and full root rollback", async mode => {
    const [location] = await connected.seedLocations("item-create-duplicate-" + mode, 1); if (location === undefined) throw new Error("Missing Location");
    const host = await connected.prepare(), input = { items: mode === "sku" ? [{ sku: "item-create-duplicate-sku" }, { sku: "item-create-duplicate-sku" }] : [{ sku: "item-create-duplicate-tuple", location_levels: [{ location_id: location }, { location_id: location }] }] };
    const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true); expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("refuses raw cardinality and managed fields before the first native callback", async () => {
    const host = await connected.prepare(), items = vi.spyOn(InventoryModuleService.prototype, "createInventoryItems");
    try {
      const before = await snapshot(); for (const input of [{ items: Array.from({ length: 5 }, () => ({})) },
        { items: [{ location_levels: Array.from({ length: 3 }, () => ({ location_id: "location" })) }] }, { items: null },
        { items: [{ deleted_at: null }] }, { items: [{ location_levels: [{ location_id: "location", reserved_quantity: 1 }] }] },
        { items: [{ location_levels: [{ location_id: "location", inventory_item_id: "foreign" }] }] }]) {
        // @ts-expect-error Deliberately malformed standalone public input.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(items).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { items.mockRestore(); }
  });

  it("rolls back late native child failure and keeps caught forbidden siblings and escaped callbacks revoked", async () => {
    const [location] = await connected.seedLocations("item-create-sticky", 1); if (location === undefined) throw new Error("Missing Location");
    const host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryLevels;
    for (const mode of ["late", "caught"] as const) {
      let caught = false, escaped: (() => Promise<unknown>) | undefined;
      const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
        const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
        if (mode === "late") throw new Error("Late native Level child failure");
        try { await this.updateInventoryItems({ id: "unadmitted-item", title: "Forbidden sibling" }); } catch { caught = true; } return result;
      });
      try {
        const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { items: [{ sku: "item-create-sticky-" + mode, location_levels: [{ location_id: location }] }] }))))).toBe(true);
        expect(caught).toBe(mode === "caught"); expect(await snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing escaped native child");
        await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
      } finally { native.mockRestore(); }
    }
  }, 240_000);

  it.each(["forged-event", "malformed-event"] as const)("rolls back staged Items and Levels after a native %s", async mode => {
    const graph = await connected.maximum("item-create-events-" + mode), host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryLevels;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args), bus: unknown = Reflect.get(this, "eventBusModuleService_");
      if (typeof bus !== "object" || bus === null) throw new Error("Missing genuine native event bus");
      const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing genuine native emitter");
      await Reflect.apply(emit, bus, [[{ name: "inventory.inventory-level.created", data: { id: mode === "malformed-event" ? 42 : "forged-level-creation" },
        metadata: { source: "inventory", object: "inventory_level", action: "created" } }], { internal: true }]); return result;
    });
    try { const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.input))))).toBe(true); expect(await snapshot()).toEqual(before); }
    finally { native.mockRestore(); }
  }, 240_000);

  it("cancels after native child creation and revokes its delayed continuation", async () => {
    const [location] = await connected.seedLocations("item-create-cancel", 1); if (location === undefined) throw new Error("Missing Location");
    const host = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), original = InventoryModuleService.prototype.createInventoryLevels;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot(); await Effect.runPromise(Effect.gen(function* () { const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { items: [{ sku: "item-create-cancel", location_levels: [{ location_id: location }] }] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); }));
      expect(await snapshot()).toEqual(before); finish?.(); if (escaped === undefined) throw new Error("Missing revoked native child"); await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it.skipIf(driver !== "postgres").each(["location-delete", "sku-conflict"] as const)("retains creation dependencies after a competing native %s commits", async mode => {
    const graph = await connected.maximum("item-create-race-" + mode), host = await connected.prepare(), deletion = await connected.prepareLocationDeletion();
    const reached = Deferred.makeUnsafe<void>(), original = InventoryModuleService.prototype.createInventoryLevels; let finish: (() => void) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    const pending = Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.input)));
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      if (mode === "location-delete") await Effect.runPromise(deletion.run(deletion.newRequestKey(), [graph.locations[0]!]).pipe(Effect.timeout(30_000)));
      else await connected.nativeCreate({ id: "competing-item-create-sku", sku: graph.input.items![0]!.sku! });
      const committed = await snapshot(); finish?.(); const result = await pending; if (Result.isSuccess(result)) throw new Error("Stale native Item creation committed after competitor");
      expect(reasons(result.failure)).toContain("writeConflict"); expect(await snapshot()).toEqual(committed);
    } finally { finish?.(); await pending; native.mockRestore(); }
  }, 240_000);

  it("isolates actual scopes with identical explicit identities and request keys", async () => {
    const other = await prepareLogicalInventoryItemCreation(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "inventory_item_create_shop_b", projectId: "inventory_item_create_shop_b", uuidOffset: 490_000 } });
    const left = await connected.prepare(), right = await other.prepare(), key = left.newRequestKey(), input: typeof InventoryItemCreationInput.Type = { items: [{ id: "item-create-scope", sku: "item-create-scope" }] };
    expect((await Effect.runPromise(left.run(key, input))).map(row => row.id)).toEqual(["item-create-scope"]); expect(await Effect.runPromise(other.probeItems(["item-create-scope"]))).toEqual([]);
    expect((await Effect.runPromise(right.run(key, input))).map(row => row.id)).toEqual(["item-create-scope"]);
    const before = await snapshot(); await Effect.runPromise(left.run(key, input)); await Effect.runPromise(right.run(key, input)); expect(await snapshot()).toEqual(before);
  }, 240_000);

  it("refuses another authentic Inventory or Stock Location profile before callbacks", async () => {
    const before = await snapshot();
    const wrongInventory = await Effect.runPromise(Effect.result(prepareInventoryItemCreationWorkflow({ ...connected.options, modules: { ...connected.options.modules,
      // @ts-expect-error Deliberately wrong authentic profile.
      inventory: { ...connected.options.modules.inventory, module: connected.batch.workflow } } })));
    const wrongLocation = await Effect.runPromise(Effect.result(prepareInventoryItemCreationWorkflow({ ...connected.options, modules: { ...connected.options.modules,
      stock_location: { ...connected.options.modules.stock_location, module: connected.members.stockLocation.runtime.workflow } } })));
    expect(Result.isFailure(wrongInventory)).toBe(true); expect(Result.isFailure(wrongLocation)).toBe(true); expect(await snapshot()).toEqual(before);
  });
});
