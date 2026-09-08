import { Effect } from "effect";
import {
  groupHasManyRows, groupManyToManyRows, toPopulateTree, tupleKey,
  type PopulateTree, type ToManyRelation,
} from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";

export type CommerceRelation = ToManyRelation | {
  readonly name: string; readonly sourcePrimaryKeys: readonly string[];
  readonly targetTable: string; readonly targetPrimaryKeys: readonly string[];
  readonly join: { readonly type: "belongsTo"; readonly foreignKeys: readonly string[] };
};
export type CommerceRelations = ReadonlyMap<string, ReadonlyMap<string, CommerceRelation>>;

/** Core find bounds the entire scoped catalog before selecting any rows. A
 * single query taking that entire bound is therefore complete. The owned scope
 * lock prevents another admitted writer from changing it during this command.
 * A second count repeats the catalog scan and is not a stronger proof.
 */
export const readCommerceRelationRows = Effect.fn("MedusaAdapter.readRelationRows")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table" | "resources">, table: string, predicate: Json, order: string = "id",
) {
  const store = yield* ctx.table(table);
  const query = { take: ctx.resources.queryRows, order: { column: order, direction: "asc" }, predicate } satisfies JsonObject;
  const rows = yield* store.find(ctx.manager, query);
  if (rows.length > ctx.resources.queryRows) return yield* Effect.fail(commerceError("storedCorruption"));
  return rows;
});

/** Pinned loadToOneRelation's tuple-key attachment, over already owned rows. */
function attachToOne(rows: Array<Record<string, Json>>, name: string, related: readonly JsonObject[], keys: readonly string[], foreignKeys: readonly string[]) {
  const byKey = new Map(related.map(row => [tupleKey(row, keys), row]));
  for (const row of rows) row[name] = byKey.get(tupleKey(row, foreignKeys)) ?? null;
}

/** Core owns the session, bounds and row decoding. Medusa owns relation grouping.
 * This instance is local to one call and never acquires a second manager. */
export const populateCommerceRelations = Effect.fn("MedusaAdapter.populateRelations")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table" | "resources">,
  table: string,
  roots: readonly JsonObject[],
  paths: readonly string[],
  relations: CommerceRelations,
  ordering: ReadonlyMap<string, string>,
  withDeleted = false,
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
      if (value === null) continue;
      if (typeof value !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
      values.push(value);
    }
    if (values.length === 0) return [];
    const cacheKey = JSON.stringify([targetTable, softDelete, order]);
    const previous = fetched.get(cacheKey);
    if (column === "id" && previous !== undefined) {
      const ids = new Set(values);
      const matching = previous.filter(row => typeof row.id === "string" && ids.has(row.id));
      if (matching.length === ids.size) return matching;
    }
    const children: Json[] = [{ kind: "in", column, values: [...new Set(values)] }];
    if (softDelete && !withDeleted) children.push({ kind: "isNull", column: "deleted_at" });
    const loaded = yield* readCommerceRelationRows(ctx, targetTable, { kind: "and", children }, order);
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
      if (join.type === "belongsTo") {
        const related = yield* read(descriptor.targetTable, descriptor.targetPrimaryKeys, rows, join.foreignKeys, true, order);
        attachToOne(result, name, yield* populate(descriptor.targetTable, related, nested), descriptor.targetPrimaryKeys, join.foreignKeys);
        continue;
      }
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
      if (join.type === "belongsTo") {
        attachToOne(result, name, related, descriptor.targetPrimaryKeys, join.foreignKeys);
        continue;
      }
      const grouped = join.type === "hasMany"
        ? groupHasManyRows(related, join.foreignKeys)
        : groupManyToManyRows(related, rows.get(join.pivotTable) ?? [], descriptor.targetPrimaryKeys, join.sourceColumns, join.targetColumns);
      for (const row of result) row[name] = grouped.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ?? [];
    }
    return result;
  }
  return assemble(table, toPopulateTree(paths));
}
