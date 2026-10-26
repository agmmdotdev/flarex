import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeOrderFinanceTransactions } from "../src/modules/order/finance-input";

describe("selected single-Order financial input", () => {
  it("admits native exact capture companions and refund decimal strings", () => {
    const input = [
      { order_id: "order-one", amount: { value: "12.500000000000000000", precision: 20 }, currency_code: "usd", reference: "capture", reference_id: "capt-one" },
      { order_id: "order-one", amount: "-3.125000000000000000001", currency_code: "usd", reference: "refund", reference_id: "ref-one" },
    ];
    expect(Result.getOrThrow(decodeOrderFinanceTransactions(input))).toEqual(input);
    // The native step handles an empty batch before calling this method.
    expect(decodeOrderFinanceTransactions([])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("keeps mixed-Order transaction batches outside this native workflow profile", () => {
    expect(decodeOrderFinanceTransactions([
      { order_id: "order-one", amount: 1, currency_code: "usd" },
      { order_id: "order-two", amount: 1, currency_code: "usd" },
    ])).toMatchObject({ _tag: "Failure", failure: { reason: "invalidInput" } });
  });

  it("refuses extra raw properties, nonfinite values and oversized batches", () => {
    const row = { order_id: "order-one", amount: 1, currency_code: "usd" };
    for (const input of [[{ ...row, amount: { value: "1", precision: 20, serializer: "outside-profile" } }],
      [{ ...row, amount: { value: "1".repeat(129), precision: 20 } }],
      [{ ...row, amount: Infinity }], Array.from({ length: 5 }, () => row)]) {
      expect(decodeOrderFinanceTransactions(input)).toMatchObject({ _tag: "Failure" });
    }
  });
});
