import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { captureInventoryMetadata, compileInventoryDefinition } from "../src/modules/inventory/schema";
import { captureStockLocationMetadata, compileStockLocationDefinition } from "../src/modules/stock-location/schema";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";

describe("pinned Inventory structural source closure", () => {
  it("retains all models and quantity storage while omitting computed item columns", async () => {
    const { frame } = await Effect.runPromise(captureInventoryMetadata());
    expect(frame.tables.map(table => table.name).sort()).toEqual(["inventory_item", "inventory_level", "reservation_item"]);
    const item = frame.tables.find(table => table.name === "inventory_item");
    if (!item) throw new Error("Missing InventoryItem");
    expect(item.columns.some(column => ["reserved_quantity", "stocked_quantity"].includes(column.name))).toBe(false);
    expect(item.columns.find(column => column.name === "requires_shipping")).toMatchObject({ defaultValue: true });
    for (const name of ["inventory_level", "reservation_item"]) {
      const table = frame.tables.find(table => table.name === name);
      if (!table) throw new Error("Missing structural Inventory model");
      expect(table.columns.some(column => column.type === "bigNumber")).toBe(true);
      expect(table.foreignKeys.some(key => key.referencedTable === "inventory_item")).toBe(true);
    }
    expect((await Effect.runPromise(compileInventoryDefinition())).schema.tables).toHaveLength(3);
  });

  it("lowers the native Stock Location inverse relation and rich Link default", async () => {
    const stock = await Effect.runPromise(captureStockLocationMetadata());
    expect(stock.frame.tables.map(table => table.name).sort()).toEqual(["stock_location", "stock_location_address"]);
    expect(stock.frame.tables.some(table => table.relationships.some(relation => relation.type === "hasOne"))).toBe(true);
    expect((await Effect.runPromise(compileStockLocationDefinition())).schema.tables).toHaveLength(2);
    const link = await Effect.runPromise(captureVariantInventoryLinkMetadata());
    expect(link.frame.columns.find(column => column.name === "required_quantity")).toMatchObject({ type: "number", nullable: false, defaultValue: 1 });
  });
});
