import { Effect, Schema } from "effect";
import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "@medusajs/workflows-sdk";
import { createProductVariantsStep } from "@medusajs/core-flows/product/create-product-variants-step";
import { createPriceSetsStep } from "@medusajs/core-flows/pricing/create-price-sets-step";
import { createVariantPricingLinkStep } from "@medusajs/core-flows/product/create-variant-pricing-link-step";
import { useQueryGraphStep } from "@medusajs/core-flows/common/use-query-graph";
import type { AtomicCommerceEvents } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { PriceSetInput, PricingId } from "./pricing-input";
import { ExactNumericRaw } from "./exact-numeric";
import type { ProductWorkflowModule } from "./product-workflow-module";
import type { makeLocalPricingCommands } from "./pricing-service";
import type { prepareVariantPricingLink } from "./variant-pricing-link-service";
import { captureWorkflowRecord } from "./workflow/configuration";
import { prepareWorkflowResources } from "./workflow/resources";
import { internalModuleWorkflowEvents } from "./workflow/events";
import { productVariantPricingResources } from "./product-variant-pricing-schema";
import { prepareAtomicWorkflowHost, type AtomicWorkflowExecution, type InstalledWorkflowModule } from "./workflow/host";

export const ProductVariantPricingInput = Schema.Struct({ product_id: PricingId,
  variants: Schema.Array(Schema.Struct({ id: Schema.optionalKey(PricingId), title: Schema.String,
    options: Schema.Record(Schema.String, Schema.String), priceSet: Schema.optionalKey(PriceSetInput),
  })).check(Schema.isLengthBetween(1, 4)),
});
const Rule = Schema.Struct({ id: Schema.String, attribute: Schema.String, value: Schema.String });
const Price = Schema.Struct({ id: Schema.String, currency_code: Schema.String, amount: Schema.Number, raw_amount: ExactNumericRaw,
  price_rules: Schema.Array(Rule).check(Schema.isMaxLength(1)) });
export const ProductVariantPricingOutput = Schema.Struct({
  variants: Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String, product_id: Schema.String })).check(Schema.isLengthBetween(1, 4)),
  priceSets: Schema.Array(Schema.Struct({ id: Schema.String, prices: Schema.Array(Price).check(Schema.isMaxLength(2)) })).check(Schema.isLengthBetween(1, 4)),
  links: Schema.Array(Schema.Struct({ id: Schema.String, variant_id: Schema.String, price_set_id: Schema.String })).check(Schema.isLengthBetween(1, 4)),
});

/** Selected Pricing branch for an existing Product with options. These are the
 * real native steps; the full variant composer still requires Inventory. */
export const productVariantPricingWorkflow = createWorkflow("create-priced-product-variants", (input: WorkflowData<typeof ProductVariantPricingInput.Type>) => {
  const variants = createProductVariantsStep(transform(input, value => value.variants.map(variant => ({
    ...(variant.id === undefined ? {} : { id: variant.id }), title: variant.title, options: { ...variant.options }, product_id: value.product_id,
  }))));
  const priceSets = createPriceSetsStep(transform({ input, variants }, ({ input }) => input.variants.map(variant => ({ ...(variant.priceSet?.id === undefined ? {} : { id: variant.priceSet.id }),
    ...(variant.priceSet?.prices === undefined ? {} : { prices: variant.priceSet.prices.map(price => ({ ...price, ...(price.rules === undefined ? {} : { rules: { ...price.rules } }) })) }),
  }))));
  const links = transform({ variants, priceSets }, ({ variants, priceSets }) => ({ links: variants.map((variant, index) => {
    const priceSet = priceSets[index];
    if (priceSet === undefined) throw new Error("Native Pricing creation omitted a PriceSet");
    return { variant_id: variant.id, price_set_id: priceSet.id };
  }) }));
  createVariantPricingLinkStep(links);
  const ids = transform({ variants, priceSets }, ({ variants, priceSets }) => ({ variants: variants.map(variant => variant.id), priceSets: priceSets.map(set => set.id) }));
  const pendingVariants = useQueryGraphStep({ entity: "product_variant", fields: ["id", "title", "product_id"], filters: { id: ids.variants }, pagination: { take: 4 } }).config({ name: "pending-priced-variants" });
  const pendingPriceSets = useQueryGraphStep({ entity: "price_set", fields: ["id", "prices.id", "prices.currency_code", "prices.amount", "prices.price_rules.id", "prices.price_rules.attribute", "prices.price_rules.value"],
    filters: { id: ids.priceSets }, pagination: { take: 4 } }).config({ name: "pending-price-sets" });
  const pendingLinks = useQueryGraphStep({ entity: "product_variant_price_sets", fields: ["id", "variant_id", "price_set_id"], filters: { variant_id: ids.variants, price_set_id: ids.priceSets }, pagination: { take: 4 } }).config({ name: "pending-variant-pricing-links" });
  return new WorkflowResponse({ variants: pendingVariants.data, priceSets: pendingPriceSets.data, links: pendingLinks.data });
});

export const prepareProductVariantPricingWorkflow = Effect.fn("MedusaWorkflow.prepareProductVariantPricing")(function* (input: {
  readonly execution: AtomicWorkflowExecution;
  readonly modules: {
    readonly product: InstalledWorkflowModule<ProductWorkflowModule>;
    readonly pricing: InstalledWorkflowModule<Effect.Success<ReturnType<typeof makeLocalPricingCommands>>["workflow"]>;
    readonly link: InstalledWorkflowModule<Effect.Success<ReturnType<typeof prepareVariantPricingLink>>["workflow"]>;
  };
  readonly revision: string; readonly subscribers: AtomicCommerceEvents["subscribers"];
}) {
  const options = yield* Effect.fromResult(captureWorkflowRecord(input));
  const registrations = yield* Effect.fromResult(captureWorkflowRecord(options.modules));
  const modules = { product: yield* Effect.fromResult(captureWorkflowRecord(registrations.product)), pricing: yield* Effect.fromResult(captureWorkflowRecord(registrations.pricing)), link: yield* Effect.fromResult(captureWorkflowRecord(registrations.link)) };
  if (Object.keys(registrations).length !== 3) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const resources = yield* Effect.fromResult(prepareWorkflowResources({ product: { module: modules.product.module, methods: ["createProductVariants"], graph: true },
    pricing: { module: modules.pricing.module, methods: ["createPriceSets"], graph: true }, link: { module: modules.link.module, methods: ["create"], graph: true },
  }, true));
  const prepared = yield* Effect.fromResult(productVariantPricingWorkflow.prepare()).pipe(Effect.mapError(cause => commerceError("unsupportedProfile", cause)));
  return yield* prepareAtomicWorkflowHost({ ...options, modules, requestCallLimit: productVariantPricingResources.calls, workflow: { name: "productVariantPricing", resources, prepared,
    input: ProductVariantPricingInput, output: ProductVariantPricingOutput, events: internalModuleWorkflowEvents,
  } });
});
