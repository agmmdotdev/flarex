import { createWorkflow, transform, WorkflowResponse, type WorkflowData } from "../../../../../third_party/medusa/upstream/packages/core/workflows-sdk/dist/index.js";
import { createProductVariantsStep } from "../../../../../third_party/medusa/upstream/packages/core/core-flows/dist/product/steps/create-product-variants.js";
import { createPriceSetsStep } from "../../../../../third_party/medusa/upstream/packages/core/core-flows/dist/pricing/steps/create-price-sets.js";
import { createVariantPricingLinkStep } from "../../../../../third_party/medusa/upstream/packages/core/core-flows/dist/product/steps/create-variant-pricing-link.js";
import { updateProductTagsWorkflow } from "../../../../../third_party/medusa/upstream/packages/core/core-flows/dist/product/workflows/update-product-tags.js";
import { useQueryGraphStep } from "../../../../../third_party/medusa/upstream/packages/core/core-flows/dist/common/steps/use-query-graph.js";
import type { ProductTypes } from "../../../../../third_party/medusa/upstream/packages/core/framework/dist/types/index.js";
import { Schema } from "effect";

// Benchmark composition of the admitted launch graph. Every step executes the
// pinned native implementation; no Flarex SDK, adapter or transaction runs here.
type LaunchInput = { product_id: string; tag_id: string; variant_title: string; usd_amount: number };
const observedProducts = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String, title: Schema.String,
  tags: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })) })));
const pricingWorkflow = createWorkflow("native-baseline-priced-variants", (input: WorkflowData<LaunchInput>) => {
  const variants = createProductVariantsStep(transform(input, (value): ProductTypes.CreateProductVariantDTO[] => [{
    product_id: value.product_id, title: value.variant_title, options: { Size: "0" },
  }]));
  const priceSets = createPriceSetsStep(transform({ input, variants }, ({ input }) => [{
    prices: [{ currency_code: "USD", amount: input.usd_amount }],
  }]));
  const links = transform({ variants, priceSets }, ({ variants, priceSets }) => ({ links: variants.map((variant, index) => {
    const priceSet = priceSets[index];
    if (priceSet === undefined) throw new Error("Native Pricing creation omitted a PriceSet");
    return { variant_id: variant.id, price_set_id: priceSet.id };
  }) }));
  createVariantPricingLinkStep(links);
  const ids = transform({ variants, priceSets }, ({ variants, priceSets }) => ({
    variants: variants.map(value => value.id), priceSets: priceSets.map(value => value.id),
  }));
  const pendingVariants = useQueryGraphStep({ entity: "product_variant", fields: ["id", "title", "product_id"],
    filters: { id: ids.variants }, pagination: { take: 4 } }).config({ name: "pending-priced-variants" });
  const pendingPriceSets = useQueryGraphStep({ entity: "price_set", fields: ["id", "prices.id", "prices.currency_code", "prices.amount", "prices.price_rules.id", "prices.price_rules.attribute", "prices.price_rules.value"],
    filters: { id: ids.priceSets }, pagination: { take: 4 } }).config({ name: "pending-price-sets" });
  const pendingLinks = useQueryGraphStep({ entity: "product_variant_price_sets", fields: ["id", "variant_id", "price_set_id"],
    filters: { variant_id: ids.variants, price_set_id: ids.priceSets }, pagination: { take: 4 } }).config({ name: "pending-variant-pricing-links" });
  return new WorkflowResponse({ variants: pendingVariants.data, priceSets: pendingPriceSets.data, links: pendingLinks.data });
});

export const nativeLaunchWorkflow = createWorkflow("native-baseline-launch-product", (input: WorkflowData<LaunchInput>) => {
  const pricing = pricingWorkflow.runAsStep({ input }).config({ name: "price-launch-variant" });
  const tags = updateProductTagsWorkflow.runAsStep({ input: transform(input, value => ({
    selector: { id: [value.tag_id] }, update: { value: "launched" },
  })) }).config({ name: "launch-product-tag" });
  const observed = useQueryGraphStep({ entity: "product", fields: ["id", "title", "tags.id", "tags.value"],
    filters: { id: transform(input, value => value.product_id) }, pagination: { take: 1 },
  }).config({ name: "pending-launched-product" });
  const product = transform({ input, tags, observed: observed.data }, ({ input, tags, observed }) => {
    const rows = observedProducts(observed);
    const row = rows.find(candidate => candidate.id === input.product_id);
    if (row === undefined || !Array.isArray(row.tags) || tags.length !== 1 || tags[0]?.id !== input.tag_id ||
      tags[0]?.value !== "launched" || !row.tags.some(tag => tag.id === input.tag_id && tag.value === "launched"))
      throw new Error("Native launch graph receipt mismatch");
    return { id: row.id, title: row.title, tags: row.tags };
  });
  return new WorkflowResponse({ pricing, tags, product });
});
