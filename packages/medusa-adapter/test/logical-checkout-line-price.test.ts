import { Cause, Effect, Exit, Result, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { prepareCheckoutOrderData } from "@medusajs/core-flows/cart/prepare-checkout-order-data";
import { CheckoutCartView } from "@medusajs/core-flows/common/checkout-query-views";
import { createOrdersStep } from "@medusajs/core-flows/order/create-orders-step";
import { MathBN } from "@medusajs/framework/utils/portable";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { prepareLogicalPaymentCollections } from "./support/logical-payment-collection-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [], cartId = "cart-checkout-exact-price";
const decodeCart = Schema.decodeUnknownSync(Schema.Tuple([CheckoutCartView]));
const decodeResult = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String,
  items: Schema.Tuple([Schema.Struct({ raw_unit_price: Schema.Struct({ value: Schema.String }) })]),
  summary: Schema.Struct({ raw_current_order_total: Schema.Struct({ value: Schema.String }) }) }));

describe("native checkout exact Cart-to-Order line price", () => {
  let local: Awaited<ReturnType<typeof prepareLogicalPaymentCollections>>;
  beforeAll(async () => {
    local = await prepareLogicalPaymentCollections(driver, close => cleanup.push(close), undefined, [
      { table: "cart", row: { id: cartId, currency_code: "usd", metadata: { exact_price: true } } },
      { table: "cart_line_item", row: { id: "cali-checkout-exact-price", cart_id: cartId, title: "Exact digital item",
        quantity: 1, requires_shipping: false, unit_price: "9007199254740993.0000",
        raw_unit_price: { value: "9007199254740993.0000", precision: 20 } } },
    ], [], "completion", "checkout");
  }, 240_000);
  afterAll(async () => { for (const close of cleanup.reverse()) await close(); }, 120_000);

  const prepare = async (late = false) => {
    if (local.checkoutOrder === undefined) throw new Error("Missing selected checkout Order owner");
    const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: local.cart.workflow,
      methods: ["listCarts"], graph: false }, order: { module: local.checkoutOrder.workflow,
      methods: ["createOrders", "deleteOrders"], graph: false } }, true));
    const read = createStep("read-stored-checkout-cart", resources.callback(async (input: { id: string }, { resources }) => {
      const [cart] = decodeCart(await resources.cart.listCarts({ id: input.id }, { select: ["*", "total"] }));
      return new StepResponse(cart);
    }));
    const fail = createStep("fail-after-native-checkout-order", () => { throw new Error("Late failure after exact native Cart-to-Order creation"); });
    const flow = createWorkflow("native-checkout-line-price-" + String(late), (input: WorkflowData<{ id: string }>) => {
      const cart = read(input), data = transform(cart, value => prepareCheckoutOrderData(value));
      const created = createOrdersStep([data]);
      if (late) fail({});
      return new WorkflowResponse(created);
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...local.options,
      modules: { cart: local.modules.cart, order: local.modules.order }, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "nativeCheckoutExactLinePrice-" + String(late), resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Struct({ id: Schema.String }), output: Schema.Array(Schema.JsonObject), events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(host.close)); return host;
  };

  it("creates an Order from the genuine Cart raw price and replays one publication", async () => {
    const host = await prepare(), key = host.newRequestKey(), input = { id: cartId };
    const result = await Effect.runPromise(host.run(key, input)), [first] = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject))(result);
    const order = decodeResult(first);
    expect(MathBN.convert(order.items[0].raw_unit_price).toString()).toBe("9007199254740993");
    expect(MathBN.convert(order.summary.raw_current_order_total).toString()).toBe("9007199254740993");
    const after = await local.snapshot();
    expect(await Effect.runPromise(host.run(key, input))).toEqual(result);
    expect(await local.snapshot()).toEqual(after);
    expect(local.errors).toEqual([]);
  }, 240_000);

  it("rolls back the native Order graph and events after a late failure", async () => {
    const host = await prepare(true), before = await local.snapshot();
    const exit = await Effect.runPromiseExit(host.run(host.newRequestKey(), { id: cartId }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late failure after exact native Cart-to-Order creation");
    expect(await local.snapshot()).toEqual(before);
  }, 240_000);
});
