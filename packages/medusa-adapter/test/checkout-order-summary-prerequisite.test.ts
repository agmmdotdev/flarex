import { Schema } from "effect";
import { expect, it } from "vitest";
import { calculateOrderChange, OrderChangeProcessing } from "@medusajs/order/utils";
import { createRawPropertiesFromBigNumber, decorateCartTotals, MathBN } from "@medusajs/framework/utils/portable";

it("retains the freshly decorated native total when creating the native Order summary", () => {
  const order = decorateCartTotals({ currency_code: "usd", items: [{ quantity: 1,
    unit_price: { value: "9007199254740993.0000", precision: 20 } }] });
  expect(MathBN.convert(order.total).toString()).toBe("9007199254740993");
  const calculated: unknown = Reflect.apply(calculateOrderChange, undefined, [{ order, actions: [], transactions: [] }]);
  createRawPropertiesFromBigNumber(calculated);
  const selected = Schema.decodeUnknownSync(Schema.Struct({ summary: Schema.Struct({
    raw_current_order_total: Schema.Struct({ value: Schema.String }),
  }) }))(calculated);
  expect(MathBN.convert(selected.summary.raw_current_order_total).toString()).toBe("9007199254740993");
});

it("retains independent native calculation state and numeric public Summary presentation", () => {
  const source = { id: "order-native-clone", total: { value: "9007199254740993", precision: 20 }, items: [],
    shipping_methods: [], credit_lines: [], metadata: { nested: { retained: true } } };
  const calc = new OrderChangeProcessing({ order: source, transactions: [], actions: [], options: {} });
  source.total.value = "0";
  source.metadata.nested.retained = false;
  expect(MathBN.convert(calc.getCurrentOrder().total).toString()).toBe("9007199254740993");
  expect(calc.getCurrentOrder().metadata).toEqual({ nested: { retained: true } });
  expect(JSON.parse(JSON.stringify(calc.getSummary()))).toMatchObject({ current_order_total: 9007199254740992 });
});
