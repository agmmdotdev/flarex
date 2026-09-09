import { Effect } from "effect";
import { assembleCommerceRelations } from "./commerce-relations";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources, type CommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { productCreationProfile, productGraphCatalog } from "./product-graph-profile";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";
import { captureGraph, insertGraphRows } from "./write/create";

export type ProductTable = string;
export interface ProductGraph { readonly products: readonly string[]; readonly rows: ReadonlyMap<ProductTable, readonly JsonObject[]> }

/** Refuse unsupported input before Medusa can normalize away unknown members. */
export const validateProductCreate = Effect.fn("ProductAdapter.validateCreate")((catalog: ProductRuntimeMetadata, input: Json) =>
  Effect.fromResult(catalog.valueProfile.validateCreate(input)));

export const captureProductGraph = Effect.fn("ProductAdapter.captureGraph")(function* (
  catalog: ProductRuntimeMetadata, input: unknown, resources: CommerceResources = defaultCommerceResources,
) {
  const graph = yield* captureGraph(productCreationProfile(catalog), input, resources);
  return { products: graph.roots, rows: graph.rows } satisfies ProductGraph;
});

export const insertProductGraph = Effect.fn("ProductAdapter.insertGraph")((
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, graph: ProductGraph,
) => insertGraphRows(ctx, productGraphCatalog(catalog), graph.rows));

/** Reuse Medusa's relation grouping for the newly inserted, acyclic graph. */
export function assembleProducts(catalog: ProductRuntimeMetadata, rows: ReadonlyMap<ProductTable, readonly JsonObject[]>, relations: readonly string[]): JsonObject[] {
  return assembleCommerceRelations(catalog.product.table.name, rows, relations, catalog.queryRelations);
}
