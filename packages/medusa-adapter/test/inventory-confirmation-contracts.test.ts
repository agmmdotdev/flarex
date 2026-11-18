import { describe, expect, it, vi } from "vitest";
import { Result } from "effect";
import { BigNumber, MathBN } from "@medusajs/framework/utils/portable";
import { decodeInventoryConfirmation, decodeInventoryConfirmationArguments, decodeInventoryConfirmationOutput,
  normalizeInventoryConfirmationArguments } from "../src/modules/inventory/confirmation-input";

describe("native Inventory confirmation argument boundary", () => {
  it("normalizes genuine native arithmetic at the composed boundary before JSON capture", () => {
    const arithmetic = MathBN.mult("0.1", 3);
    const normalized = Result.getOrThrow(normalizeInventoryConfirmationArguments(["item", ["a", "b", "a"], arithmetic]));
    expect(normalized.slice(0, 2)).toEqual(["item", ["a", "b", "a"]]);
    expect(MathBN.eq(normalized[2], arithmetic)).toBe(true);
    expect(MathBN.eq(Result.getOrThrow(normalizeInventoryConfirmationArguments(["item", [], new BigNumber("0.125")]))[2], "0.125")).toBe(true);
    expect(Result.getOrThrow(decodeInventoryConfirmationArguments(["item", [], "0"]))).toEqual(["item", [], "0"]);
    expect(Result.isFailure(decodeInventoryConfirmationArguments(["item", ["a"], arithmetic]))).toBe(true);
  });

  it("retains native comparison precision beyond the persisted raw companion precision", () => {
    const arithmetic = MathBN.convert("1.000000000000000000001");
    const normalized = Result.getOrThrow(normalizeInventoryConfirmationArguments(["item", ["a"], arithmetic]));
    expect(MathBN.eq(normalized[2], arithmetic)).toBe(true);
    expect(MathBN.gte(1, normalized[2])).toBe(false);
    const prepared = Result.getOrThrow(decodeInventoryConfirmation({ inventory_item_id: "item", location_ids: ["a"], quantity: normalized[2] }));
    expect(MathBN.eq(prepared.quantity, arithmetic)).toBe(true);
  });

  it("retains negative, zero and fractional native quantities and empty Locations", () => {
    for (const quantity of ["-2", "0", "0.125", "9007199254740993"]) {
      const value = Result.getOrThrow(normalizeInventoryConfirmationArguments(["item", [], quantity]));
      expect(MathBN.eq(value[2], quantity)).toBe(true);
      expect(Result.isSuccess(decodeInventoryConfirmation({ inventory_item_id: value[0], location_ids: value[1], quantity: value[2] }))).toBe(true);
    }
    expect(Result.getOrThrow(decodeInventoryConfirmationOutput(false))).toBe(false);
    for (const value of [0, "true", {}, null]) expect(Result.isFailure(decodeInventoryConfirmationOutput(value))).toBe(true);
  });

  it("refuses configuration, extra arguments, oversized cohorts and foreign quantity objects", () => {
    const toString = vi.fn(() => "1");
    for (const args of [[], ["item", ["a"]], ["item", ["a"], 1, {}], ["", ["a"], 1], ["item", [""], 1],
      ["item", ["a", "b", "c", "d", "e"], 1], ["item", "a", 1], ["item", ["a"], { toString }],
      ["item", ["a"], { value: "1", precision: 20 }], ["item", ["a"], "NaN"], ["item", ["a"], "Infinity"]])
      expect(Result.isFailure(normalizeInventoryConfirmationArguments(args))).toBe(true);
    expect(toString).not.toHaveBeenCalled();
    const getter = vi.fn(() => MathBN.convert(1));
    const argumentsWithGetter = Object.defineProperty(["item", ["a"], 1], "2", { get: getter, enumerable: true });
    expect(Result.isFailure(normalizeInventoryConfirmationArguments(argumentsWithGetter))).toBe(true);
    expect(getter).not.toHaveBeenCalled();
    expect(Result.isFailure(decodeInventoryConfirmation({ inventory_item_id: "item", location_ids: ["a"], quantity: "1", context: {} }))).toBe(true);
  });
});
