import { Result, Schema } from "effect";
import { WorkflowDefinitionError } from "@medusajs/workflows-sdk";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const PreviousProducts = Schema.Array(Schema.Struct({ variants: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(4)) }))
  .check(Schema.isMaxLength(4), Schema.makeFilter(rows => rows.reduce((total, row) => total + row.variants.length, 0) <= 4));
const SalesLinks = Schema.Array(Schema.Struct({ product_id: Id, sales_channel_id: Id })).check(Schema.isMaxLength(8), Schema.makeFilter(rows => {
  const counts = new Map<string, number>();
  for (const row of rows) { const count = (counts.get(row.product_id) ?? 0) + 1; if (count > 2) return false; counts.set(row.product_id, count); }
  return true;
}));
const ShippingLinks = Schema.Array(Schema.Struct({ product_id: Id, shipping_profile_id: Id })).check(Schema.isMaxLength(4),
  Schema.makeFilter(rows => new Set(rows.map(row => row.product_id)).size === rows.length));
const PricingLinks = Schema.Array(Schema.Struct({ variant_id: Id, price_set_id: Id })).check(Schema.isMaxLength(4));
function nativeQueryDecoder<S extends Schema.ConstraintDecoder<unknown>>(schema: S) {
  const decode = Schema.decodeUnknownResult(schema, { onExcessProperty: "error" });
  return (value: unknown): S["Type"] => Result.getOrThrow(decode(value).pipe(Result.mapError(() => new WorkflowDefinitionError({
    reason: "unsupportedProfile", detail: "Product update query exceeds its admitted native result contract",
  }))));
}
export const previousProductVariants = nativeQueryDecoder(PreviousProducts);
export const currentSalesChannelLinks = nativeQueryDecoder(SalesLinks);
export const currentShippingProfileLinks = nativeQueryDecoder(ShippingLinks);
export const currentVariantPricingLinks = nativeQueryDecoder(PricingLinks);
