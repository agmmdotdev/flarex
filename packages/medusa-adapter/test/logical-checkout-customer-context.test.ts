import { Cause, Effect, Exit, Result, Schema } from "effect";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PaymentModuleService } from "@medusajs/payment/services";
import { SystemPaymentProvider } from "@medusajs/payment/providers/system";
import { prepareLogicalCheckout } from "./support/logical-checkout-fixture";
import { customerRow } from "./support/customer-rows";
import { prepareRetainedCheckoutPaymentWithResources } from "./support/logical-checkout-payment-compensation-fixture";
import { prepareCustomerCheckoutModules } from "../src/workflows/cart/checkout-graph";
import { prepareCustomerCheckoutResources, prepareCustomerCompleteCartWorkflow } from "../src/workflows/cart/complete-cart";
import { createPaymentSessionsWorkflow } from "@medusajs/core-flows/payment-collection/create-payment-session";
import { prepareAtomicWorkflowHost } from "../src/workflow/host";
import { prepareCustomerPaymentSessionResources } from "../src/workflows/payment/customer-session";
import { CustomerPaymentSessionInput } from "../src/modules/payment/account-input";
import { internalModuleWorkflowEvents } from "../src/workflow/events";
import { paymentFinanceCallLimit } from "../src/workflows/payment/finance-configuration";
import { prepareCheckoutNativeLinkResource } from "../src/links/checkout-resource";
import { prepareCheckoutNativeLinkLifecycle } from "../src/links/checkout-native-lifecycle";
import { workflowResourceSelections } from "../src/workflow/resources";

const driver = process.env.FLAREX_TEST_DRIVER === "postgres" ? "postgres" : "pglite";
const object = Schema.decodeUnknownSync(Schema.JsonObject), id = Schema.decodeUnknownSync(Schema.String);
const customer = "cus-full-checkout", inverseCustomer = "cus-full-inverse", missingCustomer = "cus-full-missing";
const exact = "9007199254740993.0000";

describe("native Customer-context checkout on " + driver, () => {
  const cleanup: Array<() => Promise<void>> = [], caseCleanup: Array<() => Promise<void>> = [];
  const keep = <Host extends { readonly close: Effect.Effect<void> }>(host: Host) => { caseCleanup.push(() => Effect.runPromise(host.close)); return host; };
  let local: Awaited<ReturnType<typeof prepareLogicalCheckout>>;
  beforeAll(async () => {
    local = await prepareLogicalCheckout(driver, release => cleanup.push(release), { customerContext: true,
      additionalCases: [
        { name: "customer-identity", customerId: customer },
        { name: "customer-place", customerId: customer, shippingAddressId: "cartaddr-full" },
        { name: "customer-capture", customerId: customer, amount: exact },
        { name: "customer-late", customerId: customer },
        { name: "customer-inverse", customerId: inverseCustomer, amount: exact, sessionContext: { customer: { id: inverseCustomer } } },
        { name: "customer-missing", sessionContext: { customer: { id: missingCustomer } } },
      ], additionalSeeds: {
        customer: [customerRow(customer, "full@example.invalid", true), customerRow(inverseCustomer, "inverse@example.invalid", true),
          { table: "customer_address", row: { id: "cuaddr-full", customer_id: customer, city: "Yangon", is_default_billing: true } },
          { table: "customer_address", row: { id: "cuaddr-inverse", customer_id: inverseCustomer, city: "Mandalay", is_default_billing: true } }],
        cart: [{ table: "cart_address", row: { id: "cartaddr-full", customer_id: customer, city: "Cart shipping", country_code: "mm" } }],
      }, onPhase: phase => { if (process.env.FLAREX_CHECKOUT_DIAGNOSTICS === "1") console.info("Customer-context checkout:", phase); },
    });
  }, 600_000);
  afterEach(async () => { for (const release of caseCleanup.splice(0).reverse()) await release(); }, 120_000);
  afterAll(async () => { vi.restoreAllMocks(); for (const release of cleanup.reverse()) await release(); }, 120_000);
  const selected = (name: string) => {
    const value = local.cases.get(name);
    if (value === undefined) throw new Error("Missing native Customer checkout case");
    return value;
  };
  async function session(name: string) {
    const ids = selected(name), host = keep(await local.prepareCustomerSession());
    return object(await Effect.runPromise(host.run(host.newRequestKey(), { payment_collection_id: ids.collectionId,
      provider_id: "pp_system_default", customer_id: customer, data: { checkout: name } })));
  }
  async function retained(kind: "forward" | "inverse" | "late") {
    const modules = await Effect.runPromise(prepareCustomerCheckoutModules(local.modules));
    const resources = await Effect.runPromise(Effect.fromResult(prepareCustomerCheckoutResources(modules, local.runtime.link, local.runtime.payment.loggerResource)));
    const { inventory, ...otherModules } = modules;
    return prepareRetainedCheckoutPaymentWithResources({ ...local.configuration, modules: { ...otherModules, inventory_commands: inventory },
      identityEncoding: "resourceDigest", requestParticipantLimit: 19, executionIsolation: "scopeExclusive" }, resources, kind, release => caseCleanup.push(release));
  }
  it("limits checkout to graph-only Customer access and required local account methods", async () => {
    const modules = await Effect.runPromise(prepareCustomerCheckoutModules(local.modules));
    const resources = await Effect.runPromise(Effect.fromResult(prepareCustomerCheckoutResources(modules, local.runtime.link, local.runtime.payment.loggerResource)));
    const selections = workflowResourceSelections(resources);
    const cart = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-cart")), payment = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-payment"));
    const oldLink = Result.getOrThrow(prepareCheckoutNativeLinkResource([cart.native, payment.native]));
    expect(prepareCustomerCheckoutResources(modules, oldLink, local.runtime.payment.loggerResource))
      .toMatchObject({ _tag: "Failure", failure: { reason: "invalidAuthority" } });
    expect(selections).toHaveLength(19);
    expect(selections?.find(value => value.name === "customer")).toMatchObject({ methods: [], expose: false, graph: true });
    expect(selections?.find(value => value.name === "payment")?.methods).toEqual([
      "authorizePaymentSession", "retrievePaymentSession", "cancelPayment", "refundPayment", "createPaymentSession", "deletePaymentSession", "listPaymentSessions",
      "createAccountHolder", "deleteAccountHolder",
    ]);
    const extra = { ...local.configuration, modules: { ...local.modules, unselected: local.modules.payment } };
    expect(await Effect.runPromise(Effect.result(prepareCustomerCompleteCartWorkflow(extra))))
      .toMatchObject({ _tag: "Failure", failure: { reason: "unsupportedProfile" } });
  });
  it("places a Customer Order with real Session account context and independent Cart Address copy", async () => {
    const ids = selected("customer-place"), created = await session("customer-place"), key = local.host.newRequestKey();
    expect(created).toMatchObject({ context: { customer: { id: customer, billing_address: { id: "cuaddr-full", city: "Yangon" } },
      account_holder: { external_id: customer, provider_id: "pp_system_default" } } });
    const beforeRows = await local.rows(), before = await local.snapshot();
    const placed = await Effect.runPromise(local.host.run(key, { id: ids.cartId })), rows = await local.rows();
    const order = rows.find(row => row.id === placed.id);
    expect(order).toMatchObject({ customer_id: customer });
    expect(rows.find(row => row.id === order?.shipping_address_id)).toMatchObject({ city: "Cart shipping", country_code: "mm" });
    for (const rowId of [customer, "cuaddr-full", "cartaddr-full"])
      expect(rows.find(row => row.id === rowId)).toEqual(beforeRows.find(row => row.id === rowId));
    expect(rows.find(row => row.payment_session_id === created.id)).toMatchObject({ payment_collection_id: ids.collectionId });
    const after = await local.snapshot();
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(after.events.filter(event => event.envelope.contract === "order.placed").length - before.events.filter(event => event.envelope.contract === "order.placed").length).toBe(1);
    expect(await Effect.runPromise(local.host.run(key, { id: ids.cartId }))).toEqual(placed);
    expect(await local.snapshot()).toEqual(after);
    expect(await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: ids.cartId }))).toEqual(placed);
  }, 180_000);
  it("retains exact pre-captured Customer payment accounting and account reuse", async () => {
    const ids = selected("customer-capture"), provider = vi.spyOn(SystemPaymentProvider.prototype, "createAccountHolder");
    try {
      const created = await session("customer-capture"), capture = keep(await local.prepareCapturedPayment());
      expect(provider).not.toHaveBeenCalled();
      const payment = await Effect.runPromise(capture.run(capture.newRequestKey(), { id: id(created.id) }));
      const placed = await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: ids.cartId })), rows = await local.rows();
      expect(rows.find(row => row.id === payment.id)).toMatchObject({ amount: exact, payment_session_id: created.id });
      expect(rows.filter(row => row.order_id === placed.id && row.reference === "capture")).toMatchObject([{ amount: exact }]);
      expect(rows.find(row => row.id === placed.id)).toMatchObject({ customer_id: customer });
    } finally { provider.mockRestore(); }
  }, 180_000);
  it("rolls back complete Customer checkout after a late native authorization failure", async () => {
    const ids = selected("customer-late"), created = await session("customer-late"), native = PaymentModuleService.prototype.authorizePaymentSession;
    const before = await local.snapshot(); let reached = false;
    const spy = vi.spyOn(PaymentModuleService.prototype, "authorizePaymentSession").mockImplementation(async function (this: PaymentModuleService, ...args) {
      const output = await native.apply(this, args);
      if (args[0] === created.id) { reached = true; throw new Error("Late Customer-context checkout failure"); }
      return output;
    });
    try {
      const exit = await Effect.runPromiseExit(local.host.run(local.host.newRequestKey(), { id: ids.cartId }));
      expect(reached).toBe(true); expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) expect(Cause.pretty(exit.cause)).toContain("Late Customer-context checkout failure");
    } finally { spy.mockRestore(); }
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);
  it("executes the retained Customer refund/recreate child with exact amount, rollback and replay", async () => {
    const ids = selected("customer-inverse"), capture = keep(await local.prepareCapturedPayment());
    const payment = await Effect.runPromise(capture.run(capture.newRequestKey(), { id: ids.sessionId }));
    const forward = await retained("forward"), marker = object(await Effect.runPromise(forward.run(forward.newRequestKey(), ids.sessionId)));
    expect(marker).toEqual({ output: ids.sessionId, retained: ids.sessionId });
    await Effect.runPromise(forward.close);
    const late = await retained("late"), before = await local.snapshot(), errors = local.runtime.errors.length;
    const failed = await Effect.runPromiseExit(late.run(late.newRequestKey(), id(marker.retained)));
    expect(Exit.isFailure(failed)).toBe(true);
    if (Exit.isFailure(failed)) expect(Cause.pretty(failed.cause)).toContain("Late failure after native checkout Payment inverse");
    expect(local.runtime.errors).toHaveLength(errors);
    expect(await local.snapshot()).toEqual(before);
    await Effect.runPromise(late.close);
    const inverse = await retained("inverse"), key = inverse.newRequestKey();
    expect(await Effect.runPromise(inverse.run(key, id(marker.retained)))).toBeNull();
    const rows = await local.rows(), holder = rows.find(row => row.external_id === inverseCustomer);
    expect(holder).toMatchObject({ provider_id: "pp_system_default" });
    expect(rows.filter(row => row.account_holder_id === holder?.id)).toMatchObject([{ customer_id: inverseCustomer }]);
    expect(rows.find(row => row.payment_id === payment.id && Object.hasOwn(row, "refund_reason_id"))).toMatchObject({ amount: exact });
    expect(rows.find(row => row.id === ids.sessionId)).toMatchObject({ authorized_at: expect.any(String) });
    expect(rows.filter(row => row.payment_collection_id === ids.collectionId && row.status === "pending")).toMatchObject([{
      amount: exact, context: { customer: { id: inverseCustomer, billing_address: { id: "cuaddr-inverse", city: "Mandalay" } }, account_holder: { id: holder?.id } },
    }]);
    const after = await local.snapshot();
    expect(after.commits.length - before.commits.length).toBe(1);
    expect(after.outcomes.length - before.outcomes.length).toBe(1);
    expect(await Effect.runPromise(inverse.run(key, id(marker.retained)))).toBeNull();
    expect(await local.snapshot()).toEqual(after);
  }, 240_000);
  it("binds digested and ordinary identities separately on the native three-source Session profile", async () => {
    const ids = selected("customer-identity"), ordinary = keep(await local.prepareCustomerSession());
    const modules = { payment: local.modules.payment, customer: local.modules.customer, customer_account_holder_links: local.modules.customer_account_holder_links };
    if (local.customerSessionLink === undefined) throw new Error("Missing native Customer Session Link resource");
    const resources = await Effect.runPromise(Effect.fromResult(prepareCustomerPaymentSessionResources(modules, local.runtime.payment.loggerResource, local.customerSessionLink)));
    const prepare = () => prepareAtomicWorkflowHost({ ...local.configuration, modules, identityEncoding: "resourceDigest",
      requestCallLimit: paymentFinanceCallLimit, operationScheduling: "queued", borrowedOperationScheduling: "queued",
      workflow: { name: "createCustomerPaymentSessionsWorkflow", resources, prepared: Result.getOrThrow(createPaymentSessionsWorkflow.prepare()),
        input: CustomerPaymentSessionInput, output: Schema.JsonObject, events: internalModuleWorkflowEvents } });
    const host = keep(await Effect.runPromise(prepare()));
    const input = { payment_collection_id: ids.collectionId, provider_id: "pp_system_default" as const, customer_id: customer };
    const key = host.newRequestKey(), created = await Effect.runPromise(host.run(key, input)), after = await local.snapshot();
    expect(await Effect.runPromise(Effect.result(ordinary.run(key, input)))).toMatchObject({ _tag: "Failure", failure: { reason: "requestConflict" } });
    await Effect.runPromise(host.close);
    const reopened = keep(await Effect.runPromise(prepare()));
    expect(await Effect.runPromise(reopened.run(key, input))).toEqual(created);
    expect(await local.snapshot()).toEqual(after);
  }, 180_000);
  it("preserves Guest checkout through the Customer profile without creating an account", async () => {
    const beforeRows = await local.rows(), before = beforeRows.filter(row => Object.hasOwn(row, "external_id"));
    const placed = await Effect.runPromise(local.host.run(local.host.newRequestKey(), { id: local.cartId })), rows = await local.rows();
    expect(rows.find(row => row.id === placed.id)).toMatchObject({ customer_id: null });
    expect(rows.filter(row => Object.hasOwn(row, "external_id"))).toEqual(before);
  }, 180_000);
  it("keeps a missing persisted Customer failure sticky despite the native compensator logger", async () => {
    const ids = selected("customer-missing"), capture = keep(await local.prepareCapturedPayment());
    await Effect.runPromise(capture.run(capture.newRequestKey(), { id: ids.sessionId }));
    const inverse = await retained("inverse"), before = await local.snapshot(), errors = local.runtime.errors.length;
    const exit = await Effect.runPromiseExit(inverse.run(inverse.newRequestKey(), ids.sessionId));
    expect(Exit.isFailure(exit)).toBe(true);
    expect(local.runtime.errors.length - errors).toBe(1);
    expect(await local.snapshot()).toEqual(before);
  }, 180_000);
});
