import { Effect } from "effect";
import { describeToManyRelation, tupleKey } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { decodeCompiledDml } from "../schema/compiled";

type Table = Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number];
type Catalog = Readonly<{ tables: readonly Table[]; entities: readonly Readonly<{ table: Table; model: string }>[] }>;
type LifecycleResult = { roots: JsonObject[]; cascades: Record<string, JsonObject[]> };
type LifecyclePlan = { rows: (table: Table) => readonly JsonObject[]; apply: () => Effect.Effect<LifecycleResult, CommerceTransactionError> };

/** Operation-local Medusa DML traversal. Module owners admit roots and complete
 * closure bounds; core owns indexed reads, transitions, timestamps and facts. */
export function medusaLifecycle(ctx: CommerceCommandContext, catalog: Catalog, operation: "delete" | "softDelete" | "restore"): {
  roots: (table: Table, ids: readonly string[]) => Effect.Effect<JsonObject[], CommerceTransactionError>;
  plan: (rootTable: Table, roots: readonly JsonObject[]) => Effect.Effect<LifecyclePlan, CommerceTransactionError>;
  getStore: (table: Table) => ReturnType<CommerceCommandContext["table"]>;
  loadReferencing: (table: Table, columns: readonly string[], row: JsonObject, referencedColumns: readonly string[]) => Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
} {
  const state = new Map<string, readonly JsonObject[]>();
  const stores = new Map<string, Effect.Success<ReturnType<CommerceCommandContext["table"]>>>();
  const getStore = Effect.fn("MedusaLifecycle.store")(function* (table: Table) {
    const prior = stores.get(table.name);
    if (prior !== undefined) return prior;
    const store = yield* ctx.table(table.name); stores.set(table.name, store); return store;
  });
  const keys = (table: Table) => table.columns.some(column => column.primaryKey) ? table.columns.filter(column => column.primaryKey).map(column => column.name)
    : table.foreignKeys.flatMap(key => key.columns);
  const load = Effect.fn("MedusaLifecycle.load")(function* (table: Table,
    selection: Readonly<{ column: string; values: readonly string[] }>) {
    const cacheKey = JSON.stringify([table.name, selection.column, selection.values]);
    const prior = state.get(cacheKey);
    if (prior !== undefined) return prior;
    const order = keys(table)[0];
    if (order === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const store = yield* getStore(table);
    // The store must return the complete bounded selection or refuse; a page
    // would silently omit lifecycle descendants.
    const rows = yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: order, direction: "asc" },
      predicate: { kind: "in", column: selection.column, values: selection.values } });
    state.set(cacheKey, rows); return rows;
  });
  const loadReferencing = Effect.fn("MedusaLifecycle.loadReferencing")(function* (
    table: Table, columns: readonly string[], row: JsonObject, referencedColumns: readonly string[],
  ) {
    if (columns.length !== 1 || referencedColumns.length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const column = columns[0]; const referenced = referencedColumns[0];
    if (column === undefined || referenced === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const value = row[referenced];
    if (typeof value !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
    return yield* load(table, { column, values: [value] });
  });
  const roots = Effect.fn("MedusaLifecycle.roots")(function* (table: Table, ids: readonly string[]) {
    return (ids.length === 0 ? [] : yield* load(table, { column: "id", values: ids }))
      .filter(row => typeof row.id === "string" && ids.includes(row.id) && (operation !== "softDelete" || row.deleted_at === null));
  });
  const plan = Effect.fn("MedusaLifecycle.plan")(function* (rootTable: Table, roots: readonly JsonObject[]) {
    const planned = new Map<string, Map<string, JsonObject>>();
    const visit = Effect.fn("MedusaLifecycle.visit")(function* (table: Table, row: JsonObject): Effect.fn.Return<void, CommerceTransactionError> {
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
    for (const row of roots) yield* visit(rootTable, row);
    const rows = (table: Table): readonly JsonObject[] => [...planned.get(table.name)?.values() ?? []];
    const apply = Effect.fn("MedusaLifecycle.apply")(function* () {
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
        const store = yield* getStore(table);
        const inputKeys = rows(table).map(row => Object.fromEntries(keys(table).map(key => [key, row[key]])));
        const changed = operation === "delete" ? yield* store.delete(ctx.manager, inputKeys) : yield* store.lifecycle(ctx.manager, operation, inputKeys);
        const model = catalog.entities.find(entity => entity.table === table);
        if (model !== undefined) cascades[model.model] = changed.map(row => ({ ...row }));
        if (table === rootTable) changedRoots = changed.map(row => ({ ...row }));
      }
      return { roots: changedRoots, cascades };
    });
    return { rows, apply };
  });
  return { roots, plan, getStore, loadReferencing };
}
