import { Effect } from "effect";
import { projectRowFields, toPopulateTree } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { populateCommerceRelations } from "./commerce-relations";
import { decodeProductQuery } from "./product-query-profile";
import { resolveCommerceRelationFilter } from "./commerce-relation-filter";
import { isJsonObject, type Json } from "@flarex/persistence-postgres/internal/commerce-values";

export const findProducts = Effect.fn("ProductAdapter.find")(function* (
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, input: unknown, withCount: boolean,
) {
  const selected = yield* decodeProductQuery(catalog, input);
  const table = catalog.product.table.name;
  const store = yield* ctx.table(table);
  const filters: Json[] = [selected.query.predicate];
  for (const filter of selected.relationFilters) filters.push({ kind: "in", column: "id",
    values: yield* resolveCommerceRelationFilter(ctx, table, filter.path, filter.predicate, catalog.queryRelations, selected.withDeleted),
  });
  const query = { ...selected.query, predicate: { kind: "and", children: filters } };
  const roots = yield* store.find(ctx.manager, query);
  const count = withCount ? yield* store.count(ctx.manager, query) : undefined;
  const populated = yield* populateCommerceRelations(
    ctx, table, roots, selected.relations, catalog.queryRelations,
    new Map([[catalog.image.table.name, "rank"]]), selected.withDeleted,
  );
  const fields = new Set([...selected.selected, ...toPopulateTree(selected.relations).keys()]);
  return { rows: populated.map(row => {
    const projected = projectRowFields(row, fields);
    for (const name of ["collection", "type"]) {
      const nested = selected.selected.filter(field => field.startsWith(name + ".")).map(field => field.slice(name.length + 1));
      const related = projected[name];
      if (nested.length && related !== undefined && isJsonObject(related)) projected[name] = projectRowFields(related, new Set(nested));
      // Pinned Drizzle includes null to-one properties when the corresponding
      // FK scalar was selected, even when the relation itself was not populated.
      if (related === undefined && fields.has(name + "_id") && projected[name + "_id"] === null) projected[name] = null;
    }
    return projected;
  }), count };
});
