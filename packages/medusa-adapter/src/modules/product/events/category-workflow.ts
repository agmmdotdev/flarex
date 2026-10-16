import { Effect } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { categoryRankUpdates } from "@medusajs/product/services";
import { kebabCase } from "@medusajs/framework/utils/portable";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { commerceDecoder } from "../../../value/decoder";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { ProductCategoryCreateInput, decodeProductCategoryOutput, decodeProductCategoryUpdateInput, decodeProductCategoryIds } from "../category-input";
import { categoryCreateEventPolicy, internalCategoryPolicy } from "./category";
import { productModuleEventCapture } from "./capture";
import { matchesPublicRow } from "../../../repository/result";

const mismatch = () => commerceError("receiptMismatch");
const decodeCreate = commerceDecoder(ProductCategoryCreateInput, "receiptMismatch");
type Activity = Parameters<LogicalCallReceiptValidation>[1];
const encoder = new TextEncoder();
const compareIds = (left: string, right: string) => compareBytesLexicographically(encoder.encode(left), encoder.encode(right));
const unchangedOutside = (before: JsonObject, after: JsonObject, allowed: ReadonlySet<string>) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].every(field => allowed.has(field) ||
    before[field] !== undefined && after[field] !== undefined && jsonEqual(before[field], after[field]));

/** Observations can contain pending final rows. Only the first mutation's
 * before row may replace the request-initial evidence for an identity. */
function initialCategories(catalog: ProductRuntimeMetadata, activity: Activity) {
  const rows = new Map<string, JsonObject>();
  const record = (table: string, row: JsonObject) => {
    if (table === catalog.category.table.name && typeof row.id === "string") rows.set(row.id, row);
  };
  for (const observed of activity.observedRows) record(observed.table, observed.row);
  for (const observed of activity.lifecycle) if (observed.rowAtOperation !== null) record(observed.table, observed.rowAtOperation);
  const seen = new Set<string>();
  for (const mutation of activity.mutations) if (mutation.table === catalog.category.table.name && mutation.before !== null &&
    typeof mutation.before.id === "string" && !seen.has(mutation.before.id)) {
    seen.add(mutation.before.id); record(mutation.table, mutation.before);
  }
  return rows;
}

function categoryEvents(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  return Effect.fn("ProductEvents.validateOrderedCategoryEvents")(function* (events: readonly Json[],
    expected: readonly { readonly action: "created" | "updated" | "deleted"; readonly id: string | readonly string[] }[]) {
    if (events.length !== expected.length) return yield* Effect.fail(mismatch());
    for (const [index, event] of events.entries()) {
      const message = yield* capture(event);
      const next = expected[index];
      if (next === undefined || !jsonEqual(message.data.id, next.id) || message.metadata.action !== next.action ||
        message.metadata.object !== catalog.category.eventObject ||
        message.name !== (next.action === "created" ? catalog.category.createdEvent
          : next.action === "updated" ? catalog.category.updatedEvent : catalog.category.deletedEvent))
        return yield* Effect.fail(mismatch());
    }
  });
}

/** The public native service defaults a nullish handle before invoking the
 * existing Category tree/create owner. Its private projection envelope retains
 * the complete DTO result at this command boundary. */
export function categoryWorkflowCreatePolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const existing = categoryCreateEventPolicy(catalog);
  const events = categoryEvents(catalog);
  return Effect.fn("ProductEvents.validateCategoryWorkflowCreate")(function* (call, activity) {
    if (call.commandName !== "productCreateCategoriesForWorkflow" || call.mode !== "write")
      return yield* Effect.fail(mismatch());
    const requested = yield* Effect.fromResult(decodeCreate(call.input));
    const results = yield* Effect.fromResult(decodeProductCategoryOutput(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (requested.length !== results.length) return yield* Effect.fail(mismatch());
    if (requested.length === 0) {
      if (activity.mutations.length !== 0 || activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
        activity.referenceReplacements.length !== 0 || call.events.length !== 0) return yield* Effect.fail(mismatch());
      return;
    }
    yield* existing.validateLogicalCall({ ...call, commandName: "productCreatecategory",
      input: requested.map(row => ({ ...row, handle: row.handle ?? kebabCase(row.name) })), result: results }, activity);
    const touched = new Set<string>();
    const expectedEvents: Array<{ action: "created" | "updated"; id: string | string[] }> = [];
    for (const mutation of activity.mutations) {
      if (mutation.table !== catalog.category.table.name || mutation.operation === "insert") continue;
      const id = mutation.after?.id;
      if (typeof id !== "string") return yield* Effect.fail(mismatch());
      if (!touched.has(id)) { touched.add(id); expectedEvents.push({ action: "updated", id }); }
    }
    // Creation suppresses root afterCreate callbacks; the public service emits
    // one manual message after every scalar rank-maintenance callback.
    const createdIds = results.map(result => result.id);
    const firstCreatedId = createdIds[0];
    if (firstCreatedId === undefined) return yield* Effect.fail(mismatch());
    expectedEvents.push({ action: "created", id: createdIds.length === 1 ? firstCreatedId : createdIds });
    yield* events(call.events, expectedEvents);
  });
}

/** Native Category selectors use the specialized tree repository's default
 * ID/rank ordering, not the generic repository's direct ID-array ordering. */
export function categoryWorkflowSelectorUpdatePolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const tree = internalCategoryPolicy(catalog, "update");
  const events = categoryEvents(catalog);
  return Effect.fn("ProductEvents.validateCategoryWorkflowSelectorUpdate")(function* (call, activity) {
    if (call.commandName !== "productUpdateCategoriesBySelector" || call.mode !== "write" ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
      return yield* Effect.fail(mismatch());
    const input = yield* Effect.fromResult(decodeProductCategoryUpdateInput(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const results = yield* Effect.fromResult(decodeProductCategoryOutput(call.result))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const initial = initialCategories(catalog, activity);
    if ([...initial.values()].some(row => row.deleted_at === null &&
      (typeof row.rank !== "number" || !Number.isSafeInteger(row.rank)))) return yield* Effect.fail(mismatch());
    const ids = input.selector.id === undefined ? undefined : new Set(typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id);
    const parent = input.selector.parent_category_id;
    const selected = [...initial].filter(([id, row]) => row.deleted_at === null && (ids === undefined || ids.has(id)) &&
      (input.selector.name === undefined || row.name === input.selector.name) &&
      (input.selector.handle === undefined || row.handle === input.selector.handle) &&
      (input.selector.is_active === undefined || row.is_active === input.selector.is_active) &&
      (input.selector.is_internal === undefined || row.is_internal === input.selector.is_internal) &&
      (parent === undefined || (Array.isArray(parent) ? typeof row.parent_category_id === "string" && parent.includes(row.parent_category_id) : row.parent_category_id === parent)))
      .toSorted(([left], [right]) => compareIds(left, right));
    if (selected.length > 4 || selected.length !== results.length || selected.some(([id], index) => results[index]?.id !== id))
      return yield* Effect.fail(mismatch());
    if (selected.length === 0) {
      if (activity.mutations.length !== 0 || call.events.length !== 0) return yield* Effect.fail(mismatch());
      return;
    }
    yield* tree.validateLogicalCall({ ...call, commandName: "productInternalCategoryupdate",
      input: selected.map(([id]) => ({ ...input.update, id })), events: [] }, activity);
    const current = new Map(initial);
    const touched = new Set<string>();
    const expectedEvents: Array<{ action: "updated"; id: string | string[] }> = [];
    const touch = (id: string) => { if (!touched.has(id)) { touched.add(id); expectedEvents.push({ action: "updated", id }); } };
    const siblings = (parentId: string | null) => [...current].flatMap(([id, row]) =>
      row.deleted_at === null && row.parent_category_id === parentId && typeof row.rank === "number" && Number.isSafeInteger(row.rank)
        ? [{ id, rank: row.rank }] : []).toSorted((left, right) => left.rank - right.rank || compareIds(left.id, right.id));
    let cursor = 0;
    for (const [resultIndex, [id, initialRoot]] of selected.entries()) {
      const before = current.get(id);
      if (before === undefined || typeof before.rank !== "number" || !Number.isSafeInteger(before.rank) ||
        typeof before.mpath !== "string" || typeof initialRoot.mpath !== "string" ||
        before.parent_category_id !== null && typeof before.parent_category_id !== "string") return yield* Effect.fail(mismatch());
      const oldParent = before.parent_category_id;
      const nextParent = input.update.parent_category_id === undefined ? oldParent : input.update.parent_category_id;
      const parentChanged = oldParent !== nextParent;
      const parentRow = nextParent === null ? undefined : current.get(nextParent);
      if (nextParent !== null && (parentRow?.deleted_at !== null || typeof parentRow.mpath !== "string")) return yield* Effect.fail(mismatch());
      const nextMpath = parentRow === undefined ? id : parentRow.mpath + "." + id;
      const targetSiblings = siblings(nextParent);
      const maintainsRank = parentChanged || input.update.rank !== undefined;
      const maximumRank = parentChanged ? targetSiblings.length : Math.max(targetSiblings.length - 1, 0);
      const nextRank = maintainsRank ? Math.min(input.update.rank ?? maximumRank, maximumRank) : before.rank;
      const rankChanges = maintainsRank ? categoryRankUpdates({ id, rank: before.rank }, targetSiblings, nextRank, parentChanged,
        parentChanged ? siblings(oldParent) : []) : new Map<string, { rank: number }>();
      for (const [siblingId, update] of rankChanges) {
        const mutation = activity.mutations[cursor++], pending = current.get(siblingId);
        if (mutation?.table !== catalog.category.table.name || mutation.operation !== "patch" || mutation.before === null || mutation.after === null ||
          pending === undefined || !jsonEqual(mutation.before, pending) || mutation.after.id !== siblingId ||
          mutation.after.rank !== update.rank || !Number.isSafeInteger(update.rank) ||
          !unchangedOutside(mutation.before, mutation.after, new Set(["rank", "updated_at"]))) return yield* Effect.fail(mismatch());
        current.set(siblingId, mutation.after); touch(siblingId);
      }
      const mutation = activity.mutations[cursor++], pending = current.get(id), result = results[resultIndex];
      const allowed = new Set(["updated_at", ...Object.keys(input.update), ...(parentChanged ? ["mpath", "rank"] : [])]);
      if (mutation?.table !== catalog.category.table.name || mutation.operation !== "patch" || mutation.before === null || mutation.after === null ||
        pending === undefined || !jsonEqual(mutation.before, pending) || mutation.after.id !== id || result === undefined ||
        mutation.after.rank !== nextRank || !Number.isSafeInteger(nextRank) ||
        mutation.after.mpath !== (parentChanged ? nextMpath : before.mpath) ||
        !unchangedOutside(mutation.before, mutation.after, allowed) || !matchesPublicRow(mutation.after, result) ||
        Object.entries(input.update).some(([field, value]) => field !== "rank" &&
          (mutation.after?.[field] === undefined || !jsonEqual(mutation.after[field], value)))) return yield* Effect.fail(mismatch());
      current.set(id, mutation.after); touch(id);
      if (parentChanged && before.mpath !== nextMpath) {
        const prefix = before.mpath + ".", initialPrefix = initialRoot.mpath + ".";
        const descendants = [...current].filter(([, row]) => row.deleted_at === null && typeof row.mpath === "string" && row.mpath.startsWith(prefix))
          .toSorted(([left], [right]) => compareIds(left, right));
        for (const [descendantId, descendant] of descendants) {
          const initialDescendant = initial.get(descendantId), change = activity.mutations[cursor++];
          if (typeof descendant.mpath !== "string" || typeof initialDescendant?.mpath !== "string" || !initialDescendant.mpath.startsWith(initialPrefix) ||
            change?.table !== catalog.category.table.name || change.operation !== "patch" || change.before === null || change.after === null ||
            !jsonEqual(change.before, descendant) || change.after.id !== descendantId ||
            change.after.mpath !== nextMpath + "." + descendant.mpath.slice(prefix.length) ||
            !unchangedOutside(change.before, change.after, new Set(["mpath", "updated_at"]))) return yield* Effect.fail(mismatch());
          current.set(descendantId, change.after); touch(descendantId);
        }
      }
    }
    if (cursor !== activity.mutations.length) return yield* Effect.fail(mismatch());
    for (const result of results) touch(result.id);
    // The manual native builder groups multiple returned roots into one
    // distinct ID-array message. Whole-message hashing does not deduplicate it
    // against the earlier scalar callbacks, even when their IDs overlap.
    if (results.length > 1) expectedEvents.push({ action: "updated", id: results.map(result => result.id) });
    yield* events(call.events, expectedEvents);
  });
}

/** The specialized native leaf deletion selects every initial sibling cohort
 * before its ordered pending rank decrements and unique managed root deletes. */
export function categoryWorkflowSoftDeletePolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const events = categoryEvents(catalog);
  return Effect.fn("ProductEvents.validateCategoryWorkflowSoftDelete")(function* (call, activity) {
    if (call.commandName !== "productSoftDeleteCategoriesForWorkflow" || call.mode !== "write" ||
      !isJsonObject(call.result) || Object.keys(call.result).length !== 0 || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
      activity.mutations.some((mutation, index) => mutation.ordinal !== index)) return yield* Effect.fail(mismatch());
    const ids = yield* Effect.fromResult(decodeProductCategoryIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const initial = initialCategories(catalog, activity);
    const active = [...initial].filter(([, row]) => row.deleted_at === null);
    if (active.some(([, row]) => typeof row.rank !== "number" || !Number.isSafeInteger(row.rank))) return yield* Effect.fail(mismatch());
    const current = new Map(initial);
    const touched = new Set<string>();
    const expectedEvents: Array<{ action: "updated" | "deleted"; id: string }> = [];
    let cursor = 0;
    for (const id of ids) {
      const root = initial.get(id);
      if (root?.deleted_at !== null || typeof root.rank !== "number" || !Number.isSafeInteger(root.rank) ||
        root.parent_category_id !== null && typeof root.parent_category_id !== "string" ||
        active.some(([, row]) => row.parent_category_id === id)) return yield* Effect.fail(mismatch());
      const initialRank = root.rank;
      const cohort = active.filter(([, row]) => row.parent_category_id === root.parent_category_id &&
        typeof row.rank === "number" && row.rank > initialRank)
        .toSorted(([leftId, left], [rightId, right]) => typeof left.rank === "number" && typeof right.rank === "number"
          ? left.rank - right.rank || compareIds(leftId, rightId) : 0);
      for (const [siblingId] of cohort) {
        const mutation = activity.mutations[cursor++], pending = current.get(siblingId);
        if (mutation?.table !== catalog.category.table.name || mutation.operation !== "patch" || mutation.before === null || mutation.after === null ||
          pending === undefined || typeof pending.rank !== "number" || !jsonEqual(mutation.before, pending) || mutation.after.id !== siblingId ||
          mutation.after.rank !== pending.rank - 1 || !Number.isSafeInteger(mutation.after.rank) ||
          !unchangedOutside(mutation.before, mutation.after, new Set(["rank", "updated_at"]))) return yield* Effect.fail(mismatch());
        current.set(siblingId, mutation.after);
        if (!touched.has(siblingId)) { touched.add(siblingId); expectedEvents.push({ action: "updated", id: siblingId }); }
      }
    }
    const roots = [...new Set(ids)];
    if (activity.lifecycle.length !== roots.length) return yield* Effect.fail(mismatch());
    for (const [index, id] of roots.entries()) {
      const mutation = activity.mutations[cursor++], pending = current.get(id), observation = activity.lifecycle[index];
      if (mutation?.table !== catalog.category.table.name || mutation.operation !== "patch" || mutation.before === null || mutation.after === null ||
        pending === undefined || !jsonEqual(mutation.before, pending) || mutation.after.id !== id || mutation.before.deleted_at !== null ||
        typeof mutation.after.deleted_at !== "string" || !unchangedOutside(mutation.before, mutation.after, new Set(["deleted_at", "updated_at"])) ||
        observation?.table !== catalog.category.table.name || observation.operation !== "softDelete" || Object.keys(observation.key).length !== 1 ||
        observation.key.id !== id || observation.beforeDeletedAt !== null || observation.afterDeletedAt !== mutation.after.deleted_at ||
        observation.attemptOrdinal !== mutation.ordinal || observation.rowAtOperation !== null) return yield* Effect.fail(mismatch());
      current.set(id, mutation.after); expectedEvents.push({ action: "deleted", id });
    }
    if (cursor !== activity.mutations.length) return yield* Effect.fail(mismatch());
    yield* events(call.events, expectedEvents);
  });
}
