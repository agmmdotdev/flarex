import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "../../value/input";
import { medusaLifecycle } from "../../repository/lifecycle";
import type { capturePricingMetadata } from "./schema";
import { decodeShippingPricingSelection, decodeShippingPricingPhysicalSelection, shippingPricingIds } from "./shipping-input";

/** Only the selected Shipping Option graph is admitted. Historical descendants
 * remain in the complete plan, including rows already soft deleted. */
export const changeShippingPriceSets = Effect.fn("PricingAdapter.changeShippingPriceSets")(function* (
  ctx: CommerceCommandContext, metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"],
  input: unknown, operation: "delete" | "softDelete" | "restore",
) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
  const ids = operation === "delete"
    ? (yield* Effect.fromResult(decodeShippingPricingPhysicalSelection(captured))).$or.map(row => row.id)
    : shippingPricingIds(yield* Effect.fromResult(decodeShippingPricingSelection(captured)));
  const maximumRoots = operation === "delete" ? 4 : 8, maximumRules = operation === "delete" ? 24 : 48;
  if (ids.length > maximumRoots || new Set(ids).size !== ids.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const set = metadata.tables.find(table => table.name === "price_set"), price = metadata.tables.find(table => table.name === "price"),
    rule = metadata.tables.find(table => table.name === "price_rule");
  if (!set || !price || !rule) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const catalog = { tables: [set, price, rule], entities: [{ table: set, model: "PriceSet" },
    { table: price, model: "Price" }, { table: rule, model: "PriceRule" }] };
  const lifecycle = medusaLifecycle(ctx, catalog, operation), roots = yield* lifecycle.roots(set, ids), plan = yield* lifecycle.plan(set, roots);
  const rootIds = new Set(roots.map(row => row.id)), counts = new Map<string, number>();
  for (const row of plan.rows(price)) {
    if (typeof row.id !== "string" || typeof row.price_set_id !== "string" || !rootIds.has(row.price_set_id) || row.price_list_id !== null)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    const count = (counts.get(row.price_set_id) ?? 0) + 1; counts.set(row.price_set_id, count);
    if (count > 2) return yield* Effect.fail(commerceError("limitExceeded"));
  }
  const prices = new Set(plan.rows(price).map(row => row.id));
  if (plan.rows(rule).length > maximumRules) return yield* Effect.fail(commerceError("limitExceeded"));
  for (const row of plan.rows(rule)) if (typeof row.price_id !== "string" || !prices.has(row.price_id))
    return yield* Effect.fail(commerceError("storedCorruption"));
  const preimages = new Map<string, readonly JsonObject[]>(catalog.entities.map(entity => [entity.model, plan.rows(entity.table)]));
  const result = yield* plan.apply();
  // Native Drizzle builds lifecycle maps in DML relationship traversal order.
  const cascades: Record<string, JsonObject[]> = {};
  for (const entity of catalog.entities) {
    const rows = result.cascades[entity.model];
    if (rows !== undefined) cascades[entity.model] = rows;
  }
  return { ...result, cascades, preimages };
});
