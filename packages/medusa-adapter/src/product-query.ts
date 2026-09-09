import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { decodeProductQuery } from "./product-query-profile";
import { executeRead } from "./query/read";

export const findProducts = Effect.fn("ProductAdapter.find")(function* (
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, input: unknown, withCount: boolean, internalProduct = false,
) {
  const selected = yield* Effect.fromResult(decodeProductQuery(catalog, input, internalProduct));
  return yield* executeRead(ctx, catalog.readCatalog, {
    table: catalog.product.table.name,
    // Preserve the root profile\'s predicate-node accounting even without joins.
    query: { ...selected.query, predicate: { kind: "and", children: [selected.query.predicate] } },
    projection: selected.projection,
    paths: selected.relations, relationFilters: selected.relationFilters, withDeleted: selected.withDeleted,
    ordering: new Map([[catalog.image.table.name, "rank"]]),
    window: { kind: "database", countAt: "beforePopulation" },
  }, withCount);
});
