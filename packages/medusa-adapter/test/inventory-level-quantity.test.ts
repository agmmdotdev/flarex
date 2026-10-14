import { expect, it } from "vitest";
import { inventoryLevelAvailableQuantity } from "@medusajs/inventory/inventory-level-quantity";

it("retains the native raw-pair subtraction before converting the available DTO quantity", () => {
  expect(inventoryLevelAvailableQuantity({ value: "9007199254740993.125", precision: 30 },
    { value: "9007199254740992.875", precision: 30 }).numeric).toBe(0.25);
  expect(inventoryLevelAvailableQuantity({ value: "0.3", precision: 20 },
    { value: "0.1", precision: 20 }).numeric).toBe(0.2);
  expect(inventoryLevelAvailableQuantity(0, 0).numeric).toBe(0);
});
