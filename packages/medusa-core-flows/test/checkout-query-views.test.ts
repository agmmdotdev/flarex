import { Result } from "effect";
import { describe, expect, it } from "vitest";
import { completeCartFields } from "../src/cart/utils/fields";
import { decodeCheckoutGraphRows } from "../src/common/steps/checkout-query-views";
import { decodeCheckoutCreatedOrders, decodeCheckoutPreparedAdjustments, decodeCheckoutPreparedLineItem } from "../src/common/steps/checkout-order-view";
import { queryWorkflowGraph, type WorkflowGraphResource } from "../src/common/steps/use-query-graph";

const cartQuery = { entity: "cart", fields: completeCartFields,
  filters: { id: "cart-checked" }, options: { isList: false } } as const;
const cart = { id: "cart-checked", currency_code: "usd", sales_channel_id: null,
  email: null, locale: null, metadata: null, total: 1,
  items: [{ id: "cali-checked", title: "Digital item", quantity: 1, unit_price: 1,
    raw_unit_price: { value: "1.0000", precision: 20 }, is_tax_inclusive: false,
    requires_shipping: false, variant_id: null, tax_lines: [], adjustments: [] }],
  shipping_methods: [], credit_lines: [], genuine_extra: { selected: true } };

describe("native checkout consumed query views", () => {
  it("preserves actual selected JSON and raw amounts without requiring unselected relations", () => {
    expect(Result.getOrThrow(decodeCheckoutGraphRows(cartQuery, [cart]))).toEqual([cart]);
  });

  it("refuses malformed consumed Cart fields and missing or duplicate singleton rows", () => {
    for (const rows of [[], [cart, cart], [{ ...cart, items: [{ ...cart.items[0], raw_unit_price: { value: 1, precision: 20 } }] }]]) {
      expect(Result.isFailure(decodeCheckoutGraphRows(cartQuery, rows))).toBe(true);
    }
  });

  it("keeps dynamic selections partial rather than applying the complete checkout view", () => {
    const query = { ...cartQuery, fields: ["id"] };
    expect(Result.getOrThrow(decodeCheckoutGraphRows(query, [{ id: cart.id }]))).toEqual([{ id: cart.id }]);
  });

  it("checks native optional Order-Cart cardinality and every selected Link field", () => {
    const query = { entity: "order_cart", fields: ["cart_id", "order_id"],
      filters: { cart_id: cart.id }, options: { isList: false } };
    const link = { cart_id: cart.id, order_id: "order-checked" };
    expect(Result.getOrThrow(decodeCheckoutGraphRows(query, []))).toEqual([]);
    expect(Result.getOrThrow(decodeCheckoutGraphRows(query, [link]))).toEqual([link]);
    for (const rows of [[link, link], [{ cart_id: cart.id }], [{ ...link, unexpected: true }]]) {
      expect(Result.isFailure(decodeCheckoutGraphRows(query, rows))).toBe(true);
    }
  });

  it("checks Shipping Option projection and preserves bounded graph completeness", async () => {
    const query = { entity: "shipping_option", fields: ["id", "shipping_profile_id"],
      filters: { id: [] }, options: { cache: { enable: true } } };
    expect(Result.getOrThrow(decodeCheckoutGraphRows(query, []))).toEqual([]);
    expect(Result.isFailure(decodeCheckoutGraphRows(query, [{ id: "so-checked" }]))).toBe(true);
    const graph: WorkflowGraphResource = { maxPageSize: 10,
      graph: async () => ({ data: [cart], metadata: { count: 2, skip: 0, take: 10 } }) };
    await expect(queryWorkflowGraph(cartQuery, graph)).rejects.toThrow("complete bounded result");
  });

  it("checks native created Order fields while preserving nullable variant and genuine output fields", () => {
    const order = { id: "order-checked", items: [{ id: "ordli-checked", quantity: 1, variant_id: null,
      raw_unit_price: { value: "9007199254740993", precision: 20 } }], summary: { current_order_total: 1 } };
    expect(decodeCheckoutCreatedOrders([order])).toEqual([order]);
    expect(() => decodeCheckoutCreatedOrders([{ ...order, items: [{ id: "ordli-checked", quantity: 1 }] }])).toThrow();
    expect(() => decodeCheckoutCreatedOrders([{ ...order, items: [{ ...order.items[0], quantity: Infinity }] }])).toThrow();
  });

  it("checks consumed native helper results and retains exact raw and own undefined fields", () => {
    const item = { title: "Digital item", quantity: 1,
      unit_price: { value: "9007199254740993.0000", precision: 20 }, variant_id: undefined,
      adjustments: [{ code: undefined, amount: { value: "0.0000", precision: 20 }, provider_id: undefined }] };
    const decoded = decodeCheckoutPreparedLineItem(item);
    expect(decoded).toEqual(item);
    expect(Object.hasOwn(decoded, "variant_id")).toBe(true);
    const [adjustment] = decoded.adjustments;
    if (adjustment === undefined) throw new Error("Missing prepared adjustment");
    expect(Object.hasOwn(adjustment, "provider_id")).toBe(true);
    expect(() => decodeCheckoutPreparedLineItem({ ...item, unit_price: { value: 1, precision: 20 } })).toThrow();
    expect(() => decodeCheckoutPreparedLineItem({ ...item, adjustments: [{ code: {} }] })).toThrow();
    expect(() => decodeCheckoutPreparedAdjustments([{ code: {} }])).toThrow();
  });
});
