import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import { prepareLocalGraph } from "../src/local-graph/query";
import { prepareCoreInventoryMaintenance } from "./support/core-inventory-maintenance-fixture";
import { ExactNumericRaw } from "../src/value/exact-numeric";
import { InventoryLevelsOutput } from "../src/modules/inventory/level-input";
import { decodeGraphCount } from "../src/local-graph/query";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Inventory graph read driver");
const cleanup: Array<() => Promise<void>> = [];
let caseCleanupStart: number | undefined;
let connected: Awaited<ReturnType<typeof prepareCoreInventoryMaintenance>>;
let inventory: Effect.Success<ReturnType<typeof prepareReadCommands>>;
const prepareReadCommands = () => makeLocalInventoryCommands("variant-price-calculation");
const decodeRaw = Schema.decodeUnknownSync(ExactNumericRaw);

describe("native read-only Inventory graph for Variant price calculation", () => {
  beforeAll(async () => {
    connected = await prepareCoreInventoryMaintenance(driver, close => cleanup.push(close));
    inventory = await Effect.runPromise(prepareReadCommands());
  }, 180_000);
  beforeEach(() => { caseCleanupStart = cleanup.length; });
  afterEach(async () => {
    const transient = caseCleanupStart === undefined ? [] : cleanup.splice(caseCleanupStart);
    caseCleanupStart = undefined;
    const failures: unknown[] = [];
    for (const close of transient.reverse()) {
      try { await close(); } catch (error) { failures.push(error); }
    }
    if (failures.length !== 0) throw new AggregateError(failures, "Unable to close Inventory consumer case hosts");
  }, 120_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  it("reads complete Item and Level cohorts through native counts with exact quantity companions and no mutations", async () => {
    const items = [...await connected.seed("variant-price-read-first", 4), ...await connected.seed("variant-price-read-second", 4)];
    const seeded: Array<(typeof InventoryLevelsOutput.Type)[number]> = [];
    for (const offset of [0, 4]) {
      const result = await Effect.runPromise(connected.stocking.run(connected.stocking.newRequestKey(), {
        locations: offset === 0 ? [{ id: "variant-price-read-location-0", name: "First" }, { id: "variant-price-read-location-1", name: "Second" }] : [],
        inventory_levels: items.slice(offset, offset + 4).flatMap(inventory_item_id => [0, 1].map(index => ({ inventory_item_id,
          location_id: "variant-price-read-location-" + index, stocked_quantity: index === 0 ? 10.25 : 20.5 }))),
      }));
      seeded.push(...result.inventory_levels);
    }
    const first = items[0];
    if (first === undefined) throw new Error("Missing native Inventory seed");
    const reservations = await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), {
      reservations: [{ inventory_item_id: first, location_id: "variant-price-read-location-0", quantity: 0.125 }],
    }));
    const participant = defineAtomicCommerceParticipant("variantPriceInventoryReads");
    const graph = Result.getOrThrow(prepareLocalGraph([{ participant, module: inventory.graph }]));
    const read = defineAtomicCommerceCommand("variantPriceInventoryReadGraph", (ctx, input) => graph.bind(ctx).graph(input));
    const host = await Effect.runPromise(connected.execution.prepare({ identityAndAccessPolicy: connected.execution.identityAndAccessPolicy,
      commands: [read], participants: [{ participant, nativeStorage: connected.members.inventory.source, commands: inventory.commands,
        validateLogicalCall: inventory.logicalEventPolicy().validateLogicalCall }] }));
    const itemCount = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryItems");
    const levelCount = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryLevels");
    try {
      const before = await connected.fixture.snapshot();
      const itemRows = await Effect.runPromise(host.run(host.newRequestKey(), read, {
        entity: "inventory_item", fields: ["id", "requires_shipping"], filters: { id: items }, pagination: { take: 8 },
      }));
      expect(itemRows).toEqual({ data: [...items].sort().map(id => ({ id, requires_shipping: true })), metadata: { count: 8, skip: 0, take: 8 } });
      const fields = ["id", "inventory_item_id", "location_id", "stocked_quantity", "reserved_quantity", "raw_stocked_quantity", "raw_reserved_quantity"];
      const levels = await Effect.runPromise(host.run(host.newRequestKey(), read, {
        entity: "inventory_level", fields, filters: { inventory_item_id: items }, pagination: { take: 16 },
      }));
      const expected = seeded.map(level => {
        const reserved = level.inventory_item_id === first && level.location_id === "variant-price-read-location-0" ? 0.125 : 0;
        const stocked = level.location_id === "variant-price-read-location-0" ? 10.25 : 20.5;
        return { id: level.id, inventory_item_id: level.inventory_item_id, location_id: level.location_id,
          stocked_quantity: stocked, reserved_quantity: reserved,
          raw_stocked_quantity: decodeRaw(level.raw_stocked_quantity),
          raw_reserved_quantity: decodeRaw(reserved === 0 ? level.raw_reserved_quantity : reservations[0]?.raw_quantity) };
      }).sort((left, right) => left.id.localeCompare(right.id));
      expect(levels).toEqual({ data: expected, metadata: { count: 16, skip: 0, take: 16 } });
      const selected = expected.slice(0, 8), ids = selected.map(level => level.id);
      expect(await Effect.runPromise(host.run(host.newRequestKey(), read, {
        entity: "inventory_level", fields, filters: { id: ids }, pagination: { take: 16 },
      }))).toEqual({ data: selected, metadata: { count: 8, skip: 0, take: 16 } });
      for (const entity of ["inventory_item", "inventory_level"]) expect(await Effect.runPromise(host.run(host.newRequestKey(), read, {
        entity, fields: ["id"], filters: { id: [] }, pagination: { take: 8 },
      }))).toEqual({ data: [], metadata: { count: 0, skip: 0, take: 8 } });
      expect(itemCount).toHaveBeenCalledTimes(2); expect(levelCount).toHaveBeenCalledTimes(3);
      const after = await connected.fixture.snapshot();
      expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
    } finally {
      itemCount.mockRestore(); levelCount.mockRestore(); await Effect.runPromise(host.close);
    }
  }, 180_000);

  it("populates native Shipping Levels with exact quantities, authenticated receipts and the existing four-row bound", async () => {
    const items = await connected.seed("shipping-local-level-read", 1), first = items[0];
    if (first === undefined) throw new Error("Missing genuine Shipping Inventory seed");
    const locations = Array.from({ length: 4 }, (_, index) => ({ id: `shipping-local-level-${index}`, name: `Local ${index}` }));
    const stocking = await Effect.runPromise(connected.stocking.run(connected.stocking.newRequestKey(), { locations,
      inventory_levels: locations.map(location => ({ inventory_item_id: first, location_id: location.id, stocked_quantity: 10.25 })) }));
    const reservations = await Effect.runPromise(connected.reservations.run(connected.reservations.newRequestKey(), {
      reservations: [{ inventory_item_id: first, location_id: locations[0]!.id, quantity: 0.125 }],
    }));
    const populated = await Effect.runPromise(makeLocalInventoryCommands("variant-price-calculation", "location-levels"));
    const participant = defineAtomicCommerceParticipant("shippingLocalLevelRead");
    const read = defineAtomicCommerceCommand("shippingLocalLevelRead", (ctx, input) => ctx.call(participant, populated.count, input));
    const packets: Array<Parameters<LogicalCallReceiptValidation>> = [], policy = populated.logicalEventPolicy();
    const host = await Effect.runPromise(connected.execution.prepare({ identityAndAccessPolicy: connected.execution.identityAndAccessPolicy,
      commands: [read], participants: [{ participant, nativeStorage: connected.members.inventory.source, commands: populated.commands,
        validateLogicalCall: (call, activity) => policy.validateLogicalCall(call, activity).pipe(Effect.tap(() =>
          Effect.sync(() => { packets.push(structuredClone([call, activity])); }))) }] }));
    cleanup.push(() => Effect.runPromise(host.close));
    const input = { filters: { id: [first] }, config: { select: ["requires_shipping", "id"], relations: ["location_levels"], take: 256, skip: 0 } };
    const before = await connected.fixture.snapshot();
    const output = await Effect.runPromise(host.run(host.newRequestKey(), read, input));
    const [rows, count] = Result.getOrThrow(decodeGraphCount(output));
    expect(count).toBe(1);
    const levels = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(rows[0]?.location_levels);
    expect(levels).toHaveLength(4);
    expect(levels).toEqual(expect.arrayContaining(locations.map(location => expect.objectContaining({
      inventory_item_id: first, location_id: location.id, stocked_quantity: 10.25,
      reserved_quantity: location.id === locations[0]?.id ? 0.125 : 0,
      available_quantity: location.id === locations[0]?.id ? 10.125 : 10.25,
    }))));
    for (const level of levels) {
      const created = stocking.inventory_levels.find(value => value.id === level.id);
      if (created === undefined) throw new Error("Missing genuine native Level output");
      expect(decodeRaw(level.raw_stocked_quantity)).toEqual(decodeRaw(created.raw_stocked_quantity));
      expect(decodeRaw(level.raw_reserved_quantity)).toEqual(decodeRaw(level.location_id === locations[0]?.id
        ? reservations[0]?.raw_quantity : created.raw_reserved_quantity));
    }
    const after = await connected.fixture.snapshot();
    expect(after.rows).toEqual(before.rows); expect(after.revisions).toEqual(before.revisions); expect(after.events).toEqual(before.events);
    const packet = packets[0];
    if (packet === undefined) throw new Error("Missing genuine populated Inventory receipt");
    await Effect.runPromise(policy.validateLogicalCall(...packet));
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall(packet[0], { ...packet[1], relationalReads: [] }))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    expect(await Effect.runPromise(Effect.result(policy.validateLogicalCall({ ...packet[0], result: [[{ ...rows[0],
      location_levels: levels.map(level => ({ ...level, available_quantity: 999 })) }], count] }, packet[1]))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
    await Effect.runPromise(connected.stocking.run(connected.stocking.newRequestKey(), {
      locations: [{ id: "shipping-local-level-fifth", name: "Fifth" }],
      inventory_levels: [{ inventory_item_id: first, location_id: "shipping-local-level-fifth", stocked_quantity: 1 }],
    }));
    const beforeRefusal = await connected.fixture.snapshot();
    expect(await Effect.runPromise(Effect.result(host.run(host.newRequestKey(), read, input))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
    const refused = await connected.fixture.snapshot();
    expect(refused.rows).toEqual(beforeRefusal.rows); expect(refused.revisions).toEqual(beforeRefusal.revisions); expect(refused.events).toEqual(beforeRefusal.events);
  }, 180_000);
});
