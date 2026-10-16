import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { InventoryLevelBatchInput, prepareInventoryLevelBatchWorkflow } from "../src/workflows/inventory/batch-levels";
import { prepareLogicalInventoryLevelBatch } from "./support/logical-inventory-level-batch-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryLevelBatch>>;
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
function unchanged(row: typeof Schema.JsonObject.Type) {
  const { deleted_at: _deleted, updated_at: _updated, ...rest } = row; return rest;
}
function eventIds(events: Awaited<ReturnType<typeof snapshot>>["events"], action: "created" | "updated" | "deleted" | "restored") {
  return events.filter(event => event.envelope.contract === "inventory.inventory-level." + action).flatMap(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing native Level event");
    return decodeIds(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  });
}

describe("native parallel Inventory Level batch on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => { connected = await prepareLogicalInventoryLevelBatch(driver, close => cleanup.push(close)); }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("preserves omitted versus explicit empty deleted output and genuine empty callback resolution", async () => {
    const host = await connected.prepare(), create = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels"), update = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels");
    const softDelete = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels");
    try {
      for (const input of [{}, { create: [], update: [] }, { create: [], update: [], delete: [], force: false }]) {
        const before = await snapshot(), key = host.newRequestKey(), output = await Effect.runPromise(host.run(key, input));
        expect(output).toEqual("delete" in input ? { created: [], updated: [], deleted: [] } : { created: [], updated: [] });
        expect(Object.hasOwn(output, "deleted")).toBe("delete" in input); expect(create.mock.calls.at(-1)?.[0]).toEqual([]);
        const after = await snapshot(); expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events); expect(after.rowChanges).toEqual(before.rowChanges);
        expect(after.commits.length - before.commits.length).toBe(1); expect(await Effect.runPromise(host.run(key, input))).toEqual(output); expect(await snapshot()).toEqual(after);
      }
      expect(create).toHaveBeenCalledTimes(3); expect(update).not.toHaveBeenCalled(); expect(softDelete).not.toHaveBeenCalled();
    } finally { create.mockRestore(); update.mockRestore(); softDelete.mockRestore(); }
  }, 120_000);

  it("runs the complete eight-create/four-update/four-delete graph with preserved endpoints, exact native events and one replayable settlement", async () => {
    const protectedGraph = await connected.seedProtected("level-batch-protected"), protectedRows = await Effect.runPromise(connected.probe(protectedGraph.items));
    const graph = await connected.maximum("level-batch-maximum"), host = await connected.prepare(), otherRevision = await connected.prepare("5".repeat(64));
    const beforeRows = await connected.probeCohort(graph.items), preserved = await connected.preserved();
    for (const rows of Object.values(preserved)) expect(rows.length).toBeGreaterThan(0);
    const before = await snapshot(); let calls = 0;
    const key = host.newRequestKey(), output = await Effect.runPromise(host.run(key, graph.input).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("Native Level batch maximum calls", calls)))));
    expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); expect(output.created).toHaveLength(8); expect(output.updated).toHaveLength(4); expect(output.deleted).toEqual(graph.input.delete);
    for (const [index, row] of output.created.entries()) expect(row).toMatchObject({ ...graph.input.create![index], reserved_quantity: 0, deleted_at: null });
    for (const [index, row] of output.updated.entries()) expect(row).toMatchObject({ ...graph.input.update![index], reserved_quantity: 0, deleted_at: null });
    const stored = await connected.probeCohort(graph.items), deleted = new Set(graph.input.delete), updated = new Set(output.updated.map(row => row.id));
    expect(stored).toHaveLength(20);
    for (const row of beforeRows) {
      const after = stored.find(value => value.id === row.id); if (after === undefined) throw new Error("A batch Level disappeared physically");
      if (deleted.has(row.id)) { expect(typeof after.deleted_at).toBe("string"); expect(unchanged(after)).toEqual(unchanged(row)); }
      else if (!updated.has(row.id)) expect(after).toEqual(row);
    }
    expect(await connected.preserved()).toEqual(preserved); expect(await Effect.runPromise(connected.probe(protectedGraph.items))).toEqual(protectedRows);
    const after = await snapshot(), emitted = after.events.slice(before.events.length);
    expect(after.commits.length - before.commits.length).toBe(1); expect(after.rowChanges.length - before.rowChanges.length).toBe(16);
    expect(emitted).toHaveLength(16); expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1); expect(emitted.every(event => event.envelope.internal)).toBe(true);
    expect(eventIds(emitted, "created")).toEqual(output.created.map(row => row.id)); expect(eventIds(emitted, "updated")).toEqual(output.updated.map(row => row.id));
    expect(eventIds(emitted, "deleted")).toEqual([...graph.input.delete!].sort());
    expect(await Effect.runPromise(host.run(key, graph.input))).toEqual(output); expect(await snapshot()).toEqual(after);
    await expect(Effect.runPromise(otherRevision.run(key, graph.input))).rejects.toMatchObject({ reason: "requestConflict" });
    await expect(Effect.runPromise(host.run(key, { ...graph.input, force: false }))).rejects.toMatchObject({ reason: "requestConflict" }); expect(await snapshot()).toEqual(after);
  }, 240_000);

  it("creates against scalar Location IDs without the standalone workflow's Stock Location validation", async () => {
    const graph = await connected.seed("level-batch-unresolved"), host = await connected.prepare(), location = "level-batch-never-installed-location";
    const output = await Effect.runPromise(host.run(host.newRequestKey(), { create: graph.items.map(inventory_item_id => ({ inventory_item_id, location_id: location, stocked_quantity: -1.125, incoming_quantity: 3.75 })) }));
    expect(output.created).toHaveLength(graph.items.length); expect(output.created.every(row => row.location_id === location && row.stocked_quantity === -1.125)).toBe(true);
    expect(Object.hasOwn(output, "deleted")).toBe(false);
  }, 120_000);

  it("retains Inventory Item FK enforcement and rolls back a valid sibling create when another Item is missing", async () => {
    const graph = await connected.seed("level-batch-missing-item"), host = await connected.prepare();
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { create: [
      { inventory_item_id: graph.items[0]!, location_id: "level-batch-valid-sibling-location", stocked_quantity: 2.5 },
      { inventory_item_id: "level-batch-absent-inventory-item", location_id: "level-batch-missing-item-location", stocked_quantity: 4.5 },
    ] })));
    expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
  }, 120_000);

  it("preserves raw repeated and missing delete IDs while selecting actual Levels and respecting force", async () => {
    const graph = await connected.seed("level-batch-raw", 2), host = await connected.prepare(), ids = [graph.levels[1]!.id, "missing-batch-level", graph.levels[0]!.id, graph.levels[1]!.id];
    await Effect.runPromise(connected.setQuantities(graph.pairs, 0, 5.5));
    const before = await snapshot(), result = await Effect.runPromise(host.run(host.newRequestKey(), { delete: ids }));
    expect(result).toEqual({ created: [], updated: [], deleted: ids });
    expect((await snapshot()).rowChanges.length - before.rowChanges.length).toBe(2);
    const again = await snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { delete: ids }))).toEqual(result);
    const after = await snapshot(); expect(after.rows).toEqual(again.rows); expect(after.events).toEqual(again.events); expect(after.rowChanges).toEqual(again.rowChanges);
  }, 180_000);

  it("retains last keyed update semantics for repeated tuple requests", async () => {
    const graph = await connected.seed("level-batch-repeated"), host = await connected.prepare(), pair = graph.pairs[0]!;
    const output = await Effect.runPromise(host.run(host.newRequestKey(), { update: [{ ...pair, stocked_quantity: 11 }, { ...pair, stocked_quantity: 22.5 }] }));
    expect(output.updated).toHaveLength(1); expect(output.updated[0]).toMatchObject({ ...pair, stocked_quantity: 22.5 });
  }, 120_000);

  it("keeps complete direct create and all retained inverses native, including physical creation rollback", async () => {
    const graph = await connected.seed("level-batch-inverses", 4), probes = await connected.prepareProbes(), beforeLevels = await Effect.runPromise(connected.probe(graph.items));
    const created = await Effect.runPromise(probes.create.run(probes.create.newRequestKey(), Array.from({ length: 8 }, (_, index) => ({ inventory_item_id: graph.items[index % 4]!,
      location_id: "level-batch-inverse-location-" + index, stocked_quantity: index + 0.125 }))));
    expect(created.output).toHaveLength(8); expect(created.compensation).toEqual(created.output.map(row => row.id));
    const beforePhysical = await snapshot(); let inverseCalls = 0;
    expect(await Effect.runPromise(probes.undoCreate.run(probes.undoCreate.newRequestKey(), created.compensation).pipe(Effect.provideService(ExecutionDiagnostics, {
      observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") inverseCalls++; }).pipe(Effect.andThen(work)),
    }), Effect.ensuring(Effect.sync(() => console.info("Native Level creation inverse calls", inverseCalls)))))).toBeNull();
    expect(inverseCalls).toBeGreaterThan(0); expect(inverseCalls).toBeLessThanOrEqual(64);
    const afterPhysical = await snapshot(), removedIds = eventIds(afterPhysical.events.slice(beforePhysical.events.length), "deleted");
    const physicalCommits = afterPhysical.commits.slice(beforePhysical.commits.length); expect(physicalCommits).toHaveLength(1);
    const committed = new Set(physicalCommits.map(commit => commit.commitSeq)), tombstones = afterPhysical.revisions.filter(row => committed.has(row.commitSeq));
    expect(afterPhysical.rowChanges.length - beforePhysical.rowChanges.length).toBe(8); expect(tombstones).toHaveLength(8);
    expect(tombstones.every(row => row.isTombstone && row.valueBytes === null && row.valueSha256 === null)).toBe(true);
    expect(removedIds).toHaveLength(8); expect(new Set(removedIds)).toEqual(new Set(created.compensation));
    expect(await Effect.runPromise(connected.probe(graph.items))).toEqual(beforeLevels);
    const updates = graph.pairs.map(pair => ({ ...pair, stocked_quantity: -2.5, incoming_quantity: 7.25 }));
    const updated = await Effect.runPromise(probes.update.run(probes.update.newRequestKey(), updates));
    expect(updated.compensation.selects).toEqual(["inventory_item_id", "location_id", "stocked_quantity", "incoming_quantity"]);
    expect(updated.compensation.relations).toEqual([]); expect(updated.compensation.dataBeforeUpdate).toHaveLength(4);
    expect(await Effect.runPromise(probes.undoUpdate.run(probes.undoUpdate.newRequestKey(), updated.compensation))).toBeNull();
    const restored = await Effect.runPromise(connected.probe(graph.items));
    for (const row of restored) expect(unchanged(row)).toEqual(unchanged(beforeLevels.find(old => old.id === row.id)!));
    const host = await connected.prepare(), ids = graph.levels.map(row => row.id);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { delete: ids, force: true }))).toMatchObject({ deleted: ids });
    for (const active of [false, true]) {
      const before = await snapshot(); expect(await Effect.runPromise(probes.undoDelete.run(probes.undoDelete.newRequestKey(), ids))).toBeNull();
      const after = await snapshot(); expect(after.rowChanges.length - before.rowChanges.length).toBe(active ? 0 : 4);
      expect(eventIds(after.events.slice(before.events.length), "restored")).toEqual([...ids].sort());
    }
    const beforeEmpty = await snapshot(); expect(await Effect.runPromise(probes.undoCreate.run(probes.undoCreate.newRequestKey(), []))).toBeNull();
    expect(await Effect.runPromise(probes.undoDelete.run(probes.undoDelete.newRequestKey(), []))).toBeNull();
    const afterEmpty = await snapshot(); expect(afterEmpty.rows).toEqual(beforeEmpty.rows); expect(afterEmpty.events).toEqual(beforeEmpty.events);
  }, 240_000);

  it.each(["reserved", "missing-update", "duplicate-create"] as const)("rolls back every sibling on native %s refusal", async mode => {
    const graph = await connected.seed("level-batch-refusal-" + mode, 1, mode === "reserved"), host = await connected.prepare();
    const input: typeof InventoryLevelBatchInput.Type = { create: [{ inventory_item_id: graph.items[0]!, location_id: "level-batch-refusal-new-" + mode }],
      ...(mode === "reserved" ? { delete: graph.levels.map(row => row.id), force: true } : {}),
      ...(mode === "missing-update" ? { update: [{ inventory_item_id: graph.items[0]!, location_id: "missing-native-update-location" }] } : {}) };
    if (mode === "duplicate-create") input.create!.push({ ...input.create![0]! });
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input)));
    expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
  }, 180_000);

  it("characterizes overlapping update/delete through native parallel outcomes without a new disjointness rule", async () => {
    const graph = await connected.seed("level-batch-overlap"), host = await connected.prepare(), id = graph.levels[0]!.id;
    const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
      update: [{ ...graph.pairs[0]!, stocked_quantity: 25 }], delete: [id], force: true })));
    if (Result.isSuccess(result)) {
      expect(result.success.updated).toHaveLength(1); expect(result.success.deleted).toEqual([id]);
      expect((await Effect.runPromise(connected.probe(graph.items))).find(row => row.id === id)?.deleted_at).toBeTypeOf("string");
    } else {
      expect(nativeFailure(result.failure)).toMatchObject({ type: "not_found" }); expect(await snapshot()).toEqual(before);
    }
  }, 180_000);

  it("refuses raw cardinality overflows and malformed inputs before any callback", async () => {
    const host = await connected.prepare(), native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    try {
      const before = await snapshot();
      for (const input of [{ create: Array.from({ length: 9 }, () => ({ inventory_item_id: "item", location_id: "location" })) },
        { update: Array.from({ length: 5 }, () => ({ inventory_item_id: "item", location_id: "location" })) }, { delete: Array.from({ length: 5 }, () => "duplicate") },
        { force: "yes" }, { create: null }, { update: [{ id: "only-id" }] }, { delete: { $in: [] } }, { metadata: {} }]) {
        // @ts-expect-error Deliberately malformed public workflow boundary.
        expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), input))))).toBe(true);
      }
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("rolls back genuine sibling effects after late native update failure and forged ignored deletion maps", async () => {
    const graph = await connected.seed("level-batch-late", 2), host = await connected.prepare();
    for (const mode of ["update-error", "forged-delete-map"] as const) {
      const originalUpdate = InventoryModuleService.prototype.updateInventoryLevels, originalDelete = InventoryModuleService.prototype.softDeleteInventoryLevels;
      let completed = false;
      const update = vi.spyOn(InventoryModuleService.prototype, "updateInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
        const result = await Reflect.apply(originalUpdate, this, args); if (mode === "update-error") { completed = true; throw new Error("Late native batch update failure"); } return result;
      });
      const deletion = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
        const result = await Reflect.apply(originalDelete, this, args); if (mode === "forged-delete-map") { completed = true; return { ...result, inventory_level_id: ["forged-batch-result"] }; } return result;
      });
      try {
        const before = await snapshot(), result = await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), {
          create: [{ inventory_item_id: graph.items[0]!, location_id: "level-batch-late-new" }], update: [{ ...graph.pairs[0]!, stocked_quantity: 17 }],
          delete: [graph.levels[1]!.id], force: true })));
        expect(Result.isFailure(result)).toBe(true); expect(completed).toBe(true); expect(await snapshot()).toEqual(before);
      } finally { update.mockRestore(); deletion.mockRestore(); }
    }
  }, 240_000);

  it("revokes escaped native callbacks and keeps caught forbidden sibling mutations sticky", async () => {
    const graph = await connected.seed("level-batch-poison"), host = await connected.prepare(), original = InventoryModuleService.prototype.createInventoryLevels;
    let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.updateInventoryItems({ id: graph.items[0]!, title: "Unadmitted sibling" }); } catch { caught = true; } return result;
    });
    try {
      const before = await snapshot(); expect(Result.isFailure(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), { create: [{ inventory_item_id: graph.items[0]!, location_id: "level-batch-poison-new" }] }))))).toBe(true);
      expect(caught).toBe(true); expect(await snapshot()).toEqual(before); if (escaped === undefined) throw new Error("Missing escaped native callback");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 180_000);

  it("cancels the whole parallel root after native creation and revokes its delayed continuation", async () => {
    const graph = await connected.seed("level-batch-cancel"), host = await connected.prepare(), reached = Deferred.makeUnsafe<void>(), original = InventoryModuleService.prototype.createInventoryLevels;
    let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    try {
      const before = await snapshot(); await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { create: [{ inventory_item_id: graph.items[0]!, location_id: "level-batch-cancel-new" }],
          update: [{ ...graph.pairs[0]!, stocked_quantity: 19 }] }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await snapshot()).toEqual(before); finish?.(); if (escaped === undefined) throw new Error("Missing revoked native continuation");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 180_000);

  it.skipIf(driver !== "postgres").each(["reservation", "adjustment", "absolute"] as const)("retains all batch dependencies after competing native %s commits", async kind => {
    const graph = await connected.maximum("level-batch-race-" + kind), host = await connected.prepare(), updater = await connected.prepareUpdate(), pair = graph.pairs[4]!;
    const reached = Deferred.makeUnsafe<void>(), original = InventoryModuleService.prototype.softDeleteInventoryLevels; let finish: (() => void) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "softDeleteInventoryLevels").mockImplementation(async function (this: InventoryModuleService, ...args) {
      const result = await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; }); return result;
    });
    const pending = Effect.runPromise(Effect.result(host.run(host.newRequestKey(), graph.input)));
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      if (kind === "reservation") await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 3 }] }).pipe(Effect.timeout(30_000)));
      else if (kind === "adjustment") await Effect.runPromise(connected.adjust.run(connected.adjust.newRequestKey(), [{ ...pair, adjustment: 1 }]).pipe(Effect.timeout(30_000)));
      else await Effect.runPromise(updater.run(updater.newRequestKey(), { updates: [{ ...pair, stocked_quantity: 31 }] }).pipe(Effect.timeout(30_000)));
      const committed = await snapshot(); finish?.(); const result = await pending;
      if (Result.isSuccess(result)) throw new Error("Stale complete Level batch committed after a native competitor");
      expect(reasons(result.failure)).toContain("writeConflict"); expect(await snapshot()).toEqual(committed);
    } finally { finish?.(); await pending; native.mockRestore(); }
  }, 180_000);

  it("isolates actual scopes with identical selectors and request keys", async () => {
    const other = await prepareLogicalInventoryLevelBatch(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "inventory_level_batch_shop_b", projectId: "inventory_level_batch_shop_b", uuidOffset: 470_000 } });
    const leftGraph = await connected.seed("level-batch-scope"), rightGraph = await other.seed("level-batch-scope"), left = await connected.prepare(), right = await other.prepare();
    const key = left.newRequestKey(), input = { delete: leftGraph.levels.map(row => row.id), force: true };
    const rightInput = { delete: rightGraph.levels.map(row => row.id), force: true };
    expect((await Effect.runPromise(left.run(key, input))).deleted).toEqual(input.delete);
    expect((await Effect.runPromise(other.probe(rightGraph.items))).every(row => row.deleted_at === null)).toBe(true);
    expect((await Effect.runPromise(right.run(key, rightInput))).deleted).toEqual(rightInput.delete);
    const before = await snapshot(); await Effect.runPromise(left.run(key, input)); await Effect.runPromise(right.run(key, rightInput)); expect(await snapshot()).toEqual(before);
  }, 240_000);

  it("refuses a different authentic module profile before preparing callbacks", async () => {
    const before = await snapshot();
    const result = await Effect.runPromise(Effect.result(prepareInventoryLevelBatchWorkflow({ ...connected.options,
      // @ts-expect-error Deliberately wrong authentic module contract.
      modules: { inventory: { ...connected.options.modules.inventory, module: connected.deletion.workflow } },
    })));
    expect(Result.isFailure(result)).toBe(true); expect(await snapshot()).toEqual(before);
  });
});
