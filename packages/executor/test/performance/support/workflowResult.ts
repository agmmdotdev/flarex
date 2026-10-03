import { Schema } from "effect";
import { expect } from "vitest";

const decodeWorkflowResult = Schema.decodeUnknownSync(Schema.Struct({
  product: Schema.Struct({ id: Schema.String, title: Schema.String }),
  tags: Schema.Array(Schema.Struct({ id: Schema.String, value: Schema.String })),
  pricing: Schema.Struct({ variants: Schema.Array(Schema.Struct({ id: Schema.String, product_id: Schema.String })),
    priceSets: Schema.Array(Schema.Struct({ id: Schema.String, prices: Schema.Array(Schema.Struct({
      currency_code: Schema.String, amount: Schema.Number, price_rules: Schema.Array(Schema.Unknown) })) })),
    links: Schema.Array(Schema.Struct({ variant_id: Schema.String, price_set_id: Schema.String })) }),
}));

export function verifyProductLaunchWorkflow(value: unknown, productId: string, tagId: string, title?: string) {
  const graph = decodeWorkflowResult(value);
  expect(graph.product).toMatchObject({ id: productId, ...(title === undefined ? {} : { title }) });
  expect(graph.tags).toEqual([expect.objectContaining({ id: tagId, value: "launched" })]);
  expect(graph.pricing.variants).toHaveLength(1);
  expect(graph.pricing.variants[0]?.product_id).toBe(productId);
  expect(graph.pricing.priceSets).toHaveLength(1);
  expect(graph.pricing.priceSets[0]?.prices).toEqual([
    expect.objectContaining({ currency_code: "USD", amount: 50, price_rules: [] }),
  ]);
  expect(graph.pricing.links).toEqual([expect.objectContaining({
    variant_id: graph.pricing.variants[0]?.id, price_set_id: graph.pricing.priceSets[0]?.id,
  })]);
  return graph;
}
