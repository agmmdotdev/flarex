import { Effect, Schema } from "effect";
import { generateEntityId, MedusaError } from "@medusajs/framework/utils/portable";
import { emptyPerformedActions, addPerformedAction } from "@medusajs/drizzle/mutation-events";
import { tupleKey } from "@medusajs/drizzle/relation-query";
import { hasChangedFields, relationshipNotFoundMessage } from "@medusajs/drizzle/mutation-plan";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "./commerce-decoder";
import { captureCommerceInput } from "./commerce-input";
import { assembleCommerceRelations } from "./commerce-relations";
import { decodeGraphArray } from "./product-value-profile";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "./product-runtime-metadata";

const decodeConfig = commerceDecoder(Schema.Struct({ relations: Schema.Array(Schema.String) }), "unsupportedProfile");
const decodeReference = commerceDecoder(Schema.Union([Schema.String, Schema.StructWithRest(Schema.Struct({ id: Schema.String }), [Schema.Record(Schema.String, Schema.Json)])]), "invalidInput");
const decodeCollectionProductReference = commerceDecoder(Schema.Struct({ id: Schema.String }), "invalidInput");
type Table = ProductRuntimeMetadata["tables"][number];

/** One replacement operation owns this plan and its complete scoped snapshots.
 * Medusa supplies normalized values; core supplies all reads, writes and facts.
 * No manager, SQL implementation or mutable state survives this operation.
 */
export const replaceProductRows = Effect.fn("ProductAdapter.replaceRows")(function* (
  ctx: CommerceCommandContext, catalog: ProductRuntimeMetadata, entity: ProductEntityMetadata,
  input: unknown, config: unknown, creation = false,
) {
  const supplied = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
  const inputs = yield* Effect.fromResult(decodeGraphArray(supplied));
  const settings = yield* Effect.fromResult(captureCommerceInput(config));
  const { relations } = yield* Effect.fromResult(decodeConfig(settings));
  const allowed = entity === catalog.product ? ["options", "variants", "images", "tags", "categories"]
    : entity === catalog.option ? ["values"] : entity === catalog.variant ? ["options"] : entity === catalog.collection ? ["products"] : [];
  if (relations.some(name => !allowed.includes(name))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const state = new Map<string, JsonObject[]>();
  const inserts = new Map<string, Map<string, JsonObject>>();
  const updates = new Map<string, Map<string, JsonObject>>();
  const deletes = new Map<string, Map<string, JsonObject>>();
  const visited = new Set<string>();
  const stores = new Map<string, Effect.Success<ReturnType<CommerceCommandContext["table"]>>>();
  const getStore = Effect.fn("ProductMutation.store")(function* (table: Table) {
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
  const load = Effect.fn("ProductMutation.load")(function* (table: Table) {
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
  const remove = Effect.fn("ProductMutation.remove")(function* (table: Table, row: JsonObject): Effect.fn.Return<void, CommerceTransactionError> {
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
  const plan = Effect.fn("ProductMutation.plan")(function* (
    target: ProductEntityMetadata, inputRow: Json, owner: JsonObject, root: boolean,
  ): Effect.fn.Return<JsonObject, CommerceTransactionError> {
    const decoded = yield* Effect.fromResult(catalog.valueProfile.decodeRow(target.table.name, inputRow));
    const id = generateEntityId(decoded.id, target.prefix);
    const row = decoded.supplied;
    const token = target.table.name + ":" + id;
    if (visited.has(token)) return yield* Effect.fail(commerceError("invalidInput"));
    visited.add(token);
    const rows = yield* load(target.table);
    const existing = rows.find(value => value.id === id);
    if (existing?.deleted_at != null || (creation && root && existing !== undefined)) return yield* Effect.fail(commerceError("invalidInput"));
    if (Object.entries(owner).some(([name, value]) => (row[name] !== undefined && row[name] !== value) || (existing !== undefined && existing[name] !== value)))
      return yield* Effect.fail(commerceError("invalidInput"));
    const scalar: Record<string, Json> = { ...Object.fromEntries(Object.entries(row).filter(([name]) => target.table.columns.some(column => column.name === name))), ...owner, id };
    for (const name of ["created_at", "updated_at", "deleted_at"]) {
      if (scalar[name] !== undefined && (existing === undefined || scalar[name] !== existing[name])) return yield* Effect.fail(commerceError("invalidInput"));
      delete scalar[name];
    }
    if (target === catalog.product) {
      for (const name of ["collection", "type"] as const) {
        if (row[name] === undefined) continue;
        const descriptor = catalog.queryRelations.get(target.table.name)?.get(name);
        const column = descriptor?.join.type === "belongsTo" ? descriptor.join.foreignKeys[0] : undefined;
        if (column === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        const selected = row[name] === null ? null : (yield* plan(catalog[name], row[name], {}, false)).id;
        if (selected !== null && typeof selected !== "string") return yield* Effect.fail(commerceError("invalidInput"));
        scalar[column] = selected;
      }
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
      // not move a child. Only Product's separately admitted references change.
      for (const fk of target.table.foreignKeys) for (const name of fk.columns) {
        if (scalar[name] === undefined || target === catalog.product) continue;
        if (scalar[name] !== existing[name]) return yield* Effect.fail(commerceError("invalidInput"));
        delete scalar[name];
      }
      if (root || hasChangedFields(existing, scalar, ["id"])) put(updates, target.table, scalar);
    } else put(inserts, target.table, scalar);
    const next = { ...existing, ...scalar };
    state.set(target.table.name, [...rows.filter(value => value.id !== id), next]);
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
        if (target === catalog.collection) {
          if (child !== catalog.product) return yield* Effect.fail(commerceError("unsupportedProfile"));
          for (const member of members) {
            const reference = yield* Effect.fromResult(decodeCollectionProductReference(member));
            const token = child.table.name + ":" + reference.id;
            if (visited.has(token)) return yield* Effect.fail(commerceError("invalidInput"));
            visited.add(token);
            const products = yield* load(child.table);
            const product = products.find(row => row.id === reference.id && row.deleted_at == null);
            if (product === undefined) return yield* Effect.fail(commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA, relationshipNotFoundMessage(fk, reference.id))));
            if (product[fk] !== id) {
              put(updates, child.table, { id: reference.id, [fk]: id });
              state.set(child.table.name, products.map(row => row.id === reference.id ? { ...row, [fk]: id } : row));
            }
          }
          continue;
        }
        const previous = (yield* load(child.table)).filter(value => value[fk] === id);
        const retained = new Set<string>();
        for (const member of members) {
          const value = yield* plan(child, member, { [fk]: id }, false);
          if (typeof value.id !== "string") return yield* Effect.fail(commerceError("invalidInput"));
          retained.add(value.id);
        }
        for (const value of previous) if (typeof value.id === "string" && !retained.has(value.id)) yield* remove(child.table, value);
      } else {
        const pivot = catalog.writablePivots.find(table => table.name === join.pivotTable);
        const sourceColumn = join.sourceColumns[0], targetColumn = join.targetColumns[0];
        if (pivot === undefined || sourceColumn === undefined || targetColumn === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        const targets = yield* load(child.table);
        const previous = (yield* load(pivot)).filter(value => value[sourceColumn] === id);
        const retained = new Set<string>();
        for (const member of members) {
          const reference = yield* Effect.fromResult(decodeReference(member));
          if (typeof reference !== "string") yield* Effect.fromResult(catalog.valueProfile.decodeRow(child.table.name, reference));
          const childId = typeof reference === "string" ? reference : reference.id;
          if (retained.has(childId)) return yield* Effect.fail(commerceError("invalidInput"));
          retained.add(childId);
          const selected = targets.find(value => value.id === childId && value.deleted_at == null);
          if (selected === undefined) return yield* Effect.fail(commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA, relationshipNotFoundMessage(targetColumn, childId))));
          if (target === catalog.variant) {
            const options = yield* load(catalog.option.table);
            if (!options.some(value => value.id === selected.option_id && value.product_id === next.product_id)) return yield* Effect.fail(commerceError("invalidInput"));
          }
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
  // before parents. Self-referential category trees are outside this admission.
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
  const apply = Effect.fn("ProductMutation.apply")(function* (table: Table, operation: "insert" | "update" | "delete", group: Map<string, Map<string, JsonObject>>) {
    const rows = [...group.get(table.name)?.values() ?? []];
    if (rows.length === 0) return;
    const store = yield* getStore(table);
    const written = operation === "delete" ? yield* store.delete(ctx.manager, rows.map(row => Object.fromEntries(keys(table).map(key => [key, row[key]]))))
      : yield* store.write(ctx.manager, operation, rows);
    const model = catalog.entities.find(value => value.table === table);
    if (model !== undefined) for (const row of written) addPerformedAction(performedActions, operation === "insert" ? "created" : operation === "update" ? "updated" : "deleted", model.model, { ...row }, ["id"]);
    if (operation !== "delete") {
      const changed = new Set(written.map(row => identity(table, row)));
      state.set(table.name, [...(state.get(table.name) ?? []).filter(row => !changed.has(identity(table, row))), ...written]);
    }
  });
  for (const table of [...ordered].reverse()) yield* apply(table, "delete", deletes);
  for (const table of ordered) yield* apply(table, "insert", inserts);
  for (const table of ordered) yield* apply(table, "update", updates);
  const paths = relations.flatMap(name => name === "options" && entity === catalog.product ? [name, "options.values"] : [name]);
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
  const projection = new Map(state);
  const images = projection.get(catalog.image.table.name);
  if (images !== undefined) {
    const ranked: { row: JsonObject; rank: number }[] = [];
    for (const row of images) {
      if (typeof row.rank !== "number") return yield* Effect.fail(commerceError("storedCorruption"));
      ranked.push({ row, rank: row.rank });
    }
    projection.set(catalog.image.table.name, ranked.sort((left, right) => left.rank - right.rank).map(value => value.row));
  }
  projection.set(entity.table.name, roots.map(root => state.get(entity.table.name)?.find(row => row.id === root.id) ?? root));
  return { entities: assembleCommerceRelations(entity.table.name, projection, paths, catalog.queryRelations), performedActions };
});
