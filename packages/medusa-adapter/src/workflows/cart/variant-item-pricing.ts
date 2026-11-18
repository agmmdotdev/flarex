import { Effect, Schema } from "effect";
import { getVariantsAndItemsWithPrices } from "@medusajs/core-flows/cart/get-variants-and-items-with-prices";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureWorkflowRecord } from "../../workflow/configuration";
import { captureInstalledWorkflowModules, prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "../../workflow/host";
import { prepareWorkflowResources } from "../../workflow/resources";
import { internalModuleWorkflowEvents } from "../../workflow/events";
import { variantItemPricingParticipantLimit, variantItemPricingResources } from "../../workflow/policy";
import { prepareVariantItemPricingModules } from "./variant-item-pricing-graph";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Numeric = Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite())]);
/** These are supplied native values, not Cart/Customer/Region read authority.
 * The finite JSON rest retains native partial DTO and caller context fields.
 * Quantity validation stays in the native mapper, including its zero error. */
const Item = Schema.StructWithRest(Schema.Struct({
  id: Schema.optionalKey(Id), variant_id: Schema.optionalKey(Id), quantity: Numeric,
  unit_price: Schema.optionalKey(Numeric), is_custom_price: Schema.optionalKey(Schema.Boolean),
  is_tax_inclusive: Schema.optionalKey(Schema.Boolean), requires_shipping: Schema.optionalKey(Schema.Boolean),
  is_discountable: Schema.optionalKey(Schema.Boolean),
}), [Schema.Record(Schema.String, Schema.Json)]);
const Items = Schema.Array(Item).check(Schema.isMaxLength(4));
const Cart = Schema.StructWithRest(Schema.Struct({ id: Schema.optionalKey(Id),
  currency_code: Schema.optionalKey(Schema.String), region_id: Schema.optionalKey(Id), customer_id: Schema.optionalKey(Id),
  items: Schema.optionalKey(Items), customer: Schema.optionalKey(Schema.JsonObject), region: Schema.optionalKey(Schema.JsonObject),
}), [Schema.Record(Schema.String, Schema.Json)]);
export const VariantItemPricingInput = Schema.Struct({ cart: Cart, items: Schema.optionalKey(Items),
  setPricingContextResult: Schema.JsonObject,
  variants: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Array(Id).check(Schema.isMaxLength(4))) })),
});
/** Stored projection and complete calculated-price validation belong to their
 * read owners. Preserve the native mapper's full JSON result at this boundary. */
export const VariantItemPricingOutput = Schema.Struct({
  variants: Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }), [Schema.Record(Schema.String, Schema.Json)]))
    .check(Schema.isMaxLength(4)),
  lineItems: Schema.Array(Schema.Struct({ selector: Schema.Struct({ id: Schema.optionalKey(Id) }), data: Schema.JsonObject }))
    .check(Schema.isMaxLength(4)),
});
const names = ["product", "pricing", "inventory", "stock_location", "sales_channel", "fulfillment",
  "product_links", "variant_links", "sales_channel_locations"] as const;

/** The unchanged native root borrows six service owners and four stored Link
 * families in one existing transaction. No Cart writes or external effects. */
export const prepareVariantItemPricingWorkflow = Effect.fn("MedusaWorkflow.prepareVariantItemPricing")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: { readonly [Key in typeof names[number]]: InstalledWorkflowModule };
  readonly revision: string;
  readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  if (Object.keys(registrations).length !== names.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const captured = yield* Effect.fromResult(captureInstalledWorkflowModules(registrations, names));
  const modules = yield* prepareVariantItemPricingModules(captured);
  const resources = yield* Effect.fromResult(prepareWorkflowResources({
    product: { module: modules.product.module, methods: [], graph: true },
    pricing: { module: modules.pricing.module, methods: ["calculatePrices"], graph: true },
    inventory: { module: modules.inventory.module, methods: [], graph: true },
    stock_location: { module: modules.stock_location.module, methods: [], graph: true },
    sales_channel: { module: modules.sales_channel.module, methods: [], graph: true },
    fulfillment: { module: modules.fulfillment.module, methods: [], graph: true },
    product_links: { module: modules.product_links.module, methods: [], graph: true, expose: false },
    variant_links: { module: modules.variant_links.module, methods: [], graph: true, expose: false },
    sales_channel_locations: { module: modules.sales_channel_locations.module, methods: [], graph: true, expose: false },
  }, true));
  const prepared = yield* Effect.fromResult(getVariantsAndItemsWithPrices.prepare())
    .pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, operationScheduling: "queued",
    requestParticipantLimit: variantItemPricingParticipantLimit, requestCallLimit: variantItemPricingResources.calls, workflow: {
    name: "getVariantsAndItemsWithPrices", resources, prepared, input: VariantItemPricingInput,
    output: VariantItemPricingOutput, events: internalModuleWorkflowEvents,
  } });
});
