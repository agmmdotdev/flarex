import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { defineAtomicCommerceParticipant } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { customerCheckoutRuntimes, checkoutRuntimes } from "./support/core-checkout-fixture";
import { prepareCustomerCheckoutGraphs, prepareCheckoutGraphs } from "../src/workflows/cart/checkout-graph";
import { prepareCustomerCheckoutNativeLinkResource, prepareCheckoutNativeLinkResource, nativeLinkResourceProfile } from "../src/links/checkout-resource";
import { prepareCustomerCheckoutResources, prepareCheckoutResources } from "../src/workflows/cart/complete-cart";
import { prepareCustomerPaymentSessionResources } from "../src/workflows/payment/customer-session";
import { prepareCheckoutNativeLinkLifecycle } from "../src/links/checkout-native-lifecycle";
import { composedWorkflowResourceDefinition } from "../src/workflow/composed-resource";
import { workflowModuleDefinition } from "../src/workflow/module";
import { prepareLocalGraph } from "../src/local-graph/query";

it("prepares the genuine nineteen-source Customer graph and preserves the eighteen-source profile", async () => {
  const runtime = await customerCheckoutRuntimes(), modules = await Effect.runPromise(prepareCustomerCheckoutGraphs(runtime.workflows));
  const graph = Result.getOrThrow(prepareLocalGraph(Object.entries(modules).map(([name, module]) => {
    const definition = workflowModuleDefinition(module);
    if (definition === undefined) throw new Error("Missing native Customer checkout graph");
    return { participant: defineAtomicCommerceParticipant(name), module: definition.graph };
  })));
  expect(Object.keys(modules)).toHaveLength(19);
  expect(graph.entities).toEqual(expect.arrayContaining(["cart", "customer", "customer_address", "account_holder"]));
  expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareCheckoutGraphs(runtime.workflows))))).toBe(true);
  const ordinary = await checkoutRuntimes();
  expect(Object.keys(await Effect.runPromise(prepareCheckoutGraphs(ordinary.workflows)))).toHaveLength(18);
  expect(Result.isFailure(await Effect.runPromise(Effect.result(prepareCustomerCheckoutGraphs(ordinary.workflows))))).toBe(true);

});

it("admits exactly three native Link families and their separate bounded calls", async () => {
  const services = await Promise.all((["order-cart", "order-payment", "customer-account"] as const)
    .map(kind => Effect.runPromise(prepareCheckoutNativeLinkLifecycle(kind))));
  const native = services.map(service => service.native), resource = Result.getOrThrow(prepareCustomerCheckoutNativeLinkResource(native));
  const definition = composedWorkflowResourceDefinition(resource), create = definition?.methods.create;
  if (create === undefined) throw new Error("Missing native Customer checkout Link contract");
  expect(definition?.dependencies).toHaveLength(9);
  expect(nativeLinkResourceProfile(resource)).toBe("customer-checkout");
  expect(nativeLinkResourceProfile({ ...resource })).toBeUndefined();
  expect(Result.isSuccess(create.arguments([[{ customer: { customer_id: "cus" }, payment: { account_holder_id: "account" } }]]))).toBe(true);
  expect(Result.isSuccess(create.arguments([[{ order: { order_id: "order" }, cart: { cart_id: "cart" } },
    { order: { order_id: "order" }, payment: { payment_collection_id: "collection" } }]]))).toBe(true);
  for (const input of [
    [[{ customer: { customer_id: "cus" }, payment: { account_holder_id: "account" } }, { order: { order_id: "order" }, cart: { cart_id: "cart" } }]],
    [[{ customer: { customer_id: "cus" }, payment: { payment_collection_id: "collection" } }]],
    [[{ order: { order_id: "order" }, promotion: { promotion_id: "promo" } }]],
  ]) expect(Result.isFailure(create.arguments(input))).toBe(true);
  expect(Result.isFailure(prepareCustomerCheckoutNativeLinkResource(native.slice(0, 2)))).toBe(true);
  expect(Result.isFailure(prepareCustomerCheckoutNativeLinkResource([...native, native[0]!]))).toBe(true);
});

it("refuses the wrong native router profile before reflecting any installed source", async () => {
  const runtime = await customerCheckoutRuntimes(), cart = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-cart")),
    payment = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-payment"));
  const ordinary = Result.getOrThrow(prepareCheckoutNativeLinkResource([cart.native, payment.native]));
  const refusal = { _tag: "Failure", failure: { reason: "invalidAuthority" } };
  // @ts-expect-error Deliberate empty authority: wrong router is refused first.
  expect(prepareCustomerCheckoutResources({}, ordinary, runtime.payment.loggerResource)).toMatchObject(refusal);
  // @ts-expect-error Deliberate empty authority: wrong router is refused first.
  expect(prepareCheckoutResources({}, runtime.link, runtime.payment.loggerResource)).toMatchObject(refusal);
  // @ts-expect-error Deliberate empty authority: wrong router is refused first.
  expect(prepareCustomerPaymentSessionResources({}, runtime.payment.loggerResource, runtime.link)).toMatchObject(refusal);
});
