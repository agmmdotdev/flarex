import { Effect, Schema } from "effect";
import { expect, it } from "vitest";
import { prepareCheckoutOrderData } from "@medusajs/core-flows/cart/prepare-checkout-order-data";
import { CheckoutCartView } from "@medusajs/core-flows/common/checkout-query-views";
import { encodeNativeExactNumeric } from "../src/value/exact-numeric";

it("retains native fractional quantity and exact comparison price in the actual checkout transform", () => {
  const cart = Schema.decodeUnknownSync(CheckoutCartView)({ id: "cart-compare-price", currency_code: "usd", sales_channel_id: null,
    email: null, locale: null, metadata: null, total: 1.25, items: [{ id: "cali-compare-price", title: "Digital manual item",
      quantity: 1.25, unit_price: 1, raw_unit_price: { value: "1", precision: 20 }, is_tax_inclusive: false, requires_shipping: false,
      variant_id: null, tax_lines: [], adjustments: [], compare_at_unit_price: 9007199254740992,
      raw_compare_at_unit_price: { value: "9007199254740993.0000", precision: 20 } }], shipping_methods: [], credit_lines: [] });
  const item = prepareCheckoutOrderData(cart).items[0];
  expect(item?.quantity).toBe(1.25);
  expect(Effect.runSync(encodeNativeExactNumeric(item?.compare_at_unit_price)).value).toBe("9007199254740993.0000");
});
