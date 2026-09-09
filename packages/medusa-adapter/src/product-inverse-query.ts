import { Effect } from "effect";
import { projectRowFields } from "@medusajs/drizzle/relation-query";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";

/** Bounded form of pinned projectLoadedRelationsFromTree: Tag/Collection -> Products, with Tag -> Products ->
 * Collection admitted separately. DML owns primary/FK names; the fork owns projection rules. */
export const productInverseProjection = Effect.fn("ProductAdapter.inverseProjection")(function* (
  metadata: ProductRuntimeMetadata, owner: "tag" | "collection", fields: readonly string[] | undefined, relations: readonly string[],
) {
  if (relations.some(path => path !== "products" && !(owner === "tag" && path === "products.collection"))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const rootColumns = metadata[owner].table.columns.map(column => column.name);
  const productColumns = metadata.product.table.columns.map(column => column.name);
  const selectedProducts: string[] = [];
  const selectedRoot: string[] = [];
  for (const field of fields ?? rootColumns) {
    if (rootColumns.includes(field)) selectedRoot.push(field);
    else if (field.startsWith("products.") && productColumns.includes(field.slice(9)) && relations.length > 0) selectedProducts.push(field.slice(9));
    else return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const rootFields = [...new Set([...metadata[owner].table.columns.filter(column => column.primaryKey).map(column => column.name), ...selectedRoot])];
  const childFields = new Set(selectedProducts.length === 0 ? productColumns
    : [...metadata.product.table.columns.filter(column => column.primaryKey).map(column => column.name), ...selectedProducts]);
  if (owner === "collection") {
    const products = metadata.queryRelations.get(metadata.collection.table.name)?.get("products");
    if (products?.join.type !== "hasMany") return yield* Effect.fail(commerceError("unsupportedProfile"));
    for (const name of products.join.foreignKeys) childFields.add(name);
  }
  const collection = metadata.queryRelations.get(metadata.product.table.name)?.get("collection");
  if (collection?.join.type !== "belongsTo") return yield* Effect.fail(commerceError("unsupportedProfile"));
  if (relations.includes("products.collection")) {
    childFields.add("collection");
    for (const name of collection.join.foreignKeys) childFields.add(name);
  }
  return { rootFields, childFields };
});

export const projectProductInverseRows = Effect.fn("ProductAdapter.projectInverseRows")(function* (
  rows: readonly JsonObject[], projection: Effect.Success<ReturnType<typeof productInverseProjection>>, withProducts: boolean,
) {
  const selected = new Set(projection.rootFields);
  if (withProducts) selected.add("products");
  const result: JsonObject[] = [];
  for (const row of rows) {
    const projected = projectRowFields(row, selected);
    if (withProducts) {
      if (!Array.isArray(row.products)) return yield* Effect.fail(commerceError("storedCorruption"));
      const products: JsonObject[] = [];
      for (const product of row.products) {
        if (!isJsonObject(product)) return yield* Effect.fail(commerceError("storedCorruption"));
        const child = projectRowFields(product, projection.childFields);
        products.push(child);
      }
      projected.products = products;
    }
    result.push(projected);
  }
  return result;
});
