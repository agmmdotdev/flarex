import { Effect, Option, Result } from "effect";
import {
  groupHasManyRows, groupManyToManyRows, toPopulateTree, tupleKey,
  type PopulateTree, type ToManyRelation,
} from "@medusajs/drizzle/relation-query";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject, type StorageInsertionOrder } from "@flarex/persistence-postgres/internal/commerce-values";
import { isSelectedPopulationPath, type PopulationFilter } from "./population";
import type { Predicate } from "./predicate";

type ToOneRelation<Kind extends "belongsTo" | "hasOne"> = {
  readonly name: string; readonly sourcePrimaryKeys: readonly string[];
  readonly targetTable: string; readonly targetPrimaryKeys: readonly string[];
  readonly join: { readonly type: Kind; readonly foreignKeys: readonly string[] };
};
export type CommerceRelation = ToManyRelation | ToOneRelation<"belongsTo"> | ToOneRelation<"hasOne">;
export type CommerceRelations = ReadonlyMap<string, ReadonlyMap<string, CommerceRelation>>;
export type CommerceRelationLookup = Pick<ReadonlyMap<string, Pick<ReadonlyMap<string, CommerceRelation>, "get">>, "get">;
export type CommerceRelationOrder = string | StorageInsertionOrder;
export interface CommerceRelationReadOptions {
  /** Request source-owned identities of the actual selected rows. */
  readonly includeIdentities?: true;
}

/** Module-owned finite admission sees actual selections before presentation.
 * The callback receives rows only; it cannot acquire persistence authority. */
export type CommerceRelationReadContext = Pick<CommerceCommandContext, "manager" | "table" | "resources" | "announce"> & {
  readonly admitSelection?: (table: string, rows: readonly JsonObject[]) => Result.Result<void, CommerceTransactionError>;
};
/** One relation read as its later `CommerceRelationRows` call receives it, without options. */
export interface CommerceRelationRead {
  readonly table: string;
  readonly predicate: Json;
  readonly order: CommerceRelationOrder;
}
export interface CommerceRelationRows {
  (table: string, predicate: Json, order?: CommerceRelationOrder,
    options?: CommerceRelationReadOptions): Effect.Effect<readonly JsonObject[], CommerceTransactionError>;
  /** Present only on a live context that accepts announcements: independent reads
   * that follow, soonest first. A hint; every read still runs and decides its result. */
  readonly announce?: (reads: readonly CommerceRelationRead[]) => Effect.Effect<void, CommerceTransactionError>;
}

/** Bind the live manager once. Population/filter execution receives only this
 * operation; proof reconstruction supplies an authenticated observation reader
 * without manufacturing a database manager or another request lifetime. */
export function bindCommerceRelationRows(ctx: CommerceRelationReadContext, defaults: CommerceRelationReadOptions = {}): CommerceRelationRows {
  const announce = ctx.announce;
  if (announce === undefined) return (table, predicate, order, options) => readCommerceRelationRows(ctx, table, predicate, order, { ...defaults, ...options });
  // The announced query is built by the read's own owner from the same arguments. The
  // read of the same table, predicate object and order without options of its own
  // issues the query object of the latest announcement that named it, which lets the
  // host recognize it.
  const announced = new WeakMap<object, Readonly<{ read: CommerceRelationRead; query: JsonObject }>>();
  const rows: CommerceRelationRows = (table, predicate, order = "id", options) => {
    const held = options === undefined && typeof predicate === "object" && predicate !== null ? announced.get(predicate) : undefined;
    return held !== undefined && held.read.table === table && held.read.order === order ? readCommerceRelationQuery(ctx, table, held.query)
      : readCommerceRelationRows(ctx, table, predicate, order, { ...defaults, ...options });
  };
  return Object.assign(rows, { announce: (reads: readonly CommerceRelationRead[]) => announce({ finds: reads.map(read => {
    const query = commerceRelationReadQuery(ctx.resources, read.predicate, read.order, defaults);
    if (typeof read.predicate === "object" && read.predicate !== null) announced.set(read.predicate, { read, query });
    return { tableName: read.table, query };
  }) }) });
}

/** One complete-set query shape for execution and authenticated read receipts. */
export function commerceRelationReadQuery(resources: Pick<CommerceCommandContext["resources"], "queryRows">,
  predicate: Json, order: CommerceRelationOrder = "id", options: CommerceRelationReadOptions = {}): JsonObject {
  return { take: resources.queryRows, order: typeof order === "string" ? { column: order, direction: "asc" } : { ...order }, predicate,
    ...(options.includeIdentities === true ? { includeIdentities: true } : {}) };
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
export const readCommerceRelationRows = (
  ctx: CommerceRelationReadContext, table: string, predicate: Json, order: CommerceRelationOrder = "id", options: CommerceRelationReadOptions = {},
) => Effect.suspend(() => readCommerceRelationQuery(ctx, table, commerceRelationReadQuery(ctx.resources, predicate, order, options)));

/** One complete-set read of a query `commerceRelationReadQuery` built: either just
 * now from the read's arguments, or earlier from the same arguments for the
 * announcement that named this read. */
function readCommerceRelationQuery(ctx: CommerceRelationReadContext, table: string, query: JsonObject) {
  return Effect.gen(function* () {
    const store = yield* ctx.table(table);
    const rows = yield* store.find(ctx.manager, query);
    if (rows.length > ctx.resources.queryRows) return yield* Effect.fail(commerceError("storedCorruption"));
    if (ctx.admitSelection !== undefined) yield* Effect.fromResult(ctx.admitSelection(table, rows));
    return rows;
  });
}

/** Pinned loadToOneRelation's tuple-key attachment, over already owned rows. */
function attachToOne(rows: Array<Record<string, Json>>, name: string, related: readonly JsonObject[], keys: readonly string[], foreignKeys: readonly string[]) {
  const byKey = new Map(related.map(row => [tupleKey(row, keys), row]));
  for (const row of rows) row[name] = byKey.get(tupleKey(row, foreignKeys)) ?? null;
}

/** An inverse singleton is keyed by the target's foreign key. A complete
 * selection must prove cardinality before attachment, including for receipts. */
function attachHasOne(rows: Array<Record<string, Json>>, name: string, related: readonly JsonObject[], sourceKeys: readonly string[], foreignKeys: readonly string[]): Result.Result<void, CommerceTransactionError> {
  if (sourceKeys.length === 0 || sourceKeys.length !== foreignKeys.length) return Result.fail(commerceError("unsupportedProfile"));
  const selected = new Set(rows.map(row => tupleKey(row, sourceKeys)));
  const byKey = new Map<string, JsonObject>();
  for (const row of related) {
    // Nullable references do not belong to a parent.
    if (foreignKeys.some(key => row[key] === null)) continue;
    if (foreignKeys.some(key => typeof row[key] !== "string")) return Result.fail(commerceError("storedCorruption"));
    const key = tupleKey(row, foreignKeys);
    if (!selected.has(key)) continue;
    if (byKey.has(key)) return Result.fail(commerceError("storedCorruption"));
    byKey.set(key, row);
  }
  for (const row of rows) row[name] = byKey.get(tupleKey(row, sourceKeys)) ?? null;
  return Result.succeed(undefined);
}

interface RelationPopulation {
  readonly readRows: CommerceRelationRows;
  readonly relations: CommerceRelationLookup;
  readonly ordering: ReadonlyMap<string, CommerceRelationOrder>;
  readonly withDeleted: boolean;
  readonly filters: ReadonlyMap<string, Predicate>;
  readonly fetched: Map<string, readonly JsonObject[]>;
  /** Announced reads whose turn has not come. A later announcement repeats them:
   * that is how Core learns they are still wanted and keeps the pages it holds for
   * them, which it does not read again. */
  readonly announced: Set<CommerceRelationRead>;
}
interface PopulationRead {
  readonly table: string;
  readonly columns: readonly string[];
  readonly parentColumns: readonly string[];
  readonly softDelete: boolean;
  readonly order: CommerceRelationOrder;
  readonly primaryLookup: boolean;
  readonly predicate?: Predicate | undefined;
}
/** A read's selection prepared before its turn and, when announced, its entry. */
interface PreparedPopulationRead {
  readonly selection: ReturnType<typeof prepareCommerceRelationPopulation>;
  readonly find: CommerceRelationRead | undefined;
}
const populationCacheKey = (read: PopulationRead) => JSON.stringify([read.table, read.softDelete, read.order, read.predicate ?? null]);

/** One relation's reads: its pivot, when it has one, then its target. */
function relationReads(population: RelationPopulation, source: string, name: string, path: string) {
  const { relations, ordering, filters } = population;
  const predicate = filters.get(path);
  const descriptor = relations.get(source)?.get(name);
  if (descriptor === undefined) return Result.fail(commerceError("unsupportedProfile"));
  const order = ordering.get(descriptor.targetTable) ?? descriptor.targetPrimaryKeys[0];
  if (order === undefined) return Result.fail(commerceError("unsupportedProfile"));
  const join = descriptor.join, table = descriptor.targetTable;
  const pivot: PopulationRead | undefined = join.type !== "manyToMany" ? undefined : { table: join.pivotTable, columns: join.sourceColumns,
    parentColumns: descriptor.sourcePrimaryKeys, softDelete: false, order: ordering.get(join.pivotTable) ?? join.targetColumns[0] ?? "id", primaryLookup: false };
  const related: PopulationRead = join.type === "belongsTo"
    ? { table, columns: descriptor.targetPrimaryKeys, parentColumns: join.foreignKeys, softDelete: true, order, primaryLookup: true, predicate }
    : join.type === "manyToMany"
      ? { table, columns: descriptor.targetPrimaryKeys, parentColumns: join.targetColumns, softDelete: true, order, primaryLookup: true, predicate }
      : { table, columns: join.foreignKeys, parentColumns: descriptor.sourcePrimaryKeys, softDelete: true, order, primaryLookup: false, predicate };
  return Result.succeed({ descriptor, pivot, related });
}

/** A complete earlier selection can satisfy a primary-key population only
 * when it contains every requested identity. Empty or partial misses still read. */
export function reusePrimaryRelationRows<Row extends JsonObject>(previous: readonly Row[] | undefined, column: string, values: readonly string[]) {
  if (previous === undefined) return undefined;
  const ids = new Set(values);
  const matching = previous.filter(row => typeof row[column] === "string" && ids.has(row[column]));
  return matching.length === ids.size ? matching : undefined;
}

const readPopulationRelation = Effect.fnUntraced(function* (
  population: RelationPopulation, read: PopulationRead, parents: readonly JsonObject[], ahead?: PreparedPopulationRead,
) {
  const { readRows, fetched, withDeleted, announced } = population;
  const selection = yield* Effect.fromResult(ahead?.selection
    ?? prepareCommerceRelationPopulation(read.columns, parents, read.parentColumns, read.softDelete, withDeleted, read.predicate));
  if (ahead?.find !== undefined) announced.delete(ahead.find);
  if (Option.isNone(selection)) return [];
  const { column, values } = selection.value;
  const cacheKey = populationCacheKey(read);
  const previous = fetched.get(cacheKey);
  const reused = read.primaryLookup ? reusePrimaryRelationRows(previous, column, values) : undefined;
  if (reused !== undefined) return reused;
  const loaded = yield* readRows(read.table, selection.value.predicate, read.order);
  fetched.set(cacheKey, loaded);
  return loaded;
});

/** The reads are issued one at a time in the tree's depth-first order, announced
 * or not. One node's relations all read by the same parents, so their first reads
 * are independent: a reader that accepts announcements is told of them together
 * before the first runs. A selection prepared for that still fails at its own turn. */
const populateRelationTree = Effect.fnUntraced(function* (
  population: RelationPopulation,
  source: string, rows: readonly JsonObject[], tree: PopulateTree, prefix = "",
): Effect.fn.Return<JsonObject[], CommerceTransactionError> {
  const { readRows, fetched, withDeleted, announced } = population;
  const result = rows.map(row => ({ ...row }));
  const relations = [...tree].map(([name, nested]) => {
    const path = prefix === "" ? name : prefix + "." + name;
    return { name, nested, path, reads: relationReads(population, source, name, path) };
  });
  const ahead = new Map<string, PreparedPopulationRead>();
  if (readRows.announce !== undefined && relations.length > 1) {
    const fresh: CommerceRelationRead[] = [];
    for (const { name, reads } of relations) {
      const planned = Result.getOrUndefined(reads), first = planned?.pivot ?? planned?.related;
      if (first === undefined) continue;
      const selection = prepareCommerceRelationPopulation(first.columns, rows, first.parentColumns, first.softDelete, withDeleted, first.predicate);
      const selected = Option.getOrUndefined(Result.getOrElse(selection, () => Option.none()));
      // A primary-key read that the rows read so far already satisfy issues no find.
      const find = selected === undefined || first.primaryLookup
        && reusePrimaryRelationRows(fetched.get(populationCacheKey(first)), selected.column, selected.values) !== undefined
        ? undefined : { table: first.table, predicate: selected.predicate, order: first.order };
      if (find !== undefined) fresh.push(find);
      ahead.set(name, { selection, find });
    }
    if (fresh.length > 1) {
      const finds = [...fresh, ...announced];
      for (const find of fresh) announced.add(find);
      yield* readRows.announce(finds);
    }
  }
  for (const { name, nested, path, reads } of relations) {
    const { descriptor, pivot, related: target } = yield* Effect.fromResult(reads);
    const first = ahead.get(name);
    const pivotRows = pivot === undefined ? [] : yield* readPopulationRelation(population, pivot, rows, first);
    const related = yield* readPopulationRelation(population, target, pivot === undefined ? rows : pivotRows, pivot === undefined ? first : undefined);
    const populated = yield* populateRelationTree(population, descriptor.targetTable, related, nested, path);
    const join = descriptor.join;
    if (join.type === "belongsTo") attachToOne(result, name, populated, descriptor.targetPrimaryKeys, join.foreignKeys);
    else if (join.type === "hasOne") yield* Effect.fromResult(attachHasOne(result, name, populated, descriptor.sourcePrimaryKeys, join.foreignKeys));
    else {
      const grouped = join.type === "hasMany"
        ? groupHasManyRows(populated, join.foreignKeys)
        : groupManyToManyRows(populated, pivotRows, descriptor.targetPrimaryKeys, join.sourceColumns, join.targetColumns);
      for (const row of result) row[name] = grouped.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ?? [];
    }
  }
  return result;
});

/** Core owns the session, bounds and row decoding. Medusa owns relation grouping.
 * This instance is local to one call and never acquires a second manager. */
export const populateCommerceRelations = Effect.fnUntraced(function* (
  readRows: CommerceRelationRows,
  table: string,
  roots: readonly JsonObject[],
  paths: readonly string[],
  relations: CommerceRelationLookup,
  ordering: ReadonlyMap<string, CommerceRelationOrder>,
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
  const population: RelationPopulation = { readRows, relations, ordering, withDeleted, filters, fetched, announced: new Set() };
  return yield* populateRelationTree(population, table, roots, toPopulateTree(paths));
});

/** The same Medusa grouping for already inserted rows; creation does no re-read. */
export function assembleCommerceRelations(
  table: string, rows: ReadonlyMap<string, readonly JsonObject[]>, paths: readonly string[], relations: CommerceRelationLookup,
): Result.Result<JsonObject[], CommerceTransactionError> {
  function assemble(source: string, tree: PopulateTree): Result.Result<JsonObject[], CommerceTransactionError> {
    return Result.gen(function* () {
    const result = (rows.get(source) ?? []).map(row => ({ ...row }));
    for (const [name, nested] of tree) {
      const descriptor = relations.get(source)?.get(name);
      // Only metadata-validated, admitted paths reach this internal projection.
      if (descriptor === undefined) throw new Error("Missing admitted Medusa relation");
      const related = yield* assemble(descriptor.targetTable, nested);
      const join = descriptor.join;
      if (join.type === "belongsTo") {
        attachToOne(result, name, related, descriptor.targetPrimaryKeys, join.foreignKeys);
        continue;
      }
      if (join.type === "hasOne") {
        yield* attachHasOne(result, name, related, descriptor.sourcePrimaryKeys, join.foreignKeys);
        continue;
      }
      const grouped = join.type === "hasMany"
        ? groupHasManyRows(related, join.foreignKeys)
        : groupManyToManyRows(related, rows.get(join.pivotTable) ?? [], descriptor.targetPrimaryKeys, join.sourceColumns, join.targetColumns);
      for (const row of result) row[name] = grouped.get(tupleKey(row, descriptor.sourcePrimaryKeys)) ?? [];
    }
    return result;
    });
  }
  return assemble(table, toPopulateTree(paths));
}
