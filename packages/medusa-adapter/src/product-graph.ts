import { assembleCommerceRelations } from "./commerce-relations";
import { Effect } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, defaultCommerceResources, type CommerceResources, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { decodeGraphArray, decodeVariantReference } from "./product-value-profile";
import type { ProductRuntimeMetadata, ProductEntityMetadata } from "./product-runtime-metadata";
export type ProductTable = string;
export interface ProductGraph { readonly products: readonly string[]; readonly rows: ReadonlyMap<ProductTable, readonly JsonObject[]> }

/** Refuse unsupported input before Medusa can normalize away unknown members. */
export const validateProductCreate = Effect.fn("ProductAdapter.validateCreate")((catalog: ProductRuntimeMetadata, input: Json) =>
  Effect.fromResult(catalog.valueProfile.validateCreate(input)));

/** Decode nodes in traversal order. IDs, parent ownership and repeated-reference
 * equality remain graph invariants rather than structural schema checks. */
export const captureProductGraph = Effect.fn("ProductAdapter.captureGraph")(function* (catalog: ProductRuntimeMetadata, input: unknown, resources: CommerceResources = defaultCommerceResources) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input, resources));
  const value = yield* Effect.fromResult(decodeGraphArray(captured));
  const rows = new Map<ProductTable, JsonObject[]>(catalog.entities.map(entity => [entity.table.name, []]));
  for (const table of catalog.writablePivots) rows.set(table.name, []);
  const ids = new Set<string>();
  const products: string[] = [];
  const add = Effect.fn("ProductAdapter.graphRow")(function* (entity: ProductEntityMetadata, inputRow: Json, extra: JsonObject, relations: readonly string[]) {
    const { supplied, id: suppliedId } = yield* Effect.fromResult(catalog.valueProfile.decodeRow(entity.table.name, inputRow));
    const table = entity.table.name;
    if (Object.keys(extra).some(name => supplied[name] !== undefined && supplied[name] !== extra[name])) return yield* Effect.fail(commerceError("invalidInput"));
    const id = generateEntityId(suppliedId, entity.prefix);
    if (ids.has(table + ":" + id)) return yield* Effect.fail(commerceError("invalidInput"));
    ids.add(table + ":" + id);
    const row: JsonObject = { ...Object.fromEntries(Object.entries(supplied).filter(([name]) => !relations.includes(name))), ...extra, id };
    rows.get(table)?.push(row);
    return { id, supplied };
  });
  const members = (parent: JsonObject, name: string) => Effect.fromResult(decodeGraphArray(parent[name] ?? []));
  for (const product of value) {
    const root = yield* add(catalog.product, product, {}, ["images", "options", "variants", "tags", "categories"]);
    products.push(root.id);
    const tags = catalog.queryRelations.get(catalog.product.table.name)?.get("tags");
    if (tags?.join.type !== "manyToMany") return yield* Effect.fail(commerceError("unsupportedProfile"));
    const sourceKey = tags.join.sourceColumns[0];
    const targetKey = tags.join.targetColumns[0];
    if (sourceKey === undefined || targetKey === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const linkedTags = new Set<string>();
    for (const inputTag of yield* members(root.supplied, "tags")) {
      const tag = yield* Effect.fromResult(decodeVariantReference(inputTag));
      if (linkedTags.has(tag.id)) return yield* Effect.fail(commerceError("invalidInput"));
      linkedTags.add(tag.id);
      rows.get(tags.join.pivotTable)?.push({ [sourceKey]: root.id, [targetKey]: tag.id });
    }
    const categories = catalog.queryRelations.get(catalog.product.table.name)?.get("categories");
    if (categories?.join.type !== "manyToMany") return yield* Effect.fail(commerceError("unsupportedProfile"));
    const categorySource = categories.join.sourceColumns[0], categoryTarget = categories.join.targetColumns[0];
    if (categorySource === undefined || categoryTarget === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const linkedCategories = new Set<string>();
    for (const inputCategory of yield* members(root.supplied, "categories")) {
      if (typeof inputCategory !== "string" || linkedCategories.has(inputCategory)) return yield* Effect.fail(commerceError("invalidInput"));
      linkedCategories.add(inputCategory);
      rows.get(categories.join.pivotTable)?.push({ [categorySource]: root.id, [categoryTarget]: inputCategory });
    }
    const variants = new Map<string, JsonObject>();
    for (const variant of yield* members(root.supplied, "variants")) {
      const row = yield* add(catalog.variant, variant, { [catalog.foreignKeys.variant]: root.id }, []);
      variants.set(row.id, row.supplied);
    }
    for (const image of yield* members(root.supplied, "images")) yield* add(catalog.image, image, { [catalog.foreignKeys.image]: root.id }, []);
    for (const option of yield* members(root.supplied, "options")) {
      const row = yield* add(catalog.option, option, { [catalog.foreignKeys.option]: root.id }, ["values"]);
      for (const optionValue of yield* members(row.supplied, "values")) {
        const child = yield* add(catalog.value, optionValue, { [catalog.foreignKeys.value]: row.id }, ["variants"]);
        const linked = new Set<string>();
        for (const inputVariant of yield* members(child.supplied, "variants")) {
          const variant = yield* Effect.fromResult(decodeVariantReference(inputVariant));
          if (linked.has(variant.id)) return yield* Effect.fail(commerceError("invalidInput"));
          const declared = variants.get(variant.id);
          if (declared === undefined || JSON.stringify(declared) !== JSON.stringify(variant)) return yield* Effect.fail(commerceError("invalidInput"));
          linked.add(variant.id);
          rows.get(catalog.pivot.table.name)?.push({ [catalog.pivot.variantColumn]: variant.id, [catalog.pivot.valueColumn]: child.id });
        }
      }
    }
  }
  const graphRows = [...rows.values()].reduce((sum, group) => sum + group.length, 0);
  if (graphRows > resources.facts) return yield* Effect.fail(commerceError("limitExceeded", {
    boundary: "productGraphRows", maximum: resources.facts, attempted: graphRows,
    tables: Object.fromEntries([...rows].map(([table, group]) => [table, group.length])),
  }));
  return { products, rows } satisfies ProductGraph;
});

export const insertProductGraph = Effect.fn("ProductAdapter.insertGraph")(function* (ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, graph: ProductGraph) {
  const inserted = new Map<ProductTable, readonly JsonObject[]>();
  for (const table of [...catalog.entities.map(item => item.table.name), ...catalog.writablePivots.map(item => item.name)]) {
    const rows = graph.rows.get(table) ?? [];
    if (rows.length === 0) { inserted.set(table, []); continue; }
    const store = yield* ctx.table(table);
    inserted.set(table, yield* store.write(ctx.manager, "insert", rows));
  }
  return inserted;
});

/** Reuse Medusa's relation grouping for the newly inserted, acyclic graph. */
export function assembleProducts(catalog: ProductRuntimeMetadata, rows: ReadonlyMap<ProductTable, readonly JsonObject[]>, relations: readonly string[]): JsonObject[] {
  return assembleCommerceRelations(catalog.product.table.name, rows, relations, catalog.queryRelations);
}
