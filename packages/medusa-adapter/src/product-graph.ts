import { assembleCommerceRelations } from "./commerce-relations";
import { Effect } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
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
export const captureProductGraph = Effect.fn("ProductAdapter.captureGraph")(function* (catalog: ProductRuntimeMetadata, input: unknown) {
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const value = yield* Effect.fromResult(decodeGraphArray(captured));
  const rows = new Map<ProductTable, JsonObject[]>(catalog.entities.map(entity => [entity.table.name, []]));
  rows.set(catalog.pivot.table.name, []);
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
    const root = yield* add(catalog.product, product, {}, ["images", "options", "variants"]);
    products.push(root.id);
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
  if ([...rows.values()].reduce((sum, group) => sum + group.length, 0) > commerceLimits.catalogRows) return yield* Effect.fail(commerceError("limitExceeded"));
  return { products, rows } satisfies ProductGraph;
});

export const insertProductGraph = Effect.fn("ProductAdapter.insertGraph")(function* (ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, graph: ProductGraph) {
  const inserted = new Map<ProductTable, readonly JsonObject[]>();
  for (const table of [...catalog.entities.map(item => item.table.name), catalog.pivot.table.name]) {
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