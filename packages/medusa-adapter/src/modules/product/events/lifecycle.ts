import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect } from "effect";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { decodeProductLifecycleIds } from "../lifecycle";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { productModuleEventCapture } from "./capture";

type Activity = Parameters<LogicalCallReceiptValidation>[1];

/** Observations contain final rows. A command's first mutation preimage owns
 * its earlier state when deciding which requested roots needed a transition. */
function lifecycleEvidence(activity: Activity) {
  const rows = new Map<string, Map<string, JsonObject>>();
  const record = (table: string, row: JsonObject) => {
    if (typeof row.id !== "string") return;
    const selected = rows.get(table) ?? new Map<string, JsonObject>();
    selected.set(row.id, row); rows.set(table, selected);
  };
  for (const observation of activity.observedRows) record(observation.table, observation.row);
  // A cached unchanged restore may add no fresh read dependency. Core retains
  // its complete row at the operation separately from the lifecycle key.
  for (const observation of activity.lifecycle)
    if (observation.rowAtOperation !== null) record(observation.table, observation.rowAtOperation);
  const before = new Set<string>();
  for (const mutation of activity.mutations) {
    if (mutation.before === null || typeof mutation.before.id !== "string") continue;
    const key = JSON.stringify([mutation.table, mutation.before.id]);
    if (before.has(key)) continue;
    before.add(key); record(mutation.table, mutation.before);
  }
  return rows;
}

function eligibleRoots(rows: ReturnType<typeof lifecycleEvidence>, table: string, requested: ReadonlySet<string>, operation: "softDelete" | "restore") {
  return new Set([...(rows.get(table)?.values() ?? [])].flatMap(row => typeof row.id === "string" && requested.has(row.id) &&
    (row.deleted_at === null || operation === "restore" && typeof row.deleted_at === "string") ? [row.id] : []));
}

function descendantRoot(catalog: ProductRuntimeMetadata, entity: ProductRuntimeMetadata["product"], row: JsonObject,
  rows: ReturnType<typeof lifecycleEvidence>) {
  if (entity === catalog.value) {
    const option = row[catalog.foreignKeys.value];
    return typeof option === "string" ? rows.get(catalog.option.table.name)?.get(option)?.[catalog.foreignKeys.option] : undefined;
  }
  return row[entity === catalog.image ? catalog.foreignKeys.image : entity === catalog.option ? catalog.foreignKeys.option : catalog.foreignKeys.variant];
}

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
    const evidence = lifecycleEvidence(activity);
    const pending = eligibleRoots(evidence, catalog.product.table.name, requested, operation);
    const selected = new Set(pending);
    if (call.commandName !== commandName || call.mode !== "write" || call.events.length !== 0 ||
      activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0) return yield* Effect.fail(mismatch());
    const matched = new Set<number>(), identities = new Set<string>();
    for (const observation of activity.lifecycle) {
      const entity = byTable.get(observation.table), id = observation.key.id;
      if (entity === undefined || Object.keys(observation.key).length !== 1 ||
        typeof id !== "string" || observation.operation !== operation ||
        (operation === "softDelete" ? typeof observation.afterDeletedAt !== "string"
          : observation.afterDeletedAt !== null)) return yield* Effect.fail(mismatch());
      const identity = JSON.stringify([observation.table, id]);
      if (identities.has(identity)) return yield* Effect.fail(mismatch());
      identities.add(identity);
      if (entity === catalog.product) {
        if (!pending.delete(id)) return yield* Effect.fail(mismatch());
      }
      let row: JsonObject;
      if (observation.attemptOrdinal === null) {
        if (operation !== "restore" || observation.beforeDeletedAt !== null ||
          observation.afterDeletedAt !== null || observation.rowAtOperation?.id !== id || observation.rowAtOperation.deleted_at !== null)
          return yield* Effect.fail(mismatch());
        row = observation.rowAtOperation;
      } else {
        const mutation = activity.mutations[observation.attemptOrdinal];
        if (mutation === undefined || matched.has(observation.attemptOrdinal) ||
          mutation.table !== observation.table || mutation.operation !== "patch" ||
          mutation.before?.id !== id || mutation.after?.id !== id ||
          mutation.before.deleted_at !== observation.beforeDeletedAt ||
          mutation.after.deleted_at !== observation.afterDeletedAt || operation === "restore" && observation.beforeDeletedAt === null)
          return yield* Effect.fail(mismatch());
        matched.add(observation.attemptOrdinal);
        row = mutation.before;
      }
      if (entity !== catalog.product) {
        const root = descendantRoot(catalog, entity, row, evidence);
        if (typeof root !== "string" || !selected.has(root)) return yield* Effect.fail(mismatch());
      }
    }
    if (pending.size !== 0 || matched.size !== activity.mutations.length)
      return yield* Effect.fail(mismatch());
  });
}

/** Public native Product lifecycle admits the owned cascade and authenticates
 * an already-active restore without pretending that storage changed a row. */
export function productLogicalLifecycleEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "softDelete" | "restore", target: "product" | "variant" | "type" | "collection" = "product", namedCommand?: string) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = target === "collection" ? [catalog.collection] : target === "type" ? [catalog.type] : target === "variant" ? [catalog.variant]
    : [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const action = operation === "restore" ? CommonEvents.RESTORED : CommonEvents.DELETED;
  const commandName = namedCommand ?? (target === "collection" ? "productSoftDeleteCollectionsForWorkflow" : target === "type" ? "productSoftDeleteTypesForWorkflow" : target === "variant" ? "productSoftDeleteVariant"
    : operation === "restore" ? "productRestore" : "productSoftDelete");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalLifecycle")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== commandName || call.mode !== "write") return yield* Effect.fail(commerceError("receiptMismatch"));
    const requested = yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requestedIds = new Set(typeof requested === "string" ? [requested] : requested);
    const rootTable = target === "collection" ? catalog.collection.table.name : target === "type" ? catalog.type.table.name : target === "variant" ? catalog.variant.table.name : catalog.product.table.name;
    const evidence = lifecycleEvidence(activity);
    const pending = eligibleRoots(evidence, rootTable, requestedIds, operation);
    const selected = new Set(pending);
    if (target === "type" || target === "collection") {
      const result = call.result, key = target === "type" ? "product_type_id" : "product_collection_id";
      const ids = isJsonObject(result) ? result[key] : undefined;
      const empty = pending.size === 0 && isJsonObject(result) && Object.keys(result).length === 0;
      if (operation !== "softDelete" || !Array.isArray(call.input) || call.input.length > 4 || requestedIds.size > 4 ||
        activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
        !empty && (!isJsonObject(result) || Object.keys(result).length !== 1 || !Array.isArray(ids) ||
          ids.length !== pending.size || new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !pending.has(id))))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (target === "variant") {
      const result = call.result;
      const ids = isJsonObject(result) ? result.variant_id : undefined;
      const productIds = isJsonObject(result) ? result.product_variant_id : undefined;
      const empty = pending.size === 0 && isJsonObject(result) && Object.keys(result).length === 0;
      if (activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
        !empty && (!isJsonObject(result) || Object.keys(result).length !== 2 ||
        !Array.isArray(ids) || !Array.isArray(productIds) || ids.length !== pending.size ||
        new Set(ids).size !== ids.length || ids.some(id => typeof id !== "string" || !pending.has(id)) ||
        productIds.length !== ids.length || productIds.some((id, index) => id !== ids[index])))
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
        (observation.table === rootTable && !pending.delete(id)) ||
        (operation === "restore" ? observation.afterDeletedAt !== null : typeof observation.afterDeletedAt !== "string"))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const identity = entity.eventObject + ":" + id;
      if (expected.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
      expected.add(identity);
      let row: JsonObject;
      if (observation.attemptOrdinal === null) {
        if (operation !== "restore" || observation.beforeDeletedAt !== null || observation.afterDeletedAt !== null ||
          observation.rowAtOperation?.id !== id || observation.rowAtOperation.deleted_at !== null)
          return yield* Effect.fail(commerceError("receiptMismatch"));
        row = observation.rowAtOperation;
      } else {
        const mutation = mutations[observation.attemptOrdinal];
        if (mutation === undefined || matchedAttempts.has(observation.attemptOrdinal) || mutation.ordinal !== observation.attemptOrdinal ||
          mutation.table !== observation.table || mutation.operation !== "patch" || mutation.before?.id !== id || mutation.after?.id !== id ||
          mutation.before.deleted_at !== observation.beforeDeletedAt || mutation.after.deleted_at !== observation.afterDeletedAt ||
          (operation === "restore" && observation.beforeDeletedAt === null)) return yield* Effect.fail(commerceError("receiptMismatch"));
        matchedAttempts.add(observation.attemptOrdinal);
        row = mutation.before;
      }
      if (target === "product" && entity !== catalog.product) {
        const root = descendantRoot(catalog, entity, row, evidence);
        if (typeof root !== "string" || !selected.has(root)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (matchedAttempts.size !== mutations.length) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (pending.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
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
