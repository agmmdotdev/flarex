import { Effect } from "effect";
import { projectRowFields } from "@medusajs/drizzle/relation-query";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductRuntimeMetadata } from "./product-runtime-metadata";

/** Pinned scalar/to-one projection policy over checked DML. The existing values
 * path is needed by Medusa's update normalization; deeper paths are unadmitted. */
export const productOptionProjection = Effect.fn("ProductAdapter.optionProjection")(function* (
  metadata: ProductRuntimeMetadata, fields: readonly string[] | undefined, relations: readonly string[],
) {
  if (relations.some(path => path !== "product" && path !== "values")) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const columns = metadata.option.table.columns.map(column => column.name);
  const productColumns = metadata.product.table.columns.map(column => column.name);
  const selected: string[] = [], nested: string[] = [];
  for (const field of fields ?? columns) {
    if (columns.includes(field)) selected.push(field);
    else if (relations.includes("product") && field.startsWith("product.") && productColumns.includes(field.slice(8))) nested.push(field.slice(8));
    else return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const rootFields = new Set([...metadata.option.table.columns.filter(column => column.primaryKey).map(column => column.name), ...selected]);
  if (relations.includes("product")) {
    const descriptor = metadata.queryRelations.get(metadata.option.table.name)?.get("product");
    if (descriptor?.join.type !== "belongsTo") return yield* Effect.fail(commerceError("unsupportedProfile"));
    for (const name of descriptor.join.foreignKeys) rootFields.add(name);
  }
  return { rootFields: [...rootFields], selected: new Set([...rootFields, ...relations]), withProduct: relations.includes("product"),
    productFields: new Set(nested.length === 0 ? productColumns : [...metadata.product.table.columns.filter(column => column.primaryKey).map(column => column.name), ...nested]) };
});

export const projectProductOptionRows = Effect.fn("ProductAdapter.projectOptions")(function* (
  rows: readonly JsonObject[], projection: Effect.Success<ReturnType<typeof productOptionProjection>>,
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
