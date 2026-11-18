import { Effect, Result } from "effect";
import { describe, expect, it } from "vitest";
import { captureInventoryMetadata, compileInventoryDefinition } from "../src/modules/inventory/schema";
import { captureStockLocationMetadata, compileStockLocationDefinition } from "../src/modules/stock-location/schema";
import { captureVariantInventoryLinkMetadata } from "../src/composition/product-variant-inventory-schema";

import { compileLogicalRelationalRead } from "../../persistence-postgres/src/storage/documents/logicalDocuments/relationalQuery";
import { captureLogicalSchemaSource } from "@flarex/analysis/internal/logical-schema-candidate";
import { compileLogicalSourceIndexes } from "flarex-protocol/internal/logical-storage-requirements";

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

  it("adds unconditional Line Item equality access while preserving the native active-only index", async () => {
    const inventory = await Effect.runPromise(compileInventoryDefinition());
    const table = inventory.schema.tables.find(table => table.identity.tableId === "reservation_item");
    if (table === undefined) throw new Error("Missing native Reservation table");
    const derived = table.indexes.filter(index => index.identity.indexId === "reservation-item.line-item-equality");
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({ kind: "textEquality", columns: [{ columnId: "line_item_id" }], predicate: null,
      origin: { kind: "derived", sourceId: "reservation-item.line-item-equality" } });
    expect(table.indexes.some(index => index.identity.indexId !== "reservation-item.line-item-equality"
      && index.columns[0]?.columnId === "line_item_id" && index.predicate?.kind === "isNull")).toBe(true);
    expect(table.constraints.some(key => key.kind === "foreignKey"
      && key.sourceColumns.some(column => column.columnId === "line_item_id"))).toBe(false);
    const withoutDerived = { ...table, indexes: table.indexes.filter(index =>
      index.identity.indexId !== "reservation-item.line-item-equality") };
    expect(Result.isFailure(compileLogicalRelationalRead(withoutDerived, inventory.schema.capabilities,
      { predicate: { kind: "in", column: "line_item_id", values: ["line"] }, take: 4,
        order: { column: "id", direction: "asc" } }, 256, reason => new Error(reason)))).toBe(true);
    for (const values of [["line"], ["line", "other"], []]) {
      const plan = Result.getOrThrow(compileLogicalRelationalRead(table, inventory.schema.capabilities,
        { predicate: { kind: "in", column: "line_item_id", values }, take: 4, order: { column: "id", direction: "asc" } },
        256, reason => new Error(reason)));
      expect(plan.selections).toEqual(values.map(value => ({ column: "line_item_id", value })));
    }
    const source = await Effect.runPromise(captureLogicalSchemaSource({ key: "medusa.inventory", owner: "medusa",
      writeProfile: "medusa.inventory", evidence: inventory.provenance, definition: { kind: "relational", schema: inventory.schema },
      bindings: inventory.schema.tables.map(table => ({ kind: "definition", localName: table.identity.tableId,
        table: { namespace: "medusa", logicalName: `${inventory.schema.coordinate.lineageId}/${table.identity.tableId}` } })) }));
    const indexes = Result.getOrThrow(compileLogicalSourceIndexes(source));
    const physical = indexes.filter(index => index.localName === "reservation_item"
      && index.descriptor === "index/reservation-item.line-item-equality");
    expect(physical).toHaveLength(1);
    expect(physical[0]?.physicalSpec.predicate).toBeUndefined();
    expect(physical[0]?.physicalSpec.orderedFields[0]).toMatchObject({ kind: "documentPath", path: "line_item_id" });
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
