import { Cause, Effect, Exit, Result, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import { Order } from "@medusajs/order/models";
import { OrderModuleService } from "@medusajs/order/services";
import { formatOrder } from "@medusajs/order/utils";
import { BigNumber, decorateCartTotals } from "@medusajs/framework/utils/portable";
import { orderTotalsFields, includeOrderTotals } from "@medusajs/order/utils/totals-selection";
import { prepareCheckoutOrderData } from "@medusajs/core-flows/cart/prepare-checkout-order-data";
import { CheckoutCartView } from "@medusajs/core-flows/common/checkout-query-views";
import { defineAtomicCommerceParticipant, runCommerceCommand, commerceCommandIdentity, type CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, defaultCommerceResources, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { makeBoundedRequestLifetime } from "../../persistence-postgres/src/execution/preparation/boundedRequestLifetime";
import { makeCommerceCommandContext } from "../../persistence-postgres/src/frameworks/commerceTransaction/context";
import { makeOrderCheckoutCommands } from "../src/modules/order/finance-service";
import { prepareLocalGraph } from "../src/local-graph/query";
import { graphNativeConfiguration } from "../src/local-graph/native-metadata";
import { workflowModuleDefinition } from "../src/workflow/module";
import { captureNativeNumericDto } from "../src/value/native-numeric";
import { mockRelationalRead } from "./mock-relational-read";
import { promiseFailureObserver } from "./support/promise-failure-observer";
import { captureOrderCreationFields } from "../src/modules/order/creation-values";
import { decodeCheckoutOrderCreates } from "../src/modules/order/creation-input";
import { captureCommerceInput } from "../src/value/input";

let order: Effect.Success<ReturnType<typeof makeOrderCheckoutCommands>>;
beforeAll(async () => { order = await Effect.runPromise(makeOrderCheckoutCommands("order-response")); });
const fields = ["id", "status", "summary", "currency_code", "display_id", "custom_display_id", "region_id", "email",
  "total", "subtotal", "tax_total", "discount_total", "discount_subtotal", "discount_tax_total", "original_total", "original_subtotal", "original_tax_total",
  "item_total", "item_subtotal", "item_tax_total", "original_item_total", "original_item_subtotal", "original_item_tax_total",
  "shipping_total", "shipping_subtotal", "shipping_tax_total", "original_shipping_tax_total", "original_shipping_subtotal", "original_shipping_total",
  "credit_line_total", "credit_line_subtotal", "credit_line_tax_total", "created_at", "updated_at", "credit_lines.*", "items.*", "items.tax_lines.*",
  "items.adjustments.*", "items.detail.*", "shipping_address.*", "billing_address.*", "shipping_methods.*", "shipping_methods.tax_lines.*", "shipping_methods.adjustments.*"];

describe("native populated Order public read projection", () => {
  it("admits the actual native populated Cart-to-Order producer including promotion codes and raw credit amounts", () => {
    const cart = Schema.decodeUnknownSync(CheckoutCartView)({ id: "cart-native-order-producer", currency_code: "usd", total: 23.2,
      sales_channel_id: null, email: null, locale: null, metadata: null,
      items: [{ id: "item-native-producer", title: "Native item", quantity: 2, unit_price: 10, variant_id: null,
        requires_shipping: true, is_tax_inclusive: false, tax_lines: [{ code: "VAT", rate: 10 }], adjustments: [{ code: "SAVE", amount: 2 }] }],
      shipping_methods: [{ name: "Standard", description: null, amount: 5, is_tax_inclusive: false, shipping_option_id: "shipping-native",
        data: {}, metadata: null, tax_lines: [{ code: "VAT", rate: 10 }], adjustments: [{ code: "SHIP", amount: 1 }] }],
      credit_lines: [{ amount: 1, raw_amount: { value: "1.0000000000000000000", precision: 20 },
        reference: "credit", reference_id: "native-credit", metadata: null }],
    });
    const native = Result.getOrThrow(captureCommerceInput(prepareCheckoutOrderData(cart)));
    const admitted = Result.getOrThrow(decodeCheckoutOrderCreates([native]));
    expect(admitted).toEqual([native]);
    expect(admitted[0]).toMatchObject({ promo_codes: ["SAVE", "SHIP"],
      credit_lines: [{ amount: 1, raw_amount: { value: "1.0000000000000000000", precision: 20 } }] });
  });
  it("retains the real public schema's flattened targets in native metadata", () => {
    const definition = workflowModuleDefinition(order.workflow);
    if (definition?.graph.native === undefined) throw new Error("Missing genuine Order graph metadata");
    const native = Result.getOrThrow(graphNativeConfiguration(definition.graph.native));
    expect(native.entityRelations.get("Order")?.get("items")).toBe("OrderLineItem");
    expect(native.entityRelations.get("Order")?.get("shipping_methods")).toBe("OrderShippingMethod");
    expect(native.entityRelations.get("OrderLineItem")?.get("detail")).toBe("OrderItem");
    const schema = OrderModuleService.prototype.__joinerConfig().schema;
    expect(schema).toContain("items: [OrderLineItem]");
    expect(schema).toContain("shipping_methods: [OrderShippingMethod]");
    expect(schema).toContain("detail: OrderItem!");
  });
  it("forwards native default local completion fields through the real Order command to storage", async () => {
    const definition = workflowModuleDefinition(order.workflow);
    if (definition === undefined) throw new Error("Missing genuine Order module");
    const graph = Result.getOrThrow(prepareLocalGraph([{ participant: defineAtomicCommerceParticipant("orderCheckoutQueryProof"), module: definition.graph }]));
    const calls: Array<{ name: string | undefined; args: Json }> = [], reached = new Error("Reached checked native Order storage");
    const exit = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
      const lifetime = yield* Effect.acquireRelease(makeBoundedRequestLifetime(commerceError, commerceLimits, {}, {}, "order-checkout-query-proof", "read"), owner => owner.close);
      const unavailable = () => Effect.fail(commerceError("resourceFailure", reached));
      const store: CommerceCommandContext["store"] = { prepareRead(query) { return mockRelationalRead(this, query); },
        findPage: unavailable, aggregate: unavailable, find: unavailable, count: unavailable, write: unavailable, delete: unavailable, lifecycle: unavailable };
      const ctx = makeCommerceCommandContext(lifetime, { store, resources: defaultCommerceResources, table: () => Effect.succeed(store) },
        "order-checkout-query-proof", lifetime.context, unavailable, unavailable);
      return yield* graph.bind({ refuse: Effect.fail, recordFailure: promiseFailureObserver(), call: (_participant, command, args) => {
        calls.push({ name: commerceCommandIdentity(command)?.name, args }); return runCommerceCommand(command, ctx, args);
      } }).remoteQuery({ entryPoint: "order", fields, variables: { id: "order-checkout-proof" } });
    })));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause), JSON.stringify(calls)).toContain(reached.message);
    expect(calls[0]?.name).toBe("orderPaymentFinanceOrders");
  });
  it("uses the native formatter to flatten both populated wrappers and calculate their actual totals", async () => {
    const raw = (value: string) => ({ value, precision: 20 });
    const presented = await Effect.runPromise(order.prepared.contracts.present([{
      id: "order-native-shape", currency_code: "usd", status: "pending",
      items: [{ id: "order-item-native", order_id: "order-native-shape", item_id: "line-native", quantity: "2", raw_quantity: raw("2"),
        item: { id: "line-native", title: "Shipped item", requires_shipping: true, unit_price: "10", raw_unit_price: raw("10"),
          tax_lines: [{ id: "item-tax-native", item_id: "line-native", code: "VAT", rate: "10", raw_rate: raw("10") }],
          adjustments: [{ id: "item-adjust-native", item_id: "line-native", code: "SAVE", amount: "2", raw_amount: raw("2") }] } }],
      shipping_methods: [{ id: "shipping-native", order_id: "order-native-shape", shipping_method_id: "method-native",
        shipping_method: { id: "method-native", name: "Standard", amount: "5", raw_amount: raw("5"),
          tax_lines: [{ id: "shipping-tax-native", shipping_method_id: "method-native", code: "VAT", rate: "10", raw_rate: raw("10") }],
          adjustments: [{ id: "shipping-adjust-native", shipping_method_id: "method-native", code: "SHIP", amount: "1", raw_amount: raw("1") }] } }],
      credit_lines: [{ id: "credit-native", order_id: "order-native-shape", amount: "1", raw_amount: raw("1") }],
    }], "order"));
    const native = Result.getOrThrow(captureNativeNumericDto(formatOrder(presented, { entity: Order, includeTotals: true })));
    expect(native).toMatchObject([{ total: 23.2, subtotal: 25, tax_total: 2.2,
      items: [{ id: "line-native", quantity: 2, tax_lines: [{ rate: 10 }], adjustments: [{ amount: 2 }], detail: { id: "order-item-native" } }],
      shipping_methods: [{ id: "method-native", order_id: "order-native-shape", tax_lines: [{ rate: 10 }], adjustments: [{ amount: 1 }] }] }]);
  });
  it("keeps the exported native total trigger array isolated between preparations", () => {
    const names = orderTotalsFields(); names.splice(0);
    expect(orderTotalsFields()).toContain("credit_line_total");
    const config = { select: ["credit_line_total"] };
    expect(includeOrderTotals(config)).toBe(true);
    expect(config.select).toEqual([]);
  });
  it("captures the actual native computed tax and adjustment DTOs as their declared creation scalars", async () => {
    const itemTax = { code: "VAT", rate: 10 }, methodTax = { code: "VAT", rate: 10 },
      itemAdjustment = { amount: 2, code: "SAVE" }, methodAdjustment = { amount: 1, code: "SHIP" };
    decorateCartTotals({ currency_code: "usd", items: [{ quantity: 2, unit_price: 10, tax_lines: [itemTax], adjustments: [itemAdjustment] }],
      shipping_methods: [{ amount: 5, tax_lines: [methodTax], adjustments: [methodAdjustment] }] });
    for (const [table, native, scalar, value] of [
      ["order_line_item_tax_line", itemTax, "rate", "10"], ["order_shipping_method_tax_line", methodTax, "rate", "10"],
      ["order_line_item_adjustment", itemAdjustment, "amount", "2"], ["order_shipping_method_adjustment", methodAdjustment, "amount", "1"],
    ] as const) {
      expect(Object.keys(native)).toContain("total");
      const output = await Effect.runPromise(captureOrderCreationFields(native, table, "checkout").pipe(
        Effect.flatMap(row => order.prepared.contracts.normalize(row, table))));
      const expected = new BigNumber(value).raw;
      expect(output).toMatchObject({ [scalar]: expected?.value, ["raw_" + scalar]: expected });
      expect(Object.keys(output)).not.toContain("total");
      expect(Object.keys(output)).not.toContain("subtotal");
    }
  });
});
