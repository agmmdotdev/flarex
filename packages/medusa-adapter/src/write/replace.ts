import { Effect, Schema } from "effect";
import { generateEntityId, MedusaError } from "@medusajs/framework/utils/portable";
import { emptyPerformedActions, addPerformedAction } from "@medusajs/drizzle/mutation-events";
import { tupleKey } from "@medusajs/drizzle/relation-query";
import { hasChangedFields, relationshipNotFoundMessage } from "@medusajs/drizzle/mutation-plan";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../commerce-decoder";
import { captureCommerceInput } from "../commerce-input";
import { assembleCommerceRelations } from "../commerce-relations";
import type { GraphEntity, GraphTable, ReplacementProfile, ReplacedGraph } from "./graph-model";
const decodeGraphArray = commerceDecoder(Schema.Array(Schema.Json), "invalidInput");
const decodeConfig = commerceDecoder(Schema.Struct({ relations: Schema.Array(Schema.String) }), "unsupportedProfile");
type Table = GraphTable;

/** One replacement operation owns this plan and its complete scoped snapshots.
 * Medusa supplies normalized values; core supplies all reads, writes and facts.
 * No manager, SQL implementation or mutable state survives this operation.
 */
export const replaceGraphRows = Effect.fn("MedusaGraph.replaceRows")(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table" | "resources">, profile: ReplacementProfile, entity: GraphEntity,
  input: unknown, config: unknown, creation = false,
): Effect.fn.Return<ReplacedGraph, CommerceTransactionError> {
  const catalog = profile.catalog;
  const supplied = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
  const inputs = yield* Effect.fromResult(decodeGraphArray(supplied));
  const settings = yield* Effect.fromResult(captureCommerceInput(config));
  const { relations } = yield* Effect.fromResult(decodeConfig(settings));
  if (relations.some(name => !profile.allowedRelations(entity).includes(name))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const state = new Map<string, JsonObject[]>();
  const inserts = new Map<string, Map<string, JsonObject>>();
  const updates = new Map<string, Map<string, JsonObject>>();
  const deletes = new Map<string, Map<string, JsonObject>>();
  const visited = new Set<string>();
  const stores = new Map<string, Effect.Success<ReturnType<CommerceCommandContext["table"]>>>();
  const getStore = Effect.fn("MedusaGraph.store")(function* (table: Table) {
    const previous = stores.get(table.name);
    if (previous !== undefined) return previous;
    const store = yield* ctx.table(table.name);
    stores.set(table.name, store);
    return store;
  });
  const keys = (table: Table) => table.columns.some(column => column.primaryKey)
    ? table.columns.filter(column => column.primaryKey).map(column => column.name)
    : table.foreignKeys.flatMap(key => key.columns);
  const identity = (table: Table, row: JsonObject) => tupleKey(row, keys(table));
  const put = (group: Map<string, Map<string, JsonObject>>, table: Table, row: JsonObject) => {
    const rows = group.get(table.name) ?? new Map<string, JsonObject>();
    rows.set(identity(table, row), row); group.set(table.name, rows);
  };
  const load = Effect.fn("MedusaGraph.load")(function* (table: Table) {
    const cached = state.get(table.name);
    if (cached !== undefined) return cached;
    const store = yield* getStore(table);
    const order = keys(table)[0];
    if (order === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    // Core find first bounds the entire scoped catalog at 256 rows. Therefore a
    // 256-row unfiltered read is complete without another count/round trip.
    const rows = yield* store.find(ctx.manager, { take: ctx.resources.queryRows, order: { column: order, direction: "asc" } });
    const copy = rows.map(row => ({ ...row })); state.set(table.name, copy);
    return copy;
  });
  const remove = Effect.fn("MedusaGraph.remove")(function* (table: Table, row: JsonObject): Effect.fn.Return<void, CommerceTransactionError> {
    const token = identity(table, row);
    if (deletes.get(table.name)?.has(token)) return;
    if (inserts.get(table.name)?.has(token) || updates.get(table.name)?.has(token)) return yield* Effect.fail(commerceError("invalidInput"));
    for (const child of catalog.tables) {
      for (const fk of child.foreignKeys.filter(key => key.referencedTable === table.name && key.onDelete === "cascade")) {
        const children = yield* load(child);
        const selected = children.filter(value => tupleKey(value, fk.columns) === tupleKey(row, fk.referencedColumns));
        for (const value of selected) yield* remove(child, value);
      }
    }
    put(deletes, table, row);
    state.set(table.name, (yield* load(table)).filter(value => identity(table, value) !== token));
  });
  const plan = Effect.fn("MedusaGraph.plan")(function* (
    target: GraphEntity, inputRow: Json, owner: JsonObject, root: boolean,
  ): Effect.fn.Return<JsonObject, CommerceTransactionError> {
    const decoded = yield* Effect.fromResult(catalog.decodeRow(target, inputRow));
    const id = generateEntityId(decoded.key, target.prefix);
    const row = decoded.supplied;
    const token = target.table.name + ":" + id;
    if (visited.has(token)) return yield* Effect.fail(commerceError("invalidInput"));
    visited.add(token);
    const rows = yield* load(target.table);
    const existing = rows.find(value => value[target.keyColumn] === id);
    if (existing?.deleted_at != null || (creation && root && existing !== undefined)) return yield* Effect.fail(commerceError("invalidInput"));
    if (Object.entries(owner).some(([name, value]) => (row[name] !== undefined && row[name] !== value) || (existing !== undefined && existing[name] !== value)))
      return yield* Effect.fail(commerceError("invalidInput"));
    const scalar: Record<string, Json> = { ...Object.fromEntries(Object.entries(row).filter(([name]) => target.table.columns.some(column => column.name === name))), ...owner, [target.keyColumn]: id };
    for (const name of ["created_at", "updated_at", "deleted_at"]) {
      if (scalar[name] !== undefined && (existing === undefined || scalar[name] !== existing[name])) return yield* Effect.fail(commerceError("invalidInput"));
      delete scalar[name];
    }
    for (const name of profile.ownedToOne(target)) {
      if (row[name] === undefined) continue;
      const descriptor = catalog.queryRelations.get(target.table.name)?.get(name);
      const column = descriptor?.join.type === "belongsTo" ? descriptor.join.foreignKeys[0] : undefined;
      const child = catalog.entities.find(value => value.table.name === descriptor?.targetTable);
      if (column === undefined || child === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const selected = row[name] === null ? null : (yield* plan(child, row[name], {}, false))[child.keyColumn];
      if (selected !== null && typeof selected !== "string") return yield* Effect.fail(commerceError("invalidInput"));
      scalar[column] = selected;
    }
    for (const fk of target.table.foreignKeys) {
      const column = fk.columns[0], targetColumn = fk.referencedColumns[0];
      if (column === undefined || targetColumn === undefined || fk.columns.length !== 1 || fk.referencedColumns.length !== 1) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const reference = scalar[column];
      if (reference === undefined || reference === null) continue;
      const table = catalog.tables.find(table => table.name === fk.referencedTable);
      if (table === undefined || typeof reference !== "string") return yield* Effect.fail(commerceError("invalidInput"));
      if (!(yield* load(table)).some(row => row[targetColumn] === reference && row.deleted_at == null))
        return yield* Effect.fail(commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA, relationshipNotFoundMessage(column, reference))));
    }
    if (existing !== undefined) {
      // Child owner references may be repeated by Medusa normalization but may
      // not move a child. Mutable references require explicit module admission.
      for (const fk of target.table.foreignKeys) for (const name of fk.columns) {
        if (scalar[name] === undefined || profile.mutableForeignKeys(target)) continue;
        if (scalar[name] !== existing[name]) return yield* Effect.fail(commerceError("invalidInput"));
        delete scalar[name];
      }
      if (root || hasChangedFields(existing, scalar, [target.keyColumn])) put(updates, target.table, scalar);
    } else put(inserts, target.table, scalar);
    const next = { ...existing, ...scalar };
    state.set(target.table.name, [...rows.filter(value => value[target.keyColumn] !== id), next]);
    for (const [name, descriptor] of catalog.queryRelations.get(target.table.name) ?? []) {
      if (row[name] === undefined || descriptor.join.type === "belongsTo") continue;
      if (root && !relations.includes(name)) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const child = catalog.entities.find(value => value.table.name === descriptor.targetTable);
      if (child === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const members = yield* Effect.fromResult(decodeGraphArray(row[name]));
      const join = descriptor.join;
      if (join.type === "hasMany") {
        const fk = join.foreignKeys[0];
        if (join.foreignKeys.length !== 1 || fk === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        const mode = yield* Effect.fromResult(profile.toManyMode(target, name, child));
        if (mode === "associate") {
          for (const member of members) {
            const reference = yield* Effect.fromResult(catalog.decodeAssociation(child, member));
            const token = child.table.name + ":" + reference;
            if (visited.has(token)) return yield* Effect.fail(commerceError("invalidInput"));
            visited.add(token);
            const candidates = yield* load(child.table);
            const selected = candidates.find(row => row[child.keyColumn] === reference && row.deleted_at == null);
            if (selected === undefined) return yield* Effect.fail(commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA, relationshipNotFoundMessage(fk, reference))));
            if (selected[fk] !== id) {
              put(updates, child.table, { [child.keyColumn]: reference, [fk]: id });
              state.set(child.table.name, candidates.map(row => row[child.keyColumn] === reference ? { ...row, [fk]: id } : row));
            }
          }
          continue;
        }
        const previous = (yield* load(child.table)).filter(value => value[fk] === id);
        const retained = new Set<string>();
        for (const member of members) {
          const value = yield* plan(child, member, { [fk]: id }, false);
          const key = value[child.keyColumn];
          if (typeof key !== "string") return yield* Effect.fail(commerceError("invalidInput"));
          retained.add(key);
        }
        for (const value of previous) {
          const key = value[child.keyColumn];
          if (typeof key === "string" && !retained.has(key)) yield* remove(child.table, value);
        }
      } else {
        const pivot = catalog.writablePivots.find(table => table.name === join.pivotTable);
        const sourceColumn = join.sourceColumns[0], targetColumn = join.targetColumns[0];
        if (pivot === undefined || sourceColumn === undefined || targetColumn === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        const targets = yield* load(child.table);
        const previous = (yield* load(pivot)).filter(value => value[sourceColumn] === id);
        const retained = new Set<string>();
        for (const member of members) {
          const reference = yield* Effect.fromResult(catalog.decodeReference(child, member));
          if (reference.supplied !== undefined) yield* Effect.fromResult(catalog.decodeRow(child, reference.supplied));
          const childId = reference.key;
          if (retained.has(childId)) return yield* Effect.fail(commerceError("invalidInput"));
          retained.add(childId);
          const selected = targets.find(value => value[child.keyColumn] === childId && value.deleted_at == null);
          if (selected === undefined) return yield* Effect.fail(commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA, relationshipNotFoundMessage(targetColumn, childId))));
          yield* profile.validateLink(target, next, selected, load);
          const link = { [sourceColumn]: id, [targetColumn]: childId };
          if (!previous.some(value => identity(pivot, value) === identity(pivot, link))) {
            put(inserts, pivot, link); state.set(pivot.name, [...yield* load(pivot), link]);
          }
        }
        for (const link of previous) if (typeof link[targetColumn] === "string" && !retained.has(link[targetColumn])) yield* remove(pivot, link);
      }
    }
    return next;
  });
  const roots: JsonObject[] = [];
  for (const row of inputs) roots.push(yield* plan(entity, row, {}, true));
  // A stable dependency order batches independent rows and removes children
  // before parents. Self-referential tree policies require separate admission.
  const ordered: Table[] = [];
  const pending = [...catalog.tables];
  while (pending.length) {
    const index = pending.findIndex(table => table.foreignKeys.every(fk => fk.referencedTable === table.name || !pending.some(candidate => candidate.name === fk.referencedTable)));
    if (index < 0) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const [table] = pending.splice(index, 1);
    if (table === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    ordered.push(table);
  }
  const performedActions = emptyPerformedActions();
  const apply = Effect.fn("MedusaGraph.apply")(function* (table: Table, operation: "insert" | "update" | "delete", group: Map<string, Map<string, JsonObject>>) {
    const rows = [...group.get(table.name)?.values() ?? []];
    if (rows.length === 0) return;
    const store = yield* getStore(table);
    const written = operation === "delete" ? yield* store.delete(ctx.manager, rows.map(row => Object.fromEntries(keys(table).map(key => [key, row[key]]))))
      : yield* store.write(ctx.manager, operation, rows);
    const model = catalog.entities.find(value => value.table === table);
    if (model !== undefined) for (const row of written) addPerformedAction(performedActions, operation === "insert" ? "created" : operation === "update" ? "updated" : "deleted", model.model, { ...row }, [model.keyColumn]);
    if (operation !== "delete") {
      const changed = new Set(written.map(row => identity(table, row)));
      state.set(table.name, [...(state.get(table.name) ?? []).filter(row => !changed.has(identity(table, row))), ...written]);
    }
  });
  for (const table of [...ordered].reverse()) yield* apply(table, "delete", deletes);
  for (const table of ordered) yield* apply(table, "insert", inserts);
  for (const table of ordered) yield* apply(table, "update", updates);
  const paths = profile.projectionPaths(entity, relations);
  // Hydrate requested relations from the plan's rows, loading only untouched
  // relation tables. The original service owns the final DTO serialization.
  for (const path of paths) {
    let source = entity.table.name;
    let parents: readonly JsonObject[] = roots;
    for (const name of path.split(".")) {
      if (parents.length === 0) break;
      const descriptor = catalog.queryRelations.get(source)?.get(name);
      if (descriptor === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const table = catalog.tables.find(table => table.name === descriptor.targetTable);
      if (table === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const join = descriptor.join;
      if (join.type === "manyToMany") {
        const pivot = catalog.tables.find(table => descriptor.join.type === "manyToMany" && table.name === descriptor.join.pivotTable);
        if (pivot === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        const sources = new Set(parents.map(row => tupleKey(row, descriptor.sourcePrimaryKeys)));
        const links = (yield* load(pivot)).filter(row => sources.has(tupleKey(row, join.sourceColumns)));
        if (links.length === 0) break;
        const targets = new Set(links.map(row => tupleKey(row, join.targetColumns)));
        parents = (yield* load(table)).filter(row => targets.has(tupleKey(row, descriptor.targetPrimaryKeys)));
      } else if (join.type === "hasMany") {
        const sources = new Set(parents.map(row => tupleKey(row, descriptor.sourcePrimaryKeys)));
        parents = (yield* load(table)).filter(row => sources.has(tupleKey(row, join.foreignKeys)));
      } else {
        const targets = new Set(parents.map(row => tupleKey(row, join.foreignKeys)));
        parents = (yield* load(table)).filter(row => targets.has(tupleKey(row, descriptor.targetPrimaryKeys)));
      }
      source = table.name;
    }
  }
  const projection = new Map(yield* Effect.fromResult(profile.project(state)));
  projection.set(entity.table.name, roots.map(root => state.get(entity.table.name)?.find(row => row[entity.keyColumn] === root[entity.keyColumn]) ?? root));
  return { entities: assembleCommerceRelations(entity.table.name, projection, paths, catalog.queryRelations), performedActions };
});
