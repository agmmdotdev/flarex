import { Cause, Effect, Exit } from "effect";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PaymentModuleService } from "@medusajs/payment/services";
import { prepareCoreCheckout } from "./support/core-checkout-fixture";
import { expectCheckoutRollback } from "./support/core-checkout-evidence";
import * as cartReceipt from "../src/modules/cart/payment-receipt";
import type { LogicalCallReceiptValidation } from "../src/repository/call-receipt";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const customerId = "cus-checkout-address", time = "2026-09-01T00:00:00.000Z", updated = "2026-09-02T00:00:00.000Z";
const addresses = [
  { id: "ca-checkout-shipping", customer_id: customerId, first_name: "Shipping", last_name: "Person", company: "Shipping Co",
    address_1: "1 Shipping Street", address_2: "Suite 2", city: "Yangon", country_code: "mm", province: "Yangon",
    postal_code: "11181", phone: "+959111111111", metadata: { nested: { purpose: "shipping" } }, created_at: time, updated_at: updated },
  { id: "ca-checkout-billing", customer_id: customerId, first_name: "Billing", last_name: "Person", company: "Billing Co",
    address_1: "9 Billing Street", address_2: null, city: "Mandalay", country_code: "mm", province: "Mandalay",
    postal_code: "05011", phone: null, metadata: { nested: { purpose: "billing" } }, created_at: time, updated_at: updated },
];

describe("existing Customer and Cart Addresses in native checkout on " + driver, () => {
  const cleanup: Array<() => Promise<void>> = [];
  let local: Awaited<ReturnType<typeof prepareCoreCheckout>>;
  const receipts: Array<{ call: Parameters<LogicalCallReceiptValidation>[0]; activity: Parameters<LogicalCallReceiptValidation>[1];
    validate: LogicalCallReceiptValidation }> = [];
  beforeAll(async () => {
    const original = cartReceipt.cartPaymentReadPolicy;
    vi.spyOn(cartReceipt, "cartPaymentReadPolicy").mockImplementation((...args) => {
      const policy = original(...args);
      return { ...policy, validateLogicalCall: Effect.fn("CheckoutAddress.observeCartReceipt")(function* (call, activity) {
        if (activity.observedRows.filter(row => row.table === "cart_address").length === 2)
          receipts.push({ ...structuredClone({ call, activity }), validate: policy.validateLogicalCall });
        yield* policy.validateLogicalCall(call, activity);
      }) };
    });
    local = await prepareCoreCheckout(driver, release => cleanup.push(release), {
      onPhase: phase => { if (process.env.FLAREX_CHECKOUT_DIAGNOSTICS === "1") console.info("Customer Address checkout fixture:", phase); },
      additionalCases: [
        { name: "customer-address", customerId, shippingAddressId: "ca-checkout-shipping", billingAddressId: "ca-checkout-billing" },
        { name: "guest-address", shippingAddressId: "ca-checkout-shipping" },
        { name: "shared-address", customerId, shippingAddressId: "ca-checkout-billing", billingAddressId: "ca-checkout-billing" },
        { name: "billing-address", customerId, billingAddressId: "ca-checkout-billing" },
        { name: "late-address", customerId, shippingAddressId: "ca-checkout-shipping", billingAddressId: "ca-checkout-billing" },
      ],
      additionalSeeds: {
        cart: addresses.map(row => ({ table: "cart_address", row })),
        customer: [{ table: "customer", row: { id: customerId, email: "customer@example.test", first_name: "Customer",
          last_name: "Identity", has_account: true, metadata: { retained: true } } }],
      },
    });
  }, 600_000);
  afterAll(async () => { vi.restoreAllMocks(); for (const release of cleanup.reverse()) await release(); }, 120_000);
  const selected = (name: string) => {
    const value = local.cases.get(name);
    if (value === undefined) throw new Error("Missing address checkout case");
    return value;
  };

  for (const [name, customer, shipping, billing] of [
    ["checkout", null, null, null],
    ["customer-address", customerId, "ca-checkout-shipping", "ca-checkout-billing"],
    ["guest-address", null, "ca-checkout-shipping", null],
    ["shared-address", customerId, "ca-checkout-billing", "ca-checkout-billing"],
    ["billing-address", customerId, null, "ca-checkout-billing"],
  ] as const) it("copies " + name + " through the native root and preserves replay and Cart retry", async () => {
    const ids = selected(name), beforeRows = await local.rows(), key = local.host.newRequestKey();
    const result = await Effect.runPromiseExit(local.host.run(key, { id: ids.cartId }));
    if (Exit.isFailure(result)) throw new Error(Cause.pretty(result.cause));
    const rows = await local.rows(), order = rows.find(row => row.id === result.value.id);
    expect(order).toMatchObject({ customer_id: customer, email: "checkout@example.com" });
    for (const [slot, id] of [["shipping_address", shipping], ["billing_address", billing]] as const) {
      if (id === null) { expect(order?.[slot + "_id"]).toBeNull(); continue; }
      const original = beforeRows.find(row => row.id === id);
      if (original === undefined) throw new Error("Missing persisted Cart Address");
      const { id: _id, ...fields } = original;
      const copy = rows.find(row => row.id === order?.[slot + "_id"]);
      expect(copy).toEqual({ ...fields, id: expect.stringMatching(/^ordaddr_/) });
      expect(rows.find(row => row.id === id)).toEqual(original);
    }
    if (shipping !== null && billing !== null) expect(order?.shipping_address_id).not.toBe(order?.billing_address_id);
    expect(rows.find(row => row.id === customerId)).toEqual(beforeRows.find(row => row.id === customerId));
    expect(rows.find(row => row.id === ids.cartId)).toMatchObject({ completed_at: expect.any(String) });
    const after = await local.snapshot();
    expect(await Effect.runPromise(local.host.run(key, { id: ids.cartId }))).toEqual(result.value);
    expect(await local.snapshot()).toEqual(after);
    expect(await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: ids.cartId }))).toEqual(result.value);
    expect((await local.rows()).filter(row => row.cart_id === ids.cartId && typeof row.order_id === "string")).toHaveLength(1);
  }, 120_000);

  it("rolls back copied Addresses, Order, Links, Payment and Cart completion after native authorization fails late", async () => {
    const ids = selected("late-address"), before = await local.fixture.inventory(), key = local.host.newRequestKey();
    const native = PaymentModuleService.prototype.authorizePaymentSession;
    let reached = false;
    const spy = vi.spyOn(PaymentModuleService.prototype, "authorizePaymentSession").mockImplementation(async function (this: PaymentModuleService, ...args) {
      const result = await native.apply(this, args);
      if (args[0] === ids.sessionId) { reached = true; throw new Error("Late Customer Address checkout failure"); }
      return result;
    });
    try {
      const exit = await Effect.runPromiseExit(local.host.run(key, { id: ids.cartId }));
      expect(reached).toBe(true); expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late Customer Address checkout failure");
    } finally { spy.mockRestore(); }
    await expectCheckoutRollback(local.fixture, before, key);
    expect((await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: ids.cartId }))).id).toMatch(/^order_/);
  }, 120_000);

  it("refuses missing or reordered Address reads and inconsistent same-ID evidence from the actual Cart graph", async () => {
    const receipt = receipts[0];
    if (receipt === undefined) throw new Error("Missing genuine populated Cart Address read receipt");
    const { call, activity, validate } = receipt;
    await Effect.runPromise(validate(call, activity));
    const address = activity.observedRows.find(row => row.table === "cart_address");
    if (address === undefined) throw new Error("Missing Address evidence");
    const mutants = [
      { ...activity, relationalReads: activity.relationalReads.filter(row => row.table !== "cart_address") },
      { ...activity, relationalReads: [...activity.relationalReads].reverse() },
      { ...activity, observedRows: [...activity.observedRows, { ...address, row: { ...address.row, city: "forged" } }] },
    ];
    for (const mutant of mutants) expect(await Effect.runPromise(Effect.result(validate(call, mutant))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "receiptMismatch" } });
  });
});
