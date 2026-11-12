import { Effect, Schema } from "effect";
import { createWorkflow, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { updateTaxLinesWorkflow } from "@medusajs/core-flows/cart/update-tax-lines";
import { FeatureFlag } from "@medusajs/framework/utils/portable";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../../repository/scalar-id-read";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution } from "../../workflow/host";
import type { WorkflowModule } from "../../workflow/module";
import { prepareWorkflowResources } from "../../workflow/resources";
import { cartCreationResources } from "./create-owned";
import { cartCreationResourceSelections } from "./create-cart";
import { prepareCartCreationModules, type CartCreationModules } from "./creation-graph";

export const UpdateCartTaxesInput = Schema.Struct({ cart_id: ScalarId, force_tax_calculation: Schema.Literal(true) });

/** The native explicit Tax workflow owns calculation, replacement and retained
 * inverses. Its graph has no Cart workflow event or Payment refresh. */
export const prepareCartTaxesWorkflow = Effect.fn("CartTaxes.prepareRoot")(function* (input: {
  readonly execution: AtomicWorkflowExecution; readonly modules: CartCreationModules; readonly salesChannelRead: WorkflowModule;
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  if (Object.keys(options).some(key => !["execution", "modules", "salesChannelRead", "revision", "subscribers"].includes(key)) ||
    FeatureFlag.isFeatureEnabled("translation")) return yield* commerceError("unsupportedProfile");
  const { modules } = yield* prepareCartCreationModules(options.modules, options.salesChannelRead);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ ...cartCreationResourceSelections(modules),
    cart: { module: modules.cart.module, graph: true, methods: ["listLineItemTaxLines", "listShippingMethodTaxLines",
      "setLineItemTaxLines", "setShippingMethodTaxLines"] },
    customer: { module: modules.customer.module, methods: [], graph: true },
    store: { module: modules.store.module, methods: [], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: [], graph: true },
    promotion: { module: modules.promotion.module, methods: [], graph: true },
    payment: { module: modules.payment.module, methods: [], graph: true },
    pricing: { module: modules.pricing.module, methods: [], graph: true },
    inventory_graph: { module: modules.inventory.module, methods: [], graph: true, expose: false },
    cart_promotion_links: { module: modules.cart_promotion_links.module, methods: [], graph: true, expose: false },
  }, true, undefined, { absent: ["caching"] }));
  const root = createWorkflow("native-cart-taxes-atomic", (value: WorkflowData<typeof UpdateCartTaxesInput.Type>) => {
    updateTaxLinesWorkflow.runAsStep({ input: value });
    return new WorkflowResponse(null);
  });
  const prepared = yield* Effect.fromResult(root.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  const { inventory, ...others } = modules;
  return yield* prepareAtomicWorkflowHost({ execution: options.execution, modules: { ...others, inventory_graph: inventory,
    cart: { ...modules.cart, logicalResources: cartCreationResources } },
    revision: options.revision, subscribers: options.subscribers, identityEncoding: "resourceDigest", requestParticipantLimit: 18,
    requestCallLimit: cartCreationResources.calls, executionIsolation: "scopeExclusive", operationScheduling: "queued", borrowedOperationScheduling: "queued",
    workflow: { name: "updateTaxLinesWorkflow", resources, prepared, input: UpdateCartTaxesInput, output: Schema.Null,
      events: internalModuleWorkflowEvents } });
});
