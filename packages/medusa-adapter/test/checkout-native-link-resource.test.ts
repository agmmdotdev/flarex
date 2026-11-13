import { Effect, Result } from "effect";
import { expect, it } from "vitest";
import { prepareCheckoutNativeLinkLifecycle } from "../src/links/checkout-native-lifecycle";
import { prepareCheckoutNativeLinkResource, prepareCheckoutPromotionNativeLinkResource, nativeLinkResourceProfile } from "../src/links/checkout-resource";
import { composedWorkflowResourceDefinition } from "../src/workflow/composed-resource";
import { workflowModuleDefinition } from "../src/workflow/module";

it("selects two authentic native Link services for checkout and its retained inverse", async () => {
  const cart = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-cart"));
  const payment = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-payment"));
  const resource = Result.getOrThrow(prepareCheckoutNativeLinkResource([cart.native, payment.native]));
  const definition = composedWorkflowResourceDefinition(resource);
  expect(Object.keys(definition?.methods ?? {})).toEqual(["create", "dismiss"]);
  expect(definition?.dependencies).toHaveLength(6);
  expect(workflowModuleDefinition(cart.workflow)?.source.profile).toBe("order-cart.checkout-native-links");
  expect(Result.isFailure(prepareCheckoutNativeLinkResource([cart.native, cart.native]))).toBe(true);
  expect(Result.isFailure(prepareCheckoutNativeLinkResource([cart.native]))).toBe(true);
  expect(Result.isFailure(prepareCheckoutNativeLinkResource([cart.native, payment.native, payment.native]))).toBe(true);
  const methods = definition?.methods;
  const create = methods?.create;
  if (create === undefined) throw new Error("Missing authenticated native Link creation contract");
  expect(Result.isSuccess(create.arguments([[{ order: { order_id: "order" }, cart: { cart_id: "cart" } },
    { order: { order_id: "order" }, payment: { payment_collection_id: "paycol" } }]]))).toBe(true);
  expect(Result.isFailure(create.arguments([[{ order: { order_id: "order" }, promotion: { promotion_id: "promo" } }]]))).toBe(true);
});

it("adds the genuine OrderPromotion family without broadening original checkout admission", async () => {
  const cart = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-cart"));
  const payment = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-payment"));
  const promotion = await Effect.runPromise(prepareCheckoutNativeLinkLifecycle("order-promotion"));
  const resource = Result.getOrThrow(prepareCheckoutPromotionNativeLinkResource([cart.native, payment.native, promotion.native]));
  expect(nativeLinkResourceProfile(resource)).toBe("checkout-with-promotions");
  expect(workflowModuleDefinition(promotion.workflow)?.source.profile).toBe("order-promotion.checkout-native-links");
  const definition = composedWorkflowResourceDefinition(resource), create = definition?.methods.create, dismiss = definition?.methods.dismiss;
  if (create === undefined || dismiss === undefined) throw new Error("Missing genuine populated checkout Link methods");
  const links = [{ order: { order_id: "order" }, cart: { cart_id: "cart" } },
    { order: { order_id: "order" }, payment: { payment_collection_id: "collection" } },
    ...Array.from({ length: 4 }, (_, index) => ({ order: { order_id: "order" }, promotion: { promotion_id: "promo" + index } }))];
  expect(Result.isSuccess(create.arguments([links]))).toBe(true);
  expect(Result.isSuccess(dismiss.arguments([links]))).toBe(true);
  expect(Result.isFailure(create.arguments([[...links, links[2]]]))).toBe(true);
  expect(Result.isFailure(prepareCheckoutPromotionNativeLinkResource([cart.native, payment.native]))).toBe(true);
  expect(Result.isFailure(prepareCheckoutNativeLinkResource([cart.native, payment.native, promotion.native]))).toBe(true);
});
