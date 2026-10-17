import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Cause, Deferred, Effect, Fiber, Result, Schema } from "effect";
import { InventoryLevelService, InventoryModuleService } from "@medusajs/inventory/services";
import { BigNumber } from "@medusajs/utils/totals/big-number";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { CommerceTransactionError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { prepareDeleteReservationsByLineItemsWorkflow } from "../src/workflows/inventory/reservation-line-items";
import { prepareLogicalReservationLineItems } from "./support/logical-reservation-line-item-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalReservationLineItems>>;
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
function eventIds(events: Awaited<ReturnType<typeof snapshot>>["events"], contract: string) {
  return events.filter(event => event.envelope.contract === contract).flatMap(event => {
    const message = event.envelope.message;
    if (!isJsonObject(message) || message.data === undefined || !isJsonObject(message.data)) throw new Error("Missing genuine native Inventory event");
    return decodeIds(Array.isArray(message.data.id) ? message.data.id : [message.data.id]);
  });
}
async function refused(work: Effect.Effect<unknown, CommerceTransactionError>, before: Awaited<ReturnType<typeof snapshot>>, reason?: string) {
  const result = await Effect.runPromise(Effect.result(work));
  if (Result.isSuccess(result)) throw new Error("Expected native Reservation Line Item refusal");
  if (reason !== undefined) expect(reasons(result.failure)).toContain(reason);
  expect(await snapshot()).toEqual(before); return result.failure;
}
async function reserved(items: readonly string[]) {
  const rows = await connected.probeCohort(items);
  return rows.map(row => ({ id: row.id, inventory_item_id: row.inventory_item_id, reserved: row.raw_reserved_quantity }));
}
const deleted = "inventory.reservation-item.deleted", restored = "inventory.reservation-item.restored", updated = "inventory.inventory-level.updated";

describe("native Reservation deletion by Line Item on shared logical storage", { concurrent: false }, () => {
  beforeAll(async () => {
    connected = await prepareLogicalReservationLineItems(driver, close => cleanup.push(close)); sharedCleanupCount = cleanup.length;
  }, 240_000);
  afterEach(async () => { for (const close of cleanup.splice(sharedCleanupCount).reverse()) await close(); }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("calls native Inventory for empty raw selectors, settles once, and skips empty or absent retained inverses", async () => {
    const host = await connected.prepare(), probes = await connected.prepareProbes();
    const remove = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem");
    const restore = vi.spyOn(InventoryModuleService.prototype, "restoreReservationItemsByLineItem");
    try {
      const before = await snapshot(), key = host.newRequestKey(); expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull();
      expect(remove.mock.calls.map(call => call[0])).toEqual([[]]);
      const after = await snapshot(); expect(after.rows).toEqual(before.rows); expect(after.events).toEqual(before.events);
      expect(after.rowChanges).toEqual(before.rowChanges); expect(after.commits.length - before.commits.length).toBe(1);
      expect(await Effect.runPromise(host.run(key, { ids: [] }))).toBeNull(); expect(await snapshot()).toEqual(after); expect(remove).toHaveBeenCalledTimes(1);
      expect(await Effect.runPromise(probes.inverse.run(probes.inverse.newRequestKey(), []))).toBeNull();
      expect(await Effect.runPromise(probes.absent.run(probes.absent.newRequestKey(), null))).toBeNull(); expect(restore).not.toHaveBeenCalled();
      expect(await Effect.runPromise(probes.restore.run(probes.restore.newRequestKey(), []))).toBeNull(); expect(restore.mock.calls.map(call => call[0])).toEqual([[]]);
    } finally { remove.mockRestore(); restore.mockRestore(); }
  }, 120_000);

  it("deletes four complete Reservations across four Levels, retains native order and raw quantities, and replays one publication", async () => {
    await connected.seedProtected("reservation-line-protected");
    const graph = await connected.seed("reservation-line-maximum", Array.from({ length: 4 }, (_, pair) => ({ pair, quantity: pair + 0.25 })));
    const host = await connected.prepare(), otherRevision = await connected.prepare("a".repeat(64));
    const input = { ids: [...graph.lines].reverse() }, inputBefore = structuredClone(input), before = await snapshot(), preserved = await connected.preserved();
    const beforeReservations = await Effect.runPromise(connected.probeReservations(graph.ids));
    const remove = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem"); let calls = 0;
    try {
      const key = host.newRequestKey();
      expect(await Effect.runPromise(host.run(key, input).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("Reservation Line Item deletion maximum calls", calls)))))).toBeNull();
      expect(calls).toBeGreaterThan(0); expect(calls).toBeLessThanOrEqual(64); expect(remove.mock.calls.map(call => call[0])).toEqual([input.ids]);
      expect(input).toEqual(inputBefore); expect(await connected.preserved()).toEqual(preserved);
      const rows = await Effect.runPromise(connected.probeReservations(graph.ids)); expect(rows).toHaveLength(4);
      for (const row of rows) {
        const prior = beforeReservations.find(value => value.id === row.id); if (prior === undefined) throw new Error("Missing selected genuine preimage");
        expect(row).toMatchObject({ ...prior, updated_at: expect.any(String), deleted_at: expect.any(String) });
        expect(row.raw_quantity).toEqual(prior.raw_quantity); expect(row.quantity).toEqual(prior.quantity);
      }
      for (const row of await reserved(graph.items)) expect(row.reserved).toEqual(new BigNumber(0).raw);
      const after = await snapshot(), emitted = after.events.slice(before.events.length);
      expect(after.commits.length - before.commits.length).toBe(1); expect(after.outcomes.length - before.outcomes.length).toBe(1);
      expect(after.rowChanges.length - before.rowChanges.length).toBe(8); expect(emitted.every(event => event.envelope.internal)).toBe(true);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(eventIds(emitted, deleted)).toEqual([...graph.ids].sort());
      expect(eventIds(emitted, updated)).toEqual([...graph.levels].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0).map(row => row.id));
      expect(emitted.findIndex(event => event.envelope.contract === updated)).toBeGreaterThan(emitted.map(event => event.envelope.contract).lastIndexOf(deleted));
      expect(await Effect.runPromise(host.run(key, input))).toBeNull(); expect(remove).toHaveBeenCalledTimes(1); expect(await snapshot()).toEqual(after);
      await refused(host.run(key, { ids: [] }), after, "requestConflict");
      await refused(otherRevision.run(key, input), after, "requestConflict");
      const probes = await connected.prepareProbes(); let inverseCalls = 0;
      expect(await Effect.runPromise(probes.inverse.run(probes.inverse.newRequestKey(), input.ids).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") inverseCalls++; }).pipe(Effect.andThen(work)),
      }), Effect.ensuring(Effect.sync(() => console.info("Reservation Line Item restore maximum calls", inverseCalls)))))).toBeNull();
      expect(inverseCalls).toBeGreaterThan(0); expect(inverseCalls).toBeLessThanOrEqual(64);
      const restoredRows = await Effect.runPromise(connected.probeReservations(graph.ids)); expect(restoredRows.every(row => row.deleted_at === null)).toBe(true);
      const restoredLevels = await reserved(graph.items);
      for (const [index, item] of graph.items.entries()) expect(restoredLevels.find(row => row.inventory_item_id === item)?.reserved).toEqual(new BigNumber(index + 0.25).raw);
    } finally { remove.mockRestore(); }
  }, 240_000);

  it("refuses five matching history rows, including five tombstones, before any stock or lifecycle publication", async () => {
    for (const allDeleted of [false, true]) {
      const line = "reservation-line-overflow-" + allDeleted, graph = await connected.seed(line,
        Array.from({ length: 5 }, () => ({ line, quantity: 1, deleted: allDeleted })));
      const host = await connected.prepare(), before = await snapshot();
      await refused(host.run(host.newRequestKey(), { ids: [line] }), before, "unsupportedProfile");
      const probes = await connected.prepareProbes();
      await refused(probes.inverse.run(probes.inverse.newRequestKey(), [line]), before, "unsupportedProfile");
      expect(await Effect.runPromise(connected.probeReservations(graph.ids))).toHaveLength(5);
    }
  }, 240_000);

  it("preserves duplicate, ordered and missing raw IDs while excluding nullable Line Item selectors", async () => {
    const line = "reservation-line-raw", graph = await connected.seed(line, [{ line, quantity: 2 }, { line: null, quantity: 1 }]);
    const probes = await connected.prepareProbes(), ids = ["missing-line", line, line, "second-missing-line"];
    const remove = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem");
    try {
      expect(await Effect.runPromise(probes.forward.run(probes.forward.newRequestKey(), ids))).toEqual({ output: null, compensation: ids });
      expect(remove.mock.calls.map(call => call[0])).toEqual([ids]);
      const rows = await Effect.runPromise(connected.probeReservations(graph.ids));
      expect(rows.find(row => row.line_item_id === line)?.deleted_at).toEqual(expect.any(String));
      expect(rows.find(row => row.line_item_id === null)?.deleted_at).toBeNull();
      expect((await reserved(graph.items))[0]?.reserved).toEqual(new BigNumber(1).raw);
    } finally { remove.mockRestore(); }
  }, 120_000);

  it("preserves the upstream deletion quantity assertion from six reserved units to two", async () => {
    const line = "reservation-line-upstream-six-to-two", graph = await connected.seed(line,
      [{ line, quantity: 2 }, { line, quantity: 2 }, { line: line + "-unselected", quantity: 2 }]);
    const host = await connected.prepare(); expect((await reserved(graph.items))[0]?.reserved).toEqual(new BigNumber(6).raw);
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [line] }))).toBeNull();
    expect((await reserved(graph.items))[0]?.reserved).toEqual(new BigNumber(2).raw);
    const stored = await Effect.runPromise(connected.probeReservations(graph.ids));
    expect(stored.filter(row => row.deleted_at !== null)).toHaveLength(2);
    const beforeNoop = await snapshot(); expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [line, "missing-line"] }))).toBeNull();
    const afterNoop = await snapshot(); expect(afterNoop.rows).toEqual(beforeNoop.rows); expect(afterNoop.events).toEqual(beforeNoop.events);
    expect(afterNoop.rowChanges).toEqual(beforeNoop.rowChanges); expect(afterNoop.commits.length - beforeNoop.commits.length).toBe(1);
  }, 120_000);

  it.each([{ kind: "deleted-only", rows: [{ quantity: 3, deleted: true }], expected: 3 },
    { kind: "mixed", rows: [{ quantity: 2 }, { quantity: 3, deleted: true }], expected: 5 },
    { kind: "active-only", rows: [{ quantity: 2 }], expected: 2 }])("restores $kind demand exactly once using the approved native correction", async ({ kind, rows, expected }) => {
    const line = "reservation-line-correction-" + kind, graph = await connected.seed(line, rows.map(row => ({ ...row, line })));
    const probes = await connected.prepareProbes(), restore = vi.spyOn(InventoryModuleService.prototype, "restoreReservationItemsByLineItem");
    try {
      for (const repeated of [false, true]) {
        const before = await snapshot(); expect(await Effect.runPromise(probes.inverse.run(probes.inverse.newRequestKey(), [line]))).toBeNull();
        expect(restore.mock.calls.at(-1)?.[0]).toEqual([line]);
        const selected = await Effect.runPromise(connected.probeReservations(graph.ids)); expect(selected.every(row => row.deleted_at === null)).toBe(true);
        expect((await reserved(graph.items))[0]?.reserved).toEqual(new BigNumber(expected).raw);
        const after = await snapshot(); expect(eventIds(after.events.slice(before.events.length), restored)).toEqual([...graph.ids].sort());
        if (repeated || kind === "active-only") expect(after.rowChanges).toEqual(before.rowChanges);
      }
    } finally { restore.mockRestore(); }
  }, 180_000);

  it("groups multiple Reservations per Line Item across Levels and preserves exact zero and fractional quantities", async () => {
    const line = "reservation-line-grouped", graph = await connected.seed(line,
      [{ line, quantity: 0 }, { line, quantity: 0.125 }, { line, quantity: 1.25 }, { line, pair: 1, quantity: 2.5 }]);
    const host = await connected.prepare(), probes = await connected.prepareProbes();
    expect(await Effect.runPromise(host.run(host.newRequestKey(), { ids: [line] }))).toBeNull();
    expect((await reserved(graph.items)).map(row => row.reserved)).toEqual([new BigNumber(0).raw, new BigNumber(0).raw]);
    expect(await Effect.runPromise(probes.inverse.run(probes.inverse.newRequestKey(), [line]))).toBeNull();
    const levels = await reserved(graph.items);
    expect(levels.find(row => row.inventory_item_id === graph.items[0])?.reserved).toEqual(new BigNumber(1.375).raw);
    expect(levels.find(row => row.inventory_item_id === graph.items[1])?.reserved).toEqual(new BigNumber(2.5).raw);
    for (const row of await Effect.runPromise(connected.probeReservations(graph.ids))) expect(row.deleted_at).toBeNull();
  }, 180_000);

  it("retains older-tombstone inverse behavior and rolls the complete native round trip back on outer failure", async () => {
    const line = "reservation-line-older-history", graph = await connected.seed(line, [{ line, quantity: 2 }, { line, quantity: 3, deleted: true }]);
    const probes = await connected.prepareProbes(), before = await snapshot();
    const remove = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem"), restore = vi.spyOn(InventoryModuleService.prototype, "restoreReservationItemsByLineItem");
    try {
      const failure = await refused(probes.roundtrip.run(probes.roundtrip.newRequestKey(), [line]), before, "adapterFailure");
      expect(nativeFailure(failure)).toMatchObject({ message: "Roll back native Line Item round trip" });
      expect(remove).toHaveBeenCalledTimes(1); expect(restore).toHaveBeenCalledTimes(1);
      const original = await Effect.runPromise(connected.probeReservations(graph.ids));
      expect(original.filter(row => row.deleted_at !== null)).toHaveLength(1); expect((await reserved(graph.items))[0]?.reserved).toEqual(new BigNumber(2).raw);
      // Native raw-Line-Item compensation includes older tombstones. This is
      // intentionally observed separately from the failed-root rollback proof.
      expect(await Effect.runPromise(probes.forward.run(probes.forward.newRequestKey(), [line]))).toEqual({ output: null, compensation: [line] });
      expect(await Effect.runPromise(probes.inverse.run(probes.inverse.newRequestKey(), [line]))).toBeNull();
      expect((await Effect.runPromise(connected.probeReservations(graph.ids))).every(row => row.deleted_at === null)).toBe(true);
      expect((await reserved(graph.items))[0]?.reserved).toEqual(new BigNumber(5).raw);
    } finally { remove.mockRestore(); restore.mockRestore(); }
  }, 180_000);

  it.each([false, true])("retains native missing-Level rejection after %s physical removal and rolls restoration back", async physical => {
    const line = "reservation-line-level-missing-" + physical, graph = await connected.seed(line, [{ line, quantity: 3, deleted: true }]);
    const removal = await connected.prepareLevelRemoval(physical), probes = await connected.prepareProbes();
    expect(await Effect.runPromise(removal.run(removal.newRequestKey(), graph.levels.map(row => row.id)))).toBeNull();
    const before = await snapshot(); const failure = await refused(probes.inverse.run(probes.inverse.newRequestKey(), [line]), before);
    expect(nativeFailure(failure)).toMatchObject({ type: "not_found" });
    expect((await Effect.runPromise(connected.probeReservations(graph.ids)))[0]?.deleted_at).toEqual(expect.any(String));
  }, 180_000);

  it("rejects malformed selectors, fifth raw IDs and a wrong module profile before native callbacks", async () => {
    const host = await connected.prepare(), native = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem");
    try {
      const before = await snapshot();
      for (const input of [{ ids: Array.from({ length: 5 }, () => "duplicate") }, { ids: [""] }, { ids: null }, { ids: "line" }, { ids: [], extra: true }]) {
        // @ts-expect-error Deliberately malformed public workflow input.
        await refused(host.run(host.newRequestKey(), input), before);
      }
      const wrong = { ...connected.options, inventory: { ...connected.options.inventory, module: connected.members.inventory.runtime.workflow } };
      // @ts-expect-error Deliberately wrong named module profile.
      expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareDeleteReservationsByLineItemsWorkflow(wrong))))).toBe(true);
      expect(native).not.toHaveBeenCalled(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  });

  it("rejects forged, absent and getter-backed Inventory tokens before inspecting methods or preparing execution", async () => {
    const getter = vi.fn(() => connected.lineItems.workflow.methods), prepare = vi.fn(() => Effect.die("Unexpected host preparation"));
    const forged = Object.defineProperty({ ...connected.lineItems.workflow }, "methods", { get: getter, enumerable: true });
    for (const token of [forged, undefined, null]) {
      const inventory = { ...connected.options.inventory }; Reflect.set(inventory, "module", token);
      await expect(Effect.runPromise(prepareDeleteReservationsByLineItemsWorkflow({ ...connected.options, inventory,
        execution: { identityAndAccessPolicy: {}, prepare } }))).rejects.toMatchObject({ reason: "invalidAuthority" });
    }
    expect(getter).not.toHaveBeenCalled(); expect(prepare).not.toHaveBeenCalled();
  });

  it("authenticates selected scope exclusion before native work when a host drops the profile", async () => {
    const host = await Effect.runPromise(prepareDeleteReservationsByLineItemsWorkflow({ ...connected.options, execution: {
      identityAndAccessPolicy: connected.fixture.hostInput.identityAndAccessPolicy,
      prepare: composition => { const { executionIsolation: _selected, ...ordinary } = composition;
        return makeAtomicCommerceHost({ ...connected.fixture.hostInput, ...ordinary }); },
    } }));
    const native = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem");
    try {
      const before = await snapshot(); await refused(host.run(host.newRequestKey(), { ids: [] }), before, "unsupportedProfile");
      expect(native).not.toHaveBeenCalled();
    } finally { native.mockRestore(); await Effect.runPromise(host.close); }
  });

  it("rolls back late native failure, nonvoid results, and forged lifecycle events", async () => {
    const graph = await connected.seed("reservation-line-forgery"), host = await connected.prepare();
    for (const mode of ["throw", "result", "event", "malformed-event"] as const) {
      const original = InventoryModuleService.prototype.deleteReservationItemsByLineItem; let completed = false;
      // @ts-expect-error Deliberately violate the genuine native void ABI in one branch.
      const native = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem").mockImplementation(async function (this: InventoryModuleService, ...args) {
        await Reflect.apply(original, this, args); completed = true;
        if (mode === "throw") throw new Error("Late native Line Item deletion failure");
        if (mode === "result") {
          return { id: "forged-nonvoid-native-result" };
        }
        const bus: unknown = Reflect.get(this, "eventBusModuleService_");
        if (typeof bus !== "object" || bus === null) throw new Error("Missing genuine native event bus");
        const emit: unknown = Reflect.get(bus, "emit"); if (typeof emit !== "function") throw new Error("Missing native emitter");
        await Reflect.apply(emit, bus, [[{ name: deleted, data: { id: mode === "malformed-event" ? 42 : "forged-reservation-event" },
          metadata: { source: "inventory", object: "reservation_item", action: "deleted" } }], { internal: true }]);
      });
      try {
        const before = await snapshot(); await refused(host.run(host.newRequestKey(), { ids: graph.lines }), before,
          mode === "throw" ? "adapterFailure" : mode === "result" ? "storedCorruption" : mode === "malformed-event" ? "unadmittedEvent" : "receiptMismatch");
        expect(completed).toBe(true);
      } finally { native.mockRestore(); }
    }
  }, 180_000);

  it("rejects forged native stock arithmetic after the real Reservation lifecycle has run", async () => {
    const graph = await connected.seed("reservation-line-forged-quantity"), host = await connected.prepare();
    const original = InventoryLevelService.prototype.update;
    const native = vi.spyOn(InventoryLevelService.prototype, "update").mockImplementation(async function (this: InventoryLevelService, input, context) {
      const selected = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String, reserved_quantity: Schema.Unknown })))(input);
      const altered = selected.map(row => ({ ...row, reserved_quantity: new BigNumber(77) }));
      return Reflect.apply(original, this, [altered, context]);
    });
    try { const before = await snapshot(); await refused(host.run(host.newRequestKey(), { ids: graph.lines }), before, "receiptMismatch"); }
    finally { native.mockRestore(); }
  }, 120_000);

  it("keeps caught sibling denial sticky and revokes escaped native callbacks", async () => {
    const graph = await connected.seed("reservation-line-poison"), host = await connected.prepare();
    const original = InventoryModuleService.prototype.deleteReservationItemsByLineItem; let caught = false, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem").mockImplementation(async function (this: InventoryModuleService, ...args) {
      await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      try { await this.updateInventoryItems({ id: graph.items[0]!, title: "Forbidden sibling mutation" }); } catch { caught = true; }
    });
    try {
      const before = await snapshot(); await refused(host.run(host.newRequestKey(), { ids: graph.lines }), before);
      expect(caught).toBe(true); if (escaped === undefined) throw new Error("Missing escaped genuine callback");
      await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { native.mockRestore(); }
  }, 120_000);

  it("rolls back cancellation after native writes, drains the pending callback and rejects its revoked continuation", async () => {
    const graph = await connected.seed("reservation-line-cancel"), host = await connected.prepare(), reached = Deferred.makeUnsafe<void>();
    const original = InventoryModuleService.prototype.deleteReservationItemsByLineItem; let finish: (() => void) | undefined, escaped: (() => Promise<unknown>) | undefined;
    const native = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem").mockImplementation(async function (this: InventoryModuleService, ...args) {
      await Reflect.apply(original, this, args); escaped = () => Reflect.apply(original, this, args);
      await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; });
    });
    try {
      const before = await snapshot();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), { ids: graph.lines }));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000)); yield* Fiber.interrupt(fiber);
      }));
      expect(await snapshot()).toEqual(before); finish?.();
      if (escaped === undefined) throw new Error("Missing revoked native callback"); await expect(escaped()).rejects.toBeDefined(); expect(await snapshot()).toEqual(before);
    } finally { finish?.(); native.mockRestore(); }
  }, 120_000);

  it.skipIf(driver !== "postgres").each(["create", "update", "release", "adjust"] as const)("excludes a competing individual %s root before its native callback", async kind => {
    const line = "reservation-line-race-" + kind, graph = await connected.seed(line, [{ line, quantity: 2 }, { line: line + "-other", quantity: 1 }]);
    const host = await connected.prepare(), reached = Deferred.makeUnsafe<void>();
    const original = InventoryModuleService.prototype.deleteReservationItemsByLineItem; let finish: (() => void) | undefined;
    const remove = vi.spyOn(InventoryModuleService.prototype, "deleteReservationItemsByLineItem").mockImplementation(async function (this: InventoryModuleService, ...args) {
      await Reflect.apply(original, this, args); await Effect.runPromise(Deferred.succeed(reached, undefined)); await new Promise<void>(resolve => { finish = resolve; });
    });
    const createSpy = vi.spyOn(InventoryModuleService.prototype, "createReservationItems"), updateSpy = vi.spyOn(InventoryModuleService.prototype, "updateReservationItems"),
      releaseSpy = vi.spyOn(InventoryModuleService.prototype, "softDeleteReservationItems"), adjustSpy = vi.spyOn(InventoryModuleService.prototype, "adjustInventory");
    const first = Effect.runPromise(host.run(host.newRequestKey(), { ids: [line] })); let second: Promise<unknown> | undefined;
    try {
      await Effect.runPromise(Deferred.await(reached).pipe(Effect.timeout(30_000)));
      const pair = graph.pairs[0], other = graph.reservations[1];
      if (pair === undefined || other === undefined) throw new Error("Missing native Reservation competitor endpoints");
      const otherId = other.id;
      second = kind === "create" ? Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), { reservations: [{ ...pair, quantity: 3 }] }))
        : kind === "update" ? Effect.runPromise(connected.updateReservation.run(connected.updateReservation.newRequestKey(), { updates: [{ id: otherId, quantity: 3 }] }))
        : kind === "release" ? Effect.runPromise(connected.release.run(connected.release.newRequestKey(), { ids: [otherId] }))
        : Effect.runPromise(connected.adjust.run(connected.adjust.newRequestKey(), [{ ...pair, adjustment: 1 }]));
      if (connected.fixture.resource.kind !== "postgres") throw new Error("Missing ordinary-role PostgreSQL resource");
      const persistence = connected.fixture.resource.target;
      await expect.poll(async () => {
        const result = await persistence.query<{ waiting: boolean }>(`select exists (
          select 1 from pg_stat_activity activity where activity.datname=current_database() and activity.usename=current_user
            and activity.wait_event_type='Lock' and cardinality(pg_blocking_pids(activity.pid))>0
            and position('fx_system_scope_clock' in activity.query)>0
        ) as waiting`);
        return result.rows[0]?.waiting ?? false;
      }, { timeout: 10_000, interval: 25 }).toBe(true);
      expect(createSpy).not.toHaveBeenCalled(); expect(updateSpy).not.toHaveBeenCalled(); expect(releaseSpy).not.toHaveBeenCalled(); expect(adjustSpy).not.toHaveBeenCalled();
      finish?.(); expect(await first).toBeNull(); await second;
      expect((await reserved(graph.items))[0]?.reserved).toEqual(new BigNumber(kind === "create" ? 4 : kind === "update" ? 3 : kind === "release" ? 0 : 1).raw);
      const stored = await connected.probeCohort(graph.items); expect(stored[0]?.raw_stocked_quantity).toEqual(new BigNumber(kind === "adjust" ? 11 : 10).raw);
    } finally {
      finish?.(); await Promise.allSettled(second === undefined ? [first] : [first, second]);
      remove.mockRestore(); createSpy.mockRestore(); updateSpy.mockRestore(); releaseSpy.mockRestore(); adjustSpy.mockRestore();
    }
  }, 180_000);

  it("confines complete history and identical Line Item selectors to their actual shop scopes", async () => {
    const other = await prepareLogicalReservationLineItems(driver, close => cleanup.push(close), { resource: connected.fixture.resource,
      fixtureIdentity: { deploymentId: "reservation_line_item_shop_b", projectId: "reservation_line_item_shop_b", uuidOffset: 610_000 } });
    const line = "reservation-line-identical", left = await connected.seed("reservation-line-scope", [{ line, quantity: 2 }, { line, quantity: 3, deleted: true }]),
      right = await other.seed("reservation-line-scope", [{ line, quantity: 1 }, { line, quantity: 4, deleted: true }]);
    const leftHost = await connected.prepare(), rightHost = await other.prepare(), key = leftHost.newRequestKey();
    const beforeRight = await Effect.runPromise(other.probeReservations(right.ids));
    expect(await Effect.runPromise(leftHost.run(key, { ids: [line] }))).toBeNull();
    expect(await Effect.runPromise(other.probeReservations(right.ids))).toEqual(beforeRight);
    expect(await Effect.runPromise(rightHost.run(key, { ids: [line] }))).toBeNull();
    const leftProbes = await connected.prepareProbes(), rightProbes = await other.prepareProbes();
    expect(await Effect.runPromise(leftProbes.inverse.run(leftProbes.inverse.newRequestKey(), [line]))).toBeNull();
    expect((await Effect.runPromise(other.probeReservations(right.ids))).every(row => row.deleted_at !== null)).toBe(true);
    expect(await Effect.runPromise(rightProbes.inverse.run(rightProbes.inverse.newRequestKey(), [line]))).toBeNull();
    const leftLevel = (await connected.probeCohort(left.items))[0], rightLevel = (await other.probeCohort(right.items))[0];
    expect(leftLevel?.raw_reserved_quantity).toEqual(new BigNumber(5).raw); expect(rightLevel?.raw_reserved_quantity).toEqual(new BigNumber(5).raw);
    const beforeReplay = await snapshot(); expect(await Effect.runPromise(leftHost.run(key, { ids: [line] }))).toBeNull();
    expect(await Effect.runPromise(rightHost.run(key, { ids: [line] }))).toBeNull(); expect(await snapshot()).toEqual(beforeReplay);
  }, 240_000);
});
