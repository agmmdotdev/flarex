import { Effect, Option, Result } from "effect";
import {
  groupHasManyRows, groupManyToManyRows, toPopulateTree, tupleKey,
  type PopulateTree, type ToManyRelation,
} from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { isSelectedPopulationPath, type PopulationFilter } from "./population";
import type { Predicate } from "./predicate";

export type CommerceRelation = ToManyRelation | {
  readonly name: string; readonly sourcePrimaryKeys: readonly string[];
  readonly targetTable: string; readonly targetPrimaryKeys: readonly string[];
  readonly join: { readonly type: "belongsTo"; readonly foreignKeys: readonly string[] };
};
export type CommerceRelations = ReadonlyMap<string, ReadonlyMap<string, CommerceRelation>>;
export type CommerceRelationLookup = Pick<ReadonlyMap<string, Pick<ReadonlyMap<string, CommerceRelation>, "get">>, "get">;

/** Module-owned finite admission sees actual selections before presentation.
 * The callback receives rows only; it cannot acquire persistence authority. */
export type CommerceRelationReadContext = Pick<CommerceCommandContext, "manager" | "table" | "resources"> & {
  readonly admitSelection?: (table: string, rows: readonly JsonObject[]) => Result.Result<void, CommerceTransactionError>;
};

/** One complete-set query shape for execution and authenticated read receipts. */
export function commerceRelationReadQuery(resources: Pick<CommerceCommandContext["resources"], "queryRows">,
  predicate: Json, order = "id"): JsonObject {
  return { take: resources.queryRows, order: { column: order, direction: "asc" }, predicate };
}

/** The native population owner prepares its indexed selection independently of
 * presentation. None means no usable parent identity and performs no read. */
export function prepareCommerceRelationPopulation(columns: readonly string[], parents: readonly JsonObject[],
  parentColumns: readonly string[], softDelete: boolean, withDeleted: boolean, predicate?: Predicate) {
  return Result.gen(function* () {
    const column = columns[0], parentColumn = parentColumns[0];
    if (columns.length !== 1 || parentColumns.length !== 1 || column === undefined || parentColumn === undefined)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    if (parents.length === 0) return Option.none();
    const values: string[] = [];
    for (const parent of parents) {
      const value = parent[parentColumn];
      if (value === null) continue;
      if (typeof value !== "string") return yield* Result.fail(commerceError("storedCorruption"));
      values.push(value);
    }
    if (values.length === 0) return Option.none();
    const children: Json[] = [{ kind: "in", column, values: [...new Set(values)] }];
    if (softDelete && !withDeleted) children.push({ kind: "isNull", column: "deleted_at" });
    if (predicate !== undefined) children.push(predicate);
    const selected: JsonObject = { kind: "and", children };
    return Option.some({ column, values, predicate: selected });
  });
}

/** The selected store must return a complete bounded relation set or refuse.
 * Shared logical storage uses an indexed complete-set read; the retained
 * physical profile enforces its own catalog bound. A truncated population
 * would silently omit Medusa relationships, so a page alone is insufficient.
 */
export const readCommerceRelationRows = Effect.fn("MedusaAdapter.readRelationRows")(function* (
  ctx: CommerceRelationReadContext, table: string, predicate: Json, order: string = "id",
) {
  const store = yield* ctx.table(table);
  const query = commerceRelationReadQuery(ctx.resources, predicate, order);
  const rows = yield* store.find(ctx.manager, query);
  if (rows.length > ctx.resources.queryRows) return yield* Effect.fail(commerceError("storedCorruption"));
  if (ctx.admitSelection !== undefined) yield* Effect.fromResult(ctx.admitSelection(table, rows));
  return rows;
});

/** Pinned loadToOneRelation's tuple-key attachment, over already owned rows. */
function attachToOne(rows: Array<Record<string, Json>>, name: string, related: readonly JsonObject[], keys: readonly string[], foreignKeys: readonly string[]) {
  const byKey = new Map(related.map(row => [tupleKey(row, keys), row]));
  for (const row of rows) row[name] = byKey.get(tupleKey(row, foreignKeys)) ?? null;
}

interface RelationPopulation {
  readonly ctx: Parameters<typeof readCommerceRelationRows>[0];
  readonly relations: CommerceRelationLookup;
  readonly ordering: ReadonlyMap<string, string>;
  readonly withDeleted: boolean;
  readonly filters: ReadonlyMap<string, Predicate>;
  readonly fetched: Map<string, readonly JsonObject[]>;
}

const readPopulationRelation = Effect.fn("MedusaAdapter.readRelation")(function* (
  population: RelationPopulation,
  targetTable: string, columns: readonly string[], parents: readonly JsonObject[],
  parentColumns: readonly string[], softDelete: boolean, order: string, primaryLookup = false, predicate?: Predicate,
) {
  const { ctx, fetched, withDeleted } = population;
  const selection = yield* Effect.fromResult(prepareCommerceRelationPopulation(columns, parents, parentColumns, softDelete, withDeleted, predicate));
  if (Option.isNone(selection)) return [];
  const { column, values } = selection.value;
  const cacheKey = JSON.stringify([targetTable, softDelete, order, predicate ?? null]);
  const previous = fetched.get(cacheKey);
  if (primaryLookup && previous !== undefined) {
    const ids = new Set(values);
    const matching = previous.filter(row => typeof row[column] === "string" && ids.has(row[column]));
    if (matching.length === ids.size) return matching;
  }
  const loaded = yield* readCommerceRelationRows(ctx, targetTable, selection.value.predicate, order);
  fetched.set(cacheKey, loaded);
  return loaded;
});

const populateRelationTree = Effect.fn("MedusaAdapter.populateTree")(function* (
  population: RelationPopulation,
  source: string, rows: readonly JsonObject[], tree: PopulateTree, prefix = "",
): Effect.fn.Return<JsonObject[], CommerceTransactionError> {
  const { relations, ordering, filters } = population;
  const result = rows.map(row => ({ ...row }));
  for (const [name, nested] of tree) {
    const path = prefix === "" ? name : prefix + "." + name;
    const predicate = filters.get(path);
    const descriptor = relations.get(source)?.get(name);
    if (descriptor === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const order = ordering.get(descriptor.targetTable) ?? descriptor.targetPrimaryKeys[0];
    if (order === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const join = descriptor.join;
    if (join.type === "belongsTo") {
      const related = yield* readPopulationRelation(population, descriptor.targetTable, descriptor.targetPrimaryKeys, rows, join.foreignKeys, true, order, true, predicate);
      attachToOne(result, name, yield* populateRelationTree(population, descriptor.targetTable, related, nested, path), descriptor.targetPrimaryKeys, join.foreignKeys);
      continue;
    }
    const pivotRows = join.type === "manyToMany"
      ? yield* readPopulationRelation(population, join.pivotTable, join.sourceColumns, rows, descriptor.sourcePrimaryKeys, false, join.targetColumns[0] ?? "id")
      : [];
    const related = join.type === "hasMany"
      ? yield* readPopulationRelation(population, descriptor.targetTable, join.foreignKeys, rows, descriptor.sourcePrimaryKeys, true, order, false, predicate)
      : yield* readPopulationRelation(population, descriptor.targetTable, descriptor.targetPrimaryKeys, pivotRows, join.targetColumns, true, order, true, predicate);
    const populated = yield* populateRelationTree(population, descriptor.targetTable, related, nested, path);
    const grouped = join.type === "hasMany"
      ? groupHasManyRows(populated, join.foreignKeys)
      : groupManyToManyRows(populated, pivotRows, descriptor.targetPrimaryKeys, join.sourceColumns, join.targetColumns);
    for (const row of result) row[name] = grouped.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ?? [];
  }
  return result;
});

/** Core owns the session, bounds and row decoding. Medusa owns relation grouping.
 * This instance is local to one call and never acquires a second manager. */
export const populateCommerceRelations = Effect.fn("MedusaAdapter.populateRelations")(function* (
  ctx: CommerceRelationReadContext,
  table: string,
  roots: readonly JsonObject[],
  paths: readonly string[],
  relations: CommerceRelationLookup,
  ordering: ReadonlyMap<string, string>,
  withDeleted = false,
  populationFilters: readonly PopulationFilter[] = [],
) {
  const filters = new Map<string, Predicate>();
  for (const filter of populationFilters) {
    if (filters.has(filter.path) || !isSelectedPopulationPath(filter.path, paths)) return yield* Effect.fail(commerceError("unsupportedProfile"));
    filters.set(filter.path, filter.predicate);
  }
  // Retain ordered scalar rows only, never a branch's mutable population. A
  // later primary-key read can reuse a complete subset of an earlier FK read.
  const fetched = new Map<string, readonly JsonObject[]>();
  const population: RelationPopulation = { ctx, relations, ordering, withDeleted, filters, fetched };
  return yield* populateRelationTree(population, table, roots, toPopulateTree(paths));
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
