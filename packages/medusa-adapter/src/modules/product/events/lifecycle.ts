import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect } from "effect";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductLifecycleIds } from "../lifecycle";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { productModuleEventCapture } from "./capture";

/** The internal DAL has no public event aggregator. Its lifecycle result still
 * owns exactly the requested Product roots and their source-local children. */
export function productLogicalInternalProductLifecycleEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "softDelete" | "restore"): LogicalCallReceiptValidation {
  const mismatch = () => commerceError("receiptMismatch");
  const commandName = "productInternalProduct" + operation;
  const entities = [catalog.product, catalog.image, catalog.option, catalog.value, catalog.variant];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  return Effect.fn("ProductEvents.validateLogicalInternalProductLifecycle")(function* (call, activity) {
    const decoded = yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const ids = typeof decoded === "string" ? [decoded] : decoded;
    const requested = new Set(ids);
    if (call.commandName !== commandName || call.mode !== "write" || call.events.length !== 0 ||
      activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
      ids.length === 0 || requested.size !== ids.length) return yield* Effect.fail(mismatch());
    const optionOwners = new Map<string, string>();
    for (const observation of activity.observedRows) {
      const id = observation.row.id, owner = observation.row[catalog.foreignKeys.option];
      if (observation.table !== catalog.option.table.name || typeof id !== "string" ||
        typeof owner !== "string") continue;
      optionOwners.set(id, owner);
    }
    for (const mutation of activity.mutations) {
      if (mutation.table !== catalog.option.table.name) continue;
      const row = mutation.after ?? mutation.before;
      const id = row?.id, owner = row?.[catalog.foreignKeys.option];
      if (typeof id === "string" && typeof owner === "string") optionOwners.set(id, owner);
    }
    const roots = new Set<string>(), matched = new Set<number>();
    for (const observation of activity.lifecycle) {
      const entity = byTable.get(observation.table), id = observation.key.id;
      if (entity === undefined || Object.keys(observation.key).length !== 1 ||
        typeof id !== "string" || observation.operation !== operation ||
        (operation === "softDelete" ? typeof observation.afterDeletedAt !== "string"
          : observation.afterDeletedAt !== null)) return yield* Effect.fail(mismatch());
      if (entity === catalog.product) {
        if (!requested.has(id) || roots.has(id)) return yield* Effect.fail(mismatch());
        roots.add(id);
      }
      if (observation.attemptOrdinal === null) {
        if (operation !== "restore" || observation.beforeDeletedAt !== null ||
          observation.afterDeletedAt !== null || entity !== catalog.product)
          return yield* Effect.fail(mismatch());
        continue;
      }
      const mutation = activity.mutations[observation.attemptOrdinal];
      if (mutation === undefined || matched.has(observation.attemptOrdinal) ||
        mutation.table !== observation.table || mutation.operation !== "patch" ||
        mutation.before?.id !== id || mutation.after?.id !== id ||
        mutation.before.deleted_at !== observation.beforeDeletedAt ||
        mutation.after.deleted_at !== observation.afterDeletedAt)
        return yield* Effect.fail(mismatch());
      matched.add(observation.attemptOrdinal);
      if (entity !== catalog.product) {
        const row = mutation.before;
        const optionId = row[catalog.foreignKeys.value];
        const root = entity === catalog.value
          ? typeof optionId === "string" ? optionOwners.get(optionId) : undefined
          : row[entity === catalog.image ? catalog.foreignKeys.image
            : entity === catalog.option ? catalog.foreignKeys.option : catalog.foreignKeys.variant];
        if (typeof root !== "string" || !requested.has(root)) return yield* Effect.fail(mismatch());
      }
    }
    if (roots.size !== requested.size || matched.size !== activity.mutations.length)
      return yield* Effect.fail(mismatch());
  });
}

/** Public native Product lifecycle admits the owned cascade and authenticates
 * an already-active restore without pretending that storage changed a row. */
export function productLogicalLifecycleEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "softDelete" | "restore", target: "product" | "variant" = "product") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = target === "variant" ? [catalog.variant]
    : [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
  const commandName = target === "variant" ? "productSoftDeleteVariant"
    : operation === "restore" ? "productRestore" : "productSoftDelete";
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalLifecycle")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== commandName) return yield* Effect.fail(commerceError("receiptMismatch"));
    const requested = target === "variant"
      ? yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause))) : undefined;
    const pending = requested === undefined ? undefined
      : new Set(typeof requested === "string" ? [requested] : requested);
    if (pending !== undefined) {
      const result = call.result;
      const ids = isJsonObject(result) ? result.variant_id : undefined;
      const productIds = isJsonObject(result) ? result.product_variant_id : undefined;
      if (pending.size === 0 || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
        !isJsonObject(result) || Object.keys(result).length !== 2 ||
        !Array.isArray(ids) || !Array.isArray(productIds) || ids.length !== pending.size ||
        ids.some(id => typeof id !== "string" || !pending.has(id)) ||
        productIds.length !== ids.length || productIds.some((id, index) => id !== ids[index]))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
      const emitted = call.events;
    const expected = new Set<string>();
    const matchedAttempts = new Set<number>();
    for (const observation of lifecycle) {
      const entity = byTable.get(observation.table);
      const id = observation.key.id;
      if (entity === undefined || observation.operation !== operation || Object.keys(observation.key).length !== 1 ||
        typeof id !== "string" || id.length === 0 ||
        (pending !== undefined && !pending.delete(id)) ||
        (operation === "restore" ? observation.afterDeletedAt !== null : typeof observation.afterDeletedAt !== "string"))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const identity = entity.eventObject + ":" + id;
      if (expected.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
      expected.add(identity);
      if (observation.attemptOrdinal === null) {
        if (operation !== "restore" || observation.beforeDeletedAt !== null || observation.afterDeletedAt !== null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        continue;
      }
      const mutation = mutations[observation.attemptOrdinal];
      if (mutation === undefined || matchedAttempts.has(observation.attemptOrdinal) || mutation.ordinal !== observation.attemptOrdinal ||
        mutation.table !== observation.table || mutation.operation !== "patch" || mutation.before?.id !== id || mutation.after?.id !== id ||
        mutation.before.deleted_at !== observation.beforeDeletedAt || mutation.after.deleted_at !== observation.afterDeletedAt ||
        (operation === "restore" && observation.beforeDeletedAt === null)) return yield* Effect.fail(commerceError("receiptMismatch"));
      matchedAttempts.add(observation.attemptOrdinal);
    }
    if (matchedAttempts.size !== mutations.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (pending?.size) return yield* Effect.fail(commerceError("receiptMismatch"));
    for (const event of emitted) {
      const message = yield* capture(event);
      if (message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        if (!expected.delete(message.metadata.object + ":" + id) ||
          !entities.some(entity => entity.eventObject === message.metadata.object &&
            (operation === "restore" ? entity.restoredEvent : entity.deletedEvent) === message.name))
          return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}
