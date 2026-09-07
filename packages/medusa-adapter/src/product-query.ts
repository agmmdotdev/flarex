import { Effect } from "effect";
import { projectRowFields, toPopulateTree } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { populateCommerceRelations } from "./commerce-relations";
import { decodeProductQuery } from "./product-query-profile";

export const findProducts = Effect.fn("ProductAdapter.find")(function* (
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, input: unknown, withCount: boolean,
) {
  const selected = yield* decodeProductQuery(catalog, input);
  const table = catalog.product.table.name;
  const store = yield* ctx.table(table);
  const roots = yield* store.find(ctx.manager, selected.query);
  const count = withCount ? yield* store.count(ctx.manager, selected.query) : undefined;
  const populated = yield* populateCommerceRelations(
    ctx, table, roots, selected.relations, catalog.queryRelations,
    new Map([[catalog.image.table.name, "rank"]]),
  );
  const fields = new Set([...selected.selected, ...toPopulateTree(selected.relations).keys()]);
  return { rows: populated.map(row => projectRowFields(row, fields)), count };
});
