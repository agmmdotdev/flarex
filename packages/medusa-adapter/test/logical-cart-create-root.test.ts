import { appendFileSync, writeFileSync } from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { linkPairRevisionId, LinkPairRevisionRecordSchema, LinkPreimageOperationRecordSchema } from "@medusajs/link-modules";
import { defineAtomicCommerceNativeSource } from "../../persistence-postgres/src/frameworks/atomicCommerce/nativeSelection";
import { decodeCartRootCreates, decodeCartCreationResult } from "../src/modules/cart/creation-input";
import { decodePromotionComputeInput, decodePromotionComputedActions } from "../src/modules/promotion/compute-input";
import { decodeGraphCount, decodeGraphList } from "../src/local-graph/query";
import { projectNativeRow } from "../src/repository/result";
import { CreateCartOutput, prepareCreateCartWorkflow } from "../src/workflows/cart/create-cart";
import { cartCreateRootSeeds } from "./support/cart-create-root-seeds";
import { prepareCoreCartCreateRoot } from "./support/core-cart-create-root-fixture";
import { finishOrderFixture } from "./support/core-order-fixture";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const cleanup: Array<() => Promise<void>> = [];
let connected: Awaited<ReturnType<typeof prepareCoreCartCreateRoot>>;
const decodeId = Schema.decodeUnknownSync(Schema.String);
const decodeOperation = Schema.decodeUnknownSync(LinkPreimageOperationRecordSchema, { onExcessProperty: "error" });
const decodePairRevision = Schema.decodeUnknownSync(LinkPairRevisionRecordSchema, { onExcessProperty: "error" });
beforeAll(async () => { connected = await prepareCoreCartCreateRoot(driver, close => cleanup.push(close), {
  seeds: cartCreateRootSeeds, onPhase: phase => {
    if (process.env.FLAREX_CART_CREATE_SETUP_TRACE !== undefined) appendFileSync(process.env.FLAREX_CART_CREATE_SETUP_TRACE, JSON.stringify({ at: Date.now(), phase }) + "\n");
  },
}); }, 600_000);
afterAll(async () => {
  try { if (process.env.FLAREX_CART_CREATE_CALL_TRACE !== undefined && typeof connected !== "undefined")
    writeFileSync(process.env.FLAREX_CART_CREATE_CALL_TRACE, JSON.stringify(connected.traces, null, 2));
  } finally { await finishOrderFixture(cleanup.reverse()); }
}, 60_000);

it("creates the native default Cart and recovers its original result after lost acknowledgement", async () => {
  let callbacks = 0;
  const options = { ...connected.configuration, hooks: { cartCreated: () => { callbacks++; } } };
  const host = await Effect.runPromise(prepareCreateCartWorkflow(options));
  cleanup.push(() => Effect.runPromise(host.close));
  const request = host.newRequestKey(), fault = connected.fixture.loseNextNativeRootAcknowledgement();
  const created = await Effect.runPromise(host.run(request, {}));
  expect(fault).toMatchObject({ armed: false, failures: 1 });
  expect(typeof fault.evidence?.timestamp).toBe("bigint");
  expect(callbacks).toBe(1);
  expect(created).toMatchObject({ region_id: "reg-create-root", sales_channel_id: "sc-create-root", currency_code: "usd", items: [], shipping_methods: [] });
  const result = Schema.decodeUnknownSync(CreateCartOutput)(created);
  const before = await connected.snapshot(), rows = await connected.rows();
  const cartTable = connected.fixture.sources.find(source => source.definition.identity.sourceKey === "medusa.cart")
    ?.definition.tables.find(table => table.localName === "cart");
  if (cartTable === undefined) throw new Error("Missing genuine Core Cart table");
  const cart = before.rows.find(row => row.table === cartTable.name && row.value.id === result.id)?.value;
  expect(cart).toMatchObject({ region_id: "reg-create-root", sales_channel_id: "sc-create-root", currency_code: "usd" });
  expect(rows.find(row => row.id === cart?.shipping_address_id)).toMatchObject({ country_code: "us" });
  expect(before.events.filter(event => !event.envelope.internal && event.envelope.contract === "cart.created")).toEqual([expect.objectContaining({ envelope: expect.objectContaining({ message: expect.objectContaining({ data: { id: result.id } }) }) })]);
  expect(rows.some(row => typeof row.id === "string" && row.id.startsWith("paycol_"))).toBe(false);
  expect(rows.some(row => typeof row.payment_collection_id === "string")).toBe(false);
  expect(before.outcomes).toContainEqual(expect.objectContaining({ timestamp: fault.evidence?.timestamp,
    value: expect.objectContaining({ key: request, kind: "nativeRoot", state: "committed" }) }));
  expect(before.families.filter(family => family.timestamp === fault.evidence?.timestamp)).toHaveLength(1);
  const reopened = await Effect.runPromise(prepareCreateCartWorkflow(options));
  cleanup.push(() => Effect.runPromise(reopened.close));
  const replay = await Effect.runPromise(reopened.run(request, {}));
  expect(replay).toEqual(created);
  expect(await connected.snapshot()).toEqual(before);
  expect(callbacks).toBe(1);
}, 240_000);

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
  const before = await connected.rows(), from = connected.traces.length, key = connected.host.newRequestKey();
  const created = await Effect.runPromise(connected.host.run(key, {
    customer_id: "cus-create-root", promo_codes: ["NATIVE-CART"], additional_data: { trace: "native-root-transients" }, items: [{ variant_id: "variant-create-root", quantity: 2 }],
  }));
  const result = Schema.decodeUnknownSync(CreateCartOutput)(created);
  expect(result).toMatchObject({ customer_id: "cus-create-root", email: "native-cart@example.com", items: [] });
  const rows = await connected.rows(), line = rows.find(row => row.cart_id === result.id && row.variant_id === "variant-create-root");
  expect(line).toMatchObject({ product_id: "prod-create-root", title: "Native Cart Product", quantity: 2, requires_shipping: true,
    raw_unit_price: { value: "12.500000000000000000", precision: 20 } });
  const tax = rows.find(row => row.item_id === line?.id && row.tax_rate_id === "txr-create-root");
  const adjustment = rows.find(row => row.item_id === line?.id && row.promotion_id === "promo-create-root");
  const link = rows.find(row => row.cart_id === result.id && row.promotion_id === "promo-create-root");
  expect(tax).toMatchObject({ rate: 10 });
  expect(adjustment).toMatchObject({ raw_amount: { value: "1.0000000000000000000", precision: 20 }, code: "NATIVE-CART" });
  if (line === undefined || tax === undefined || adjustment === undefined || link === undefined) throw new Error("Missing native Cart rows");
  const linkId = decodeId(link.id);
  const traces = connected.traces.slice(from);
  const profile = traces.find(trace => trace.call.commandName === "shippingProfileCountForCheckout");
  expect(profile?.activity.observedRows).toContainEqual(expect.objectContaining({ table: "shipping_profile",
    row: expect.objectContaining({ id: "sp-create-root" }) }));
  expect(traces.some(trace => trace.call.commandName === "shippingOptionCountForCheckout")).toBe(false);
  const applied = traces.findIndex(trace => trace.call.commandName === "cartPromotionApplyPreimages");
  const apply = traces[applied];
  if (apply === undefined) throw new Error("Missing native Cart Promotion operation");
  expect(traces.slice(0, applied).some(trace => trace.call.commandName === "cartPromotionCount" &&
    Result.getOrThrow(decodeGraphCount(trace.call.result))[1] === 0)).toBe(true);
  expect(apply.activity.observedRows).toContainEqual(expect.objectContaining({ table: "cart_promotion",
    row: expect.objectContaining({ id: linkId, cart_id: result.id, promotion_id: "promo-create-root" }) }));
  const receipt = apply.activity.mutations.find(mutation => mutation.table === "link_workflow_operation")?.after;
  if (receipt === undefined || receipt === null) throw new Error("Missing native Cart Promotion receipt");
  const operation = decodeOperation(projectNativeRow(receipt));
  expect(operation.state).toBe("applied");
  const [change] = operation.changes;
  expect(operation.changes).toHaveLength(1);
  expect(change).toMatchObject({ primary: result.id, foreign: "promo-create-root", before: null,
    after: { id: linkId, created_at: decodeId(link.created_at), updated_at: decodeId(link.updated_at), deleted_at: null } });
  const pairId = await linkPairRevisionId(operation.service_name, { primary: result.id, foreign: "promo-create-root" });
  const pair = decodePairRevision(rows.find(row => row.id === pairId));
  expect(pair.revision).toBe(change?.afterRevision);
  expect(decodeOperation(rows.find(row => row.id === operation.id))).toEqual(operation);
  const stored = await connected.snapshot(), outcome = stored.outcomes.find(value => value.value.key === key);
  if (outcome === undefined) throw new Error("Missing settled Cart outcome");
  for (const id of [result.id, decodeId(line.id), decodeId(tax.id), decodeId(adjustment.id), linkId, operation.id, pairId])
    expect(stored.rows).toContainEqual(expect.objectContaining({ timestamp: outcome.timestamp, value: expect.objectContaining({ id }) }));
  expect(stored.events).toContainEqual(expect.objectContaining({ timestamp: outcome.timestamp,
    envelope: expect.objectContaining({ internal: false, contract: "cart.created", message: expect.objectContaining({ data: { id: result.id } }) }) }));
  const cartDtos = traces.filter(trace => trace.call.commandName === "cartCountForCheckout")
    .flatMap(trace => Result.getOrThrow(decodeGraphCount(trace.call.result))[0]);
  expect(cartDtos.findLast(row => row.id === result.id)).toMatchObject({ items: [{
    raw_unit_price: { value: "12.5", precision: 20 }, raw_subtotal: { value: "25", precision: 20 },
  }] });
  const adjustmentDtos = traces.filter(trace => trace.call.commandName === "cartAddItemAdjustmentsForCreation")
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
  const apply = connected.traces.findLast(trace => trace.call.commandName === "cartPromotionApplyPreimages" &&
    trace.activity.mutations.some(mutation => mutation.table === "cart_promotion" && mutation.operation === "insert" && mutation.after?.cart_id === lateCart.id && mutation.after.promotion_id === "promo-create-root"));
  expect(apply?.activity.mutations.map(mutation => mutation.table)).toEqual(expect.arrayContaining([
    "cart_promotion", "link_workflow_operation", "link_pair_revision",
  ]));
  expect(await connected.snapshot()).toEqual(before);
}, 120_000);

it("refuses a mismatched Core source before calling the native Cart hook", async () => {
  let callbacks = 0;
  const before = await connected.snapshot(), from = connected.traces.length;
  const payment = connected.fixture.sources.find(source => source.definition.identity.sourceKey === "medusa.payment");
  if (payment === undefined) throw new Error("Missing genuine Core Payment definition");
  const incompatible = Result.getOrThrow(defineAtomicCommerceNativeSource("cart_promotion_links", payment.definition));
  const result = await Effect.runPromiseExit(Effect.scoped(Effect.gen(function* () {
    const host = yield* Effect.acquireRelease(prepareCreateCartWorkflow({ ...connected.configuration,
      modules: { ...connected.modules, cart_promotion_links: { module: connected.modules.cart_promotion_links.module,
        nativeStorage: incompatible } }, hooks: { cartCreated: () => { callbacks++; } } }), host => host.close);
    return yield* host.run(host.newRequestKey(), {});
  })));
  if (Exit.isSuccess(result)) throw new Error("Expected the mismatched source to fail");
  expect(result.cause.reasons.filter(Cause.isFailReason)).toContainEqual(expect.objectContaining({
    error: expect.objectContaining({ reason: "invalidAuthority" }),
  }));
  expect(callbacks).toBe(0);
  expect(connected.traces).toHaveLength(from);
  expect(await connected.snapshot()).toEqual(before);
}, 120_000);
