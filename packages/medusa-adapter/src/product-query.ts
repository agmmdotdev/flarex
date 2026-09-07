import { productRelations, type ProductRuntimeMetadata } from "./product-runtime-metadata";
import { Effect } from "effect";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCommerceInput } from "./commerce-input";
import { assembleProducts, type ProductTable } from "./product-graph";

export const decodeProductQuery = Effect.fn("ProductAdapter.decodeQuery")(function* (catalog: ProductRuntimeMetadata, input: unknown) {
  const value = yield* Effect.fromResult(captureCommerceInput(input));
  if (!isJsonObject(value) || Object.keys(value).some(key => !["where", "options"].includes(key))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const where = value.where ?? {};
  const options = value.options ?? {};
  if (!isJsonObject(where) || !isJsonObject(options) || Object.keys(options).some(key => !["fields", "populate", "limit", "offset", "orderBy"].includes(key))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const relations = options.populate ?? [];
  if (!Array.isArray(relations) || relations.some(relation => typeof relation !== "string" || !productRelations.includes(relation))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const requested: string[] = [];
  for (const relation of relations) { if (typeof relation !== "string") return yield* Effect.fail(commerceError("invalidInput")); requested.push(relation); }
  const scalarFields = catalog.product.table.columns.map(column => column.name) ?? [];
  const fields = options.fields ?? scalarFields;
  if (!Array.isArray(fields) || fields.length === 0 || fields.some(field => typeof field !== "string" || !scalarFields.includes(field))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const selected: string[] = [];
  for (const field of fields) { if (typeof field !== "string") return yield* Effect.fail(commerceError("invalidInput")); selected.push(field); }
  const skip = options.offset ?? 0;
  const take = options.limit ?? 15;
  if (typeof skip !== "number" || !Number.isSafeInteger(skip) || skip < 0 || skip > 255 || typeof take !== "number" || !Number.isSafeInteger(take) || take < 0 || take > 256) return yield* Effect.fail(commerceError("limitExceeded"));
  const order = options.orderBy ?? { id: "ASC" };
  if (!isJsonObject(order) || Object.keys(order).some(key => !["id", "handle", "images"].includes(key))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  if (order.images !== undefined && (!isJsonObject(order.images) || Object.keys(order.images).length !== 1 || order.images.rank !== "ASC")) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const orders = Object.entries(order).filter(([key]) => key !== "images");
  if (orders.length > 1 || orders.some(([, direction]) => direction !== "ASC" && direction !== "DESC")) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const ordered = orders[0];
  const predicates: Json[] = [{ kind: "isNull", column: "deleted_at" }];
  for (const [column, filter] of Object.entries(where)) {
    if (!["id", "handle"].includes(column)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const values = Array.isArray(filter) ? filter : [filter];
    if (values.length > 256 || values.some(member => typeof member !== "string")) return yield* Effect.fail(commerceError("invalidInput"));
    predicates.push({ kind: "in", column, values });
  }
  return { selected, relations: requested, query: { fields: [...new Set([...selected, "id"])], skip, take,
    order: { column: ordered?.[0] ?? "id", direction: ordered?.[1] === "DESC" ? "desc" : "asc" },
    predicate: { kind: "and", children: predicates } } satisfies JsonObject };
});

export const findProducts = Effect.fn("ProductAdapter.find")(function* (ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, input: unknown, withCount: boolean) {
  const selected = yield* decodeProductQuery(catalog, input);
  const store = yield* ctx.table(catalog.product.table.name);
  const roots = yield* store.find(ctx.manager, selected.query);
  const count = withCount ? yield* store.count(ctx.manager, selected.query) : undefined;
  const rows = new Map<ProductTable, readonly JsonObject[]>([[catalog.product.table.name, roots]]);
  const wants = (name: string) => selected.relations.some(relation => relation === name || relation.startsWith(name + "."));
  const load = Effect.fn("ProductAdapter.populate")(function* (table: ProductTable, column: string, parents: readonly JsonObject[], order: string = "id") {
    if (parents.length === 0) { rows.set(table, []); return; }
    const target = yield* ctx.table(table);
    const values: Json[] = [];
    for (const parent of parents) {
      if (typeof parent.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
      values.push(parent.id);
    }
    rows.set(table, yield* target.find(ctx.manager, { take: 256, order: { column: order, direction: "asc" },
      predicate: { kind: "and", children: [{ kind: "in", column, values }, ...(table === catalog.pivot.table.name ? [] : [{ kind: "isNull", column: "deleted_at" }])] } }));
  });
  if (wants("images")) yield* load(catalog.image.table.name, catalog.foreignKeys.image, roots, "rank");
  if (wants("options") || wants("variants.options")) yield* load(catalog.option.table.name, catalog.foreignKeys.option, roots);
  if (wants("options.values") || wants("variants.options")) yield* load(catalog.value.table.name, catalog.foreignKeys.value, rows.get(catalog.option.table.name) ?? []);
  if (wants("variants")) yield* load(catalog.variant.table.name, catalog.foreignKeys.variant, roots);
  if (wants("variants.options")) yield* load(catalog.pivot.table.name, catalog.pivot.variantColumn, rows.get(catalog.variant.table.name) ?? [], catalog.pivot.variantColumn);
  const result = assembleProducts(catalog, rows, selected.relations).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => selected.selected.includes(key) || wants(key))));
  return { rows: result, count };
});
