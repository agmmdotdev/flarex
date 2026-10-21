// @ts-check
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inventoryConfirmationSourcePairs, inventoryAvailabilitySourcePair,
  verifyInventoryConfirmationSourceSelection,
  verifyInventoryConfirmationFork, verifyNativeInventoryAvailabilityExtraction,
  verifyInventoryConfirmationPreparationTest } from "./check-medusa-inventory-confirmation-source.mjs";

const failure = "Changed native Inventory confirmation source";
/** @param {string} target */
const entry = target => {
  const pair = [...inventoryConfirmationSourcePairs, inventoryAvailabilitySourcePair].find(pair => pair.target === target);
  if (!pair) throw new Error("Missing Inventory confirmation source pair");
  return { ...pair, native: readFileSync(pair.source, "utf8"), actual: readFileSync(pair.target, "utf8") };
};
const preparation = entry("packages/medusa-core-flows/src/cart/utils/prepare-confirm-inventory-input.ts");
const availability = entry(inventoryAvailabilitySourcePair.target);

describe("exact native Inventory confirmation closure", () => {
  const selection = [...inventoryConfirmationSourcePairs, inventoryAvailabilitySourcePair];
  it("requires every exact source pair and rejects copied or relabeled admission", () => {
    expect(() => verifyInventoryConfirmationSourceSelection(selection)).not.toThrow();
    for (const pair of selection) {
      expect(() => verifyInventoryConfirmationSourceSelection(selection.filter(selected => selected !== pair))).toThrow(failure);
      expect(() => verifyInventoryConfirmationSourceSelection(selection.map(selected => selected === pair ? { ...pair, classification: "authored" } : selected)))
        .toThrow(failure);
      expect(() => verifyInventoryConfirmationSourceSelection([...selection, { ...pair, target: "packages/medusa-core-flows/src/other.ts" }]))
        .toThrow(failure);
    }
    expect(() => verifyInventoryConfirmationSourceSelection([...selection, { target: "packages/medusa-core-flows/src/other.ts", classification: "inventoryConfirmationFork" }]))
      .toThrow(failure);
  });
  it.each(inventoryConfirmationSourcePairs.filter(pair => pair.classification !== "testPort"))("preserves complete typed and emitted $target", pair => {
    const selected = entry(pair.target);
    expect(() => verifyInventoryConfirmationFork(selected.native, selected.actual, pair.target)).not.toThrow();
  });

  it.each([
    ["packages/medusa-core-flows/src/cart/steps/confirm-inventory.ts", "if (item.allow_backorder)", "if (!item.allow_backorder)"],
    ["packages/medusa-core-flows/src/cart/steps/confirm-inventory.ts", "MathBN.mult(item.quantity, item.required_quantity)", "MathBN.mult(item.quantity, 1)"],
    ["packages/medusa-core-flows/src/cart/steps/confirm-inventory.ts", "inventoryCoverage.some", "inventoryCoverage.every"],
    ["packages/medusa-core-flows/src/cart/steps/confirm-inventory.ts", "item.location_ids,", "[],"],
    ["packages/medusa-core-flows/src/cart/utils/prepare-confirm-inventory-input.ts", "if (item && updateItem_.quantity)", "if (item)"],
    ["packages/medusa-core-flows/src/cart/utils/prepare-confirm-inventory-input.ts", "sales_channels?.id === salesChannelId", "sales_channels?.id !== salesChannelId"],
    ["packages/medusa-core-flows/src/cart/utils/prepare-confirm-inventory-input.ts", "location_levels.raw_reserved_quantity", "location_levels.reserved_quantity"],
    ["packages/medusa-core-flows/src/cart/utils/prepare-confirm-inventory-input.ts", "MathBN.gte(", "MathBN.gt("],
    ["packages/medusa-core-flows/src/cart/workflows/confirm-variant-inventory.ts", "confirmInventoryStep(confirmInventoryInput)", "confirmInventoryStep({ items: [] })"],
    ["packages/medusa-core-flows/src/cart/workflows/confirm-variant-inventory.ts", "new WorkflowResponse(confirmInventoryInput)", "new WorkflowResponse({ items: [] })"],
    ["packages/medusa-utils/src/common/deep-flat-map.ts", "stack.shift()!", "stack.pop()!"],
    ["packages/medusa-utils/src/common/deep-flat-map.ts", "if (!isDefined(element?.[currentKey]))", "if (!element?.[currentKey])"],
  ])("rejects changed native behavior in %s", (target, before, after) => {
    const selected = entry(target), changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyInventoryConfirmationFork(selected.native, changed, target)).toThrow(failure);
  });

  it("refuses broader erased contracts, barrel imports and arbitrary additions", () => {
    for (const changed of [preparation.actual.replace("id?: string | undefined", "id?: unknown"),
      preparation.actual.replace("stockAvailability: Map<string, Map<string, BigNumberInput | BigNumber>>", "stockAvailability: Map<string, Map<string, unknown>>"),
      preparation.actual.replace("const mapLocationAvailability = new Map<string, Map<string, BigNumberInput | BigNumber>>()", "const mapLocationAvailability = new Map<string, Map<string, BigNumberInput>>()"),
      preparation.actual.replace('@medusajs/utils/common/deep-flat-map', '@medusajs/utils'),
      preparation.actual + "\nexport const other = 1"])
      expect(() => verifyInventoryConfirmationFork(preparation.native, changed, preparation.target)).toThrow(failure);
  });
});

describe("native availability arithmetic extraction", () => {
  it("keeps the complete native return under the exact readonly raw-quantity ABI", () => {
    expect(() => verifyNativeInventoryAvailabilityExtraction(availability.native, availability.actual)).not.toThrow();
    expect(() => verifyNativeInventoryAvailabilityExtraction(availability.native, "/* layout */\n" + availability.actual)).not.toThrow();
  });

  it.each([
    ["MathBN.sub(r.raw_stocked_quantity, r.raw_reserved_quantity)", "MathBN.sub(r.raw_reserved_quantity, r.raw_stocked_quantity)"],
    ["MathBN.sum(", "MathBN.max("],
    ["raw_stocked_quantity: BigNumberInput", "stocked_quantity: BigNumberInput"],
    ["result: readonly", "result:"],
    ['@medusajs/framework/utils/portable', '@medusajs/framework/utils'],
  ])("refuses changed arithmetic or erased ABI: %s", (before, after) => {
    const changed = availability.actual.replace(before, after);
    expect(changed).not.toBe(availability.actual);
    expect(() => verifyNativeInventoryAvailabilityExtraction(availability.native, changed)).toThrow(failure);
  });

  it("requires the pinned class/method/final return and rejects extra target operations", () => {
    for (const source of [availability.native.replace("class InventoryLevelRepository", "class OtherRepository"),
      availability.native.replace("async getAvailableQuantity(", "async otherQuantity("),
      availability.native + "\n" + availability.native])
      expect(() => verifyNativeInventoryAvailabilityExtraction(source, availability.actual)).toThrow(failure);
    expect(() => verifyNativeInventoryAvailabilityExtraction(availability.native, availability.actual + "\nexport const other = true"))
      .toThrow(failure);
  });
});

describe("native preparation test provenance", () => {
  const selected = entry("packages/medusa-adapter/test/native-confirm-inventory-preparation.test.ts");
  it("keeps every upstream setup and assertion", () => {
    expect(() => verifyInventoryConfirmationPreparationTest(selected.native, selected.actual)).not.toThrow();
  });
  it.each([
    ["quantity: 2, // overrides", "quantity: 3, // overrides"],
    [".toThrow(MedusaError)", ".toThrow()"],
    ['it("should use the quantity', 'it.skip("should use the quantity'],
  ])("rejects changed upstream assertion or execution: %s", (before, after) => {
    const changed = selected.actual.replace(before, after);
    expect(changed).not.toBe(selected.actual);
    expect(() => verifyInventoryConfirmationPreparationTest(selected.native, changed)).toThrow(failure);
  });
});
