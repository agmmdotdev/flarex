import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { medusaLifecycle } from "../../repository/lifecycle";
import { readCommerceRelationRows } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { decodePriceListPhysicalSelection } from "./list-input";
import type { capturePricingMetadata } from "./schema";

/** Native creation retains root IDs. Its physical inverse owns the complete
 * bounded descendant graph, including history, and leaves external sets/Links. */
export const deletePricingPriceLists = Effect.fn("PricingAdapter.deletePriceLists")(function* (
  ctx: CommerceCommandContext, metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"], input: unknown,
) {
  const selection = yield* Effect.fromResult(decodePriceListPhysicalSelection(
    yield* Effect.fromResult(captureCommerceInput(input, ctx.resources))));
  const ids = selection.$or.map(row => row.id);
  const list = metadata.tables.find(table => table.name === "price_list"), price = metadata.tables.find(table => table.name === "price"),
    listRule = metadata.tables.find(table => table.name === "price_list_rule"), rule = metadata.tables.find(table => table.name === "price_rule");
  if (!list || !price || !listRule || !rule) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const catalog = { tables: [list, price, listRule, rule], entities: [{ table: list, model: "PriceList" },
    { table: price, model: "Price" }, { table: listRule, model: "PriceListRule" }, { table: rule, model: "PriceRule" }] };
  const lifecycle = medusaLifecycle(ctx, catalog, "delete");
  // The bounded original inverse returns roots in their observed storage
  // traversal order. Reuse its authenticated read order, including history;
  // the existing lifecycle owner still plans and removes every descendant.
  const roots = ids.length === 0 ? [] : yield* readCommerceRelationRows(ctx, list.name,
    { kind: "in", column: "id", values: ids }, { kind: "storageInsertion", direction: "asc" });
  const plan = yield* lifecycle.plan(list, roots);
  const rootIds = new Set(roots.map(row => row.id)), priceIds = new Set(plan.rows(price).map(row => row.id));
  // Compensation also owns history and children added after creation. Its
  // closure follows shared resource bounds, not the forward input shape.
  for (const [table, ownerColumn, owners] of [[price, "price_list_id", rootIds], [listRule, "price_list_id", rootIds],
    [rule, "price_id", priceIds]] as const) {
    for (const row of plan.rows(table)) {
      const owner = row[ownerColumn];
      if (typeof row.id !== "string" || typeof owner !== "string" || !owners.has(owner))
        return yield* Effect.fail(commerceError("storedCorruption"));
    }
  }
  return yield* plan.apply();
});
