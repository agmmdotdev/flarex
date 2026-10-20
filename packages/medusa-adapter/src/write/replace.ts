import { observeExecution } from "@flarex/persistence-postgres/internal/execution-diagnostics";
// Named execution diagnostics belong to explicit SDK composition. Local operations
// retain their lazy Effect body without rebuilding traced function definitions.
import { Effect, Result, Schema } from "effect";
import { generateEntityId, MedusaError } from "@medusajs/framework/utils/portable";
import { emptyPerformedActions, addPerformedAction } from "@medusajs/drizzle/mutation-events";
import { tupleKey } from "@medusajs/drizzle/relation-query";
import { jsonEqual } from "flarex-protocol/json";
import { hasChangedFields, relationshipNotFoundMessage } from "@medusajs/drizzle/mutation-plan";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type CommerceTransactionError, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../value/decoder";
import { captureCommerceInput } from "../value/input";
import { assembleCommerceRelations } from "../query/relations";
import type { GraphEntity, GraphTable, ReplacementProfile, ReplacedGraph } from "./graph-model";
// The authoritative native capture already established the complete JSON tree.
// Relation shape remains checked here; operation-specific decoders stay below.
const graphArray = (value: Json): Result.Result<readonly Json[], CommerceTransactionError> =>
  Array.isArray(value) ? Result.succeed(value) : Result.fail(commerceError("invalidInput"));
const decodeConfig = commerceDecoder(Schema.Struct({ relations: Schema.Array(Schema.String) }), "unsupportedProfile");
const decodeManagedUpdateTime = commerceDecoder(Schema.DateFromString, "invalidInput");
const decodeStoredUpdateTime = commerceDecoder(Schema.DateFromString, "storedCorruption");
type Table = GraphTable;

/** One replacement operation owns this plan and its complete scoped snapshots.
 * Medusa supplies normalized values; core supplies all reads, writes and facts.
 * No manager, SQL implementation or mutable state survives this operation.
 */
export const replaceGraphRows = Effect.fnUntraced(function* (
  ctx: Pick<CommerceCommandContext, "manager" | "table" | "resources">, profile: ReplacementProfile, entity: GraphEntity,
  input: unknown, config: unknown, creation = false,
): Effect.fn.Return<ReplacedGraph, CommerceTransactionError> {
  const catalog = profile.catalog;
  if ((profile.existingRootWrite !== undefined || profile.ownedChildWrite !== undefined) &&
    (creation || profile.operation !== "upsertWithReplace"))
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  const supplied = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
  const inputs = yield* Effect.fromResult(graphArray(supplied));
  const settings = yield* Effect.fromResult(captureCommerceInput(config));
  const { relations } = yield* Effect.fromResult(decodeConfig(settings));
  if (relations.some(name => !profile.allowedRelations(entity).includes(name))) return yield* Effect.fail(commerceError("unsupportedProfile"));
  const state = new Map<string, JsonObject[]>();
  const selectedKeys = new Set<string>();
  const inserts = new Map<string, Map<string, JsonObject>>();
  const reconstitutions = new Map<string, Map<string, JsonObject>>();
  const updates = new Map<string, Map<string, JsonObject>>();
  const upserts = new Map<string, Map<string, JsonObject>>();
  const deletes = new Map<string, Map<string, JsonObject>>();
  const visited = new Set<string>();
  const repeatedReferences = new Map<string, { readonly owner: JsonObject; readonly row: JsonObject }>();
  const stores = new Map<string, Effect.Success<ReturnType<CommerceCommandContext["table"]>>>();
  const getStore = (table: Table) => observeExecution("MedusaGraph.store", Effect.gen(function* () {
    const previous = stores.get(table.name);
    if (previous !== undefined) return previous;
    const store = yield* ctx.table(table.name);
    stores.set(table.name, store);
    return store;
  }));
  const keys = (table: Table) => table.columns.some(column => column.primaryKey)
    ? table.columns.filter(column => column.primaryKey).map(column => column.name)
    : table.foreignKeys.flatMap(key => key.columns);
  const identity = (table: Table, row: JsonObject) => tupleKey(row, keys(table));
  const orderedDeletionTables = new Set(profile.orderedDeletionTables ?? []);
  if (profile.orderedDeletionTables !== undefined && orderedDeletionTables.size !== profile.orderedDeletionTables.length)
    return yield* Effect.fail(commerceError("unsupportedProfile"));
  for (const name of orderedDeletionTables) {
    const table = catalog.tables.find(table => table.name === name), order = profile.ordering.get(name);
    const primary = table?.columns.filter(column => column.primaryKey);
    if (creation || table === undefined || table.name === entity.table.name || primary?.length !== 1 ||
      (primary[0]?.type !== "text" && primary[0]?.type !== "id") || primary[0].nullable || order === undefined || typeof order === "string" ||
      order.kind !== "storageInsertion" || order.direction !== "asc")
      return yield* Effect.fail(commerceError("unsupportedProfile"));
  }
  const put = (group: Map<string, Map<string, JsonObject>>, table: Table, row: JsonObject) => {
    const rows = group.get(table.name) ?? new Map<string, JsonObject>();
    rows.set(identity(table, row), row); group.set(table.name, rows);
  };
  const load = (table: Table, column: string, values: readonly string[], refresh = false) => observeExecution("MedusaGraph.load", Effect.gen(function* () {
    if (values.length === 0) return [];
    const selected = new Set(values);
    let known = new Map((state.get(table.name) ?? []).map(row => [identity(table, row), row]));
    const primary = keys(table);
    // A complete prior FK selection may already contain every requested
    // primary-key row. Reuse that request-local view instead of spending one
    // bounded call per retained child; unknown keys still go to core.
    if (!refresh && primary.length === 1 && primary[0] === column && [...selected].every(value =>
      [...known.values()].some(row => row[column] === value)))
      return [...known.values()].filter(row => typeof row[column] === "string" && selected.has(row[column]) &&
        !deletes.get(table.name)?.has(identity(table, row)));
    const selectionKey = JSON.stringify([table.name, column, [...selected].sort()]);
    if (refresh || !selectedKeys.has(selectionKey)) {
      const store = yield* getStore(table);
      const order = profile.ordering.get(table.name) ?? keys(table)[0];
      if (order === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const rows = yield* store.find(ctx.manager, { take: ctx.resources.queryRows,
        order: typeof order === "string" ? { column: order, direction: "asc" } : { ...order },
        predicate: { kind: "in", column, values: [...selected] } });
      yield* Effect.fromResult(profile.admitSelection(table, rows));
      // The plan's request-local rows override prior store values until its
      // batched writes run. The core read still owns index selection and bounds.
      if (typeof order !== "string") {
        // A complete intrinsic-order selection supplies the order of this
        // cohort. Final refresh happens after applied writes, so its actual
        // rows replace the planning cache before native relation assembly.
        const ordered = rows.filter(row => !deletes.get(table.name)?.has(identity(table, row)))
          .map(row => [identity(table, row), refresh ? { ...row } : known.get(identity(table, row)) ?? { ...row }] as const);
        known = new Map([...known].filter(([, row]) => typeof row[column] !== "string" || !selected.has(row[column])));
        for (const [token, row] of ordered) known.set(token, row);
      } else {
        for (const row of rows) {
          const token = identity(table, row);
          if (!known.has(token) && !deletes.get(table.name)?.has(token)) known.set(token, { ...row });
        }
      }
      selectedKeys.add(selectionKey);
    }
    state.set(table.name, [...known.values()]);
    return [...known.values()].filter(row => typeof row[column] === "string" && selected.has(row[column]) &&
      !deletes.get(table.name)?.has(identity(table, row)));
  }));
  const remove = (table: Table, row: JsonObject) => observeExecution("MedusaGraph.remove", Effect.gen(function* (): Effect.fn.Return<void, CommerceTransactionError> {
    const token = identity(table, row);
    if (deletes.get(table.name)?.has(token)) return;
    if (inserts.get(table.name)?.has(token) || reconstitutions.get(table.name)?.has(token) || updates.get(table.name)?.has(token))
      return yield* Effect.fail(commerceError("invalidInput"));
    for (const child of catalog.tables) {
      for (const fk of child.foreignKeys.filter(key => key.referencedTable === table.name && key.onDelete === "cascade")) {
        const childColumn = fk.columns[0], parentColumn = fk.referencedColumns[0];
        if (fk.columns.length !== 1 || fk.referencedColumns.length !== 1 || childColumn === undefined || parentColumn === undefined ||
          typeof row[parentColumn] !== "string") return yield* Effect.fail(commerceError("unsupportedProfile"));
        const children = yield* load(child, childColumn, [row[parentColumn]]);
        const selected = children.filter(value => tupleKey(value, fk.columns) === tupleKey(row, fk.referencedColumns));
        for (const value of selected) yield* remove(child, value);
      }
    }
    put(deletes, table, row);
    state.set(table.name, (state.get(table.name) ?? []).filter(value => identity(table, value) !== token));
  }));
  const plan = (target: GraphEntity, inputRow: Json, owner: JsonObject, root: boolean, touch = false) => observeExecution("MedusaGraph.plan", Effect.gen(function* (): Effect.fn.Return<JsonObject, CommerceTransactionError> {
    const decoded = yield* Effect.fromResult(catalog.decodeRow(target, inputRow));
    const id = generateEntityId(decoded.key, target.prefix);
    const row = decoded.supplied;
    const token = target.table.name + ":" + id;
    const keyOnly = Object.keys(row).length === 1 && row[target.keyColumn] === id;
    const reusable = !creation && profile.operation === "update" && !root && !touch && Object.keys(owner).length > 0 && keyOnly &&
      profile.repeatedOwnedReferences === "coalesceIdentical";
    if (visited.has(token)) {
      const previous = repeatedReferences.get(token);
      if (reusable && previous !== undefined && jsonEqual(previous.owner, owner)) return previous.row;
      return yield* Effect.fail(commerceError("invalidInput"));
    }
    visited.add(token);
    const rows = yield* load(target.table, target.keyColumn, [id]);
    const existing = rows.find(value => value[target.keyColumn] === id);
    if (existing?.deleted_at != null || (creation && root && existing !== undefined)) return yield* Effect.fail(commerceError("invalidInput"));
    if (root && profile.existingRootWrite === "upsert" && existing === undefined)
      return yield* Effect.fail(commerceError("invalidInput"));
    if (Object.entries(owner).some(([name, value]) => (row[name] !== undefined && row[name] !== value) || (existing !== undefined && existing[name] !== value)))
      return yield* Effect.fail(commerceError("invalidInput"));
    const preservingUpsert = existing !== undefined && (root ? profile.existingRootWrite !== undefined
      : Object.keys(owner).length > 0 && profile.ownedChildWrite === "upsert");
    if (existing !== undefined && preservingUpsert) put(upserts, target.table, existing);
    const scalar: Record<string, Json> = { ...Object.fromEntries(Object.entries(row).filter(([name]) => target.table.columns.some(column => column.name === name))), ...owner, [target.keyColumn]: id };
    const reconstitution = existing === undefined && !root && profile.allowReconstitution === true &&
      ["created_at", "updated_at", "deleted_at"].some(name => scalar[name] !== undefined);
    const managedChildUpdateTime = !creation && profile.operation === "update" && !root && existing !== undefined &&
      Object.keys(owner).length > 0 && profile.ownedChildUpdatedAt === "managed" && scalar.updated_at !== undefined;
    let managedUpdateChanged = false;
    if (managedChildUpdateTime) {
      const suppliedTime = yield* Effect.fromResult(decodeManagedUpdateTime(scalar.updated_at)),
        storedTime = yield* Effect.fromResult(decodeStoredUpdateTime(existing?.updated_at));
      managedUpdateChanged = suppliedTime.getTime() !== storedTime.getTime();
    }
    for (const name of ["created_at", "updated_at", "deleted_at"]) {
      if (reconstitution) continue;
      if (!(name === "updated_at" && managedChildUpdateTime) && scalar[name] !== undefined &&
        (existing === undefined || scalar[name] !== existing[name])) return yield* Effect.fail(commerceError("invalidInput"));
      delete scalar[name];
    }
    for (const name of profile.ownedToOne(target)) {
      if (row[name] === undefined) continue;
      const descriptor = catalog.queryRelations.get(target.table.name)?.get(name);
      const column = descriptor?.join.type === "belongsTo" ? descriptor.join.foreignKeys[0] : undefined;
      const child = catalog.entities.find(value => value.table.name === descriptor?.targetTable);
      if (column === undefined || child === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const reference = row[name];
      const selected = reference === null ? null : typeof reference === "string"
        ? (yield* Effect.fromResult(catalog.decodeReference(child, reference))).key
        : (yield* plan(child, reference, {}, false, profile.touchOwnedToOne === true))[child.keyColumn];
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
      const visibility = profile.foreignKeyVisibility?.(target, column) ?? "active";
      if (!(yield* load(table, targetColumn, [reference])).some(row => row[targetColumn] === reference &&
        (visibility === "existing" || row.deleted_at == null)))
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
      const rootTouch = !creation && profile.operation === "update" && profile.touchExistingRoot === true;
      const update = root ? profile.operation === "upsertWithReplace" || rootTouch || Object.keys(scalar).some(name => name !== target.keyColumn)
        : preservingUpsert || touch || managedUpdateChanged || hasChangedFields(existing, scalar, [target.keyColumn]);
      if (update) put(updates, target.table, scalar);
    } else put(reconstitution ? reconstitutions : inserts, target.table, scalar);
    const next = { ...existing, ...scalar };
    state.set(target.table.name, [...(state.get(target.table.name) ?? []).filter(value => value[target.keyColumn] !== id), next]);
    if (reusable && existing !== undefined) repeatedReferences.set(token, { owner, row: next });
    for (const [name, descriptor] of catalog.queryRelations.get(target.table.name) ?? []) {
      if (row[name] === undefined || descriptor.join.type === "belongsTo") continue;
      if (root && !relations.includes(name)) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const child = catalog.entities.find(value => value.table.name === descriptor.targetTable);
      if (child === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const members = yield* Effect.fromResult(graphArray(row[name]));
      // Update profiles default to module-owned empty collection cleanup.
      // Explicit replacement and upsert retain their empty-set rule.
      if (!creation && profile.operation === "update" && members.length === 0 && profile.emptyCollections !== "replace") continue;
      const join = descriptor.join;
      if (join.type === "hasMany") {
        const fk = join.foreignKeys[0];
        if (join.foreignKeys.length !== 1 || fk === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        const mode = yield* Effect.fromResult(profile.toManyMode(target, name, child));
        if (mode === "associate") {
          const references: Array<Result.Result<string, CommerceTransactionError>> = [];
          const targetIds = new Set<string>();
          for (const member of members) {
            const decoded = catalog.decodeAssociation(child, member);
            if (Result.isFailure(decoded)) { references.push(decoded); break; }
            const reference = decoded.success;
            const token = child.table.name + ":" + reference;
            if (visited.has(token) || targetIds.has(reference)) {
              references.push(Result.fail(commerceError("invalidInput")));
              break;
            }
            references.push(decoded);
            targetIds.add(reference);
          }
          const candidates = new Map((yield* load(child.table, child.keyColumn, [...targetIds]))
            .map(value => [value[child.keyColumn], value]));
          for (const decoded of references) {
            const reference = yield* Effect.fromResult(decoded);
            const token = child.table.name + ":" + reference;
            visited.add(token);
            const selected = candidates.get(reference);
            if (selected === undefined || selected.deleted_at != null) return yield* Effect.fail(commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA, relationshipNotFoundMessage(fk, reference))));
            if (selected[fk] !== id) {
              put(updates, child.table, { [child.keyColumn]: reference, [fk]: id });
              state.set(child.table.name, (state.get(child.table.name) ?? []).map(row =>
                row[child.keyColumn] === reference ? { ...row, [fk]: id } : row));
            }
          }
          continue;
        }
        const previous = (yield* load(child.table, fk, [id])).filter(value => value[fk] === id &&
          (profile.replacementMembers !== "active" || value.deleted_at == null));
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
        const previous = (yield* load(pivot, sourceColumn, [id])).filter(value => value[sourceColumn] === id);
        const retained = new Set<string>();
        // Decode pure references ahead of one indexed target read, then report
        // errors and validate links in the original member order. Stop at the
        // first invalid or duplicate member so its predecessors can still
        // report a missing target before that member does.
        const references: Array<Result.Result<{ readonly key: string }, CommerceTransactionError>> = [];
        const targetIds = new Set<string>();
        for (const member of members) {
          const reference = Result.flatMap(catalog.decodeReference(child, member), value =>
            value.supplied === undefined ? Result.succeed({ key: value.key })
              : Result.map(catalog.decodeRow(child, value.supplied), () => ({ key: value.key })));
          if (Result.isFailure(reference)) { references.push(reference); break; }
          if (targetIds.has(reference.success.key)) {
            references.push(Result.fail(commerceError("invalidInput")));
            break;
          }
          targetIds.add(reference.success.key);
          references.push(reference);
        }
        const targets = new Map((yield* load(child.table, child.keyColumn, [...targetIds]))
          .map(value => [value[child.keyColumn], value]));
        for (const reference of references) {
          const childId = (yield* Effect.fromResult(reference)).key;
          if (retained.has(childId)) return yield* Effect.fail(commerceError("invalidInput"));
          retained.add(childId);
          const selected = targets.get(childId);
          if (selected === undefined || selected.deleted_at != null) return yield* Effect.fail(commerceError("adapterFailure", new MedusaError(MedusaError.Types.INVALID_DATA, relationshipNotFoundMessage(targetColumn, childId))));
          yield* profile.validateLink(target, next, selected, load);
          const link = { [sourceColumn]: id, [targetColumn]: childId };
          if (!previous.some(value => identity(pivot, value) === identity(pivot, link))) {
            put(inserts, pivot, link); state.set(pivot.name, [...state.get(pivot.name) ?? [], link]);
          }
        }
        for (const link of previous) if (typeof link[targetColumn] === "string" && !retained.has(link[targetColumn])) yield* remove(pivot, link);
      }
    }
    return next;
  }));
  const roots: JsonObject[] = [];
  for (const row of inputs) roots.push(yield* plan(entity, row, {}, true));
  yield* profile.prepareProjection(entity, roots, load);
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
  // The complete graph plan, including every protected deletion order, must
  // be admitted before applying any mutation in any table.
  for (const table of [...ordered].reverse()) {
    if (!orderedDeletionTables.has(table.name)) continue;
    const rows = [...deletes.get(table.name)?.values() ?? []];
    if (rows.length === 0) continue;
    const store = yield* getStore(table);
    const key = keys(table)[0];
    if (key === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const values: string[] = [];
    for (const row of rows) {
      const value = row[key];
      if (typeof value !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
      values.push(value);
    }
    // Independently ordered per-root reads cannot establish the relative
    // insertion order of their children. Select the complete deletion
    // cohort once through the existing protected ordering owner; its
    // executed read retains actual ordered identities for call validation.
    const selected = yield* store.find(ctx.manager, { take: ctx.resources.queryRows,
      order: { kind: "storageInsertion", direction: "asc" }, predicate: { kind: "in", column: key, values } });
    yield* Effect.fromResult(profile.admitSelection(table, selected));
    const planned = new Map(rows.map(row => [identity(table, row), row]));
    if (selected.length !== rows.length || new Set(selected.map(row => identity(table, row))).size !== rows.length ||
      selected.some(row => !jsonEqual(planned.get(identity(table, row)) ?? null, row)))
      return yield* Effect.fail(commerceError("storedCorruption"));
    deletes.set(table.name, new Map(selected.map(row => [identity(table, row), row])));
  }
  const performedActions = emptyPerformedActions();
  const apply = (table: Table, operation: "insert" | "update" | "delete" | "reconstitute", group: Map<string, Map<string, JsonObject>>) => observeExecution("MedusaGraph.apply", Effect.gen(function* () {
    const rows = [...group.get(table.name)?.values() ?? []];
    if (rows.length === 0) return;
    const store = yield* getStore(table);
    let written: readonly JsonObject[];
    if (operation === "delete") {
      written = yield* store.delete(ctx.manager, rows.map(row => Object.fromEntries(keys(table).map(key => [key, row[key]]))));
    } else if (operation === "reconstitute") {
      const reconstitute = store.reconstitute;
      if (reconstitute === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      written = yield* reconstitute(ctx.manager, rows);
    } else {
      const selectedUpserts = upserts.get(table.name);
      if (operation === "update" && selectedUpserts !== undefined) {
        // Route only exact selected active identities. Nested rows sharing a
        // root table and unselected child policies keep ordinary managed
        // updates; existing owner proofs precede any owned-child selection.
        // Keep original row order when a table contains both kinds of write.
        const batches: Array<{ mode: "update" | "upsert"; rows: JsonObject[] }> = [];
        for (const row of rows) {
          const mode = selectedUpserts.has(identity(table, row)) ? "upsert" : "update";
          const previous = batches.at(-1);
          if (previous?.mode === mode) previous.rows.push(row);
          else batches.push({ mode, rows: [row] });
        }
        const result: JsonObject[] = [];
        for (const batch of batches) result.push(...yield* store.write(ctx.manager, batch.mode, batch.rows));
        written = result;
      } else written = yield* store.write(ctx.manager, operation, rows);
    }
    const model = catalog.entities.find(value => value.table === table);
    if (model !== undefined) for (const row of written) addPerformedAction(performedActions, operation === "insert" || operation === "reconstitute" ? "created" : operation === "update" ? "updated" : "deleted", model.model, { ...row }, [model.keyColumn]);
    if (operation !== "delete") {
      const changed = new Set(written.map(row => identity(table, row)));
      state.set(table.name, [...(state.get(table.name) ?? []).filter(row => !changed.has(identity(table, row))), ...written]);
    }
  }));
  for (const table of [...ordered].reverse()) yield* apply(table, "delete", deletes);
  for (const table of ordered) {
    yield* apply(table, "insert", inserts);
    yield* apply(table, "reconstitute", reconstitutions);
  }
  for (const table of ordered) yield* apply(table, "update", updates);
  const paths = profile.projectionPaths(entity, relations);
  // Keep returned write rows and their framework order. Select any previously
  // untouched relation members by declared keys before final projection.
  const rootIds: string[] = [];
  for (const root of roots) {
    const id = root[entity.keyColumn];
    if (typeof id !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
    rootIds.push(id);
  }
  const freshRoots = yield* load(entity.table, entity.keyColumn, rootIds);
  if (freshRoots.length !== roots.length) return yield* Effect.fail(commerceError("storedCorruption"));
  const selectValues = (rows: readonly JsonObject[], column: string) => observeExecution("MedusaGraph.selectValues", Effect.gen(function* () {
    const values = new Set<string>();
    for (const row of rows) {
      const value = row[column];
      if (value === null) continue;
      if (typeof value !== "string") return yield* Effect.fail(commerceError("storedCorruption"));
      values.add(value);
    }
    return [...values];
  }));
  // Hydrate each selected relation from its indexed forward or reverse key.
  // The original service still owns the final DTO serialization.
  for (const path of paths) {
    let source = entity.table.name;
    let parents: readonly JsonObject[] = freshRoots;
    for (const name of path.split(".")) {
      if (parents.length === 0) break;
      const descriptor = catalog.queryRelations.get(source)?.get(name);
      if (descriptor === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const table = catalog.tables.find(table => table.name === descriptor.targetTable);
      if (table === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
      const order = profile.ordering.get(table.name), refresh = order !== undefined && typeof order !== "string";
      const join = descriptor.join;
      if (join.type === "manyToMany") {
        const pivot = catalog.tables.find(table => table.name === join.pivotTable);
        const sourceKey = descriptor.sourcePrimaryKeys[0], pivotSource = join.sourceColumns[0];
        const pivotTarget = join.targetColumns[0], targetKey = descriptor.targetPrimaryKeys[0];
        if (pivot === undefined || descriptor.sourcePrimaryKeys.length !== 1 || join.sourceColumns.length !== 1 ||
          join.targetColumns.length !== 1 || descriptor.targetPrimaryKeys.length !== 1 ||
          sourceKey === undefined || pivotSource === undefined || pivotTarget === undefined || targetKey === undefined)
          return yield* Effect.fail(commerceError("unsupportedProfile"));
        const links = yield* load(pivot, pivotSource, yield* selectValues(parents, sourceKey));
        if (links.length === 0) break;
        parents = yield* load(table, targetKey, yield* selectValues(links, pivotTarget), refresh);
      } else if (join.type === "hasMany") {
        const sourceKey = descriptor.sourcePrimaryKeys[0], targetKey = join.foreignKeys[0];
        if (descriptor.sourcePrimaryKeys.length !== 1 || join.foreignKeys.length !== 1 ||
          sourceKey === undefined || targetKey === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        parents = yield* load(table, targetKey, yield* selectValues(parents, sourceKey), refresh);
      } else {
        const sourceKey = join.foreignKeys[0], targetKey = descriptor.targetPrimaryKeys[0];
        if (join.foreignKeys.length !== 1 || descriptor.targetPrimaryKeys.length !== 1 ||
          sourceKey === undefined || targetKey === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
        parents = yield* load(table, targetKey, yield* selectValues(parents, sourceKey), refresh);
      }
      source = table.name;
    }
  }
  const projection = new Map(yield* Effect.fromResult(profile.project(state)));
  projection.set(entity.table.name, roots.map(root => freshRoots.find(row => row[entity.keyColumn] === root[entity.keyColumn]) ?? root));
  return { entities: assembleCommerceRelations(entity.table.name, projection, paths, catalog.queryRelations), performedActions };
}, work => observeExecution("MedusaGraph.replaceRows", work));
