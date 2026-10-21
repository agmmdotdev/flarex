import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Effect, Result, Schema } from "effect";
import { InventoryModuleService } from "@medusajs/inventory/services";
import { defineAtomicCommerceCommand, defineAtomicCommerceParticipant } from "../../persistence-postgres/src/frameworks/atomicCommerce/commands";
import { makeAtomicCommerceHost } from "../../persistence-postgres/src/frameworks/atomicCommerce/host";
import { makeLocalInventoryCommands } from "../src/modules/inventory/service";
import { prepareLocalGraph } from "../src/local-graph/query";
import { prepareLogicalInventoryMaintenance } from "./support/logical-inventory-maintenance-fixture";
import { logicalCurrencyInventory } from "./support/logical-currency-inventory";
import { ExactNumericRaw } from "../src/value/exact-numeric";
import { InventoryLevelsOutput } from "../src/modules/inventory/level-input";

const driver = process.env.FLAREX_TEST_DRIVER ?? "pglite";
if (driver !== "pglite" && driver !== "postgres") throw new Error("Invalid Inventory graph read driver");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalInventoryMaintenance>>;
let inventory: Effect.Success<ReturnType<typeof prepareReadCommands>>;
const prepareReadCommands = () => makeLocalInventoryCommands("variant-price-calculation");
const decodeRaw = Schema.decodeUnknownSync(ExactNumericRaw);

describe("native read-only Inventory graph for Variant price calculation", () => {
  beforeAll(async () => {
    connected = await prepareLogicalInventoryMaintenance(driver, close => cleanup.push(close));
    inventory = await Effect.runPromise(prepareReadCommands());
  }, 180_000);
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
    const host = await Effect.runPromise(makeAtomicCommerceHost({ ...connected.fixture.hostInput, commands: [read],
      participants: [{ participant, logicalStorage: connected.members.inventory.hostInput.logicalStorage, commands: inventory.commands,
        validateLogicalCall: inventory.logicalEventPolicy().validateLogicalCall }] }));
    const itemCount = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryItems");
    const levelCount = vi.spyOn(InventoryModuleService.prototype, "listAndCountInventoryLevels");
    try {
      const before = await logicalCurrencyInventory(connected.fixture);
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
      const after = await logicalCurrencyInventory(connected.fixture);
      expect(after.rows).toEqual(before.rows); expect(after.rowChanges).toEqual(before.rowChanges); expect(after.events).toEqual(before.events);
    } finally {
      itemCount.mockRestore(); levelCount.mockRestore(); await Effect.runPromise(host.close);
    }
  }, 180_000);
});
