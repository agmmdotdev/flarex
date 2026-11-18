import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureCategoryProjection, decodeCategoryProjection } from "../category-projection";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { productModuleEventCapture, EventId } from "./capture";
import { matchesPublicRow } from "../../../repository/result";
import { categoryCreationFields, isValidCategoryIdentity } from "@medusajs/product/services";
import { compareBytesLexicographically } from "@flarex/utils/bytes";

type CategoryActivity = Parameters<LogicalCallReceiptValidation>[1];

const categoryEncoder = new TextEncoder();

/** Bind the existing Category creation owner to native preparation and the
 * actual ordered DAL shifts. No workflow-specific root bound belongs here. */
const validateCategoryCreation = Effect.fn("ProductEvents.categoryCreation")(function* (
  catalog: ProductRuntimeMetadata, requested: readonly JsonObject[], results: readonly Json[], activity: CategoryActivity,
) {
  const mismatch = () => commerceError("receiptMismatch");
  const initial = new Map<string, JsonObject>();
  for (const observation of activity.observedRows) if (observation.table === catalog.category.table.name && typeof observation.row.id === "string")
    initial.set(observation.row.id, observation.row);
  const first = new Set<string>();
  for (const mutation of activity.mutations) if (mutation.before !== null && typeof mutation.before.id === "string" && !first.has(mutation.before.id)) {
    first.add(mutation.before.id); initial.set(mutation.before.id, mutation.before);
  }
  // Later observations or shift preimages of newly inserted roots are pending
  // evidence, not pre-existing siblings for the native preparation phase.
  for (const mutation of activity.mutations) if (mutation.operation === "insert" && typeof mutation.after?.id === "string")
    initial.delete(mutation.after.id);
  if ([...initial.values()].some(row => row.deleted_at === null &&
    (typeof row.rank !== "number" || !Number.isSafeInteger(row.rank)))) return yield* Effect.fail(mismatch());
  const prepared = new Map<string, { rank: number; mpath: string }>();
  const offsets = new Map<string | null, number>();
  const current = new Map(initial);
  let cursor = 0;
  for (const [index, input] of requested.entries()) {
    const result = results[index];
    if (result === undefined || !isJsonObject(result) || !isValidCategoryIdentity(result.id) || prepared.has(result.id) || current.has(result.id) ||
      input.id !== undefined && !isValidCategoryIdentity(input.id) ||
      input.rank !== undefined && (typeof input.rank !== "number" || !Number.isSafeInteger(input.rank) || input.rank < 0) ||
      input.parent_category_id !== undefined && input.parent_category_id !== null && !isValidCategoryIdentity(input.parent_category_id))
      return yield* Effect.fail(mismatch());
    const parentId = typeof input.parent_category_id === "string" ? input.parent_category_id : null;
    const parent = parentId === null ? undefined : prepared.get(parentId) ?? initial.get(parentId);
    if (parentId !== null && (parent === undefined || typeof parent.mpath !== "string" ||
      !prepared.has(parentId) && initial.get(parentId)?.deleted_at !== null)) return yield* Effect.fail(mismatch());
    const parentMpath = typeof parent?.mpath === "string" ? parent.mpath : undefined;
    const initialSiblingCount = [...initial.values()].filter(row => row.deleted_at === null && row.parent_category_id === parentId).length;
    const fields = categoryCreationFields(result.id, parentMpath, typeof input.rank === "number" ? input.rank : undefined,
      initialSiblingCount, offsets.get(parentId) ?? 0);
    if (!Number.isSafeInteger(fields.rank)) return yield* Effect.fail(mismatch());
    offsets.set(parentId, (offsets.get(parentId) ?? 0) + 1);
    prepared.set(result.id, fields);
    const siblings = [...current].filter(([, row]) => row.deleted_at === null && row.parent_category_id === parentId &&
      typeof row.rank === "number" && row.rank >= fields.rank).toSorted(([left], [right]) =>
      compareBytesLexicographically(categoryEncoder.encode(left), categoryEncoder.encode(right)));
    for (const [id, pending] of siblings) {
      const mutation = activity.mutations[cursor++];
      if (typeof pending.rank !== "number" || mutation?.operation !== "patch" || mutation.before === null || mutation.after === null ||
        !jsonEqual(mutation.before, pending) || mutation.after.id !== id || mutation.after.rank !== pending.rank + 1 ||
        !Number.isSafeInteger(mutation.after.rank) ||
        [...new Set([...Object.keys(mutation.before), ...Object.keys(mutation.after)])].some(field =>
          field !== "rank" && field !== "updated_at" && (mutation.before?.[field] === undefined || mutation.after?.[field] === undefined ||
            !jsonEqual(mutation.before[field], mutation.after[field])))) return yield* Effect.fail(mismatch());
      current.set(id, mutation.after);
    }
    const insertion = activity.mutations[cursor++];
    if (insertion?.operation !== "insert" || insertion.before !== null || insertion.after === null || insertion.after.id !== result.id ||
      insertion.after.rank !== fields.rank || insertion.after.mpath !== fields.mpath || insertion.after.parent_category_id !== parentId ||
      !matchesPublicRow(insertion.after, result)) return yield* Effect.fail(mismatch());
    current.set(result.id, insertion.after);
  }
  if (cursor !== activity.mutations.length) return yield* Effect.fail(mismatch());
});

/** Physical DML removal cascades through the model's child relation, including
 * previously soft-deleted children that the native active leaf read omits.
 * Receipt evidence must own every ancestor and every removed descendant. */
const physicalCategoryDeletion = Effect.fn("ProductEvents.physicalCategoryDeletion")(function* (
  catalog: ProductRuntimeMetadata, selected: ReadonlySet<string>, activity: CategoryActivity,
) {
  const mismatch = () => commerceError("receiptMismatch");
  const children = catalog.category.table.relationships.find(relation => relation.name === "category_children");
  if (children?.type !== "hasMany" || !children.cascadeDelete || children.targetModel !== catalog.category.model ||
    children.mappedBy !== "parent_category") return yield* Effect.fail(mismatch());
  const rows = new Map<string, JsonObject>();
  for (const observation of activity.observedRows) if (observation.table === catalog.category.table.name && typeof observation.row.id === "string")
    rows.set(observation.row.id, observation.row);
  const first = new Set<string>();
  for (const mutation of activity.mutations) if (mutation.table === catalog.category.table.name &&
    mutation.before !== null && typeof mutation.before.id === "string" && !first.has(mutation.before.id)) {
    first.add(mutation.before.id); rows.set(mutation.before.id, mutation.before);
  }
  for (const id of selected) if (rows.get(id)?.deleted_at !== null) return yield* Effect.fail(mismatch());
  const owned = new Set(selected);
  // Each admitted edge is the authentic native parent reference. A missing
  // ancestor, foreign branch or cycle cannot become reachable from a root.
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [id, row] of rows) if (!owned.has(id) && typeof row.parent_category_id === "string" && owned.has(row.parent_category_id)) {
      if (typeof row.deleted_at !== "string") return yield* Effect.fail(mismatch());
      owned.add(id); expanded = true;
    }
  }
  for (const row of rows.values()) if (row.deleted_at === null &&
    typeof row.parent_category_id === "string" && owned.has(row.parent_category_id)) return yield* Effect.fail(mismatch());
  return owned;
});

/** Native Category upsert creates ID-less rows, then updates selected IDs.
 * Reuse the tree receipts for each disjoint phase; overlapping tree effects
 * fail closed until one call can authenticate their combined ownership. */
export function categoryUpsertEventPolicy(catalog: ProductRuntimeMetadata) {
  const create = categoryCreateEventPolicy(catalog);
  const update = categoryChangeEventPolicy(catalog, "update");
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCategoryUpsert")(
    function* (call, activity) {
      const requests = Array.isArray(call.input) ? call.input : [call.input];
      const results = Array.isArray(call.result) ? call.result : [call.result];
      if (call.commandName !== "productupsertcategory" || requests.length === 0 ||
        requests.length !== results.length || requests.some(row => !isJsonObject(row)) ||
        results.some(row => !isJsonObject(row)) || activity.lifecycle.length !== 0 ||
        activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
        return yield* Effect.fail(mismatch());
      const forCreate = requests.filter(row => isJsonObject(row) && typeof row.id !== "string");
      const forUpdate = requests.filter(row => isJsonObject(row) && typeof row.id === "string");
      if (forUpdate.length > 1) return yield* Effect.fail(mismatch());
      const createdResults = results.slice(0, forCreate.length);
      const updatedResult = results[forCreate.length];
      const created = activity.mutations.filter(mutation => mutation.operation === "insert");
      const updated = activity.mutations.filter(mutation => mutation.operation !== "insert");
      if (created.length !== forCreate.length || updated.length !== forUpdate.length ||
        activity.mutations.some((mutation, index) => mutation.ordinal !== index ||
          mutation.table !== catalog.category.table.name)) return yield* Effect.fail(mismatch());
      const createEvents: Json[] = [], updateEvents: Json[] = [];
      for (const event of call.events) {
        const message = yield* capture(event);
        if (message.metadata.object !== catalog.category.eventObject)
          return yield* Effect.fail(mismatch());
        if (message.name === catalog.category.createdEvent) createEvents.push(event);
        else if (message.name === catalog.category.updatedEvent) updateEvents.push(event);
        else return yield* Effect.fail(mismatch());
      }
      if (forCreate.length !== 0) yield* create.validateLogicalCall({ ...call,
        commandName: "productCreatecategory", input: forCreate, result: createdResults,
        events: createEvents, fromAttempt: 0, toAttempt: created.length,
      }, { ...activity, mutations: created.map((mutation, ordinal) => ({ ...mutation, ordinal })) });
      if (forUpdate.length !== 0) {
        const request = forUpdate[0];
        if (!isJsonObject(request) || typeof request.id !== "string" ||
          !isJsonObject(updatedResult) || updatedResult.id !== request.id)
          return yield* Effect.fail(mismatch());
        const { id, ...data } = request;
        yield* update.validateLogicalCall({ ...call, commandName: "productupdatecategory",
          input: { id, data }, result: updatedResult, events: updateEvents,
          fromAttempt: 0, toAttempt: updated.length,
        }, { ...activity, mutations: updated.map((mutation, ordinal) => ({ ...mutation, ordinal })) });
      }
    });
  return { capture, validateLogicalCall };
}

/** Bind public Category creation to the native tree transition, requested
 * Product memberships and the module messages for every affected Category. */
export function categoryCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const tree = internalCategoryPolicy(catalog, "create");
  const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products");
  const join = relation?.join;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCategoryCreate")(
    function* (write, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      const mismatch = () => commerceError("receiptMismatch");
      const emitted = write.events;
      if (lifecycle.length !== 0 || setNull.length !== 0 ||
        referenceReplacements.length !== 0 || join?.type !== "manyToMany" ||
        join.sourceColumns.length !== 1 || join.targetColumns.length !== 1 ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(mismatch());
      const categoryColumn = join.sourceColumns[0], productColumn = join.targetColumns[0];
      if (categoryColumn === undefined || productColumn === undefined) return yield* Effect.fail(mismatch());
      const input = Array.isArray(write.input) ? write.input : [write.input];
      const result = Array.isArray(write.result) ? write.result : [write.result];
      if (input.length === 0 || input.length !== result.length ||
        input.some(row => !isJsonObject(row)) || result.some(row => !isJsonObject(row)))
        return yield* Effect.fail(mismatch());
      const expectedPivots = new Set<string>();
      const treeInput: JsonObject[] = [];
      for (const [index, inputRow] of input.entries()) {
        const resultRow = result[index];
        if (!isJsonObject(inputRow) || !isJsonObject(resultRow) || typeof resultRow.id !== "string")
          return yield* Effect.fail(mismatch());
        const { products, ...category } = inputRow;
        treeInput.push(category);
        if (products === undefined) continue;
        if (!Array.isArray(products)) return yield* Effect.fail(mismatch());
        for (const product of products) {
          if (!isJsonObject(product) || typeof product.id !== "string") return yield* Effect.fail(mismatch());
          const key = JSON.stringify([resultRow.id, product.id]);
          if (expectedPivots.has(key)) return yield* Effect.fail(mismatch());
          expectedPivots.add(key);
        }
      }
      const categories: Array<(typeof mutations)[number]> = [];
      const expectedEvents = new Set<string>();
      for (const mutation of mutations) {
        if (mutation.table === join.pivotTable) {
          const categoryId = mutation.after?.[categoryColumn];
          const productId = mutation.after?.[productColumn];
          if (mutation.operation !== "insert" || mutation.before !== null ||
            typeof categoryId !== "string" || typeof productId !== "string" ||
            !expectedPivots.delete(JSON.stringify([categoryId, productId])))
            return yield* Effect.fail(mismatch());
          continue;
        }
        if (mutation.table !== catalog.category.table.name) return yield* Effect.fail(mismatch());
        const id = mutation.after?.id;
        const action = mutation.operation === "insert" ? CommonEvents.CREATED : CommonEvents.UPDATED;
        if (typeof id !== "string" || !["insert", "patch", "replace"].includes(mutation.operation))
          return yield* Effect.fail(mismatch());
        expectedEvents.add(action + ":" + id);
        categories.push({ ...mutation, ordinal: categories.length });
      }
      if (expectedPivots.size !== 0) return yield* Effect.fail(mismatch());
      const syntheticResult = yield* Effect.fromResult(captureCategoryProjection(result, defaultCommerceResources))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      yield* tree.validateLogicalCall({ ...write, commandName: "productInternalCategorycreate",
        input: treeInput, result: syntheticResult, events: [], fromAttempt: 0, toAttempt: categories.length },
      { ...activity, mutations: categories });
      for (const event of emitted) {
        const message = yield* capture(event);
        if (message.metadata.object !== catalog.category.eventObject ||
          (message.metadata.action === CommonEvents.CREATED ? message.name !== catalog.category.createdEvent
            : message.metadata.action === CommonEvents.UPDATED ? message.name !== catalog.category.updatedEvent : true))
          return yield* Effect.fail(mismatch());
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expectedEvents.delete(message.metadata.action + ":" + id)) return yield* Effect.fail(mismatch());
      }
      if (expectedEvents.size !== 0) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}

/** Public Category update/delete retain the same native tree mutations as the
 * internal service, with public result shapes, module events and delete pivots. */
export function categoryChangeEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "update" | "delete") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const tree = internalCategoryPolicy(catalog, operation);
  const relation = catalog.queryRelations.get(catalog.category.table.name)?.get("products");
  const join = relation?.join;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCategoryChange")(
    function* (write, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      const mismatch = () => commerceError("receiptMismatch");
      const emitted = write.events;
      if (lifecycle.length !== 0 || setNull.length !== 0 ||
        referenceReplacements.length !== 0 || join?.type !== "manyToMany" ||
        join.sourceColumns.length !== 1 || join.targetColumns.length !== 1 ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(mismatch());
      const categoryColumn = join.sourceColumns[0];
      if (categoryColumn === undefined) return yield* Effect.fail(mismatch());
      const ids = operation === "delete" ? Array.isArray(write.input) ? write.input : [write.input] : [];
      if (operation === "delete" && (ids.length === 0 || ids.some(id => typeof id !== "string") || write.result !== null))
        return yield* Effect.fail(mismatch());
      const update = operation === "update" && isJsonObject(write.input) &&
        typeof write.input.id === "string" && write.input.data !== undefined &&
        isJsonObject(write.input.data) &&
        isJsonObject(write.result) && write.result.id === write.input.id
        ? { ...write.input.data, id: write.input.id } : undefined;
      if (operation === "update" && update === undefined) return yield* Effect.fail(mismatch());
      const selected = new Set(ids);
      const deleted = operation === "delete" ? yield* physicalCategoryDeletion(catalog, new Set(ids.filter((id): id is string => typeof id === "string")), activity)
        : new Set<string>();
      const productColumn = join.targetColumns[0];
      if (productColumn === undefined) return yield* Effect.fail(mismatch());
      const expectedPivots = new Set<string>();
      if (operation === "delete") {
        const observePivot = (table: string, row: JsonObject) => {
          const categoryId = row[categoryColumn], productId = row[productColumn];
          if (table === join.pivotTable && typeof categoryId === "string" && typeof productId === "string" && deleted.has(categoryId))
            expectedPivots.add(JSON.stringify([categoryId, productId]));
        };
        for (const observation of activity.observedRows) observePivot(observation.table, observation.row);
        for (const mutation of mutations) if (mutation.before !== null) observePivot(mutation.table, mutation.before);
      }
      const categories: Array<(typeof mutations)[number]> = [];
      const expectedEvents = new Set<string>();
      for (const mutation of mutations) {
        if (mutation.table === join.pivotTable) {
          const categoryId = mutation.before?.[categoryColumn];
          const productId = mutation.before?.[productColumn];
          if (operation !== "delete" || mutation.operation !== "delete" ||
            mutation.after !== null || mutation.before === null ||
            typeof categoryId !== "string" || typeof productId !== "string" ||
            !deleted.has(categoryId) || !expectedPivots.delete(JSON.stringify([categoryId, productId]))) return yield* Effect.fail(mismatch());
          continue;
        }
        if (mutation.table !== catalog.category.table.name) return yield* Effect.fail(mismatch());
        const id = mutation.before?.id ?? mutation.after?.id;
        const action = mutation.operation === "delete" ? CommonEvents.DELETED : CommonEvents.UPDATED;
        if (typeof id !== "string" || !["patch", "replace", "delete"].includes(mutation.operation))
          return yield* Effect.fail(mismatch());
        // Native physical service dispatches afterDelete only for its returned
        // requested roots; model-cascaded descendants have no extra callback.
        if (action !== CommonEvents.DELETED || selected.has(id)) expectedEvents.add(action + ":" + id);
        categories.push({ ...mutation, ordinal: categories.length });
      }
      if (expectedPivots.size !== 0) return yield* Effect.fail(mismatch());
      const syntheticResult = yield* Effect.fromResult(captureCategoryProjection(
        operation === "update" ? [write.result] : ids, defaultCommerceResources))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      yield* tree.validateLogicalCall({ ...write, commandName: "productInternalCategory" + operation,
        input: operation === "update" ? [update] : ids, result: syntheticResult, events: [],
        fromAttempt: 0, toAttempt: categories.length }, { ...activity, mutations: categories });
      if (operation === "update" && update !== undefined && isJsonObject(write.result)) {
        const final = categories.findLast(mutation => mutation.after?.id === update.id)?.after;
        if (final === undefined || final === null || !isJsonObject(final)) return yield* Effect.fail(mismatch());
        if (!matchesPublicRow(final, write.result)) return yield* Effect.fail(mismatch());
      }
      for (const event of emitted) {
        const message = yield* capture(event);
        if (message.metadata.object !== catalog.category.eventObject ||
          (message.metadata.action === CommonEvents.UPDATED ? message.name !== catalog.category.updatedEvent
            : message.metadata.action === CommonEvents.DELETED ? message.name !== catalog.category.deletedEvent : true))
          return yield* Effect.fail(mismatch());
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expectedEvents.delete(message.metadata.action + ":" + id)) return yield* Effect.fail(mismatch());
      }
      if (expectedEvents.size !== 0) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}

const InternalCategoryCreateRows = Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: Schema.optionalKey(EventId), name: Schema.String,
  handle: Schema.optionalKey(Schema.String),
  parent_category_id: Schema.optionalKey(Schema.NullOr(EventId)),
  rank: Schema.optionalKey(Schema.Int),
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isLengthBetween(1, 256));

const decodeInternalCategoryCreateRows = Schema.decodeUnknownEffect(InternalCategoryCreateRows,
  { onExcessProperty: "error" });

/** Direct internal Category calls emit no module events. Admit only their
 * selected root mutations and native sibling/path maintenance. */
export function internalCategoryPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "delete") {
  const mismatch = () => commerceError("receiptMismatch");
  const ids = Schema.decodeUnknownEffect(Schema.Array(EventId).check(Schema.isLengthBetween(1, 256)),
    { onExcessProperty: "error" });
  const selectedRows = Schema.decodeUnknownEffect(Schema.Array(Schema.StructWithRest(
    Schema.Struct({ id: EventId }), [Schema.Record(Schema.String, Schema.Json)]))
    .check(Schema.isLengthBetween(1, 256)), { onExcessProperty: "error" });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateInternalCategory")(
    function* (call, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      if (call.events.length !== 0 || lifecycle.length !== 0 || setNull.length !== 0 || referenceReplacements.length !== 0 ||
        mutations.some((mutation, index) => mutation.ordinal !== index))
        return yield* Effect.fail(mismatch());
      const createRows = operation === "create" ? yield* decodeInternalCategoryCreateRows(call.input)
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : [];
      const updateRows = operation === "update" ? yield* selectedRows(call.input)
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : [];
      const inputIds = operation === "delete" ? yield* ids(call.input)
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)))
        : operation === "update" ? updateRows.map(row => row.id) : [];
      const resultRows = yield* Effect.fromResult(decodeCategoryProjection(call.result))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const count = operation === "create" ? createRows.length : inputIds.length;
      if (!Array.isArray(resultRows) || resultRows.length !== count ||
        resultRows.some((row, index) => operation === "delete" ? row !== inputIds[index]
          : !isJsonObject(row) || typeof row.id !== "string" ||
            (operation === "create" ? createRows[index]?.id !== undefined && row.id !== createRows[index]?.id
              : row.id !== inputIds[index]))) return yield* Effect.fail(mismatch());
      const input = operation === "create" ? resultRows.map(row => isJsonObject(row) ? row.id as string : "") : inputIds;
      if (new Set(input).size !== input.length) return yield* Effect.fail(mismatch());
      if (operation === "create") yield* validateCategoryCreation(catalog, createRows, resultRows, activity);
      const selected = new Set(input);
      const physical = operation === "delete" ? yield* physicalCategoryDeletion(catalog, selected, activity) : new Set<string>();
      const pendingPhysical = new Set(physical);
      const seen = new Set<string>();
      const segment = mutations;
      const roots = new Map<string, { before: JsonObject | null; after: JsonObject | null }>();
      for (const mutation of segment) {
        const id = mutation.before?.id ?? mutation.after?.id;
        if (typeof id !== "string" || !selected.has(id)) continue;
        const previous = roots.get(id);
        roots.set(id, { before: previous === undefined ? mutation.before : previous.before, after: mutation.after });
      }
      for (const mutation of segment) {
        const before = mutation.before, after = mutation.after;
        const id = operation === "delete" ? before?.id : after?.id;
        if (mutation.table !== catalog.category.table.name || typeof id !== "string")
          return yield* Effect.fail(mismatch());
        const root = selected.has(id);
        if (mutation.operation === "insert") {
          if (operation !== "create" || !root || before !== null || !isJsonObject(after) ||
            after.deleted_at !== null) return yield* Effect.fail(mismatch());
          const selectedRow = createRows[input.indexOf(id)];
          const resultRow = resultRows[input.indexOf(id)];
          if (selectedRow === undefined || after.name !== selectedRow.name ||
            (selectedRow.handle !== undefined && after.handle !== selectedRow.handle) ||
            after.parent_category_id !== (selectedRow.parent_category_id ?? null) ||
            !isJsonObject(resultRow) || after.rank !== resultRow.rank ||
            Object.entries(selectedRow).some(([key, value]) =>
              !["id", "name", "handle", "parent_category_id", "rank"].includes(key) &&
              (after[key] === undefined || !jsonEqual(value, after[key]))))
            return yield* Effect.fail(mismatch());
          seen.add(id);
        } else if (mutation.operation === "delete") {
          if (operation !== "delete" || !pendingPhysical.delete(id) || !isJsonObject(before) || after !== null)
            return yield* Effect.fail(mismatch());
          if (root) seen.add(id);
        } else if (mutation.operation === "patch" || mutation.operation === "replace") {
          if (!isJsonObject(before) || !isJsonObject(after) || before.id !== after.id ||
            before.deleted_at !== after.deleted_at) return yield* Effect.fail(mismatch());
          const requested = operation === "update" && root
            ? updateRows.find(row => row.id === id) : undefined;
          for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
            if (before[key] !== undefined && after[key] !== undefined &&
              jsonEqual(before[key], after[key])) continue;
            if (["rank", "mpath", "updated_at"].includes(key)) continue;
            if (requested === undefined || requested[key] === undefined ||
              after[key] === undefined || !jsonEqual(requested[key], after[key]))
              return yield* Effect.fail(mismatch());
          }
          if (root && operation === "update") seen.add(id);
        } else return yield* Effect.fail(mismatch());
      }
      if (pendingPhysical.size !== 0) return yield* Effect.fail(mismatch());
      if (operation === "update") {
        for (const requested of updateRows) {
          const final = roots.get(requested.id)?.after;
          if (final === undefined || final === null) return yield* Effect.fail(mismatch());
          const result = resultRows[input.indexOf(requested.id)];
          if (!isJsonObject(result) ||
            !segment.some(mutation => mutation.after?.id === requested.id &&
              mutation.after.rank === result.rank && mutation.after.mpath === result.mpath))
            return yield* Effect.fail(mismatch());
          for (const [key, value] of Object.entries(requested)) {
            if (key === "id" || key === "rank" || key === "mpath" || key === "updated_at") continue;
            if (final[key] === undefined || !jsonEqual(value, final[key]))
              return yield* Effect.fail(mismatch());
          }
        }
      }
      if (seen.size !== selected.size) return yield* Effect.fail(mismatch());

    });
  return { validateLogicalCall };
}
