import { Effect, Schema } from "effect";
import { pricingStaticResources } from "@medusajs/pricing/static-manifest";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { medusaLifecycle } from "../../repository/lifecycle";
import { PricingId } from "./input";
import type { capturePricingMetadata } from "./schema";

const Ids = Schema.Array(PricingId).check(Schema.isMaxLength(4));
const Selector = Schema.Struct({ id: Schema.Union([PricingId, Ids]) });
export const PricingLifecycleSelection = Schema.Union([PricingId, Ids, Selector,
  Schema.Array(Selector).check(Schema.isMaxLength(4))]);
export function pricingLifecycleIds(selection: typeof PricingLifecycleSelection.Type): string[] {
  return (Array.isArray(selection) ? selection : [selection]).flatMap(member => typeof member === "string" ? [member]
    : typeof member.id === "string" ? [member.id] : [...member.id]);
}
const linkableKeys = pricingStaticResources.joinerConfig?.linkableKeys ?? {};
export const PricingLifecycleConfig = Schema.Struct({ returnLinkableKeys: Schema.optionalKey(Schema.Array(
  Schema.String.check(Schema.makeFilter(key => Object.hasOwn(linkableKeys, key))),
).check(Schema.isMaxLength(Object.keys(linkableKeys).length))) });
export const PricingLifecycleInput = Schema.Struct({ selector: PricingLifecycleSelection, config: PricingLifecycleConfig });
export const decodePricingLifecycleInput = commerceDecoder(PricingLifecycleInput, "invalidInput");
const decodeSelection = commerceDecoder(PricingLifecycleSelection, "unsupportedProfile");

/** Only the native Product-update Link cascade is admitted. Complete checked
 * DML traversal includes PriceList prices and refuses an oversized closure. */
export const softDeletePricingPriceSets = Effect.fn("PricingAdapter.softDeletePriceSets")(function* (
  ctx: CommerceCommandContext, metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"], input: unknown,
) {
  const selected = yield* Effect.fromResult(decodeSelection(yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
  const ids = pricingLifecycleIds(selected);
  if (ids.length > 4 || new Set(ids).size !== ids.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const set = metadata.tables.find(table => table.name === "price_set"), price = metadata.tables.find(table => table.name === "price"),
    rule = metadata.tables.find(table => table.name === "price_rule");
  if (set === undefined || price === undefined || rule === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const catalog = { tables: [set, price, rule], entities: [{ table: set, model: "PriceSet" },
    { table: price, model: "Price" }, { table: rule, model: "PriceRule" }] };
  const lifecycle = medusaLifecycle(ctx, catalog, "softDelete");
  const roots = yield* lifecycle.roots(set, ids);
  const plan = yield* lifecycle.plan(set, roots);
  const rootIds = new Set(roots.map(row => row.id));
  const counts = new Map<string, { base: number; list: number }>();
  for (const row of plan.rows(price)) {
    if (typeof row.id !== "string" || typeof row.price_set_id !== "string" || !rootIds.has(row.price_set_id)
      || (row.price_list_id !== null && typeof row.price_list_id !== "string")) return yield* Effect.fail(commerceError("storedCorruption"));
    const count = counts.get(row.price_set_id) ?? { base: 0, list: 0 };
    if (row.price_list_id === null) count.base++; else count.list++;
    counts.set(row.price_set_id, count);
    if (count.base > 2 || count.list > 2) return yield* Effect.fail(commerceError("limitExceeded"));
  }
  const priceIds = new Set(plan.rows(price).map(row => row.id));
  const ruleCounts = new Map<string, number>();
  for (const row of plan.rows(rule)) {
    if (typeof row.id !== "string" || typeof row.price_id !== "string" || !priceIds.has(row.price_id))
      return yield* Effect.fail(commerceError("storedCorruption"));
    const count = (ruleCounts.get(row.price_id) ?? 0) + 1;
    ruleCounts.set(row.price_id, count);
    if (count > 1) return yield* Effect.fail(commerceError("limitExceeded"));
  }
  return yield* plan.apply();
});
