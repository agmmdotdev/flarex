import { appendFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { decodeCartRootCreates, decodeCartCreationResult } from "../src/modules/cart/creation-input";
import { decodePromotionComputeInput, decodePromotionComputedActions } from "../src/modules/promotion/compute-input";
import { decodeGraphCount, decodeGraphList } from "../src/local-graph/query";
import { CreateCartOutput, prepareCreateCartWorkflow } from "../src/workflows/cart/create-cart";
import { cartCreateRootSeeds } from "./support/cart-create-root-seeds";
import { prepareLogicalCartCreateRoot } from "./support/logical-cart-create-root-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareLogicalCartCreateRoot>>;
beforeAll(async () => { connected = await prepareLogicalCartCreateRoot(driver, close => cleanup.push(close), {
  seeds: cartCreateRootSeeds, onPhase: phase => {
    if (process.env.FLAREX_CART_CREATE_SETUP_TRACE !== undefined) appendFileSync(process.env.FLAREX_CART_CREATE_SETUP_TRACE, JSON.stringify({ at: Date.now(), phase }) + "\n");
  },
}); }, 600_000);
afterAll(async () => {
  try { if (process.env.FLAREX_CART_CREATE_CALL_TRACE !== undefined && typeof connected !== "undefined")
    writeFileSync(process.env.FLAREX_CART_CREATE_CALL_TRACE, JSON.stringify(connected.traces, null, 2));
  } finally { for (const close of cleanup.reverse()) await close(); }
}, 60_000);

it("creates an actual native Cart through all direct children, retaining Store defaults and the original result", async () => {
  const request = connected.host.newRequestKey(), created = await Effect.runPromise(connected.host.run(request, {}));
  expect(created).toMatchObject({ region_id: "reg-create-root", sales_channel_id: "sc-create-root", currency_code: "usd", items: [], shipping_methods: [] });
  const result = Schema.decodeUnknownSync(CreateCartOutput)(created);
  const rows = await connected.rows(), cart = rows.find(row => row.id === result.id);
  expect(cart).toMatchObject({ region_id: "reg-create-root", sales_channel_id: "sc-create-root", currency_code: "usd" });
  expect(rows.find(row => row.id === cart?.shipping_address_id)).toMatchObject({ country_code: "us" });
  const before = await connected.snapshot();
  expect(before.events.filter(event => !event.envelope.internal && event.envelope.contract === "cart.created")).toEqual([expect.objectContaining({ envelope: expect.objectContaining({ message: expect.objectContaining({ data: { id: result.id } }) }) })]);
  expect(rows.some(row => typeof row.id === "string" && row.id.startsWith("paycol_"))).toBe(false);
  expect(rows.some(row => typeof row.payment_collection_id === "string")).toBe(false);
  const replay = await Effect.runPromise(connected.host.run(request, {}));
  expect(replay).toEqual(created);
  expect(await connected.snapshot()).toEqual(before);
}, 120_000);

it("creates exact manual pricing and genuine System Tax rows without replacing the native Cart result", async () => {
  const created = await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), { items: [{ title: "Exact manual",
    quantity: 1, unit_price: "9007199254740993.1250", requires_shipping: false, is_discountable: false }] }));
  const result = Schema.decodeUnknownSync(CreateCartOutput)(created);
  expect(result.items).toEqual([]);
  const rows = await connected.rows(), line = rows.find(row => row.cart_id === result.id && row.title === "Exact manual");
  expect(line).toMatchObject({ raw_unit_price: { value: "9007199254740993.1250", precision: 20 }, quantity: 1 });
  expect(rows.find(row => row.item_id === line?.id && row.tax_rate_id === "txr-create-root")).toMatchObject({ rate: 10, code: "NATIVE-US" });
}, 120_000);

it("combines actual Product pricing, Customer groups, Inventory confirmation, Tax and automatic Promotion", async () => {
  const before = await connected.rows(), created = await Effect.runPromise(connected.host.run(connected.host.newRequestKey(), {
    customer_id: "cus-create-root", promo_codes: ["NATIVE-CART"], additional_data: { trace: "native-root-transients" }, items: [{ variant_id: "variant-create-root", quantity: 2 }],
  }));
  const result = Schema.decodeUnknownSync(CreateCartOutput)(created);
  expect(result).toMatchObject({ customer_id: "cus-create-root", email: "native-cart@example.com", items: [] });
  const rows = await connected.rows(), line = rows.find(row => row.cart_id === result.id && row.variant_id === "variant-create-root");
  expect(line).toMatchObject({ product_id: "prod-create-root", title: "Native Cart Product", quantity: 2, raw_unit_price: { value: "12.500000000000000000", precision: 20 } });
  expect(rows.find(row => row.item_id === line?.id && row.tax_rate_id === "txr-create-root")).toMatchObject({ rate: 10 });
  expect(rows.find(row => row.item_id === line?.id && row.promotion_id === "promo-create-root")).toMatchObject({ raw_amount: { value: "1.0000000000000000000", precision: 20 }, code: "NATIVE-CART" });
  expect(rows.find(row => row.cart_id === result.id && row.promotion_id === "promo-create-root")).toBeDefined();
  const cartDtos = connected.traces.filter(trace => trace.call.commandName === "cartCountForCheckout")
    .flatMap(trace => Result.getOrThrow(decodeGraphCount(trace.call.result))[0]);
  expect(cartDtos.findLast(row => row.id === result.id)).toMatchObject({ items: [{
    raw_unit_price: { value: "12.5", precision: 20 }, raw_subtotal: { value: "25", precision: 20 },
  }] });
  const adjustmentDtos = connected.traces.filter(trace => trace.call.commandName === "cartAddItemAdjustmentsForCreation")
    .flatMap(trace => Result.getOrThrow(decodeGraphList(trace.call.result)));
  expect(adjustmentDtos.find(row => row.item_id === line?.id)).toMatchObject({ amount: 1, raw_amount: { value: "1", precision: 20 } });
  expect(rows.find(row => row.id === "ilev-create-root")).toEqual(before.find(row => row.id === "ilev-create-root"));
}, 120_000);

it("refuses insufficient stock and invalid quantity before creating any Cart rows", async () => {
  for (const quantity of [4, 0]) {
    const before = await connected.snapshot(), result = await Effect.runPromiseExit(connected.host.run(connected.host.newRequestKey(), {
      items: [{ variant_id: "variant-create-root", quantity }],
    }));
    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) expect(Cause.pretty(result.cause)).toContain(quantity === 0
      ? "Item quantity must be greater than 0" : "Some variant does not have the required inventory");
    expect(await connected.snapshot()).toEqual(before);
  }
}, 120_000);

it("rolls back native Cart, Addresses, Tax and Promotion writes after a genuine late cartCreated failure", async () => {
  let reached = 0;
  const host = await Effect.runPromise(prepareCreateCartWorkflow({ ...connected.configuration, hooks: { cartCreated: () => {
    reached++; throw new Error("Late native Cart creation failure");
  } } }));
  cleanup.push(() => Effect.runPromise(host.close));
  const before = await connected.snapshot(), result = await Effect.runPromiseExit(host.run(host.newRequestKey(), {
    email: "fresh-native-guest@example.com", items: [{ title: "Late native manual", quantity: 1, unit_price: "12.5", requires_shipping: false }],
  }));
  expect(Exit.isFailure(result)).toBe(true);
  expect(reached).toBe(1);
  const creation = connected.traces.filter(trace => trace.call.commandName === "cartCreateWithOwnership").findLast(trace =>
    Result.getOrThrow(decodeCartRootCreates(trace.call.input)).some(cart => cart.email === "fresh-native-guest@example.com"));
  if (creation === undefined) throw new Error("Missing genuine late Cart creation call");
  const lateCart = Schema.decodeUnknownSync(CreateCartOutput)(Result.getOrThrow(decodeCartCreationResult(creation.call.result)).carts[0]);
  const compute = connected.traces.filter(trace => trace.call.commandName === "promotionComputeActions").findLast(trace =>
    Schema.decodeUnknownSync(CreateCartOutput)(Result.getOrThrow(decodePromotionComputeInput(trace.call.input)).context).id === lateCart.id);
  if (compute === undefined) throw new Error("Missing genuine automatic Promotion call");
  expect(Result.getOrThrow(decodePromotionComputeInput(compute.call.input)).codes).toEqual([]);
  const action = Result.getOrThrow(decodePromotionComputedActions(compute.call.result)).find(action => action.action === "addItemAdjustment");
  if (action?.action !== "addItemAdjustment") throw new Error("Missing genuine automatic adjustment action");
  expect(connected.traces.some(trace => trace.call.commandName === "cartAddItemAdjustmentsForCreation" &&
    trace.activity.mutations.some(mutation => mutation.table === "cart_line_item_adjustment" && mutation.operation === "insert" && mutation.after?.item_id === action.item_id))).toBe(true);
  expect(connected.traces.some(trace => trace.call.commandName === "cartPromotionApplyPreimages" &&
    trace.activity.mutations.some(mutation => mutation.table === "cart_promotion" && mutation.operation === "insert" && mutation.after?.cart_id === lateCart.id && mutation.after.promotion_id === "promo-create-root"))).toBe(true);
  expect(await connected.snapshot()).toEqual(before);
}, 120_000);
