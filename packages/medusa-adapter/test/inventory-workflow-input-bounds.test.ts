import { expect, it } from "vitest";
import { Result, Schema } from "effect";
import { StockLocationsInput } from "../src/modules/stock-location/input";
import { StockAdjustmentsInput } from "../src/workflows/inventory/adjust-and-reserve";

it("admits four native Stock Locations and rejects the fifth before execution", () => {
  const decode = Schema.decodeUnknownResult(StockLocationsInput);
  const input = Array.from({ length: 4 }, (_, index) => ({ name: "location-" + index }));
  expect(Result.isSuccess(decode(input))).toBe(true);
  expect(Result.isFailure(decode([...input, { name: "fifth" }]))).toBe(true);
});

it("admits four sequential stock adjustments and rejects the fifth before execution", () => {
  const decode = Schema.decodeUnknownResult(StockAdjustmentsInput);
  const adjustment = { inventory_item_id: "item", location_id: "location", adjustment: 1 };
  const input = Array.from({ length: 4 }, () => ({ ...adjustment }));
  expect(Result.isSuccess(decode(input))).toBe(true);
  expect(Result.isFailure(decode([...input, adjustment]))).toBe(true);
});
