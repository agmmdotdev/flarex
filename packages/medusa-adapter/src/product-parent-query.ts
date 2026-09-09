import { Effect } from "effect";
import { projectRowFields } from "@medusajs/drizzle/relation-query";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";

/** Pinned scalar/to-one projection over checked DML. Each entity retains its
 * bounded relation paths, including the service-owned Variant image read. */
export const productParentProjection = Effect.fn("ProductAdapter.parentProjection")(function* (
  metadata: ProductRuntimeMetadata, kind: "option" | "variant", fields: readonly string[] | undefined, relations: readonly string[],
) {
  const allowed = kind === "option" ? ["product", "values"] : ["product", "product.images", "images", "options"];
  const withProduct = relations.some(path => path === "product" || path.startsWith("product."));
  if (relations.some(path => !allowed.includes(path))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const columns = metadata[kind].table.columns.map(column => column.name);
  const productColumns = metadata.product.table.columns.map(column => column.name);
  const selected: string[] = [], nested: string[] = [];
  for (const field of fields ?? columns) {
    if (columns.includes(field)) selected.push(field);
    else if (withProduct && field.startsWith("product.") && productColumns.includes(field.slice(8))) nested.push(field.slice(8));
    else return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const rootFields = new Set([...metadata[kind].table.columns.filter(column => column.primaryKey).map(column => column.name), ...selected]);
  if (withProduct) {
    const descriptor = metadata.queryRelations.get(metadata[kind].table.name)?.get("product");
    if (descriptor?.join.type !== "belongsTo") return yield* Effect.fail(commerceError("unsupportedProfile"));
    for (const name of descriptor.join.foreignKeys) rootFields.add(name);
  }
  return { rootFields: [...rootFields], selected: new Set([...rootFields, ...relations.map(path => path.split(".")[0]).filter((name): name is string => name !== undefined)]), withProduct,
    productFields: new Set([...(nested.length === 0 ? productColumns : [...metadata.product.table.columns.filter(column => column.primaryKey).map(column => column.name), ...nested]), ...(relations.includes("product.images") ? ["images"] : [])]) };
});

export const projectProductParentRows = Effect.fn("ProductAdapter.projectParents")(function* (
  rows: readonly JsonObject[], projection: Effect.Success<ReturnType<typeof productParentProjection>>,
) {
  const result: JsonObject[] = [];
  for (const row of rows) {
    const projected = projectRowFields(row, projection.selected);
    if (projection.withProduct) {
      if (row.product === undefined || (row.product !== null && !isJsonObject(row.product))) return yield* Effect.fail(commerceError("storedCorruption"));
      projected.product = row.product === null ? null : projectRowFields(row.product, projection.productFields);
    }
    result.push(projected);
  }
  return result;
});
