import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { Cause, Effect, Exit, Result, Schema } from "effect";
import { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { asValue, createContainer } from "@medusajs/deps/awilix-portable";
import { createStoreCartHttpHandler } from "@flarex/medusa-http/store-cart";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { PaymentModuleService } from "@medusajs/payment/services";
import { PromotionModuleService } from "@medusajs/promotion/services";
import { CartModuleService } from "@medusajs/cart/services";
import { makeStoreCartRequestScopeFactory } from "../src/http/store-cart-request";
import { prepareCartPromotionsWorkflow } from "../src/workflows/cart/promotions";
import { captureInstalledWorkflowModules } from "../src/workflow/host";
import { cartCreationModuleNames } from "../src/workflows/cart/creation-graph";
import { prepareStoreCartRequestFixture } from "./support/store-cart-request-fixture";
import { storeCartLogger, storeCartToken, storeCartRevokedToken, storeCartPromotionSeedRows } from "./support/store-cart-request-catalog";

const driver = Schema.decodeUnknownSync(Schema.Literals(["pglite", "postgres"]))(process.env.FLAREX_TEST_DRIVER ?? "pglite");
const decodeCart = Schema.decodeUnknownSync(Schema.Struct({ cart: Schema.JsonObject }));
const decodeId = Schema.decodeUnknownSync(Schema.NonEmptyString);
const decodeRows = Schema.decodeUnknownSync(Schema.Array(Schema.JsonObject));
let tested: Awaited<ReturnType<typeof prepareStoreCartRequestFixture>>;
beforeAll(async () => { tested = await prepareStoreCartRequestFixture(driver, { additionalRows: storeCartPromotionSeedRows }); }, 600_000);
afterAll(async () => { await tested?.fixture.close(); }, 60_000);

async function request(path: string, options: Readonly<{ method?: "GET" | "POST" | "DELETE"; value?: unknown; key?: string }> = {}) {
  return tested.use(runtime => Effect.gen(function* () {
    const container = createContainer().register({ logger: asValue(storeCartLogger), configModule: asValue({ projectConfig: { http: {} } }) });
    const scopes = yield* makeStoreCartRequestScopeFactory({ runtime, container });
    const http = createStoreCartHttpHandler({ storeCors: "https://store.test", ...scopes, admitCartRefetchFields: runtime.admitCartRefetchFields });
    const response = yield* Effect.promise(() => http.handle(new Request(`https://store.test${path}`, {
      method: options.method ?? (options.value === undefined ? "GET" : "POST"),
      headers: { "content-type": "application/json", "x-publishable-api-key": options.key ?? storeCartToken },
      ...(options.value === undefined ? {} : { body: JSON.stringify(options.value) }),
    })));
    return { status: response.status, value: yield* Effect.promise(() => response.json()) };
  }));
}
async function create() {
  const response = await request("/store/carts", { value: { items: [{ variant_id: "variant-create-root", quantity: 1 }] } });
  expect(response.status, JSON.stringify(response.value)).toBe(200);
  return decodeCart(response.value).cart;
}
const path = (id: string) => `/store/carts/${id}/promotions`;
const codes = (cart: typeof Schema.JsonObject.Type) => decodeRows(cart.promotions).map(row => row.code).sort();
function failures(value: unknown): string[] {
  if (Cause.isCause(value)) return value.reasons.flatMap(reason => Cause.isFailReason(reason) ? failures(reason.error)
    : Cause.isDieReason(reason) ? failures(reason.defect) : ["Interrupt"]);
  if (value instanceof CommerceTransactionError) return [value.reason, ...failures(value.cause)];
  if (value instanceof Error) return [value.name, value.message, ...failures(value.cause)];
  return [];
}

it("adds, repeats, removes and clears native codes while preserving automatic promotions and exact totals", async () => {
  const cart = await create(), id = decodeId(cart.id), endpoint = path(id);
  expect(cart).toMatchObject({ subtotal: 12.5, discount_total: 1.1, total: 12.65 });
  const before = await tested.fixture.snapshot();
  for (let index = 0; index < 2; index++) {
    const added = await request(endpoint, { value: { promo_codes: ["HTTP-CART"] } });
    expect(added.status, JSON.stringify(added.value)).toBe(200);
    expect(decodeCart(added.value).cart).toMatchObject({ id, subtotal: 12.5, discount_total: 3.3, total: 10.45 });
    expect(codes(decodeCart(added.value).cart)).toEqual(["HTTP-CART", "NATIVE-CART"]);
  }
  const removed = await request(endpoint, { method: "DELETE", value: { promo_codes: ["HTTP-CART"] } });
  expect(removed.status, JSON.stringify(removed.value)).toBe(200);
  expect(decodeCart(removed.value).cart).toMatchObject({ discount_total: 1.1, total: 12.65 });
  expect(codes(decodeCart(removed.value).cart)).toEqual(["NATIVE-CART"]);
  const reapplied = await request(endpoint, { value: { promo_codes: ["HTTP-CART"] } });
  expect(reapplied.status, JSON.stringify(reapplied.value)).toBe(200);
  expect(decodeCart(reapplied.value).cart).toMatchObject({ discount_total: 3.3, total: 10.45 });
  expect(codes(decodeCart(reapplied.value).cart)).toEqual(["HTTP-CART", "NATIVE-CART"]);
  const cleared = await request(endpoint, { value: { promo_codes: [] } });
  expect(cleared.status, JSON.stringify(cleared.value)).toBe(200);
  expect(decodeCart(cleared.value).cart).toMatchObject({ discount_total: 1.1, total: 12.65 });
  expect(codes(decodeCart(cleared.value).cart)).toEqual(["NATIVE-CART"]);
  const unknown = await request(endpoint, { method: "DELETE", value: { promo_codes: ["UNKNOWN"] } });
  expect(unknown.status, JSON.stringify(unknown.value)).toBe(200);
  expect(codes(decodeCart(unknown.value).cart)).toEqual(["NATIVE-CART"]);
  const after = await tested.fixture.snapshot();
  expect(after.events.filter(event => !event.envelope.internal)).toEqual(before.events.filter(event => !event.envelope.internal));
  const merged = await request(`/store/carts/${id}/line-items`, { value: { variant_id: "variant-create-root", quantity: 1 } });
  expect(merged.status, JSON.stringify(merged.value)).toBe(200);
  expect(decodeCart(merged.value).cart).toMatchObject({ subtotal: 25, items: [{ quantity: 2, unit_price: 12.5 }] });
  const line = decodeRows(decodeCart(merged.value).cart.items)[0];
  if (line === undefined) throw new Error("Missing native Cart Line Item after promotion history");
  // Native refresh retains adjustment tombstones. The existing deletion
  // profile admits at most four complete rows per non-Address table.
  const beforeDeletion = await tested.fixture.snapshot();
  const refused = await request(`/store/carts/${id}/line-items/${decodeId(line.id)}`, { method: "DELETE" });
  expect(refused.status, JSON.stringify(refused.value)).toBe(400);
  expect(await tested.fixture.snapshot()).toEqual(beforeDeletion);
  const deletion = await tested.use(runtime => Effect.exit(runtime.runWorkflow("delete-line-items", { cart_id: id, ids: [decodeId(line.id)] })));
  expect(Exit.isFailure(deletion) ? failures(deletion.cause) : []).toContain("limitExceeded");
  expect(await tested.fixture.snapshot()).toEqual(beforeDeletion);
});

it("forces native Payment Collection amount refresh and Session deletion, but retains equal-amount Sessions", async () => {
  const deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment");
  try {
    const added = await request(path("cart-http-promotion-payment"), { value: { promo_codes: ["HTTP-CART"] } });
    expect(added.status, JSON.stringify(added.value)).toBe(200);
    expect(decodeCart(added.value).cart).toMatchObject({ total: 10.45, payment_collection: { id: "paycol-http-promotions", amount: 10.45, payment_sessions: [] } });
    expect(deleted).toHaveBeenCalledTimes(1);
    expect(await tested.fixture.readRows("payment", ["payses-http-promotions"])).toEqual([]);
    const equal = await request(path("cart-http-promotion-equal"), { method: "DELETE", value: { promo_codes: ["UNKNOWN"] } });
    expect(equal.status, JSON.stringify(equal.value)).toBe(200);
    expect(decodeCart(equal.value).cart).toMatchObject({ total: 12.65,
      payment_collection: { id: "paycol-http-promotions-equal", amount: 12.65, payment_sessions: [{ id: "payses-http-promotions-equal" }] } });
    expect(deleted).toHaveBeenCalledTimes(1);
  } finally { deleted.mockRestore(); }
});

it("refuses invalid keys, bodies, codes and projections before writes and preserves native missing/completed Cart failures", async () => {
  const cart = await create(), endpoint = path(decodeId(cart.id)), before = await tested.fixture.snapshot();
  for (const method of ["POST", "DELETE"] as const) {
    expect((await request(`${endpoint}?fields=id,unsupported`, { method, value: { promo_codes: ["HTTP-CART"] } })).status).toBe(400);
    expect((await request(endpoint, { method, key: storeCartRevokedToken, value: { promo_codes: ["HTTP-CART"] } })).status).toBe(400);
    expect((await request(endpoint, { method, value: { promo_codes: ["HTTP-CART"], untrusted: true } })).status).toBe(400);
    expect((await request(endpoint, { method, value: { promo_codes: Array.from({ length: 5 }, () => "HTTP-CART") } })).status).toBe(400);
    expect((await request(path("cart-http-promotions-completed"), { method, value: { promo_codes: ["HTTP-CART"] } })).status).toBe(400);
    expect((await request(path("cart-missing"), { method, value: { promo_codes: ["HTTP-CART"] } })).status).toBe(500);
  }
  expect((await request(endpoint, { value: { promo_codes: ["INVALID"] } })).status).toBe(400);
  expect(await tested.fixture.snapshot()).toEqual(before);
});

it("rolls back adjustments, Links and Payment changes despite native swallowed provider deletion failure", async () => {
  const before = await tested.fixture.snapshot();
  const adjustments = vi.spyOn(CartModuleService.prototype, "addLineItemAdjustments");
  const update = vi.spyOn(PaymentModuleService.prototype, "updatePaymentCollections");
  const deleted = vi.spyOn(SystemPaymentProvider.prototype, "deletePayment").mockRejectedValueOnce(new Error("native-promotion-payment-delete-failure"));
  const logger = vi.spyOn(storeCartLogger, "error").mockImplementation(() => undefined);
  try {
    const failed = await request(path("cart-http-promotion-failure"), { value: { promo_codes: ["HTTP-CART"] } });
    expect(failed.status).toBe(500);
    expect(adjustments).toHaveBeenCalledTimes(1); expect(deleted).toHaveBeenCalledTimes(1);
    expect(adjustments).toHaveBeenCalledBefore(deleted);
    expect(update).toHaveBeenCalledTimes(1);
    expect(logger).toHaveBeenCalledWith(expect.stringContaining("Encountered an error when trying to delete payment session"));
    expect(logger.mock.calls.flatMap(args => args.flatMap(failures))).toContain("native-promotion-payment-delete-failure");
    expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { adjustments.mockRestore(); update.mockRestore(); deleted.mockRestore(); logger.mockRestore(); }
});

it("recovers lost native-root acknowledgement and replays the same key without recomputing or duplicating events", async () => {
  const id = decodeId((await create()).id);
  const modules = Result.getOrThrow(captureInstalledWorkflowModules(Object.fromEntries(cartCreationModuleNames.map(name =>
    [name, { module: tested.catalog.runtimes.workflows[name], nativeStorage: tested.fixture.source(name) }])), cartCreationModuleNames));
  const root = await Effect.runPromise(prepareCartPromotionsWorkflow({ execution: tested.fixture.execution, modules,
    salesChannelRead: tested.catalog.runtimes.salesChannelRead, link: tested.catalog.runtimes.link, logger: tested.catalog.runtimes.logger,
    revision: "3".repeat(64), subscribers: [{ id: "native-cart-promotion-replay", revision: "4".repeat(64) }] }));
  const computed = vi.spyOn(PromotionModuleService.prototype, "computeActions");
  try {
    const key = root.newRequestKey(), fault = tested.fixture.loseNextNativeRootAcknowledgement();
    const args = Result.getOrThrow(root.decodeInput({ cart_id: id, promo_codes: ["HTTP-CART"], action: "add", force_refresh_payment_collection: true }));
    expect(await Effect.runPromise(root.run(key, args))).toBeNull();
    // One native calculation and one genuine immutable-observation receipt
    // reconstruction. Outcome replay must invoke neither a second time.
    expect(fault).toMatchObject({ armed: false, failures: 1 }); expect(computed).toHaveBeenCalledTimes(2);
    const before = await tested.fixture.snapshot();
    expect(await Effect.runPromise(root.run(key, args))).toBeNull();
    expect(computed).toHaveBeenCalledTimes(2); expect(await tested.fixture.snapshot()).toEqual(before);
  } finally { computed.mockRestore(); await Effect.runPromise(root.close); }
});
