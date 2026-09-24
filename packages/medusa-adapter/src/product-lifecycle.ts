import { Effect, Schema } from "effect";
import { describeToManyRelation, tupleKey } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, commerceLimits, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";
import { captureCommerceInput } from "./commerce-input";
import { commerceDecoder } from "./commerce-decoder";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ProductLifecycleIds = Schema.Array(Id).check(Schema.isMaxLength(commerceLimits.catalogRows));
export const decodeProductLifecycleIds = commerceDecoder(Schema.Union([Id, ProductLifecycleIds]), "invalidInput");
const decodeDelete = commerceDecoder(Schema.Struct({ $or: Schema.Array(Schema.Struct({ id: Id })).check(Schema.isMaxLength(commerceLimits.catalogRows)) }), "invalidInput");
type Table = ProductRuntimeMetadata["tables"][number];

/** Operation-local DML cascade. The pinned repository's cascadeDelete metadata
 * selects managed transitions; physical FK cascades select explicit removals.
 * Reads, managed timestamps, bounded SQL and complete row facts stay in core. */
export const changeProductLifecycle = Effect.fn("ProductAdapter.lifecycle")(function* (
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, entity: ProductEntityMetadata,
  operation: "delete" | "softDelete" | "restore", input: unknown,
) {
  if (operation !== "delete" && entity !== catalog.product && !(operation === "softDelete" && [catalog.variant, catalog.tag].includes(entity))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  if (operation === "delete" && ![catalog.product, catalog.tag, catalog.type, catalog.collection, catalog.category, catalog.option, catalog.assignment].includes(entity)) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
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
  const load = Effect.fn("ProductLifecycle.load")(function* (table: Table,
    selection: Readonly<{ column: string; values: readonly string[] }>) {
    const cacheKey = JSON.stringify([table.name, selection.column, selection.values]);
    const prior = state.get(cacheKey);
    if (prior !== undefined) return prior;
    const order = keys(table)[0];
    if (order === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const store = yield* getStore(table);
    const rows = yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: order, direction: "asc" },
      predicate: { kind: "in", column: selection.column, values: selection.values } });
    state.set(cacheKey, rows); return rows;
  });
  const loadReferencing = Effect.fn("ProductLifecycle.loadReferencing")(function* (
    table: Table, columns: readonly string[], row: JsonObject, referencedColumns: readonly string[],
  ) {
    if (columns.length !== 1 || referencedColumns.length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const column = columns[0]; const referenced = referencedColumns[0];
    if (column === undefined || referenced === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const value = row[referenced];
    if (typeof value !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
    return yield* load(table, { column, values: [value] });
  });
  // Requested root IDs are admitted by the shared indexed row reader. A
  // one-ID lifecycle call must not depend on the size of the whole catalog.
  const roots = (ids.length === 0 ? [] : yield* load(entity.table, { column: "id", values: ids }))
    .filter(row => typeof row.id === "string" && ids.includes(row.id) && (operation !== "softDelete" || row.deleted_at === null));
  if (entity === catalog.category) {
    if (roots.length !== ids.length) return yield* Effect.fail(commerceError("unsupportedProfile"));
    for (const root of roots) if ((yield* loadReferencing(entity.table, ["parent_category_id"], root, ["id"]))
      .some(child => child.deleted_at === null))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const planned = new Map<string, Map<string, JsonObject>>();
  const visit = Effect.fn("ProductLifecycle.visit")(function* (table: Table, row: JsonObject): Effect.fn.Return<void, CommerceTransactionError> {
    const identity = tupleKey(row, keys(table));
    const group = planned.get(table.name) ?? new Map<string, JsonObject>();
    if (group.has(identity)) return;
    group.set(identity, row); planned.set(table.name, group);
    if (operation === "delete") {
      for (const child of catalog.tables) for (const fk of child.foreignKeys.filter(fk => fk.referencedTable === table.name && fk.onDelete === "cascade")) {
        for (const member of yield* loadReferencing(child, fk.columns, row, fk.referencedColumns)) yield* visit(child, member);
      }
    } else {
      for (const relation of table.relationships.filter(relation => relation.cascadeDelete)) {
        const descriptor = describeToManyRelation(table, relation.name, catalog.tables);
        if (descriptor?.join.type !== "hasMany") return yield* Effect.fail(commerceError("unsupportedProfile"));
        const child = catalog.tables.find(table => table.name === descriptor.targetTable);
        if (child === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        for (const member of yield* loadReferencing(child, descriptor.join.foreignKeys, row, descriptor.sourcePrimaryKeys)) yield* visit(child, member);
      }
    }
  });
  for (const row of roots) yield* visit(entity.table, row);
  const planSetNull = operation === "delete" && entity === catalog.type ? ctx.planSetNull : undefined;
  const plannedDetach: Array<Parameters<NonNullable<CommerceCommandContext["planSetNull"]>>[0]> = [];
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
      if (planSetNull !== undefined) {
        if (columns.length !== 1 || columns[0] !== "type_id" || descriptor.sourcePrimaryKeys.length !== 1 ||
          descriptor.sourcePrimaryKeys[0] !== "id") return yield* Effect.fail(commerceError("unsupportedProfile"));
        for (const root of roots) {
          if (typeof root.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
          plannedDetach.push({ sourceTable: catalog.product.table.name, sourceColumn: "type_id",
            targetTable: entity.table.name, targetColumn: "id", targetKey: root.id });
        }
        continue;
      }
      const updates: JsonObject[] = [];
      for (const root of roots) for (const row of yield* loadReferencing(catalog.product.table, columns, root, descriptor.sourcePrimaryKeys)) {
        if (typeof row.id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
        updates.push({ id: row.id, ...Object.fromEntries(columns.map(name => [name, null])) });
      }
      if (updates.length) yield* (yield* getStore(catalog.product.table)).write(ctx.manager, "update", updates);
    }
  }
  // Stable child-first physical removal also handles shared pivot dependencies.
  // Category deletion is leaf-only; the original service owns sibling ranking.
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
  if (planSetNull !== undefined) for (const selection of plannedDetach) yield* planSetNull(selection);
  return { roots: changedRoots, cascades };
});
