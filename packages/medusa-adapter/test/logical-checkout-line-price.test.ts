import { Cause, Effect, Exit, Result, Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createStep, createWorkflow, StepResponse, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { prepareCheckoutOrderData } from "@medusajs/core-flows/cart/prepare-checkout-order-data";
import { CheckoutCartView } from "@medusajs/core-flows/common/checkout-query-views";
import { createOrdersStep } from "@medusajs/core-flows/order/create-orders-step";
import { MathBN } from "@medusajs/framework/utils/portable";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareWorkflowResources } from "../src/workflow/resources";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import * as creationReceipt from "../src/modules/order/creation-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";
import { prepareCoreCartOrderFixture } from "./support/core-cart-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [], cartId = "cart-checkout-exact-price";
const exactAmount = "9007199254740993";
const raw = Schema.Struct({ value: Schema.String, precision: Schema.Finite });
const createdOrders = Schema.Array(Schema.JsonObject);
const decodeCart = Schema.decodeUnknownSync(Schema.Tuple([CheckoutCartView]));
const decodeResult = Schema.decodeUnknownSync(Schema.Tuple([Schema.Struct({ id: Schema.String,
  items: Schema.Tuple([Schema.Struct({ id: Schema.String, raw_unit_price: raw })]),
  summary: Schema.Struct({ raw_current_order_total: raw }) })]));
const decodeLine = Schema.decodeUnknownSync(Schema.Struct({ id: Schema.String, unit_price: Schema.String, raw_unit_price: raw }));
const decodeSummary = Schema.decodeUnknownSync(Schema.Struct({ order_id: Schema.String,
  totals: Schema.Struct({ current_order_total: Schema.Finite, raw_current_order_total: raw }) }));

describe("native checkout exact Cart-to-Order line price", () => {
  let local: Awaited<ReturnType<typeof prepareCoreCartOrderFixture>>;
  const accepted: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1] }> = [];
  const readCarts: (typeof CheckoutCartView.Type)[] = [];
  const original = creationReceipt.validateCheckoutOrderCreation;
  let failedOrderId: string | undefined;
  beforeAll(async () => {
    vi.spyOn(creationReceipt, "validateCheckoutOrderCreation").mockImplementation(prepared => {
      const validate = original(prepared);
      return Effect.fn("CheckoutPrice.observeAcceptedReceipt")(function* (call, activity) {
        yield* validate(call, activity);
        accepted.push({ call, activity });
      });
    });
    local = await prepareCoreCartOrderFixture(driver, close => cleanup.push(close), [
      { table: "cart", row: { id: cartId, currency_code: "usd", metadata: { exact_price: true } } },
      { table: "cart_line_item", row: { id: "cali-checkout-exact-price", cart_id: cartId, title: "Exact digital item",
        quantity: 1, requires_shipping: false, unit_price: "9007199254740993.0000",
        raw_unit_price: { value: "9007199254740993.0000", precision: 20 } } },
    ]);
  }, 240_000);
  afterAll(() => { vi.restoreAllMocks(); return finishOrderFixture(cleanup.reverse()); }, 120_000);

  const prepare = async (late = false) => {
    const resources = Result.getOrThrow(prepareWorkflowResources({ cart: { module: local.cart.workflow,
      methods: ["listCarts"], graph: false }, order: { module: local.order.workflow,
      methods: ["createOrders", "deleteOrders"], graph: false } }, true));
    const read = createStep("read-stored-checkout-cart", resources.callback(async (input: { id: string }, { resources }) => {
      const [cart] = decodeCart(await resources.cart.listCarts({ id: input.id }, { select: ["*", "total"] }));
      readCarts.push(cart);
      return new StepResponse(cart);
    }));
    const fail = createStep("fail-after-native-checkout-order", (created: typeof createdOrders.Type) => {
      const [order] = decodeResult(created);
      const receipt = accepted.at(-1);
      if (receipt?.call.commandName !== "orderCreateForCheckout" || decodeResult(receipt.call.result)[0].id !== order.id)
        throw new Error("Missing accepted receipt for the created Order");
      failedOrderId = order.id;
      throw new Error("Late failure after exact native Cart-to-Order creation");
    });
    const flow = createWorkflow("native-checkout-line-price-" + String(late), (input: WorkflowData<{ id: string }>) => {
      const cart = read(input), data = transform(cart, value => prepareCheckoutOrderData(value));
      const created = createOrdersStep([data]);
      if (late) fail(created);
      return new WorkflowResponse(created);
    });
    const host = await Effect.runPromise(prepareAtomicWorkflowHost({ ...local.options,
      modules: local.modules,
      workflow: { name: "nativeCheckoutExactLinePrice-" + String(late), resources, prepared: Result.getOrThrow(flow.prepare()),
        input: Schema.Struct({ id: Schema.String }), output: createdOrders, events: internalModuleWorkflowEvents } }));
    cleanup.push(() => Effect.runPromise(host.close)); return host;
  };

  it("creates an Order from the genuine Cart raw price and replays one publication", async () => {
    const host = await prepare(), key = host.newRequestKey(), input = { id: cartId };
    const before = await local.snapshot(), start = accepted.length, reads = readCarts.length;
    const result = await Effect.runPromise(host.run(key, input)), [order] = decodeResult(result);
    expect(readCarts.slice(reads)).toMatchObject([{ id: cartId, shipping_methods: [], credit_lines: [],
      items: [{ unit_price: 9_007_199_254_740_992, raw_unit_price: { value: exactAmount } }] }]);
    expect(MathBN.convert(order.items[0].raw_unit_price).toString()).toBe(exactAmount);
    expect(MathBN.convert(order.summary.raw_current_order_total).toString()).toBe(exactAmount);
    const after = await local.snapshot();
    const outcome = after.outcomes.find(record => record.value.key === key);
    if (outcome === undefined) throw new Error("Missing committed Cart-to-Order outcome");
    expect(outcome.value).toMatchObject({ kind: "nativeRoot", state: "committed" });
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(after.rows.length - before.rows.length).toBe(4);
    expect(after.revisions.length - before.revisions.length).toBe(4);
    const revisions = after.revisions.filter(row => row.timestamp === outcome.timestamp);
    const tableName = (table: string) => local.orderDefinition.tables.find(declaration => declaration.name === table)?.localName;
    expect(revisions.map(row => tableName(row.table)).sort()).toEqual(["order", "order_item", "order_line_item", "order_summary"]);
    for (const revision of revisions) {
      expect(revision).toMatchObject({ previous: null, deleted: false });
      expect(after.rows).toContainEqual({ table: revision.table, timestamp: outcome.timestamp, value: revision.value });
      expect(after.indexes).toContainEqual(expect.objectContaining({ table: revision.table, name: "by_id",
        id: revision.id, timestamp: outcome.timestamp }));
    }
    expect(after.rows.filter(row => tableName(row.table) === undefined)).toEqual(before.rows);
    const line = decodeLine(revisions.find(row => tableName(row.table) === "order_line_item")?.value);
    expect(line.id).toBe(order.items[0].id);
    expect(MathBN.convert(line.unit_price).toString()).toBe(exactAmount);
    expect(MathBN.convert(line.raw_unit_price).toString()).toBe(exactAmount);
    const summary = decodeSummary(revisions.find(row => tableName(row.table) === "order_summary")?.value);
    expect(summary.order_id).toBe(order.id);
    // Summary.totals is native JSON. The raw companion retains the complete
    // amount alongside the native numeric presentation.
    expect(summary.totals.current_order_total).toBe(9_007_199_254_740_992);
    expect(MathBN.convert(summary.totals.raw_current_order_total).toString()).toBe(exactAmount);
    const events = after.events.filter(event => event.timestamp === outcome.timestamp);
    expect(after.families.length - before.families.length).toBe(1);
    expect(new Set(events.map(event => event.familyId)).size).toBe(1);
    expect(after.events.length - before.events.length).toBe(4);
    expect(events.map(event => event.envelope.contract)).toEqual([
      "order.order.created", "order.order-summary.created", "order.order-line-item.created", "order.order-item.created",
    ]);
    expect(accepted.slice(start)).toMatchObject([{ call: { commandName: "orderCreateForCheckout", toAttempt: 4 } }]);
    await Effect.runPromise(host.close);
    const reopened = await prepare();
    expect(await Effect.runPromise(reopened.run(key, input))).toEqual(result);
    expect(await local.snapshot()).toEqual(after);
    expect(accepted).toHaveLength(start + 1);
    expect(readCarts).toHaveLength(reads + 1);
  }, 240_000);

  it("rolls back the native Order graph and events after a late failure", async () => {
    const host = await prepare(true), key = host.newRequestKey(), before = await local.fixture.inventory();
    const start = accepted.length;
    const exit = await Effect.runPromiseExit(host.run(key, { id: cartId }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late failure after exact native Cart-to-Order creation");
    const packets = accepted.slice(start);
    expect(packets).toHaveLength(1);
    const [packet] = packets;
    if (packet === undefined || failedOrderId === undefined) throw new Error("Missing accepted Order receipt or dependent failure");
    expect(packet.call).toMatchObject({ commandName: "orderCreateForCheckout", mode: "write", result: [{ id: failedOrderId }], toAttempt: 4 });
    expect(packet.activity.mutations.map(mutation => [mutation.operation, mutation.table])).toEqual([
      ["insert", "order"], ["insert", "order_summary"], ["insert", "order_line_item"], ["insert", "order_item"],
    ]);
    const after = await local.fixture.inventory();
    // A failed request-control record fences the key. Business rows, history,
    // indexes and all event storage remain identical.
    expect(after.outcomes.filter(record => record.value.key === key)).toMatchObject([
      { value: { kind: "nativeRoot", state: "failed" } },
    ]);
    expect({ ...after, outcomes: after.outcomes.filter(record => record.value.key !== key) }).toEqual(before);
  }, 240_000);
});
