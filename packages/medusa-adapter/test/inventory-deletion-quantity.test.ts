import { expect, it } from "vitest";
import { Effect } from "effect";
import { inventoryItemReservedQuantity } from "../src/modules/inventory/deletion-read";
import type { JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

const level = (value: string) => ({ reserved_quantity: value, raw_reserved_quantity: { value, precision: 20 } });

it("applies native Number(null)=0 only to an authenticated empty level selection", async () => {
  expect(await Effect.runPromise(inventoryItemReservedQuantity([]))).toBe(0);
  expect(await Effect.runPromise(inventoryItemReservedQuantity([level("0"), level("0")]))).toBe(0);
});

it("sums exact native quantities before final Number serialization", async () => {
  expect(await Effect.runPromise(inventoryItemReservedQuantity([level("0.1"), level("0.2")]))).toBe(0.3);
  expect(await Effect.runPromise(inventoryItemReservedQuantity([level("9007199254740992.1"), level("-9007199254740992.0")]))).toBe(0.1);
});

it("refuses missing or inconsistent quantity evidence and a third active level", async () => {
  const cases: readonly (readonly JsonObject[])[] = [[{ reserved_quantity: "0" }], [{ reserved_quantity: "1", raw_reserved_quantity: { value: "0", precision: 20 } }],
    [{ reserved_quantity: null, raw_reserved_quantity: null }]];
  for (const rows of cases) {
    expect(await Effect.runPromise(Effect.result(inventoryItemReservedQuantity(rows)))).toMatchObject({ _tag: "Failure", failure: { reason: "storedCorruption" } });
  }
  expect(await Effect.runPromise(Effect.result(inventoryItemReservedQuantity([level("0"), level("0"), level("0")]))))
    .toMatchObject({ _tag: "Failure", failure: { reason: "limitExceeded" } });
});
