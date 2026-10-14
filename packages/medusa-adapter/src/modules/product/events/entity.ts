import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "../runtime-metadata";
import { productModuleEventCapture } from "./capture";
import { matchesPublicRow } from "./result";

/** One native entity command owns its row transitions and matching messages. */
export function productLogicalEntityEventPolicy(catalog: ProductRuntimeMetadata, entity: ProductEntityMetadata,
  commandName: string, action: "created" | "updated" | "deleted") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const eventName = action === "created" ? entity.createdEvent : action === "updated" ? entity.updatedEvent : entity.deletedEvent;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalEntity")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== commandName) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
    if (action !== "deleted" && lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const expected = new Set<string>();
    for (const mutation of mutations) {
      const id = mutation.after?.id;
      const before = mutation.before;
      const after = mutation.after;
      const transition = action === "created"
        ? mutation.operation === "insert" && before === null && after?.deleted_at === null
        : (mutation.operation === "patch" || mutation.operation === "replace") &&
          before !== null && before.id === id && before.deleted_at === null &&
          (action === "updated" ? after?.deleted_at === null : typeof after?.deleted_at === "string");
      if (mutation.table !== entity.table.name || !transition ||
        typeof id !== "string" || expected.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      expected.add(id);
    }
    for (const event of emitted) {
      const message = yield* capture(event);
      if (message.name !== eventName || message.metadata.object !== entity.eventObject ||
        message.metadata.action !== action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        if (!expected.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

/** Direct single-row updates must bind the returned DTO and requested fields
 * to the same mutation authenticated by the shared event receipt. */
export function productLogicalDirectEntityUpdateEventPolicy(catalog: ProductRuntimeMetadata,
  entity: ProductEntityMetadata, commandName: string): LogicalCallReceiptValidation {
  const generic = productLogicalEntityEventPolicy(catalog, entity, commandName, "updated");
  return Effect.fn("ProductEvents.validateLogicalDirectEntityUpdate")(function* (call, activity) {
    yield* generic.validateLogicalCall(call, activity);
    const input = call.input, result = call.result;
    const mutation = activity.mutations[0];
    if (!isJsonObject(input) || typeof input.id !== "string" || input.data === undefined ||
      !isJsonObject(input.data) || result === undefined ||
      activity.mutations.length !== 1 || mutation?.after === null || mutation?.after === undefined ||
      mutation.after.id !== input.id || !matchesPublicRow(mutation.after, result) ||
      Object.entries(input.data).some(([field, value]) => {
        const stored = mutation.after?.[field];
        return stored === undefined || !jsonEqual(stored, value);
      })) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
}

/** The event belongs to the deleted native root; Product detachment is a
 * declared core effect rather than an adapter-supplied mutation receipt. */
export function productLogicalNullableReferenceDeleteEventPolicy(catalog: ProductRuntimeMetadata,
  target: ProductEntityMetadata, referenceColumn: "type_id" | "collection_id", commandName: string) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalReferenceDelete")(
    function* (call, activity) {
      const { mutations, lifecycle, setNull } = activity;
      if (call.commandName !== commandName) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
      if (lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
      const deleted = new Set<string>();
      for (const mutation of mutations) {
        if (mutation.table === target.table.name && mutation.operation === "delete" &&
          mutation.after === null && typeof mutation.before?.id === "string" &&
          !deleted.has(mutation.before.id)) {
          deleted.add(mutation.before.id);
          continue;
        }
        return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (setNull.length !== deleted.size || new Set(setNull.map(intent => intent.targetKey)).size !== setNull.length ||
        setNull.some(intent => intent.sourceTable !== catalog.product.table.name || intent.sourceColumn !== referenceColumn ||
          intent.targetTable !== target.table.name || intent.targetColumn !== "id" || !deleted.has(intent.targetKey)))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const event of emitted) {
        const message = yield* capture(event);
        if (message.name !== target.deletedEvent || message.metadata.object !== target.eventObject ||
          message.metadata.action !== CommonEvents.DELETED) return yield* Effect.fail(commerceError("receiptMismatch"));
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (!deleted.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
        }
      }
      if (deleted.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    });
  return { capture, validateLogicalCall };
}

/** Direct Image creation carries one stored row and one returned row per
 * request. The module event must identify exactly those inserted rows. */
export function productLogicalImageCreateEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const entity = productLogicalEntityEventPolicy(catalog, catalog.image, "productCreateimage", "created");
  const mismatch = () => commerceError("receiptMismatch");
  return Effect.fn("ProductEvents.validateLogicalImageCreate")(function* (call, activity) {
    const requests = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== "productCreateimage" || requests.length === 0 ||
      requests.length !== results.length || activity.mutations.length !== requests.length ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0 ||
      requests.some(row => !isJsonObject(row)) || results.some(row => !isJsonObject(row)))
      return yield* Effect.fail(mismatch());
    const pending = new Map<string, JsonObject>();
    for (const mutation of activity.mutations) {
      const row = mutation.after, id = row?.id;
      if (mutation.table !== catalog.image.table.name || mutation.operation !== "insert" ||
        mutation.before !== null || typeof id !== "string" || row === null || pending.has(id))
        return yield* Effect.fail(mismatch());
      pending.set(id, row);
    }
    const unmatched = [...requests];
    for (const result of results) {
      if (!isJsonObject(result) || typeof result.id !== "string") return yield* Effect.fail(mismatch());
      const row = pending.get(result.id);
      if (row === undefined || !matchesPublicRow(row, result)) return yield* Effect.fail(mismatch());
      const index = unmatched.findIndex(request => isJsonObject(request) &&
        Object.entries(request).every(([field, value]) => row[field] !== undefined && jsonEqual(row[field], value)));
      if (index < 0) return yield* Effect.fail(mismatch());
      unmatched.splice(index, 1);
      pending.delete(result.id);
    }
    if (unmatched.length !== 0 || pending.size !== 0) return yield* Effect.fail(mismatch());
    yield* entity.validateLogicalCall(call, activity);
  });
}

/** Native Type writes stay on Product's logical source. Its hard delete may
 * detach nullable Product.type_id references before removing the Type row. */
export function productLogicalTypeEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "delete") {
  if (operation !== "delete") return productLogicalEntityEventPolicy(catalog, catalog.type,
    operation === "create" ? "productCreatetype" : "productupdatetype",
    operation === "create" ? "created" : "updated");
  return productLogicalNullableReferenceDeleteEventPolicy(catalog, catalog.type, "type_id", "productDeletetype");
}

/** Native Type upsert creates ID-less rows first, then updates selected IDs.
 * Authenticate the complete result and both event families at this one call. */
export function productLogicalTypeUpsertEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const mismatch = () => commerceError("receiptMismatch");
  return Effect.fn("ProductEvents.validateLogicalTypeUpsert")(function* (call, activity) {
    const requests = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== "productupserttype" || call.mode !== "write" ||
      requests.length === 0 || requests.length !== results.length ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0 ||
      requests.some(row => !isJsonObject(row)) || results.some(row => !isJsonObject(row)))
      return yield* Effect.fail(mismatch());
    const changed = new Map<string, typeof activity.mutations[number]>();
    const expected = new Set<string>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after, id = after?.id;
      const created = mutation.operation === "insert" && before === null && after?.deleted_at === null;
      const updated = (mutation.operation === "patch" || mutation.operation === "replace") &&
        before !== null && after !== null && before.id === id &&
        before.deleted_at === null && after.deleted_at === null;
      if (mutation.table !== catalog.type.table.name || typeof id !== "string" ||
        !(created || updated) || changed.has(id)) return yield* Effect.fail(mismatch());
      changed.set(id, mutation);
      expected.add((created ? catalog.type.createdEvent : catalog.type.updatedEvent) + ":" + id);
    }
    if (changed.size !== requests.length) return yield* Effect.fail(mismatch());
    const created = new Map<string, JsonObject>();
    const updated = new Map<string, JsonObject>();
    for (const request of requests) {
      if (!isJsonObject(request) || typeof request.value !== "string") return yield* Effect.fail(mismatch());
      if (typeof request.id === "string") {
        if (updated.has(request.id)) return yield* Effect.fail(mismatch());
        updated.set(request.id, request);
      } else {
        if (created.has(request.value)) return yield* Effect.fail(mismatch());
        created.set(request.value, request);
      }
    }
    for (const result of results) {
      if (!isJsonObject(result) || typeof result.id !== "string") return yield* Effect.fail(mismatch());
      const mutation = changed.get(result.id);
      const after = mutation?.after;
      if (mutation === undefined || after == null || typeof after.value !== "string" ||
        !matchesPublicRow(after, result))
        return yield* Effect.fail(mismatch());
      const request = mutation.operation === "insert"
        ? created.get(after.value)
        : updated.get(result.id);
      if (request === undefined || request.value !== after.value ||
        (mutation.operation === "insert" ? !created.delete(after.value) : !updated.delete(result.id)))
        return yield* Effect.fail(mismatch());
      changed.delete(result.id);
    }
    if (created.size !== 0 || updated.size !== 0 || changed.size !== 0)
      return yield* Effect.fail(mismatch());
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.object !== catalog.type.eventObject ||
        ![catalog.type.createdEvent, catalog.type.updatedEvent].includes(message.name))
        return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(mismatch());
    }
    if (expected.size !== 0) return yield* Effect.fail(mismatch());
  });
}

/** Native Option commands own their Value graph. Hard deletion emits only the
 * Option root message; create/update/upsert emit each changed entity message. */
export function productLogicalOptionEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "upsert" | "delete") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const commandName = operation === "create" ? "productCreateoption" : operation === "update" ? "productupdateoption"
    : operation === "upsert" ? "productupsertoption" : "productDeleteoption";
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalOption")(
    function* (call, activity) {
      const { mutations, lifecycle } = activity;
      if (call.commandName !== commandName) return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
      if (lifecycle.length !== 0) return yield* Effect.fail(mismatch());
      const options = new Map<string, typeof mutations[number]>();
      const values = new Map<string, typeof mutations[number]>();
      const pivots: Array<typeof mutations[number]> = [];
      const expected = new Set<string>();
      for (const mutation of mutations) {
        if (mutation.table === catalog.pivot.table.name) {
          if (mutation.operation !== "delete" || mutation.before === null || mutation.after !== null)
            return yield* Effect.fail(mismatch());
          pivots.push(mutation);
          continue;
        }
        const entity = mutation.table === catalog.option.table.name ? catalog.option
          : mutation.table === catalog.value.table.name ? catalog.value : undefined;
        if (entity === undefined) return yield* Effect.fail(mismatch());
        const before = mutation.before, after = mutation.after;
        const id = after?.id ?? before?.id;
        if (typeof id !== "string" || (before !== null && before.id !== id) || (after !== null && after.id !== id))
          return yield* Effect.fail(mismatch());
        const group = entity === catalog.option ? options : values;
        if (group.has(id)) return yield* Effect.fail(mismatch());
        group.set(id, mutation);
        if (operation === "delete") {
          if (mutation.operation !== "delete" || before === null || after !== null)
            return yield* Effect.fail(mismatch());
          if (entity === catalog.option) expected.add(`${entity.deletedEvent}:${id}`);
          continue;
        }
        const action = mutation.operation === "insert" && before === null && after?.deleted_at === null ? "created"
          : (mutation.operation === "patch" || mutation.operation === "replace") &&
            before !== null && after?.deleted_at === null ? "updated"
          : mutation.operation === "delete" && entity === catalog.value && before !== null && after === null ? "deleted" : undefined;
        if (action === undefined || (entity === catalog.option &&
          (operation === "create" && action !== "created" || operation === "update" && action !== "updated")))
          return yield* Effect.fail(mismatch());
        expected.add(`${action === "created" ? entity.createdEvent : action === "updated" ? entity.updatedEvent : entity.deletedEvent}:${id}`);
      }
      for (const mutation of values.values()) {
        const beforeParent = mutation.before?.[catalog.foreignKeys.value];
        const afterParent = mutation.after?.[catalog.foreignKeys.value];
        if (mutation.before !== null && (typeof beforeParent !== "string" || !options.has(beforeParent)) ||
          mutation.after !== null && (typeof afterParent !== "string" || !options.has(afterParent)) ||
          mutation.before !== null && mutation.after !== null && beforeParent !== afterParent)
          return yield* Effect.fail(mismatch());
      }
      const pivotKeys = new Set<string>();
      for (const mutation of pivots) {
        const value = mutation.before?.[catalog.pivot.valueColumn];
        const variant = mutation.before?.[catalog.pivot.variantColumn];
        const changedValue = typeof value === "string" ? values.get(value) : undefined;
        const key = JSON.stringify([variant, value]);
        if (typeof variant !== "string" || changedValue?.operation !== "delete" || pivotKeys.has(key))
          return yield* Effect.fail(mismatch());
        pivotKeys.add(key);
      }
      for (const event of emitted) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (!expected.delete(`${message.name}:${id}`)) return yield* Effect.fail(mismatch());
        }
      }
      if (expected.size !== 0) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}
