import { Effect } from "effect";
import {
  groupHasManyRows, groupManyToManyRows, toPopulateTree, tupleKey,
  type PopulateTree, type ToManyRelation,
} from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

export type CommerceRelations = ReadonlyMap<string, ReadonlyMap<string, ToManyRelation>>;

/** Core owns the session, bounds and row decoding. Medusa owns relation grouping.
 * This instance is local to one call and never acquires a second manager. */
export const populateCommerceRelations = Effect.fn("MedusaAdapter.populateRelations")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table">,
  table: string,
  roots: readonly JsonObject[],
  paths: readonly string[],
  relations: CommerceRelations,
  ordering: ReadonlyMap<string, string>,
) {
  // Retain ordered scalar rows only, never a branch's mutable population. A
  // later primary-key read can reuse a complete subset of an earlier FK read.
  const fetched = new Map<string, readonly JsonObject[]>();
  const read = Effect.fn("MedusaAdapter.readRelation")(function* (
    targetTable: string, columns: readonly string[], parents: readonly JsonObject[],
    parentColumns: readonly string[], softDelete: boolean, order: string,
  ) {
    const column = columns[0];
    const parentColumn = parentColumns[0];
    if (columns.length !== 1 || parentColumns.length !== 1 || column === undefined || parentColumn === undefined) {
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    }
    if (parents.length === 0) return [];
    const values: string[] = [];
    for (const parent of parents) {
      const value = parent[parentColumn];
      if (typeof value !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
      values.push(value);
    }
    const cacheKey = JSON.stringify([targetTable, softDelete, order]);
    const previous = fetched.get(cacheKey);
    if (column === "id" && previous !== undefined) {
      const ids = new Set(values);
      const matching = previous.filter(row => typeof row.id === "string" && ids.has(row.id));
      if (matching.length === ids.size) return matching;
    }
    const store = yield* ctx.table(targetTable);
    const children: Json[] = [{ kind: "in", column, values: [...new Set(values)] }];
    if (softDelete) children.push({ kind: "isNull", column: "deleted_at" });
    const loaded = yield* store.find(ctx.manager, {
      take: 256, order: { column: order, direction: "asc" },
      predicate: { kind: "and", children },
    });
    fetched.set(cacheKey, loaded);
    return loaded;
  });
  const populate = Effect.fn("MedusaAdapter.populateTree")(function* (
    source: string, rows: readonly JsonObject[], tree: PopulateTree,
  ): Effect.fn.Return<JsonObject[], CommerceTransactionError> {
    const result = rows.map(row => ({ ...row }));
    for (const [name, nested] of tree) {
      const descriptor = relations.get(source)?.get(name);
      if (descriptor === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const order = ordering.get(descriptor.targetTable) ?? "id";
      const join = descriptor.join;
      const pivotRows = join.type === "manyToMany"
        ? yield* read(join.pivotTable, join.sourceColumns, rows, descriptor.sourcePrimaryKeys, false, join.targetColumns[0] ?? "id")
        : [];
      const related = join.type === "hasMany"
        ? yield* read(descriptor.targetTable, join.foreignKeys, rows, descriptor.sourcePrimaryKeys, true, order)
        : yield* read(descriptor.targetTable, descriptor.targetPrimaryKeys, pivotRows, join.targetColumns, true, order);
      const populated = yield* populate(descriptor.targetTable, related, nested);
      const grouped = join.type === "hasMany"
        ? groupHasManyRows(populated, join.foreignKeys)
        : groupManyToManyRows(populated, pivotRows, descriptor.targetPrimaryKeys, join.sourceColumns, join.targetColumns);
      for (const row of result) row[name] = grouped.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ?? [];
    }
    return result;
  });
  return yield* populate(table, roots, toPopulateTree(paths));
});

/** The same Medusa grouping for already inserted rows; creation does no re-read. */
export function assembleCommerceRelations(
  table: string, rows: ReadonlyMap<string, readonly JsonObject[]>, paths: readonly string[], relations: CommerceRelations,
): JsonObject[] {
  function assemble(source: string, tree: PopulateTree): JsonObject[] {
    const result = (rows.get(source) ?? []).map(row => ({ ...row }));
    for (const [name, nested] of tree) {
      const descriptor = relations.get(source)?.get(name);
      // Only metadata-validated, admitted paths reach this internal projection.
      if (descriptor === undefined) throw new Error("Missing admitted Medusa relation");
      const related = assemble(descriptor.targetTable, nested);
      const join = descriptor.join;
      const grouped = join.type === "hasMany"
        ? groupHasManyRows(related, join.foreignKeys)
        : groupManyToManyRows(related, rows.get(join.pivotTable) ?? [], descriptor.targetPrimaryKeys, join.sourceColumns, join.targetColumns);
      for (const row of result) row[name] = grouped.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ?? [];
    }
    return result;
  }
  return assemble(table, toPopulateTree(paths));
}
