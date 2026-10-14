import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { Cause, Deferred, Effect, Fiber } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { StockLocationModuleService } from "@medusajs/stock-location/services";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ExecutionDiagnostics } from "@flarex/persistence-postgres/internal/execution-diagnostics";
import { fxAppRowCurrent, fxSystemCommitAppRowChanges } from "../../persistence-postgres/src/database/schema";
import { fxSystemCommitEvents } from "../../persistence-postgres/src/commit/events/schema";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { issueRelationalSession, runRelationalSession } from "../../persistence-postgres/src/database/relationalTransaction/session";
import { RelationalSessionError } from "../../persistence-postgres/src/database/relationalTransaction/model";
import { prepareInventoryStockingWorkflow, type InventoryStockingHooks, type InventoryStockingInput } from "../src/workflows/inventory/stock";
import { inventoryStockingResources } from "../src/workflow/policy";
import { logicalCurrencyFixture, type LogicalCurrencyFixture } from "./support/logical-currency-fixture";
import { prepareLogicalInventoryHosts, prepareInventoryCreateHost, type LogicalInventoryHosts } from "./support/logical-inventory-fixture";
import type { AtomicWorkflowExecution } from "../src/workflow/host";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid stocking driver");
const cleanup: Array<() => Promise<void>> = [];
type Connected = { fixture: LogicalCurrencyFixture; members: LogicalInventoryHosts };
let selected: Connected;
const revision = createHash("sha256").update("native-inventory-stocking").digest("hex");
const execution = (value: Connected, session = value.fixture.session): AtomicWorkflowExecution => ({
  identityAndAccessPolicy: value.fixture.hostInput.identityAndAccessPolicy,
  prepare: composition => makeAtomicCommerceHost({ ...value.fixture.hostInput, session, ...composition }),
});
const prepare = (value = selected, hooks: InventoryStockingHooks = {}, execute = execution(value)) => Effect.runPromise(
  prepareInventoryStockingWorkflow({ execution: execute, modules: {
    inventory: { module: value.members.inventory.runtime.workflow, logicalStorage: value.members.inventory.hostInput.logicalStorage },
    stock_location: { module: value.members.stockLocation.runtime.workflow, logicalStorage: value.members.stockLocation.hostInput.logicalStorage },
  }, revision, subscribers: [{ id: "inventory-stocking", revision }], hooks }),
);
const rows = (value = selected) => value.fixture.persistence.drizzle.select().from(fxAppRowCurrent);
const events = (value = selected) => value.fixture.persistence.drizzle.select().from(fxSystemCommitEvents)
  .orderBy(fxSystemCommitEvents.commitSeq, fxSystemCommitEvents.eventOrdinal);
function nativeFailure(error: unknown): unknown {
  if (error instanceof CommerceTransactionError && error.cause !== undefined) return nativeFailure(error.cause);
  if (Cause.isCause(error)) return nativeFailure(Cause.squash(error));
  if (error instanceof Error && error.cause !== undefined) return nativeFailure(error.cause);
  return error;
}
function failureReasons(error: unknown): string[] {
  if (Cause.isCause(error)) return error.reasons.flatMap(reason => reason._tag === "Fail" ? failureReasons(reason.error) : []);
  if (!(error instanceof Error)) return [];
  const reason = "reason" in error && typeof error.reason === "string" ? [error.reason] : [];
  return [...reason, ...failureReasons(error.cause)];
}
async function expectRefusal(work: Promise<unknown>, reason: string) {
  await expect(work.then(() => { throw new Error("Expected stocking refusal"); }, error => failureReasons(error)))
    .resolves.toContain(reason);
}
const input = (prefix: string, maximum = false): typeof InventoryStockingInput.Type => ({
  locations: Array.from({ length: maximum ? 4 : 1 }, (_, index) => ({ id: prefix + "-location-" + index,
    name: prefix + " Warehouse " + index, address: { id: prefix + "-address-" + index,
      address_1: "Line " + index, country_code: "MM", city: "Yangon", metadata: { index } },
    metadata: { external: prefix, index },
  })),
  inventory_levels: Array.from({ length: maximum ? 8 : 1 }, (_, index) => ({ inventory_item_id: "stock-item-" + Math.floor(index / 2),
    location_index: maximum ? index % 4 : 0, stocked_quantity: index + 0.25, incoming_quantity: index + 0.5,
  })),
});
async function connect(fixture: LogicalCurrencyFixture): Promise<Connected> {
  return { fixture, members: await prepareLogicalInventoryHosts(fixture, { levels: true, stockLocations: true }) };
}
async function seedItems(value: Connected) {
  const { host, create } = await prepareInventoryCreateHost(value.fixture, value.members.inventory);
  try { await Effect.runPromise(host.run(host.newRequestKey(), create,
    Array.from({ length: 4 }, (_, index) => ({ id: "stock-item-" + index, sku: "stock-sku-" + index })))); }
  finally { await Effect.runPromise(host.close); }
}

describe("native Stock Location and Inventory-level stocking", () => {
  beforeAll(async () => {
    selected = await connect(await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantInventory: true,
    }));
    await seedItems(selected);
  }, 180_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); });

  it("stocks the maximum graph with native hooks, exact quantities, one publication and replay", async () => {
    const locationHook = vi.fn<NonNullable<InventoryStockingHooks["stockLocationsCreated"]>>(async ({ stockLocations }, { resources }) => {
      const pending = await resources.query.graph({ entity: "stock_location", fields: ["id", "name"],
        filters: { id: stockLocations.map(location => location.id) }, pagination: { take: 4 } });
      expect(pending.data.map(row => row.id).sort()).toEqual(stockLocations.map(row => row.id).sort());
    });
    const stockHook = vi.fn<NonNullable<InventoryStockingHooks["inventoryStocked"]>>(({ inventory_levels }) => {
      expect(inventory_levels).toHaveLength(8);
    });
    const host = await prepare(selected, { stockLocationsCreated: locationHook, inventoryStocked: stockHook });
    try {
      const beforeRows = await rows(), beforeEvents = await events(), key = host.newRequestKey(), value = input("maximum-stock", true);
      let calls = 1;
      const result = await Effect.runPromise(host.run(key, value).pipe(Effect.provideService(ExecutionDiagnostics, {
        observe: (name, work) => Effect.sync(() => { if (name === "BoundedRequest.enter") calls++; }).pipe(Effect.andThen(work)),
      })));
      console.info("Native stocking bounded calls:", calls);
      expect(calls).toBeLessThanOrEqual(inventoryStockingResources.calls);
      expect(result.locations.map(location => location.id)).toEqual(value.locations.map(location => location.id));
      expect(result.locations.every(location => typeof location.address_id === "string" && location.address !== undefined)).toBe(true);
      for (const [index, level] of result.inventory_levels.entries()) {
        expect(level).toMatchObject({ inventory_item_id: "stock-item-" + Math.floor(index / 2),
          location_id: "maximum-stock-location-" + index % 4, stocked_quantity: index + 0.25,
          incoming_quantity: index + 0.5, reserved_quantity: 0, available_quantity: index + 0.25,
          raw_stocked_quantity: { value: (index + 0.25).toPrecision(20), precision: 20 },
          raw_reserved_quantity: { value: (0).toPrecision(20), precision: 20 },
          raw_incoming_quantity: { value: (index + 0.5).toPrecision(20), precision: 20 },
        });
      }
      expect((await rows()).length - beforeRows.length).toBe(16);
      const emitted = (await events()).slice(beforeEvents.length);
      expect(emitted).toHaveLength(16);
      expect(new Set(emitted.map(event => event.commitSeq)).size).toBe(1);
      expect(new Set(emitted.map(event => event.envelope.contract))).toEqual(new Set([
        "stock_location.stock-location-address.created", "stock_location.stock-location.created", "inventory.inventory-level.created",
      ]));
      const last = emitted.at(-1); if (!last) throw new Error("Missing stocking publication");
      expect((await selected.fixture.persistence.drizzle.select().from(fxSystemCommitAppRowChanges))
        .filter(fact => fact.commitSeq === last.commitSeq)).toHaveLength(16);
      const committedRows = await rows(), committedEvents = await events();
      expect(await Effect.runPromise(host.run(key, value))).toEqual(result);
      expect(locationHook).toHaveBeenCalledTimes(1); expect(stockHook).toHaveBeenCalledTimes(1);
      expect(await rows()).toEqual(committedRows); expect(await events()).toEqual(committedEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("uses existing locations and native defaults while preserving authentic empty child calls", async () => {
    const nativeLocations = vi.spyOn(StockLocationModuleService.prototype, "createStockLocations");
    const nativeLevels = vi.spyOn(InventoryModuleService.prototype, "createInventoryLevels");
    const host = await prepare();
    try {
      const created = await Effect.runPromise(host.run(host.newRequestKey(), { locations: [{ id: "default-location", name: "Default" }], inventory_levels: [] }));
      expect(created.inventory_levels).toEqual([]);
      expect(nativeLevels.mock.calls.some(([input]) => Array.isArray(input) && input.length === 0)).toBe(true);
      const stocked = await Effect.runPromise(host.run(host.newRequestKey(), { locations: [], inventory_levels: [
        { inventory_item_id: "stock-item-0", location_id: "default-location" },
      ] }));
      expect(stocked.inventory_levels[0]).toMatchObject({ stocked_quantity: 0, incoming_quantity: 0, reserved_quantity: 0, available_quantity: 0 });
      expect(nativeLocations.mock.calls.some(([input]) => Array.isArray(input) && input.length === 0)).toBe(true);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), { locations: [], inventory_levels: [] }))).toEqual({ locations: [], inventory_levels: [] });
    } finally { nativeLocations.mockRestore(); nativeLevels.mockRestore(); await Effect.runPromise(host.close); }
  });

  it("preserves native missing-location validation before missing-item integrity and rolls back earlier locations", async () => {
    const host = await prepare();
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      const value = { locations: [{ id: "refused-location", name: "Refused" }], inventory_levels: [
        { inventory_item_id: "missing-item", location_id: "missing-location" },
      ] };
      await expect(Effect.runPromise(host.run(host.newRequestKey(), value)).catch(error => { throw nativeFailure(error); }))
        .rejects.toMatchObject({ type: "not_found", message: "Stock locations with ids: missing-location was not found" });
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      await expectRefusal(Effect.runPromise(host.run(host.newRequestKey(), {
        ...value, inventory_levels: [{ inventory_item_id: "missing-item", location_index: 0 }],
      })), "invalidInput");
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("refuses duplicate levels atomically after address/location creation", async () => {
    const host = await prepare();
    try {
      const beforeRows = await rows(), beforeEvents = await events(), value = input("duplicate-stock");
      await expectRefusal(Effect.runPromise(host.run(host.newRequestKey(), { ...value,
        inventory_levels: [...value.inventory_levels, ...value.inventory_levels],
      })), "invalidInput");
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("refuses managed quantities, invalid ordinals and bounds before hooks", async () => {
    const hook = vi.fn<NonNullable<InventoryStockingHooks["stockLocationsCreated"]>>(() => undefined);
    const host = await prepare(selected, { stockLocationsCreated: hook });
    try {
      const value = input("invalid-stock"), beforeRows = await rows();
      const firstLevel = value.inventory_levels[0], firstLocation = value.locations[0];
      if (!firstLevel || !firstLocation) throw new Error("Missing bounded input fixture");
      const invalid = [
        { ...value, inventory_levels: [{ inventory_item_id: "stock-item-0", location_index: 0, reserved_quantity: 10 }] },
        { ...value, inventory_levels: [{ inventory_item_id: "stock-item-0", location_index: 0, raw_stocked_quantity: { value: "10", precision: 20 } }] },
        { ...value, inventory_levels: [{ inventory_item_id: "stock-item-0", location_index: 1 }] },
        { ...value, inventory_levels: Array.from({ length: 9 }, () => firstLevel) },
        { ...value, locations: Array.from({ length: 5 }, () => firstLocation) },
      ];
      for (const input of invalid) await expectRefusal(Effect.runPromise(host.run(host.newRequestKey(), input)), "invalidInput");
      expect(hook).not.toHaveBeenCalled(); expect(await rows()).toEqual(beforeRows);
    } finally { await Effect.runPromise(host.close); }
  });

  it("rolls back late hooks and caught unsupported writes, then revokes escaped level methods", async () => {
    type Resources = Parameters<NonNullable<InventoryStockingHooks["inventoryStocked"]>>[1]["resources"];
    let escaped: Resources["inventory"]["createInventoryLevels"] | undefined;
    const hooks: NonNullable<InventoryStockingHooks["inventoryStocked"]>[] = [
      () => { throw new Error("late stocking failure"); },
      async (_value, { resources }) => { escaped = resources.inventory.createInventoryLevels;
        const unsupported = [{ inventory_item_id: "stock-item-0", location_id: "default-location", reserved_quantity: 1 }];
        try { await resources.inventory.createInventoryLevels(unsupported); } catch {} },
      async (_value, { container }) => {
        const inventory = container.resolve<{ createReservationItems: (input: unknown) => Promise<unknown> }>("inventory");
        try { await inventory.createReservationItems([]); } catch {} },
      async (_value, { resources, eventGroupId }) => {
        try { await resources.event_bus.emit([{ name: "inventory.inventory-level.created", data: { id: "forged-level" },
          metadata: { eventGroupId } }]); } catch {} },
    ];
    for (const [index, hook] of hooks.entries()) {
      const host = await prepare(selected, { inventoryStocked: hook });
      try {
        const beforeRows = await rows(), beforeEvents = await events();
        await expect(Effect.runPromise(host.run(host.newRequestKey(), input("late-stock-" + index)))).rejects.toBeDefined();
        expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
      } finally { await Effect.runPromise(host.close); }
    }
    if (!escaped) throw new Error("Missing escaped Inventory method");
    await expect(escaped([])).rejects.toMatchObject({ reason: "closed" });
  });

  it("drains cancellation after both children with no publication", async () => {
    const reached = await Effect.runPromise(Deferred.make<void>());
    let release: (() => void) | undefined;
    const host = await prepare(selected, { inventoryStocked: async () => {
      await Effect.runPromise(Deferred.succeed(reached, undefined));
      await new Promise<void>(resolve => { release = resolve; });
    } });
    try {
      const beforeRows = await rows(), beforeEvents = await events();
      await Effect.runPromise(Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(host.run(host.newRequestKey(), input("cancel-stock")));
        yield* Deferred.await(reached).pipe(Effect.timeout(30_000));
        yield* Fiber.interrupt(fiber);
      }));
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { release?.(); await Effect.runPromise(host.close); }
  }, 120_000);

  it("recovers a lost commit acknowledgement without repeating native hooks", async () => {
    let lose = true;
    const session = issueRelationalSession(selected.fixture.persistence.drizzle, (profile, work) => runRelationalSession(selected.fixture.session, profile, work).pipe(
      Effect.catchTag("RelationalTransactionError", cause => Effect.fail(new RelationalSessionError({ reason: "resourceFailure", cause }))),
      Effect.flatMap(value => { if (!lose) return Effect.succeed(value); lose = false;
        return Effect.fail(new RelationalSessionError({ reason: "decisionUncertain", cause: new Error("Lost stocking COMMIT acknowledgement") })); }),
    ));
    const hook = vi.fn<NonNullable<InventoryStockingHooks["inventoryStocked"]>>(() => undefined);
    const host = await prepare(selected, { inventoryStocked: hook }, execution(selected, session));
    try {
      const key = host.newRequestKey(), value = input("uncertain-stock"), result = await Effect.runPromise(host.run(key, value));
      expect(lose).toBe(false); expect(hook).toHaveBeenCalledTimes(1);
      const beforeRows = await rows(), beforeEvents = await events();
      expect(await Effect.runPromise(host.run(key, value))).toEqual(result);
      expect(await rows()).toEqual(beforeRows); expect(await events()).toEqual(beforeEvents);
    } finally { await Effect.runPromise(host.close); }
  });

  it("confines matching Location and Inventory identities to their own shop", async () => {
    const other = await connect(await logicalCurrencyFixture(driver, close => cleanup.push(close), {
      includeProduct: true, includePricing: true, includeVariantInventory: true, resource: selected.fixture.resource,
      fixtureIdentity: { deploymentId: "stock_shop_b", projectId: "stock_shop_b", uuidOffset: 18_000 },
    }));
    await seedItems(other);
    const first = await prepare(), second = await prepare(other);
    try {
      const value = input("same-shop-stock");
      const left = await Effect.runPromise(first.run(first.newRequestKey(), value));
      const right = await Effect.runPromise(second.run(second.newRequestKey(), value));
      expect(left.locations[0]?.id).toBe(right.locations[0]?.id);
      expect(left.inventory_levels[0]?.inventory_item_id).toBe(right.inventory_levels[0]?.inventory_item_id);
      await expect(Effect.runPromise(second.run(second.newRequestKey(), { locations: [], inventory_levels: [
        { inventory_item_id: "stock-item-0", location_id: "default-location" },
      ] })).catch(error => { throw nativeFailure(error); }))
        .rejects.toMatchObject({ type: "not_found", message: "Stock locations with ids: default-location was not found" });
    } finally { await Effect.runPromise(first.close); await Effect.runPromise(second.close); }
  }, 180_000);
});
