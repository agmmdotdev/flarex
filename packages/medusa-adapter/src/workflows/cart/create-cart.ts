import { Effect, Result, Schema } from "effect";
import { createWorkflow, nativeCartCreationProfile, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createCartWorkflow, type CreateCartWorkflowInput } from "@medusajs/core-flows/cart/create-carts";
import { FeatureFlag } from "@medusajs/framework/utils/portable";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { makePaymentLifecycleCommands } from "../../modules/payment/lifecycle-service";
import type { prepareCartPromotionPreimageLinks } from "../../links/cart-promotion-preimages";
import { CartCreationAddress } from "../../modules/cart/creation-input";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type WorkflowCallResults } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { orderedWorkflowIdEvents } from "../../workflow/events";
import { workflowModuleDefinition, type WorkflowModule } from "../../workflow/module";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { ScalarId } from "../../repository/scalar-id-read";
import { promotionComputeResources } from "../../workflow/policy";
import { cartCreationResources } from "./create-owned";
import { VariantItemPricingInput } from "./variant-item-pricing";
import { prepareCartCreationModules, type CartCreationModules } from "./creation-graph";

const Text = Schema.optionalKey(Schema.String);
export const CreateCartInput = Schema.Struct({ region_id: Text, customer_id: Text, sales_channel_id: Text,
  email: Text, currency_code: Text, locale: Text, shipping_address_id: Text, billing_address_id: Text,
  shipping_address: Schema.optionalKey(Schema.Union([CartCreationAddress, Schema.String])), billing_address: Schema.optionalKey(Schema.Union([CartCreationAddress, Schema.String])),
  items: Schema.optionalKey(Schema.Array(VariantItemPricingInput.fields.items.schema.value).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
  metadata: Schema.optionalKey(Schema.JsonObject), additional_data: Schema.optionalKey(Schema.JsonObject),
  promo_codes: Schema.optionalKey(Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4))) });
export const CreateCartOutput = Schema.StructWithRest(Schema.Struct({ id: ScalarId }), [Schema.Record(Schema.String, Schema.Json)]);
const decodeCreated = commerceDecoder(Schema.Struct({ carts: Schema.Array(CreateCartOutput), receipt: Schema.optionalKey(Schema.JsonObject) }), "receiptMismatch");
const decodeHook = commerceDecoder(Schema.Struct({ cart: CreateCartOutput, additional_data: Schema.optionalKey(Schema.JsonObject) }), "invalidInput");
type Logger = Effect.Success<ReturnType<typeof makePaymentLifecycleCommands>>["loggerResource"];
type Links = Effect.Success<ReturnType<typeof prepareCartPromotionPreimageLinks>>["resource"];
export interface CartCreationHooks { readonly cartCreated?: (input: Result.Result.Success<ReturnType<typeof decodeHook>>) => unknown | Promise<unknown> }

export function prepareCartCreationResources(modules: CartCreationModules,
  inventory: Effect.Success<ReturnType<typeof prepareCartCreationModules>>["inventory"], link: Links, logger: Logger) {
  return prepareWorkflowResources({
    cart: { module: modules.cart.module, methods: ["createCartsWithOwnership", "compensateCartsCreation", "listCarts", "listLineItemTaxLines", "listShippingMethodTaxLines",
      "setLineItemTaxLines", "setShippingMethodTaxLines", "addLineItemAdjustments", "softDeleteLineItemAdjustments", "restoreLineItemAdjustments",
      "addShippingMethodAdjustments", "softDeleteShippingMethodAdjustments", "restoreShippingMethodAdjustments"], graph: true },
    customer: { module: modules.customer.module, methods: ["retrieveCustomer", "listCustomers", "createCustomers", "deleteCustomers"], graph: true },
    region: { module: modules.region.module, methods: [], graph: true },
    store: { module: modules.store.module, methods: ["listStores"], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: ["retrieveSalesChannel"], graph: true },
    promotion: { module: modules.promotion.module, methods: ["computeActions"], graph: true },
    tax: { module: modules.tax.module, methods: ["getTaxLines"], graph: false },
    payment: { module: modules.payment.module, methods: ["updatePaymentCollections", "deletePaymentSession", "listPaymentCollections", "listPaymentSessions"], graph: true },
    product: { module: modules.product.module, methods: [], graph: true },
    pricing: { module: modules.pricing.module, methods: ["calculatePrices"], graph: true },
    inventory_graph: { module: modules.inventory.module, methods: ["confirmInventory"], graph: true, expose: false },
    stock_location: { module: modules.stock_location.module, methods: [], graph: true },
    fulfillment: { module: modules.fulfillment.module, methods: [], graph: true },
    product_links: { module: modules.product_links.module, methods: [], graph: true, expose: false },
    variant_links: { module: modules.variant_links.module, methods: [], graph: true, expose: false },
    sales_channel_locations: { module: modules.sales_channel_locations.module, methods: [], graph: true, expose: false },
    cart_promotion_links: { module: modules.cart_promotion_links.module, methods: ["applyPreimageOperation", "compensatePreimageOperation"], graph: true, expose: false },
    cart_payment_collection_links: { module: modules.cart_payment_collection_links.module, methods: [], graph: true, expose: false },
  }, true, { inventory, link, logger }, { absent: ["caching"] });
}

/** The genuine native root runs as one child of the trusted atomic owner. Its
 * original Cart result and each retained inverse stay with their native owners. */
export const prepareCreateCartWorkflow = Effect.fn("CartCreation.prepareRoot")(function* (input: {
  readonly execution: AtomicWorkflowExecution; readonly modules: CartCreationModules; readonly salesChannelRead: WorkflowModule;
  readonly link: Links; readonly logger: Logger; readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
  readonly hooks?: CartCreationHooks;
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "salesChannelRead", "link", "logger", "revision", "subscribers", "hooks"].includes(key)) ||
    FeatureFlag.isFeatureEnabled("translation")) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const selected = yield* prepareCartCreationModules(options.modules, options.salesChannelRead), modules = selected.modules;
  const resources = yield* Effect.fromResult(prepareCartCreationResources(modules, selected.inventory, options.link, options.logger));
  const registered = yield* Effect.fromResult(captureWorkflowRecord(options.hooks ?? {}));
  if (Object.keys(registered).some(name => name !== "cartCreated") || registered.cartCreated !== undefined && typeof registered.cartCreated !== "function")
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const handler = registered.cartCreated;
  type Hooks = NonNullable<Parameters<typeof createCartWorkflow.prepare>[0]>;
  const hooks: Hooks = handler === undefined ? {} : { cartCreated: resources.callback((value: unknown) => captureCommerceInput(value).pipe(Result.flatMap(decodeHook),
    Result.match({ onFailure: error => Promise.reject(error), onSuccess: value => handler(value) }))) };
  const root = createWorkflow({ name: "native-cart-creation-atomic", constructionProfile: nativeCartCreationProfile },
    (value: WorkflowData<CreateCartWorkflowInput>) => new WorkflowResponse(createCartWorkflow.runAsStep({ input: value, hooks })));
  const prepared = yield* Effect.fromResult(root.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const create = modules.cart.module.methods.createCartsWithOwnership;
  if (create === undefined) return yield* Effect.fail(commerceError("invalidAuthority"));
  const events = orderedWorkflowIdEvents("cart.created", Effect.fn("CartCreation.createdIds")(function* (calls: WorkflowCallResults) {
    const ids: string[] = [];
    for (const result of calls.results(create)) ids.push(...(yield* Effect.fromResult(decodeCreated(result))).carts.map(cart => cart.id));
    return ids;
  }));
  for (const name of ["cart", "promotion"] as const)
    if (modules[name].logicalResources !== undefined || workflowModuleDefinition(modules[name].module)?.logical === undefined)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  const { inventory, ...others } = modules;
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules: { ...others, inventory_graph: inventory,
    cart: { ...modules.cart, logicalResources: cartCreationResources }, promotion: { ...modules.promotion, logicalResources: promotionComputeResources } },
    revision: options.revision, subscribers: options.subscribers, identityEncoding: "resourceDigest", requestParticipantLimit: 18, requestCallLimit: cartCreationResources.calls,
    executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "createCartWorkflow", resources, prepared, input: CreateCartInput, output: CreateCartOutput, events } });
});
