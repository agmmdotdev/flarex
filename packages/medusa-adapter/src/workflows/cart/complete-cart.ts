import { Effect, Result, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { completeCartWorkflow } from "@medusajs/core-flows/cart/complete-cart";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import { nativeLinkResourceProfile, type prepareCheckoutNativeLinkResource } from "../../links/checkout-resource";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type WorkflowCallResults, type InstalledWorkflowModule } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import { paymentFinanceCallLimit } from "../payment/finance-configuration";
import { prepareCheckoutModules, prepareCustomerCheckoutModules, checkoutModuleNames, customerCheckoutModuleNames, type CheckoutModules, type CustomerCheckoutModules } from "./checkout-graph";
import { makeCheckoutInventoryResource } from "../../modules/inventory/checkout-resource";
import { prepareWorkflowLocking } from "../../workflow/locking";

export const CheckoutInput = Schema.Struct({ id: ScalarId });
export const CheckoutOutput = Schema.Struct({ id: ScalarId });
const decodeCreated = commerceDecoder(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: ScalarId }),
  [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isLengthBetween(1, 1)), "receiptMismatch");
type Logger = Effect.Success<ReturnType<typeof makePaymentLifecycleCommands>>["loggerResource"];
type Links = Result.Result.Success<ReturnType<typeof prepareCheckoutNativeLinkResource>>;

// A genuine child invocation supplies native parent metadata: lock steps skip
// under this existing outer scope-exclusive atomic settlement owner.
export const checkoutRoot = createWorkflow("flarex-complete-cart", (input: WorkflowData<typeof CheckoutInput.Type>) =>
  new WorkflowResponse(completeCartWorkflow.runAsStep({ input })));

/** Native checkout and retained Payment/Inventory callbacks borrow these exact
 * services. The other sources supply authenticated graph reads only. */
function checkoutSelections(modules: CheckoutModules) {
  return {
      cart: { module: modules.cart.module, methods: ["listCarts", "updateCarts", "listAddresses", "updateAddresses"], graph: true },
      order: { module: modules.order.module, methods: ["createOrders", "deleteOrders", "addOrderTransactions", "deleteOrderTransactions", "listOrderTransactions"], graph: true },
      payment: { module: modules.payment.module, methods: ["authorizePaymentSession", "retrievePaymentSession", "cancelPayment", "refundPayment", "createPaymentSession", "deletePaymentSession", "listPaymentSessions"], graph: true },
      order_cart_links: { module: modules.order_cart_links.module, methods: ["nativeCreate", "nativeList", "nativeDismiss"], graph: true, expose: false },
      order_payment_collection_links: { module: modules.order_payment_collection_links.module, methods: ["nativeCreate", "nativeList", "nativeDismiss"], graph: true, expose: false },
      cart_payment_collection_links: { module: modules.cart_payment_collection_links.module, methods: [], graph: true, expose: false },
      cart_promotion_links: { module: modules.cart_promotion_links.module, methods: [], graph: true, expose: false },
      customer: { module: modules.customer.module, methods: [], graph: true, expose: false },
      region: { module: modules.region.module, methods: [], graph: true, expose: false },
      promotion: { module: modules.promotion.module, methods: [], graph: true, expose: false },
      product: { module: modules.product.module, methods: [], graph: true, expose: false },
      product_links: { module: modules.product_links.module, methods: [], graph: true, expose: false },
      variant_links: { module: modules.variant_links.module, methods: [], graph: true, expose: false },
      inventory_commands: { module: modules.inventory.module, methods: ["createReservationItems", "deleteReservationItems"], graph: true, expose: false },
      stock_location: { module: modules.stock_location.module, methods: [], graph: true, expose: false },
      sales_channel: { module: modules.sales_channel.module, methods: [], graph: true, expose: false },
      sales_channel_locations: { module: modules.sales_channel_locations.module, methods: [], graph: true, expose: false },
      fulfillment: { module: modules.fulfillment.module, methods: [], graph: true, expose: false },
  } as const;
}
function checkoutCompositions(modules: CheckoutModules, link: Links, logger: Logger) {
  return Result.gen(function* () {
    const create = modules.inventory.module.methods.createReservationItems, remove = modules.inventory.module.methods.deleteReservationItems;
    if (create === undefined || remove === undefined) return yield* Result.fail(commerceError("invalidAuthority"));
    const inventory = yield* makeCheckoutInventoryResource(create, remove);
    const locking = yield* prepareWorkflowLocking([create, remove], "null");
    return { link, logger, inventory, locking };
  });
}
export function prepareCheckoutResources(modules: CheckoutModules, link: Links, logger: Logger) {
  if (nativeLinkResourceProfile(link) !== "checkout") return Result.fail(commerceError("invalidAuthority"));
  return checkoutCompositions(modules, link, logger).pipe(Result.flatMap(composed =>
    prepareWorkflowResources(checkoutSelections(modules), true, composed)));
}
export function prepareCustomerCheckoutResources(modules: CustomerCheckoutModules, link: Links, logger: Logger) {
  if (nativeLinkResourceProfile(link) !== "customer-checkout") return Result.fail(commerceError("invalidAuthority"));
  const selections = checkoutSelections(modules);
  return checkoutCompositions(modules, link, logger).pipe(Result.flatMap(composed => prepareWorkflowResources({ ...selections,
    payment: { ...selections.payment, methods: [...selections.payment.methods, "createAccountHolder", "deleteAccountHolder"] },
    customer_account_holder_links: { module: modules.customer_account_holder_links.module,
      methods: ["nativeCreate", "nativeList", "nativeDismiss"], graph: true, expose: false },
  }, true, composed)));
}

interface CompleteCartOptions {
  readonly execution: AtomicWorkflowExecution; readonly modules: CheckoutModules; readonly link: Links; readonly logger: Logger;
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
}
const prepareCompleteCartProfile = Effect.fn("Checkout.prepareCompleteCart")(function* (input: Omit<CompleteCartOptions, "modules"> & { readonly modules: Readonly<Record<string, InstalledWorkflowModule>> }, profile: "checkout" | "customer") {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "link", "logger", "revision", "subscribers"].includes(key)))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== (profile === "customer" ? 19 : 18))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const selected = profile === "customer"
    ? { profile: "customer" as const, modules: yield* prepareCustomerCheckoutModules(yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, customerCheckoutModuleNames))) }
    : { profile: "checkout" as const, modules: yield* prepareCheckoutModules(yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, checkoutModuleNames))) };
  const modules = selected.modules;
  const resources = yield* Effect.fromResult(selected.profile === "customer"
    ? prepareCustomerCheckoutResources(selected.modules, options.link, options.logger) : prepareCheckoutResources(selected.modules, options.link, options.logger));
  const prepared = yield* Effect.fromResult(checkoutRoot.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const created = modules.order.module.methods.createOrders;
  if (created === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const events = orderedWorkflowIdEvents("order.placed", Effect.fn("Checkout.createdOrderIds")(function* (calls: WorkflowCallResults) {
    const ids: string[] = [];
    for (const value of calls.results(created)) ids.push(...(yield* Effect.fromResult(decodeCreated(value))).map(row => row.id));
    return ids;
  }), { criticalPriority: true, pendingCancellation: true });
  const { inventory, ...otherModules } = modules;
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules: { ...otherModules, inventory_commands: inventory }, revision: options.revision, subscribers: options.subscribers,
    ...(profile === "customer" ? { identityEncoding: "resourceDigest" as const } : {}),
    requestParticipantLimit: profile === "customer" ? 19 : 18, requestCallLimit: paymentFinanceCallLimit,
    executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: profile === "customer" ? "completeCustomerCartWorkflow" : "completeCartWorkflow", resources, prepared, input: CheckoutInput, output: CheckoutOutput, events } });
});

interface CustomerCompleteCartOptions extends Omit<CompleteCartOptions, "modules"> { readonly modules: CustomerCheckoutModules }
export const prepareCompleteCartWorkflow = (input: CompleteCartOptions) => prepareCompleteCartProfile(input, "checkout");
export const prepareCustomerCompleteCartWorkflow = (input: CustomerCompleteCartOptions) => prepareCompleteCartProfile(input, "customer");
