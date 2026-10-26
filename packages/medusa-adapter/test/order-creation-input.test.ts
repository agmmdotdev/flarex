import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { decodeOrderCreates } from "../src/modules/order/creation-input";

const item = { title: "Digital item", quantity: "1.25", unit_price: "9007199254740993", requires_shipping: false };
const order = { currency_code: "usd", items: [item] };

describe("bounded native Order creation input", () => {
  it("preserves exact scalar and native raw quantities without numeric coercion", () => {
    expect(Result.getOrThrow(decodeOrderCreates([order]))).toEqual([order]);
    const raw = { ...order, items: [{ ...item, unit_price: { value: "3.125", precision: 20 } }] };
    expect(Result.getOrThrow(decodeOrderCreates([raw]))).toEqual([raw]);
  });

  it.each([
    { ...order, id: "caller-order" },
    { ...order, display_id: 123 },
    { ...order, shipping_address: { city: "Unadmitted" } },
    { ...order, shipping_methods: [{ name: "Unadmitted", amount: 1 }] },
    { ...order, credit_lines: [{ amount: 1 }] },
    { ...order, items: [{ ...item, requires_shipping: true }] },
    { ...order, items: [{ ...item, total: 1 }] },
    { ...order, items: [{ ...item, unit_price: { value: "3.125", precision: 20, unexpected: "refused" } }] },
    { ...order, items: [{ ...item, tax_lines: [{ rate: 10 }] }] },
    { ...order, items: [{ ...item, adjustments: [{ amount: 1 }] }] },
    { ...order, items: Array.from({ length: 5 }, () => item) },
  ])("refuses unadmitted identities, graph writes and computed fields %j", input => {
    expect(Result.isFailure(decodeOrderCreates([input]))).toBe(true);
  });
  it("bounds the aggregate item count across individually valid Orders", () => {
    expect(Result.isFailure(decodeOrderCreates([]))).toBe(true);
    expect(Result.isFailure(decodeOrderCreates([
      { ...order, items: [item, item, item] }, { ...order, items: [item, item] },
    ]))).toBe(true);
    expect(Result.isSuccess(decodeOrderCreates([
      { ...order, items: [item, item] }, { ...order, items: [item, item] },
    ]))).toBe(true);
  });
});
