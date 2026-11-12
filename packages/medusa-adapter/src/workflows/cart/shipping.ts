import { Effect, Schema } from "effect";
import { createWorkflow, nativeCartMutationProfile, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { listShippingOptionsForCartWorkflow } from "@medusajs/core-flows/cart/list-shipping-options-for-cart";
import { addShippingMethodToCartWorkflow } from "@medusajs/core-flows/cart/add-shipping-method-to-cart";
import { FeatureFlag } from "@medusajs/framework/utils/portable";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../../repository/scalar-id-read";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type WorkflowCallResults } from "../../workflow/host";
import { internalModuleWorkflowEvents, orderedWorkflowIdEvents } from "../../workflow/events";
import { prepareWorkflowResources } from "../../workflow/resources";
import type { WorkflowModule } from "../../workflow/module";
import { promotionComputeResources } from "../../workflow/policy";
import { decodeGraphCount } from "../../local-graph/query";
import { cartCreationResourceSelections, type prepareCartCreationResources } from "./create-cart";
import { cartCreationResources } from "./create-owned";
import { prepareCartCreationModules, type CartCreationModules } from "./creation-graph";
import { prepareCartShippingModules, type CartShippingLinks } from "./shipping-graph";
import { cartMutationRequestCallLimit, prepareCartShippingMutationResources } from "./mutations";

export const ListCartShippingOptionsInput = Schema.Struct({ cart_id: ScalarId, is_return: Schema.optionalKey(Schema.Boolean),
  enabled_in_store: Schema.optionalKey(Schema.Boolean), option_ids: Schema.optionalKey(Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4))),
  fields: Schema.optionalKey(Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(256))), additional_data: Schema.optionalKey(Schema.JsonObject) });
export const AddCartShippingMethodInput = Schema.Struct({ cart_id: ScalarId,
  options: Schema.Array(Schema.Struct({ id: ScalarId, data: Schema.optionalKey(Schema.JsonObject) })).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 4)),
  additional_data: Schema.optionalKey(Schema.JsonObject) });
type Preparation = Parameters<typeof prepareCartCreationResources>;

/** Genuine unpriced listing and add/replace graphs retain native provider,
 * eligibility, Tax, Promotion and Payment behavior under the existing root. */
export const prepareCartShippingWorkflows = Effect.fn("CartShipping.prepareRoots")(function* (input: {
  readonly execution: AtomicWorkflowExecution; readonly modules: CartCreationModules; readonly shippingLinks: CartShippingLinks;
  readonly salesChannelRead: WorkflowModule; readonly link: Preparation[2]; readonly logger: Preparation[3];
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "shippingLinks", "salesChannelRead", "link", "logger", "revision", "subscribers"].includes(key)) ||
    FeatureFlag.isFeatureEnabled("translation")) return yield* commerceError("unsupportedProfile");
  const selected = yield* prepareCartCreationModules(options.modules, options.salesChannelRead);
  const modules = yield* Effect.fromResult(prepareCartShippingModules(selected.modules, options.shippingLinks));
  const { tax: _taxSelection, store: _storeSelection, ...selections } = cartCreationResourceSelections(modules);
  const listResources = yield* Effect.fromResult(prepareWorkflowResources({ ...selections,
    cart: { module: modules.cart.module, methods: [], graph: true }, customer: { module: modules.customer.module, methods: [], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: [], graph: true },
    promotion: { module: modules.promotion.module, methods: [], graph: true }, payment: { module: modules.payment.module, methods: [], graph: true },
    pricing: { module: modules.pricing.module, methods: [], graph: true }, inventory_graph: { module: modules.inventory.module, methods: [], graph: true, expose: false },
    cart_promotion_links: { module: modules.cart_promotion_links.module, methods: [], graph: true, expose: false },
    location_fulfillment_set_links: { module: modules.location_fulfillment_set_links.module, methods: [], graph: true, expose: false },
    shipping_option_price_set_links: { module: modules.shipping_option_price_set_links.module, methods: [], graph: true, expose: false },
  }, true, undefined, { absent: ["caching"] }));
  const addResources = yield* Effect.fromResult(prepareCartShippingMutationResources(modules, selected.inventory, options.link, options.logger, modules));
  const list = createWorkflow("native-cart-shipping-list-atomic", (value: WorkflowData<typeof ListCartShippingOptionsInput.Type>) =>
    new WorkflowResponse(listShippingOptionsForCartWorkflow.runAsStep({ input: value })));
  const add = createWorkflow({ name: "native-cart-shipping-add-atomic", constructionProfile: nativeCartMutationProfile },
    (value: WorkflowData<typeof AddCartShippingMethodInput.Type>) => {
      addShippingMethodToCartWorkflow.runAsStep({ input: value }); return new WorkflowResponse(null);
    });
  const preparedList = yield* Effect.fromResult(list.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const preparedAdd = yield* Effect.fromResult(add.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const count = modules.cart.module.methods.listAndCountCarts;
  if (count === undefined) return yield* commerceError("invalidAuthority");
  const updated = orderedWorkflowIdEvents("cart.updated", Effect.fn("CartShipping.updatedIds")(function* (calls: WorkflowCallResults) {
    const ids = [];
    for (const result of calls.results(count)) ids.push(...(yield* Effect.fromResult(decodeGraphCount(result)))[0].map(cart => cart.id));
    const first = ids[0];
    if (typeof first !== "string" || ids.some(id => id !== first)) return yield* commerceError("receiptMismatch");
    return [first];
  }));
  const { inventory, tax: _tax, store: _store, ...listModules } = modules,
    { inventory: _inventory, store: _addStore, ...addModules } = modules;
  const common = { execution: options.execution, revision: options.revision, subscribers: options.subscribers,
    executionIsolation: "scopeExclusive" as const, operationScheduling: "queued" as const, borrowedOperationScheduling: "queued" as const };
  return {
    listShippingOptions: yield* prepareAtomicWorkflowHost({ ...common, modules: { ...listModules, inventory_graph: inventory,
      cart: { ...modules.cart, logicalResources: cartCreationResources } }, identityEncoding: "resourceDigest", requestParticipantLimit: 18,
      requestCallLimit: cartCreationResources.calls, workflow: { name: "listShippingOptionsForCartWorkflow", resources: listResources, prepared: preparedList,
        input: ListCartShippingOptionsInput, output: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), events: internalModuleWorkflowEvents } }),
    addShippingMethod: yield* prepareAtomicWorkflowHost({ ...common, modules: { ...addModules, inventory_graph: inventory,
      cart: { ...modules.cart, logicalResources: cartCreationResources }, promotion: { ...modules.promotion, logicalResources: promotionComputeResources } },
      identityEncoding: "resourceAndDefinitionDigest", requestParticipantLimit: 19, requestCallLimit: cartMutationRequestCallLimit,
      workflow: { name: "addShippingMethodToCartWorkflow", resources: addResources, prepared: preparedAdd,
        input: AddCartShippingMethodInput, output: Schema.Null, events: updated } }),
  };
});
