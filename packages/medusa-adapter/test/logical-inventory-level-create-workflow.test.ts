import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Exit, Fiber, Result, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { prepareInventoryLevelCreationWorkflow } from "../src/workflows/inventory/create-levels";
import { projectExactNumericColumns } from "../src/value/exact-numeric";
import { prepareLogicalInventoryLevelCreation } from "./support/logical-inventory-level-create-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryLevelCreation>>;
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
function eventIds(events: Awaited<ReturnType<typeof snapshot>>["events"], action: "created" | "deleted") {
  return events.filter(event => event.envelope.contract === "inventory.inventory-level." + action).flatMap(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Level event");
    return decodeIds(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  });
}
async function refused(work: Effect.Effect<unknown, CommerceTransactionError>, reason: CommerceTransactionError["reason"], before: Awaited<ReturnType<typeof snapshot>>) {
  const result = await Effect.runPromise(Effect.result(work));
  if (Result.isSuccess(result)) throw new Error("Expected named Level creation refusal " + reason);
  expect(reasons(result.failure), JSON.stringify(reasons(result.failure))).toContain(reason); expect(await snapshot()).toEqual(before); return result.failure;
}
function tombstones(before: Awaited<ReturnType<typeof snapshot>>, after: Awaited<ReturnType<typeof snapshot>>, count: number) {
  const commits = after.commits.slice(before.commits.length); expect(commits).toHaveLength(1);
  const sequences = new Set(commits.map(commit => commit.commitSeq)), revisions = after.revisions.filter(row => sequences.has(row.commitSeq));
  expect(after.rowChanges.length - before.rowChanges.length).toBe(count); expect(revisions).toHaveLength(count);
  expect(revisions.every(row => row.isTombstone && row.valueBytes === null && row.valueSha256 === null)).toBe(true);
}

describe("native standalone Inventory Level creation on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalInventoryLevelCreation(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("performs the required empty Query before the genuine empty Inventory call and replays one settlement", async () => {
    const host = await connected.prepare(), query = vi.spyOn(StockLocationModuleService.prototype, "listAndCountStockLocations");
    const levels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    try {
      const before = await snapshot(), key = host.newRequestKey(), input = { inventory_levels: [] };
      expect(await Effect.runPromise(host.run(key, input))).toEqual([]);
      expect(query.mock.calls.map(call => call[0])).toEqual([{ id: [] }]); expect(levels.mock.calls.map(call => call[0])).toEqual([[]]);
      expect(query.mock.calls[0]?.[1]).toMatchObject({ select: ["id"], relations: [], order: { id: "ASC" }, skip: 0, take: expect.any(Number) });
      expect(query.mock.invocationCallOrder[0]).toBeLessThan(levels.mock.invocationCallOrder[0]!);
      const after = await snapshot(); expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.rowChanges).toEqual(before.rowChanges);
      expect(after.commits.length - before.commits.length).toBe(1);
      expect(await Effect.runPromise(host.run(key, input))).toEqual([]); expect(await snapshot()).toEqual(after);
      expect(query).toHaveBeenCalledTimes(1); expect(levels).toHaveBeenCalledTimes(1);
    } finally { query.mockRestore(); levels.mockRestore(); }
  }, 120_000);

  it.each(["distinct", "repeated"] as const)("creates eight complete ordered Levels with %s existing Items, eight Locations and preserved neighboring families", async pattern => {
    const protectedGraph = await connected.seedProtected("level-create-protected-" + pattern);
    const protectedLevels = await connected.probeCohort(protectedGraph.items), graph = await connected.maximum("level-create-max-" + pattern, pattern === "repeated");
    const host = await connected.prepare(), revision = await connected.prepare("c".repeat(64)), inputBefore = structuredClone(graph.input);
    const preserved = await connected.preserved(); for (const rows of Object.values(preserved)) expect(rows.length).toBeGreaterThan(0);
    const before = await snapshot(), key = host.newRequestKey(); let calls = 0;
    const output = await Effect.runPromise(host.run(key, graph.input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("Standalone Level creation maximum calls", pattern, calls)))));
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); expect(output).toHaveLength(8);
    expect(new Set(output.map(row => row.id)).size).toBe(8);
    const stored = await connected.probeCohort(graph.items); expect(stored).toHaveLength(8);
    for (const [index, row] of output.entries()) {
      const input = graph.input.inventory_levels[index]!, stocked = new BigNumber(input.stocked_quantity ?? 0), incoming = new BigNumber(input.incoming_quantity ?? 0), reserved = new BigNumber(0);
      expect(row.id).toMatch(/^ilev_/);
      expect(row).toMatchObject({ inventory_item_id: input.inventory_item_id, location_id: input.location_id,
        stocked_quantity: input.stocked_quantity ?? 0, incoming_quantity: input.incoming_quantity ?? 0, reserved_quantity: 0,
        available_quantity: input.stocked_quantity ?? 0, metadata: null, deleted_at: null,
        raw_stocked_quantity: stocked.raw, raw_incoming_quantity: incoming.raw, raw_reserved_quantity: reserved.raw });
      expect(Object.keys(row).sort()).toEqual(["id", "inventory_item_id", "location_id", "stocked_quantity", "reserved_quantity", "incoming_quantity",
        "available_quantity", "raw_stocked_quantity", "raw_reserved_quantity", "raw_incoming_quantity", "metadata", "created_at", "updated_at", "deleted_at"].sort());
      expect(typeof row.created_at).toBe("string"); expect(typeof row.updated_at).toBe("string");
      const actual = stored.find(value => value.id === row.id); if (actual === undefined) throw new Error("Missing actual created Level");
      const exact = await Effect.runPromise(projectExactNumericColumns(actual, [{ name: "stocked_quantity" }, { name: "incoming_quantity" }, { name: "reserved_quantity" }], "exact"));
      expect(exact).toMatchObject({ stocked_quantity: stocked.raw?.value, incoming_quantity: incoming.raw?.value, reserved_quantity: reserved.raw?.value });
      expect(actual).toMatchObject({ raw_stocked_quantity: stocked.raw, raw_incoming_quantity: incoming.raw, raw_reserved_quantity: reserved.raw });
    }
    expect(graph.input).toEqual(inputBefore); expect(await connected.preserved()).toEqual(preserved);
    expect(await connected.probeCohort(protectedGraph.items)).toEqual(protectedLevels);
    const after = await snapshot(), emitted = after.events.slice(before.events.length);
    expect(after.commits.length - before.commits.length).toBe(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(8);
    expect(emitted).toHaveLength(8); expect(emitted.every(event => event.envelope.internal && event.envelope.contract === "inventory.inventory-level.created")).toBe(true);
    expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1); expect(eventIds(emitted, "created")).toEqual(output.map(row => row.id));
    expect(await Effect.runPromise(host.run(key, graph.input))).toEqual(output); expect(await snapshot()).toEqual(after);
    await expect(Effect.runPromise(host.run(key, { inventory_levels: [] }))).rejects.toMatchObject({ reason: "requestConflict" });
    await expect(Effect.runPromise(revision.run(key, graph.input))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await snapshot()).toEqual(after);
  }, 240_000);

  it.each(["missing", "deleted"] as const)("keeps the native %s Location error and refuses before Level creation", async mode => {
    const graph = await connected.endpoints("level-create-location-" + mode), host = await connected.prepare();
    const selected = mode === "missing" ? "level-create-absent-location" : graph.locations[0]!;
    if (mode === "deleted") { const deletion = await connected.prepareLocationDeletion(); await Effect.runPromise(deletion.run(deletion.newRequestKey(), [selected])); }
    const levels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    try {
      const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { inventory_levels: [
        { inventory_item_id: graph.items[0]!, location_id: selected }, { inventory_item_id: graph.items[0]!, location_id: selected },
      ] })));
      if (Result.isSuccess(result)) throw new Error("Expected native missing-Location refusal");
      expect(nativeFailure(result.failure)).toMatchObject({ type: "not_found", message: "Stock locations with ids: " + selected + " was not found" });
      expect(levels).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { levels.mockRestore(); }
  }, 180_000);

  it.each(["missing-item", "duplicate-tuple"] as const)("retains %s enforcement and whole-root rollback", async mode => {
    const graph = await connected.endpoints("level-create-invalid-" + mode, 2), host = await connected.prepare();
    const first = graph.input.inventory_levels[0]!, second = mode === "missing-item"
      ? { ...graph.input.inventory_levels[1]!, inventory_item_id: "level-create-nonexistent-item" } : { ...first };
    const before = await snapshot();
    await refused(host.run(host.newRequestKey(), { inventory_levels: [first, second] }), "invalidInput", before);
    expect(await connected.probeCohort(graph.items)).toEqual([]);
  }, 180_000);

  it.each(["reordered", "identity", "quantity", "raw", "default", "metadata", "missing-field", "extra-field", "missing-row"] as const)("authenticates complete native %s Level results before publication", async mode => {
    const graph = await connected.endpoints("level-create-forged-" + mode, 2), host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryLevels;
    let changed = false; const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); if (!Array.isArray(result)) throw new Error("Expected genuine Level array"); changed = true;
      if (mode === "reordered") return [...result].reverse(); if (mode === "missing-row") return result.slice(1);
      const row = result[0]; if (row === undefined) throw new Error("Missing forged Level witness");
      if (mode === "identity") Reflect.set(row, "id", "forged-level-id");
      else if (mode === "quantity") Reflect.set(row, "available_quantity", 99);
      else if (mode === "raw") Reflect.set(row, "raw_stocked_quantity", { value: "99.000000000000000000", precision: 20 });
      else if (mode === "default") Reflect.set(row, "reserved_quantity", 1);
      else if (mode === "metadata") Reflect.set(row, "metadata", { forged: true });
      else if (mode === "extra-field") Reflect.set(row, "invented", true); else Reflect.deleteProperty(row, "updated_at");
      return result;
    });
    try { const before = await snapshot(); await refused(host.run(host.newRequestKey(), graph.input), "receiptMismatch", before); expect(changed).toBe(true); }
    finally { native.mockRestore(); }
  }, 180_000);

  it.each(["requested-missing", "other-existing", "count"] as const)("authenticates the Stock Location %s tuple before its native existence guard", async mode => {
    const graph = await connected.endpoints("level-create-location-forged-" + mode, 2), host = await connected.prepare();
    const requested = mode === "requested-missing" ? "level-create-fabricated-matching-location" : graph.locations[0]!;
    const original = StockLocationModuleService.prototype.listAndCountStockLocations; let changed = false;
    const native = vi.spyOn(StockLocationModuleService.prototype, "listAndCountStockLocations").mockImplementation(async function (this: StockLocationModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); changed = true;
      if (mode === "count") result[1]++; else { Reflect.set(result, 0, [{ id: mode === "requested-missing" ? requested : graph.locations[1]! }]); result[1] = 1; } return result;
    });
    const levels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    try {
      const before = await snapshot(); await refused(host.run(host.newRequestKey(), { inventory_levels: [{ inventory_item_id: graph.items[0]!, location_id: requested }] }), "receiptMismatch", before);
      expect(changed).toBe(true); expect(levels).not.toHaveBeenCalled();
    } finally { native.mockRestore(); levels.mockRestore(); }
  }, 180_000);

  it("uses the genuine eight-ID physical inverse with strict tombstones and preserves Items and neighboring records", async () => {
    const graph = await connected.maximum("level-create-inverse"), host = await connected.prepare(), inverse = await connected.prepareInverse();
    const output = await Effect.runPromise(host.run(host.newRequestKey(), graph.input)), ids = output.map(row => row.id), preserved = await connected.preserved();
    const before = await snapshot(); let calls = 0;
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), ids).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("Standalone Level creation inverse calls", calls)))))).toBeNull();
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64);
    const after = await snapshot(); tombstones(before, after, 8); expect(eventIds(after.events.slice(before.events.length), "deleted")).toHaveLength(8);
    expect(new Set(eventIds(after.events.slice(before.events.length), "deleted"))).toEqual(new Set(ids));
    expect(await connected.probeCohort(graph.items)).toEqual([]); expect(await connected.preserved()).toEqual(preserved);
    const native = vi.spyOn(InventoryModuleService.prototype, "deleteInventoryLevels");
    try {
      for (const raw of [[], ids, [ids[0]!, ids[0]!, "level-create-absent-inverse"]]) {
        const previous = await snapshot(); expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), raw))).toBeNull();
        const current = await snapshot(); expect(current.rows).toEqual(previous.rows); expect(current.events).toEqual(previous.events); expect(current.rowChanges).toEqual(previous.rowChanges);
      }
      expect(native.mock.calls.map(call => call[0])).toEqual([ids, [ids[0]!, ids[0]!, "level-create-absent-inverse"]]);
      const previous = await snapshot(); await refused(inverse.run(inverse.newRequestKey(), Array.from({ length: 9 }, () => ids[0]!)), "invalidInput", previous);
    } finally { native.mockRestore(); }
  }, 240_000);

  it("retains duplicate and missing raw inverse IDs while deleting each actual selected Level once", async () => {
    const graph = await connected.endpoints("level-create-inverse-raw", 2), host = await connected.prepare(), inverse = await connected.prepareInverse();
    const output = await Effect.runPromise(host.run(host.newRequestKey(), graph.input)), ids = output.map(row => row.id), before = await snapshot();
    expect(await Effect.runPromise(inverse.run(inverse.newRequestKey(), [ids[1]!, "missing-level-raw", ids[0]!, ids[1]!]))).toBeNull();
    const after = await snapshot(); tombstones(before, after, 2); const emitted = eventIds(after.events.slice(before.events.length), "deleted");
    expect(emitted).toHaveLength(2); expect(new Set(emitted)).toEqual(new Set(ids)); expect(await connected.probeCohort(graph.items)).toEqual([]);
  }, 180_000);

  it("refuses omitted, oversized, managed and malformed public input before either callback", async () => {
    const host = await connected.prepare(), query = vi.spyOn(StockLocationModuleService.prototype, "listAndCountStockLocations");
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    const malformed: unknown[] = [{}, { inventory_levels: undefined }, { inventory_levels: null },
      { inventory_levels: Array.from({ length: 9 }, () => ({ inventory_item_id: "item", location_id: "location" })) },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", id: "managed" }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", reserved_quantity: 1 }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", raw_stocked_quantity: { value: "1", precision: 20 } }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", metadata: {} }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", deleted_at: null }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", stocked_quantity: Number.NaN }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", incoming_quantity: Number.POSITIVE_INFINITY }] },
      { inventory_levels: [{ inventory_item_id: "item", location_id: "location", stocked_quantity: null }] }];
    try {
      const before = await snapshot();
      for (const input of malformed) {
        // @ts-expect-error Deliberately malformed required native input.
        await refused(host.run(host.newRequestKey(), input), "invalidInput", before);
      }
      expect(query).not.toHaveBeenCalled(); expect(native).not.toHaveBeenCalled();
    } finally { query.mockRestore(); native.mockRestore(); }
  });

  it.each(["late", "caught", "denied"] as const)("rolls back a %s native failure and revokes escaped callbacks", async mode => {
    const graph = await connected.endpoints("level-create-sticky-" + mode), host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryLevels;
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      if (mode === "late") throw new Error("Late native standalone Level creation failure");
      try {
        const update = { id: graph.items[0]!, title: "Unadmitted sibling" };
        if (mode === "denied") await this.updateInventoryItems(update, args[1]);
        else await this.updateInventoryItems(update);
      } catch { caught = true; } return result;
    });
    try {
      const before = await snapshot(), failure = await refused(host.run(host.newRequestKey(), graph.input),
        mode === "late" ? "adapterFailure" : mode === "caught" ? "overlappingOperation" : "unsupportedProfile", before);
      if (mode === "late") expect(reasons(failure)).toContain("Late native standalone Level creation failure");
      else expect(reasons(failure)).toContain("rollbackOnly");
      expect(caught).toBe(mode !== "late");
      if (escaped === undefined) throw new Error("Missing escaped native creation callback");
      await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it.each(["forged", "malformed"] as const)("rolls back actual Level creation after a native %s event", async mode => {
    const graph = await connected.endpoints("level-create-event-" + mode), host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryLevels;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args), bus: unknown = Reflect.get(this, "eventBusModuleService_");
      if (typeof bus !== "object" || bus === null) throw new Error("Missing actual native event bus");
      const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing actual native emitter");
      await Reflect.apply(emit, bus, [[{ name: "inventory.inventory-level.created", data: { id: mode === "malformed" ? 42 : "forged-level-event" },
        metadata: { source: "inventory", object: "inventory_level", action: "created" } }], { internal: true }]); return result;
    });
    try { const before = await snapshot(); await refused(host.run(host.newRequestKey(), graph.input), mode === "malformed" ? "unadmittedEvent" : "receiptMismatch", before); }
    finally { native.mockRestore(); }
  }, 180_000);

  it("interrupts after staged native creation, rolls back the root and revokes the continuation", async () => {
    const graph = await connected.endpoints("level-create-cancel"), host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryLevels;
    const reached = Deferred.makeUnsafe<void>(); let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot(), exit = await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), graph.input));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber); return yield* Fiber.await(fiber);
      }));
      expect(Exit.isFailure(exit)).toBe(true); if (Exit.isFailure(exit)) expect(Cause.hasInterrupts(exit.cause)).toBe(true);
      expect(await snapshot()).toEqual(before); finish?.(); if (escaped === undefined) throw new Error("Missing revoked native continuation");
      await expect(escaped()).rejects.toMatchObject({ reason: "closed" }); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it.skipIf(driver !== "postgres").each(["location-delete", "tuple-conflict"] as const)("retains dependencies after competing native %s commits", async mode => {
    const graph = await connected.endpoints("level-create-race-" + mode), host = await connected.prepare(), deletion = await connected.prepareLocationDeletion();
    const original = InventoryModuleService.prototype.createInventoryLevels, reached = Deferred.makeUnsafe<void>();
    let finish: (() => void) | undefined, parked = false;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const root = !parked; if (root) parked = true;
      if (root && mode === "location-delete") { await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); }
      const result = await Reflect.apply(original, this, args);
      if (root && mode === "tuple-conflict") { await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); }
      return result;
    });
    const pending = Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.input)));
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      if (mode === "location-delete") await Effect.runPromise(deletion.run(deletion.newRequestKey(), [graph.locations[0]!]).pipe(Effect.timeout(30_000)));
      else await connected.nativeCreateLevel({ ...graph.input.inventory_levels[0]!, stocked_quantity: 17 });
      const committed = await snapshot(); finish?.(); const result = await pending;
      if (Result.isSuccess(result)) throw new Error("Stale standalone Level creation committed after native competitor");
      expect(reasons(result.failure)).toContain("writeConflict"); expect(await snapshot()).toEqual(committed);
    } finally { finish?.(); await pending; native.mockRestore(); }
  }, 240_000);

  it("isolates real scopes with identical endpoints and request keys", async () => {
    const graph = await connected.endpoints("level-create-scope"), host = await connected.prepare();
    const other = await prepareLogicalInventoryLevelCreation(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "inventory_level_create_shop_b", projectId: "inventory_level_create_shop_b", uuidOffset: 510_000 } });
    const right = await other.prepare(), beforeOther = await logicalCurrencyInventory(other.fixture);
    const missing = await Effect.runPromise(Effect.result(right.run(right.newRequestKey(), graph.input)));
    if (Result.isSuccess(missing)) throw new Error("Foreign-scope Location satisfied the native existence guard");
    expect(nativeFailure(missing.failure)).toMatchObject({ type: "not_found", message: "Stock locations with ids: " + graph.locations[0] + " was not found" });
    expect(await logicalCurrencyInventory(other.fixture)).toEqual(beforeOther);
    const rightGraph = await other.endpoints("level-create-scope"), key = host.newRequestKey();
    expect(await Effect.runPromise(host.run(key, graph.input))).toMatchObject(graph.input.inventory_levels);
    expect(await other.probeCohort(rightGraph.items)).toEqual([]);
    expect(await Effect.runPromise(right.run(key, rightGraph.input))).toMatchObject(rightGraph.input.inventory_levels);
    const leftAfter = await snapshot(), rightAfter = await logicalCurrencyInventory(other.fixture);
    await Effect.runPromise(host.run(key, graph.input)); await Effect.runPromise(right.run(key, rightGraph.input));
    expect(await snapshot()).toEqual(leftAfter); expect(await logicalCurrencyInventory(other.fixture)).toEqual(rightAfter);
  }, 240_000);

  it("refuses other authentic Inventory and Stock Location profiles before native callbacks", async () => {
    const before = await snapshot(), native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    try {
      const wrongInventory = await Effect.runPromise(Effect.result(prepareInventoryLevelCreationWorkflow({ ...connected.options, modules: { ...connected.options.modules,
        inventory: { ...connected.options.modules.inventory, module: connected.common.creation.workflow } } })));
      const wrongLocation = await Effect.runPromise(Effect.result(prepareInventoryLevelCreationWorkflow({ ...connected.options, modules: { ...connected.options.modules,
        stock_location: { ...connected.options.modules.stock_location, module: connected.members.stockLocation.runtime.workflow } } })));
      expect(wrongInventory).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      expect(wrongLocation).toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });
});
