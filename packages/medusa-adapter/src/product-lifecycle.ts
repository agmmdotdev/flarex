import { Effect, Schema } from "effect";
import { describeToManyRelation, tupleKey } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { captureCommerceInput } from "./commerce-input";
import { commerceDecoder } from "./commerce-decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const decodeProductLifecycleIds = commerceDecoder(Schema.Union([Id, Schema.Array(Id).check(Schema.isMaxLength(commerceLimits.catalogRows))]), "invalidInput");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(commerceLimits.catalogRows)) }), "invalidInput");
type Table = ProductRuntimeMetadata["tables"][number];

/** Operation-local DML cascade. The pinned repository's cascadeDelete metadata
 * selects managed transitions; physical FK cascades select explicit removals.
 * Reads, managed timestamps, bounded SQL and complete row facts stay in core. */
export const changeProductLifecycle = Effect.fn("ProductAdapter.lifecycle")(function* (
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, entity: ProductEntityMetadata,
  operation: "delete" | "softDelete" | "restore", input: unknown,
) {
  if (operation !== "delete" && entity !== catalog.product) return yield* Effect.fail(commerceError("unsupportedProfile"));
  if (operation === "delete" && ![catalog.product, catalog.tag, catalog.type, catalog.collection, catalog.category].includes(entity)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const captured = yield* Effect.fromResult(captureCommerceInput(input));
  const selected = operation === "delete" ? (yield* Effect.fromResult(decodeDelete(captured))).$or.map(row => row.id)
    : yield* Effect.fromResult(decodeProductLifecycleIds(captured));
  const ids = typeof selected === "string" ? [selected] : selected;
  if (new Set(ids).size !== ids.length) return yield* Effect.fail(commerceError("invalidInput"));
  const state = new Map<string, readonly JsonObject[]>();
  const stores = new Map<string, Effect.Success<ReturnType<CommerceCommandContext["table"]>>>();
  const getStore = Effect.fn("ProductLifecycle.store")(function* (table: Table) {
    const prior = stores.get(table.name);
    if (prior !== undefined) return prior;
    const store = yield* ctx.table(table.name); stores.set(table.name, store); return store;
  });
  const keys = (table: Table) => table.columns.some(column => column.primaryKey) ? table.columns.filter(column => column.primaryKey).map(column => column.name)
    : table.foreignKeys.flatMap(key => key.columns);
  const load = Effect.fn("ProductLifecycle.load")(function* (table: Table) {
    const prior = state.get(table.name);
    if (prior !== undefined) return prior;
    const order = keys(table)[0];
    if (order === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const store = yield* getStore(table);
    const rows = yield* store.find(ctx.manager, { take: commerceLimits.catalogRows, order: { column: order, direction: "asc" } });
    state.set(table.name, rows); return rows;
  });
  const roots = (yield* load(entity.table)).filter(row => typeof row.id === "string" && ids.includes(row.id) && (operation !== "softDelete" || row.deleted_at === null));
  const rerank: JsonObject[] = [];
  if (entity === catalog.category) {
    const categories = yield* load(entity.table);
    if (roots.length !== ids.length || roots.some(row => row.parent_category_id !== null || categories.some(child => child.parent_category_id === row.id && child.deleted_at === null)))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    const ranks: number[] = [];
    for (const row of roots) {
      if (typeof row.rank !== "number") return yield* Effect.fail(commerceError("storedCorruption"));
      ranks.push(row.rank);
    }
    for (const row of categories) {
      if (row.parent_category_id !== null || row.deleted_at !== null || typeof row.id !== "string" || ids.includes(row.id)) continue;
      const rank = row.rank;
      if (typeof rank !== "number") return yield* Effect.fail(commerceError("storedCorruption"));
      const removedBefore = ranks.filter(value => value < rank).length;
      if (removedBefore) rerank.push({ id: row.id, rank: rank - removedBefore });
    }
  }
  const planned = new Map<string, Map<string, JsonObject>>();
  const visit = Effect.fn("ProductLifecycle.visit")(function* (table: Table, row: JsonObject): Effect.fn.Return<void, CommerceTransactionError> {
    const identity = tupleKey(row, keys(table));
    const group = planned.get(table.name) ?? new Map<string, JsonObject>();
    if (group.has(identity)) return;
    group.set(identity, row); planned.set(table.name, group);
    if (operation === "delete") {
      for (const child of catalog.tables) for (const fk of child.foreignKeys.filter(fk => fk.referencedTable === table.name && fk.onDelete === "cascade")) {
        for (const member of (yield* load(child)).filter(value => tupleKey(value, fk.columns) === tupleKey(row, fk.referencedColumns))) yield* visit(child, member);
      }
    } else {
      for (const relation of table.relationships.filter(relation => relation.cascadeDelete)) {
        const descriptor = describeToManyRelation(table, relation.name, catalog.tables);
        if (descriptor?.join.type !== "hasMany") return yield* Effect.fail(commerceError("unsupportedProfile"));
        const child = catalog.tables.find(table => table.name === descriptor.targetTable);
        if (child === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        const columns = descriptor.join.foreignKeys;
        for (const member of (yield* load(child)).filter(value => tupleKey(value, columns) === tupleKey(row, descriptor.sourcePrimaryKeys))) yield* visit(child, member);
      }
    }
  });
  for (const row of roots) yield* visit(entity.table, row);
  // The pinned repository detaches non-cascading hasMany references before
  // removing a type/collection. These are the profile's admitted nullable
  // Product reference writes, with normal core facts and managed timestamps.
  if (operation === "delete" && [catalog.type, catalog.collection].includes(entity)) {
    for (const relation of entity.table.relationships.filter(relation => relation.type === "hasMany" && !relation.cascadeDelete)) {
      const descriptor = describeToManyRelation(entity.table, relation.name, catalog.tables);
      if (descriptor?.join.type !== "hasMany" || descriptor.targetTable !== catalog.product.table.name)
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      const columns = descriptor.join.foreignKeys;
      if (columns.length !== descriptor.sourcePrimaryKeys.length || columns.some(name => !["type_id", "collection_id"].includes(name)))
        return yield* Effect.fail(commerceError("unsupportedProfile"));
      const updates = (yield* load(catalog.product.table))
        .filter(row => roots.some(root => tupleKey(row, columns) === tupleKey(root, descriptor.sourcePrimaryKeys)))
        .map(row => ({ id: row.id, ...Object.fromEntries(columns.map(name => [name, null])) }));
      if (updates.length) yield* (yield* getStore(catalog.product.table)).write(ctx.manager, "update", updates);
    }
  }
  // Stable child-first physical removal also handles shared pivot dependencies.
  // Category subtree operations are not admitted by the root-only profile.
  const ordered: Table[] = [];
  const pending = catalog.tables.filter(table => planned.has(table.name));
  while (pending.length) {
    const index = pending.findIndex(table => table.foreignKeys.every(fk => fk.referencedTable === table.name || !pending.some(target => target.name === fk.referencedTable)));
    if (index < 0) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const [table] = pending.splice(index, 1);
    if (table === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
    ordered.push(table);
  }
  const cascades: Record<string, JsonObject[]> = {};
  let changedRoots: JsonObject[] = [];
  for (const table of operation === "delete" ? ordered.reverse() : ordered) {
    const members = [...planned.get(table.name)?.values() ?? []];
    const store = yield* getStore(table);
    const inputKeys = members.map(row => Object.fromEntries(keys(table).map(key => [key, row[key]])));
    const rows = operation === "delete" ? yield* store.delete(ctx.manager, inputKeys) : yield* store.lifecycle(ctx.manager, operation, inputKeys);
    const model = catalog.entities.find(entity => entity.table === table);
    if (model !== undefined) cascades[model.model] = rows.map(row => ({ ...row }));
    if (table === entity.table) changedRoots = rows.map(row => ({ ...row }));
  }
  const reranked = rerank.length === 0 ? [] : [...yield* (yield* getStore(catalog.category.table)).write(ctx.manager, "update", rerank)];
  return { roots: changedRoots, cascades, reranked };
});
