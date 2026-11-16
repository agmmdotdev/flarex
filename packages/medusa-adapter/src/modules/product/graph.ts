import { Effect } from "effect";
import { assembleCommerceRelations } from "../../query/relations";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { defaultCommerceResources, type CommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { productCreationProfile, productGraphCatalog } from "./graph-profile";
import type { ProductRuntimeMetadata } from "./runtime-metadata";
import { captureGraph, insertGraphRows } from "../../write/create";
import { observeExecution } from "@flarex/persistence-postgres/internal/execution-diagnostics";

export type ProductTable = string;
export interface ProductGraph { readonly products: readonly string[]; readonly rows: ReadonlyMap<ProductTable, readonly JsonObject[]> }

/** Refuse unsupported input before Medusa can normalize away unknown members. */
export const validateProductCreate = (catalog: ProductRuntimeMetadata, input: Json) =>
  Effect.withSpan(Effect.suspend(() => Effect.fromResult(catalog.valueProfile.validateCreate(input))),
    "ProductAdapter.validateCreate", { captureStackTrace: false });

export const captureProductGraph = Effect.fnUntraced(function* (
  catalog: ProductRuntimeMetadata, input: unknown, resources: CommerceResources = defaultCommerceResources,
) {
  const graph = yield* captureGraph(productCreationProfile(catalog), input, resources);
  return { products: graph.roots, rows: graph.rows } satisfies ProductGraph;
}, work => observeExecution("ProductGraph.capture", work), effect => Effect.withSpan(effect, "ProductAdapter.captureGraph", { captureStackTrace: false }));

export const insertProductGraph = (ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, graph: ProductGraph) =>
  Effect.withSpan(Effect.suspend(() => observeExecution("ProductGraph.insert", insertGraphRows(ctx, productGraphCatalog(catalog), graph.rows))),
    "ProductAdapter.insertGraph", { captureStackTrace: false });

/** Reuse Medusa's relation grouping for the newly inserted, acyclic graph. */
export function assembleProducts(catalog: ProductRuntimeMetadata, rows: ReadonlyMap<ProductTable, readonly JsonObject[]>, relations: readonly string[]) {
  return assembleCommerceRelations(catalog.product.table.name, rows, relations, catalog.queryRelations);
}
