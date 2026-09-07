import { Effect } from "effect";
import { generateEntityId } from "@medusajs/framework/utils/portable";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import type { ProductRuntimeMetadata, ProductEntityMetadata } from "./product-runtime-metadata";
export type ProductTable = string;
export interface ProductGraph { readonly products: readonly string[]; readonly rows: ReadonlyMap<ProductTable, readonly JsonObject[]> }

/** Refuse unsupported input before Medusa can normalize away unknown members. */
export const validateProductCreate = Effect.fn("ProductAdapter.validateCreate")(function* (catalog: ProductRuntimeMetadata, input: Json) {
  const scalarNames = (name: string) => {
    const table = catalog.entities.find(value => value.table.name === name)?.table;
    const managed = ["created_at", "updated_at", "deleted_at", ...(table?.foreignKeys.flatMap(key => key.columns) ?? [])];
    return table?.columns.map(column => column.name).filter(column => !managed.includes(column)) ?? [];
  };
  const check = (value: Json, names: readonly string[]) => isJsonObject(value) && Object.keys(value).every(key => names.includes(key));
  for (const product of Array.isArray(input) ? input : [input]) {
    if (!check(product, [...scalarNames(catalog.product.table.name), "options", "variants", "images"]) || !isJsonObject(product)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    for (const relation of ["options", "variants", "images"]) {
      const children = product[relation];
      if (children === undefined) continue;
      if (!Array.isArray(children)) return yield* Effect.fail(commerceError("invalidInput"));
      for (const child of children) {
        const allowed = relation === "options" ? ["title", "values"] : relation === "images" ? scalarNames(catalog.image.table.name) : [...scalarNames(catalog.variant.table.name), "options"];
        if (!check(child, allowed) || !isJsonObject(child)) return yield* Effect.fail(commerceError("unsupportedProfile"));
        if (relation === "options" && child.values !== undefined && (!Array.isArray(child.values) || child.values.some(value => typeof value !== "string"))) return yield* Effect.fail(commerceError("invalidInput"));
        if (relation === "variants" && child.options !== undefined && (!isJsonObject(child.options) || Object.values(child.options).some(value => typeof value !== "string"))) return yield* Effect.fail(commerceError("invalidInput"));
      }
    }
  }
});

/** The service has already assigned variants and moved option links into values.
 * Capture its acyclic graph and resolve repeated references by validated IDs. */
export const captureProductGraph = Effect.fn("ProductAdapter.captureGraph")(function* (catalog: ProductRuntimeMetadata, input: unknown) {
  const value = yield* Effect.fromResult(captureCommerceInput(input));
  if (!Array.isArray(value)) return yield* Effect.fail(commerceError("invalidInput"));
  const rows = new Map<ProductTable, JsonObject[]>(catalog.entities.map(entity => [entity.table.name, []]));
  rows.set(catalog.pivot.table.name, []);
  const ids = new Set<string>();
  const products: string[] = [];
  const add = Effect.fn("ProductAdapter.graphRow")(function* (entity: ProductEntityMetadata, supplied: Json, extra: JsonObject, relations: readonly string[]) {
    if (!isJsonObject(supplied)) return yield* Effect.fail(commerceError("invalidInput"));
    const descriptor = entity.table;
    const table = descriptor.name;
    const fields = descriptor.columns.map(column => column.name);
    if (Object.keys(supplied).some(name => !fields.includes(name) && !relations.includes(name)) ||
      Object.keys(extra).some(name => supplied[name] !== undefined && supplied[name] !== extra[name]) ||
      (supplied.id !== undefined && (typeof supplied.id !== "string" || supplied.id.length === 0 || supplied.id.length > 256))) return yield* Effect.fail(commerceError("invalidInput"));
    const id = generateEntityId(typeof supplied.id === "string" ? supplied.id : undefined, entity.prefix);
    if (ids.has(table + ":" + id)) return yield* Effect.fail(commerceError("invalidInput"));
    ids.add(table + ":" + id);
    const row: JsonObject = { ...Object.fromEntries(Object.entries(supplied).filter(([name]) => !relations.includes(name))), ...extra, id };
    rows.get(table)?.push(row);
    return row;
  });
  const members = Effect.fn("ProductAdapter.graphMembers")(function* (parent: JsonObject, name: string) {
    const items = parent[name] ?? [];
    if (!Array.isArray(items)) return yield* Effect.fail(commerceError("invalidInput"));
    return items;
  });
  for (const product of value) {
    if (!isJsonObject(product)) return yield* Effect.fail(commerceError("invalidInput"));
    const root = yield* add(catalog.product, product, {}, ["images", "options", "variants"]);
    if (typeof root.id !== "string") return yield* Effect.fail(commerceError("invalidInput"));
    products.push(root.id);
    const variants = new Map<string, JsonObject>();
    for (const variant of yield* members(product, "variants")) {
      const row = yield* add(catalog.variant, variant, { [catalog.foreignKeys.variant]: root.id }, []);
      if (typeof row.id !== "string" || !isJsonObject(variant)) return yield* Effect.fail(commerceError("invalidInput"));
      variants.set(row.id, variant);
    }
    for (const image of yield* members(product, "images")) yield* add(catalog.image, image, { [catalog.foreignKeys.image]: root.id }, []);
    for (const option of yield* members(product, "options")) {
      const row = yield* add(catalog.option, option, { [catalog.foreignKeys.option]: root.id }, ["values"]);
      if (!isJsonObject(option) || typeof row.id !== "string") return yield* Effect.fail(commerceError("invalidInput"));
      for (const optionValue of yield* members(option, "values")) {
        const child = yield* add(catalog.value, optionValue, { [catalog.foreignKeys.value]: row.id }, ["variants"]);
        if (!isJsonObject(optionValue) || typeof child.id !== "string") return yield* Effect.fail(commerceError("invalidInput"));
        const linked = new Set<string>();
        for (const variant of yield* members(optionValue, "variants")) {
          if (!isJsonObject(variant) || typeof variant.id !== "string" || linked.has(variant.id)) return yield* Effect.fail(commerceError("invalidInput"));
          const declared = variants.get(variant.id);
          if (declared === undefined || JSON.stringify(declared) !== JSON.stringify(variant)) return yield* Effect.fail(commerceError("invalidInput"));
          linked.add(variant.id);
          rows.get(catalog.pivot.table.name)?.push({ [catalog.pivot.variantColumn]: variant.id, [catalog.pivot.valueColumn]: child.id });
        }
      }
    }
  }
  if ([...rows.values()].reduce((sum, group) => sum + group.length, 0) > 256) return yield* Effect.fail(commerceError("limitExceeded"));
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

/** Acyclic projection. Relationship queries remain scope bound in the core. */
export function assembleProducts(catalog: ProductRuntimeMetadata, rows: ReadonlyMap<ProductTable, readonly JsonObject[]>, relations: readonly string[]): JsonObject[] {
  const group = (table: ProductTable) => rows.get(table) ?? [];
  const wants = (name: string) => relations.some(relation => relation === name || relation.startsWith(name + "."));
  return group(catalog.product.table.name).map(product => ({ ...product,
    ...(wants("images") ? { images: group(catalog.image.table.name).filter(image => image[catalog.foreignKeys.image] === product.id) } : {}),
    ...(wants("options") ? { options: group(catalog.option.table.name).filter(option => option[catalog.foreignKeys.option] === product.id).map(option => ({ ...option,
      ...(wants("options.values") ? { values: group(catalog.value.table.name).filter(value => value[catalog.foreignKeys.value] === option.id) } : {}),
    })) } : {}),
    ...(wants("variants") ? { variants: group(catalog.variant.table.name).filter(variant => variant[catalog.foreignKeys.variant] === product.id).map(variant => ({ ...variant,
      ...(wants("variants.options") ? { options: group(catalog.value.table.name).filter(value => group(catalog.pivot.table.name).some(pair => pair[catalog.pivot.variantColumn] === variant.id && pair[catalog.pivot.valueColumn] === value.id)) } : {}),
    })) } : {}),
  }));
}
