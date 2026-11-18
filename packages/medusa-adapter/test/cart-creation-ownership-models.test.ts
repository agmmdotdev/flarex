import { describe, expect, it } from "vitest";
import { Effect } from "effect";
import * as native from "@medusajs/cart/models";
import { cartCreationModels } from "@medusajs/cart/creation-models";
import { compileDmlSchema } from "@medusajs/drizzle/schema";
import { captureCartMetadata, cartModels } from "../src/modules/cart/schema";

describe("native Cart creation ownership model profile", () => {
  it("retains every existing native column, index, foreign key and check in the creation profile", () => {
    const baseline = compileDmlSchema([...cartModels]), creation = compileDmlSchema(Object.values(cartCreationModels));
    expect(baseline.tables).toHaveLength(9);
    expect(creation.tables).toHaveLength(12);
    for (const table of baseline.tables) {
      const current = creation.tables.find(candidate => candidate.name === table.name);
      expect(current, table.name).toBeDefined();
      if (current === undefined) throw new Error("Missing original Cart model");
      expect(current.columns, table.name).toEqual(table.columns);
      expect(current.indexes, table.name).toEqual(table.indexes);
      expect(current.foreignKeys, table.name).toEqual(table.foreignKeys);
      expect(current.checks, table.name).toEqual(table.checks);
    }
  });

  it("cascades physical generation claims with their exact targets and retains the operation independently", () => {
    const schema = compileDmlSchema(Object.values(cartCreationModels));
    for (const [name, target, column] of [["cart_creation_cart", "cart", "cart_id"],
      ["cart_creation_address", "cart_address", "address_id"]] as const) {
      const claim = schema.tables.find(table => table.name === name);
      expect(claim?.foreignKeys.filter(key => key.referencedTable === target)).toEqual([
        expect.objectContaining({ columns: [column], referencedColumns: ["id"], onDelete: "cascade" }),
      ]);
      expect(claim?.columns.filter(column => column.primaryKey).map(column => column.name)).toEqual(["id"]);
      expect(claim?.indexes.filter(index => index.unique)).toEqual([]);
      expect(claim?.foreignKeys.filter(key => key.referencedTable === "cart_creation_operation")).toEqual([
        expect.objectContaining({ columns: ["operation_id"], referencedColumns: ["id"] }),
      ]);
      expect(claim?.foreignKeys.find(key => key.referencedTable === "cart_creation_operation")?.onDelete).toBeUndefined();
    }
    expect(schema.tables.find(table => table.name === "cart_creation_operation")?.foreignKeys).toEqual([]);
  });

  it("keeps default native models and the existing Cart installation profile unchanged", async () => {
    expect(cartCreationModels.Cart).not.toBe(native.Cart);
    expect(cartCreationModels.Address).not.toBe(native.Address);
    expect(native.Cart.schema).not.toHaveProperty("creation_claims");
    expect(native.Address.schema).not.toHaveProperty("creation_claims");
    expect((await Effect.runPromise(captureCartMetadata())).frame.tables).toHaveLength(9);
    expect(cartCreationModels.LineItem).toBe(native.LineItem);
    expect(cartCreationModels.ShippingMethod).toBe(native.ShippingMethod);
  });
});
