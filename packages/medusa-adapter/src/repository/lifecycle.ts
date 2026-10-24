import { Effect } from "effect";
import { describeToManyRelation, tupleKey } from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { decodeCompiledDml } from "../schema/compiled";
import type { PhysicalReferenceDetachment } from "./reference-detachment";

type Table = Effect.Success<ReturnType<typeof decodeCompiledDml>>["tables"][number];
type Catalog = Readonly<{ tables: readonly Table[]; entities: readonly Readonly<{ table: Table; model: string }>[];
  referenceDetachments?: readonly PhysicalReferenceDetachment[] }>;
type LifecycleResult = { roots: JsonObject[]; cascades: Record<string, JsonObject[]> };
type LifecyclePlanOptions = Readonly<{ rootOrder: "selection" }>;
type LifecyclePlan = { rows: (table: Table) => readonly JsonObject[]; apply: () => Effect.Effect<LifecycleResult, CommerceTransactionError> };

/** Operation-local Medusa DML traversal. Module owners admit roots and complete
 * closure bounds; core owns indexed reads, transitions, timestamps and facts. */
export function medusaLifecycle(ctx: CommerceCommandContext, catalog: Catalog, operation: "delete" | "softDelete" | "restore"): {
  roots: (table: Table, ids: readonly string[]) => Effect.Effect<JsonObject[], CommerceTransactionError>;
  plan: (rootTable: Table, roots: readonly JsonObject[], options?: LifecyclePlanOptions) => Effect.Effect<LifecyclePlan, CommerceTransactionError>;
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
  const plan = Effect.fn("MedusaLifecycle.plan")(function* (rootTable: Table, roots: readonly JsonObject[], options?: LifecyclePlanOptions) {
    const rootIdentities = new Set(roots.map(row => tupleKey(row, keys(rootTable))));
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
      // Table topology cannot order a same-table FK. Discover the complete
      // closure first, then seal every self-table order before any mutation.
      // Other table profiles and soft lifecycle ordering retain their existing
      // order. A cycle cannot be satisfied by sequential scalar deletions.
      const deletionRows = new Map<string, readonly JsonObject[]>();
      if (operation === "delete") for (const table of ordered) {
        const selfKeys = table.foreignKeys.filter(key => key.referencedTable === table.name);
        if (!selfKeys.length) continue;
        if (selfKeys.some(key => key.columns.length !== 1 || key.referencedColumns.length !== 1))
          return yield* Effect.fail(commerceError("unsupportedProfile"));
        const remaining = [...rows(table)], changed: JsonObject[] = [];
        while (remaining.length) {
          const index = remaining.findIndex(row => selfKeys.every(key => {
            const column = key.columns[0], referenced = key.referencedColumns[0];
            return column !== undefined && referenced !== undefined && !remaining.some(child =>
              child[column] !== null && child[column] !== undefined && child[column] === row[referenced]);
          }));
          if (index < 0) return yield* Effect.fail(commerceError("unsupportedProfile"));
          const [row] = remaining.splice(index, 1);
          if (row === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
          changed.push(row);
        }
        deletionRows.set(table.name, changed);
      }
      const cascades: Record<string, JsonObject[]> = {};
      let changedRoots: JsonObject[] = [];
      for (const table of operation === "delete" ? ordered.reverse() : ordered) {
        const store = yield* getStore(table);
        const inputKeys = (deletionRows.get(table.name) ?? rows(table)).map(row => Object.fromEntries(keys(table).map(key => [key, row[key]])));
        const changed = operation === "delete" ? yield* store.delete(ctx.manager, inputKeys) : yield* store.lifecycle(ctx.manager, operation, inputKeys);
        if (operation === "delete") for (const edge of catalog.referenceDetachments ?? []) if (edge.targetTable === table.name) {
          if (ctx.detachDeletedReference === undefined) return yield* ctx.refuse(commerceError("invalidAuthority"));
          for (const row of changed) {
            const targetKey = row[edge.targetColumn];
            if (typeof targetKey !== "string") return yield* ctx.refuse(commerceError("storedCorruption"));
            // The core authenticates this exact preceding delete and performs
            // the complete eager FK-only transition in the same live root.
            yield* ctx.detachDeletedReference({ sourceTable: edge.sourceTable, sourceColumn: edge.sourceColumn,
              targetTable: edge.targetTable, targetColumn: edge.targetColumn, targetKey });
          }
        }
        const model = catalog.entities.find(entity => entity.table === table);
        if (model !== undefined) cascades[model.model] = changed.map(row => ({ ...row }));
        if (table === rootTable) changedRoots = changed.filter(row => rootIdentities.has(tupleKey(row, keys(rootTable))))
          .map(row => ({ ...row }));
      }
      // Physical deletes retain dependency order. A selected profile may present
      // its explicit roots in the original complete selection order instead.
      if (options?.rootOrder === "selection") {
        const changedByIdentity = new Map(changedRoots.map(row => [tupleKey(row, keys(rootTable)), row]));
        if (changedByIdentity.size !== changedRoots.length || changedByIdentity.size !== rootIdentities.size)
          return yield* Effect.fail(commerceError("storedCorruption"));
        const selectedRoots: JsonObject[] = [];
        for (const identity of rootIdentities) {
          const row = changedByIdentity.get(identity);
          if (row === undefined) return yield* Effect.fail(commerceError("storedCorruption"));
          selectedRoots.push(row);
        }
        changedRoots = selectedRoots;
      }
      return { roots: changedRoots, cascades };
    });
    return { rows, apply };
  });
  return { roots, plan, getStore, loadReferencing };
}
