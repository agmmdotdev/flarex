import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateCartPromotionsWorkflow } from "@medusajs/core-flows/cart/update-cart-promotions";
import { FeatureFlag, PromotionActions } from "@medusajs/framework/utils/portable";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../../repository/scalar-id-read";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { promotionComputeResources } from "../../workflow/policy";
import type { WorkflowModule } from "../../workflow/module";
import { cartCreationResources } from "./create-owned";
import { cartCreationResourceSelections, type prepareCartCreationResources } from "./create-cart";
import { prepareCartCreationModules, type CartCreationModules } from "./creation-graph";

export const UpdateCartPromotionsInput = Schema.Struct({ cart_id: ScalarId,
  promo_codes: Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(4)),
  action: Schema.Literals(Object.values(PromotionActions)), force_refresh_payment_collection: Schema.Literal(true) });
type Preparation = Parameters<typeof prepareCartCreationResources>;

/** Dedicated native promotion root. Adjustment/Link writes and local Payment
 * refresh share one existing settlement; the native graph emits module events. */
export const prepareCartPromotionsWorkflow = Effect.fn("CartPromotions.prepareRoot")(function* (input: {
  readonly execution: AtomicWorkflowExecution; readonly modules: CartCreationModules; readonly salesChannelRead: WorkflowModule;
  readonly link: Preparation[2]; readonly logger: Preparation[3]; readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "salesChannelRead", "link", "logger", "revision", "subscribers"].includes(key)) ||
    FeatureFlag.isFeatureEnabled("translation")) return yield* commerceError("unsupportedProfile");
  const selected = yield* prepareCartCreationModules(options.modules, options.salesChannelRead), modules = selected.modules;
  const { tax: _taxSelection, ...selections } = cartCreationResourceSelections(modules);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ ...selections,
    cart: { module: modules.cart.module, graph: true, methods: ["addLineItemAdjustments", "softDeleteLineItemAdjustments", "restoreLineItemAdjustments",
      "addShippingMethodAdjustments", "softDeleteShippingMethodAdjustments", "restoreShippingMethodAdjustments"] },
    customer: { module: modules.customer.module, methods: [], graph: true },
    store: { module: modules.store.module, methods: [], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: [], graph: true },
    pricing: { module: modules.pricing.module, methods: [], graph: true },
    inventory_graph: { module: modules.inventory.module, methods: [], graph: true, expose: false },
    payment: { module: modules.payment.module, graph: true, methods: ["updatePaymentCollections", "upsertPaymentCollections", "listPaymentCollections",
      "deletePaymentSession", "createPaymentSession", "listPaymentSessions"] },
  }, true, { link: options.link, logger: options.logger }, { absent: ["caching"] }));
  const root = createWorkflow("native-cart-promotions-atomic", (value: WorkflowData<typeof UpdateCartPromotionsInput.Type>) => {
    updateCartPromotionsWorkflow.runAsStep({ input: value });
    return new WorkflowResponse(null);
  });
  const prepared = yield* Effect.fromResult(root.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const { inventory, tax: _taxModule, ...others } = modules;
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules: { ...others, inventory_graph: inventory,
    cart: { ...modules.cart, logicalResources: cartCreationResources }, promotion: { ...modules.promotion, logicalResources: promotionComputeResources } },
    revision: options.revision, subscribers: options.subscribers, identityEncoding: "resourceDigest", requestParticipantLimit: 17,
    requestCallLimit: cartCreationResources.calls, executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "updateCartPromotionsWorkflow", resources, prepared, input: UpdateCartPromotionsInput, output: Schema.Null,
      events: internalModuleWorkflowEvents } });
});
