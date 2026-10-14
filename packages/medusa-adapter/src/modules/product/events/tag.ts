import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect } from "effect";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductLifecycleIds } from "../lifecycle";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { productLogicalEntityEventPolicy, productLogicalDirectEntityUpdateEventPolicy } from "./entity";
import { matchesPublicRow } from "./result";
import { productModuleEventCapture } from "./capture";
import { productMembershipPivots } from "./memberships";

/** Every selected tag method validates at the shared outer-call boundary. */
export function tagCallEventPolicy(catalog: ProductRuntimeMetadata) {
  const created = productLogicalEntityEventPolicy(catalog, catalog.tag, "productCreatetag", "created");
  const updated = productLogicalEntityEventPolicy(catalog, catalog.tag, "productUpdateTagsBySelector", "updated");
  const updatedDirect = { ...productLogicalEntityEventPolicy(catalog, catalog.tag, "productupdatetag", "updated"),
    validateLogicalCall: productLogicalDirectEntityUpdateEventPolicy(catalog, catalog.tag, "productupdatetag") };
  const deleted = productLogicalEntityEventPolicy(catalog, catalog.tag, "productSoftDeleteTag", "deleted");
  const upsert: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalTagUpsert")(function* (call, activity) {
    const many = Array.isArray(call.input);
    const requested = many ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== "productupserttag" || many !== Array.isArray(call.result) ||
      requested.length !== results.length ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set<string>();
    const mutations = new Map<string, typeof activity.mutations[number]>();
    for (const mutation of activity.mutations) {
      const after = mutation.after, before = mutation.before, id = after?.id;
      const action = mutation.operation === "insert" && before === null && after?.deleted_at === null
        ? CommonEvents.CREATED
        : (mutation.operation === "patch" || mutation.operation === "replace") &&
          before !== null && before.id === id && before.deleted_at === null && after?.deleted_at === null
          ? CommonEvents.UPDATED : undefined;
      if (mutation.table !== catalog.tag.table.name || typeof id !== "string" ||
        action === undefined || mutations.has(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      mutations.set(id, mutation);
      expected.add((action === CommonEvents.CREATED ? catalog.tag.createdEvent : catalog.tag.updatedEvent) + ":" + id);
    }
    if (mutations.size !== results.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    const requestedExisting = new Map<string, string>();
    const requestedNew = new Set<string>();
    for (const input of requested) {
      if (!isJsonObject(input) || typeof input.value !== "string")
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (typeof input.id === "string") {
        if (requestedExisting.has(input.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        requestedExisting.set(input.id, input.value);
      } else {
        if (requestedNew.has(input.value)) return yield* Effect.fail(commerceError("receiptMismatch"));
        requestedNew.add(input.value);
      }
    }
    const returned = new Set<string>();
    for (const result of results) {
      if (!isJsonObject(result) || typeof result.id !== "string" ||
        typeof result.value !== "string" || returned.has(result.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const mutation = mutations.get(result.id);
      if (mutation?.after?.value !== result.value || !matchesPublicRow(mutation.after, result) ||
        (mutation.operation === "insert" ? !requestedNew.delete(result.value)
          : requestedExisting.get(result.id) !== result.value || !requestedExisting.delete(result.id)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      returned.add(result.id);
    }
    if (requestedExisting.size !== 0 || requestedNew.size !== 0)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const event of call.events) {
      const message = yield* created.capture(event);
      if (message.metadata.object !== catalog.tag.eventObject) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalTagCall")(
    function* (call, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      if (setNull.length !== 0 || referenceReplacements.length !== 0)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (call.mode === "read") return;
      const policy = call.commandName === "productCreatetag" ? created
        : call.commandName === "productupdatetag" ? updatedDirect
        : call.commandName === "productupserttag" ? { validateLogicalCall: upsert }
        : call.commandName === "productUpdateTagsBySelector" ? updated
        : call.commandName === "productSoftDeleteTag" ? deleted : undefined;
      if (policy === undefined) return yield* Effect.fail(commerceError("receiptMismatch"));
      const lifecycleAttempts = new Set<number>();
      for (const observation of lifecycle) {
        const mutation = observation.attemptOrdinal === null ? undefined : mutations[observation.attemptOrdinal];
        if (mutation === undefined || observation.table !== catalog.tag.table.name ||
          observation.operation !== "softDelete" || observation.key.id !== mutation.after?.id ||
          observation.beforeDeletedAt !== null || observation.afterDeletedAt !== mutation.after?.deleted_at ||
          lifecycleAttempts.has(mutation.ordinal))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        lifecycleAttempts.add(mutation.ordinal);
      }
      if (call.commandName === "productSoftDeleteTag" ? lifecycle.length !== mutations.length : lifecycle.length !== 0)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      yield* policy.validateLogicalCall(call, activity);
    });
  return { capture: created.capture, validateLogicalCall };
}

/** Hard Tag deletion also removes its Product membership pivots. The native
 * event names only the deleted Tags; core owns the FK and pivot settlement. */
export function productLogicalTagHardDeleteEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  return Effect.fn("ProductEvents.validateLogicalTagHardDelete")(function* (call, activity) {
    if (call.commandName !== "productDeletetag" || call.mode !== "write" || call.result !== null ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const decoded = yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requested = new Set(typeof decoded === "string" ? [decoded] : decoded);
    if (requested.size !== (typeof decoded === "string" ? 1 : decoded.length))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const tagPivot = (yield* productMembershipPivots(catalog))[0];
    if (tagPivot === undefined) return yield* Effect.fail(commerceError("unsupportedProfile"));
    const deleted = new Set<string>();
    const memberships = new Set<string>();
    for (const mutation of activity.mutations) {
      if (mutation.operation !== "delete" || mutation.before === null || mutation.after !== null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (mutation.table === catalog.tag.table.name) {
        const id = mutation.before.id;
        if (typeof id !== "string" || !requested.has(id) || deleted.has(id) ||
          mutation.before.deleted_at !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
        deleted.add(id);
      } else if (mutation.table === tagPivot.table) {
        const productId = mutation.before[tagPivot.productColumn];
        const tagId = mutation.before[tagPivot.targetColumn];
        const identity = JSON.stringify([productId, tagId]);
        if (typeof productId !== "string" || typeof tagId !== "string" ||
          !requested.has(tagId) || memberships.has(identity))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        memberships.add(identity);
      } else return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    const announced = new Set(deleted);
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.name !== catalog.tag.deletedEvent || message.metadata.object !== catalog.tag.eventObject ||
        message.metadata.action !== CommonEvents.DELETED)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!announced.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (announced.size !== 0 || activity.mutations.some(mutation => {
      if (mutation.table !== tagPivot.table) return false;
      const target = mutation.before?.[tagPivot.targetColumn];
      return typeof target !== "string" || !deleted.has(target);
    }))
      return yield* Effect.fail(commerceError("receiptMismatch"));
  });
}
