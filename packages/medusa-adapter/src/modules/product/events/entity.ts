import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "../runtime-metadata";
import { productModuleEventCapture } from "./capture";
import { matchesPublicRow } from "../../../repository/result";
import { commerceDecoder } from "../../../value/decoder";
import { decodeRelatedUpdate } from "../value-profile";
import { decodeProductOptionCreateInput, decodeProductOptionUpdateInput, decodeProductOptionOutput } from "../option-input";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { compareBytesLexicographically } from "@flarex/utils/bytes";

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
        setNull.some(intent => intent.managedUpdate !== "advance" || intent.sourceTable !== catalog.product.table.name || intent.sourceColumn !== referenceColumn ||
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
  operation: "create" | "update" | "upsert" | "delete" | "selector", namedCommand?: string) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const commandName = namedCommand ?? (operation === "create" ? "productCreateoption" : operation === "update" ? "productupdateoption"
    : operation === "upsert" ? "productupsertoption" : operation === "selector" ? "productUpdateOptionsBySelector" : "productDeleteoption");
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalOption")(
    function* (call, activity) {
      const { mutations, lifecycle } = activity;
      if (call.commandName !== commandName || call.mode !== "write" || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0 ||
        mutations.some((mutation, index) => mutation.ordinal !== index)) return yield* Effect.fail(commerceError("receiptMismatch"));
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
          (operation === "create" && action !== "created" || (operation === "update" || operation === "selector") && action !== "updated")))
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
      yield* validateOptionCall(catalog, operation, call, activity, options, values, pivots);
      const selectedOrder = [...options.keys()];
      let selectedEventOrdinal = 0;
      for (const event of emitted) {
        const message = yield* capture(event);
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
          if (operation === "selector" && message.metadata.object === catalog.option.eventObject && id !== selectedOrder[selectedEventOrdinal++])
            return yield* Effect.fail(mismatch());
          if (!expected.delete(`${message.name}:${id}`)) return yield* Effect.fail(mismatch());
        }
      }
      if (expected.size !== 0 || operation === "selector" && selectedEventOrdinal !== selectedOrder.length) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}

type OptionActivity = Parameters<LogicalCallReceiptValidation>[1];
type OptionMutation = OptionActivity["mutations"][number];
const decodeOptionObjects = commerceDecoder(Schema.Array(Schema.JsonObject).pipe(Schema.mutable).check(Schema.isMaxLength(256)), "receiptMismatch");
const optionEncoder = new TextEncoder();
const optionSameOutside = (before: JsonObject, after: JsonObject, allowed: ReadonlySet<string>) =>
  [...new Set([...Object.keys(before), ...Object.keys(after)])].every(field => allowed.has(field) ||
    before[field] !== undefined && after[field] !== undefined && jsonEqual(before[field], after[field]));

/** Authenticate native replacement outcomes against the complete observed
 * preimage, without executing a second replacement planner. */
const validateOptionCall = Effect.fn("ProductEvents.validateOptionCall")(function* (
  catalog: ProductRuntimeMetadata, operation: "create" | "update" | "upsert" | "delete" | "selector",
  call: Parameters<LogicalCallReceiptValidation>[0], activity: OptionActivity,
  options: ReadonlyMap<string, OptionMutation>, values: ReadonlyMap<string, OptionMutation>, pivots: readonly OptionMutation[],
) {
  const mismatch = () => commerceError("receiptMismatch");
  const initialOptions = new Map<string, JsonObject>(), initialValues = new Map<string, JsonObject>();
  for (const observation of activity.observedRows) {
    const group = observation.table === catalog.option.table.name ? initialOptions : observation.table === catalog.value.table.name ? initialValues : undefined;
    if (group !== undefined && typeof observation.row.id === "string") group.set(observation.row.id, observation.row);
  }
  for (const [id, mutation] of options) if (mutation.before !== null) initialOptions.set(id, mutation.before); else initialOptions.delete(id);
  for (const [id, mutation] of values) if (mutation.before !== null) initialValues.set(id, mutation.before); else initialValues.delete(id);
  const removedValues = new Set<string>();
  if (operation === "delete") {
    const requested = Array.isArray(call.input) ? call.input : [call.input];
    if (call.result !== null || requested.some(id => typeof id !== "string")) return yield* Effect.fail(mismatch());
    const requestedIds = new Set(requested);
    // Physical deletion removes present identities, including inactive roots.
    // Missing IDs and repeated requests add no transition or module event.
    const eligible = new Set([...initialOptions.keys()].filter(id => requestedIds.has(id)));
    if (options.size !== eligible.size || [...options.keys()].some(id => !eligible.has(id))) return yield* Effect.fail(mismatch());
    const expected = new Set([...initialValues].filter(([, row]) => {
      const parent = row[catalog.foreignKeys.value]; return typeof parent === "string" && options.has(parent);
    }).map(([id]) => id));
    for (const [id] of values) if (!expected.delete(id)) return yield* Effect.fail(mismatch()); else removedValues.add(id);
    if (expected.size !== 0) return yield* Effect.fail(mismatch());
  } else {
    let requests: JsonObject[];
    if (operation === "selector") {
      const input = yield* Effect.fromResult(decodeProductOptionUpdateInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      const selected = [...initialOptions.values()].filter(row => row.deleted_at === null &&
        (input.selector.id === undefined || (typeof input.selector.id === "string" ? row.id === input.selector.id : typeof row.id === "string" && input.selector.id.includes(row.id))) &&
        (input.selector.product_id === undefined || (typeof input.selector.product_id === "string" ? row.product_id === input.selector.product_id :
          typeof row.product_id === "string" && input.selector.product_id.includes(row.product_id))) &&
        (input.selector.title === undefined || row.title === input.selector.title))
        .toSorted((left, right) => compareBytesLexicographically(optionEncoder.encode(String(left.id)), optionEncoder.encode(String(right.id))));
      const ordered = preservePrimaryKeyOrFilterOrder(selected, buildQuery(input.selector, { order: { id: "ASC" } }).where, ["id"], [["id", "ASC"]]);
      if (ordered.length > 4) return yield* Effect.fail(mismatch());
      requests = [];
      for (const row of ordered) {
        if (typeof row.id !== "string") return yield* Effect.fail(mismatch());
        requests.push({ ...input.update, id: row.id });
      }
    } else if (operation === "update") {
      const input = yield* Effect.fromResult(decodeRelatedUpdate(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      yield* Effect.fromResult(catalog.valueProfile.validateRelatedUpdateData(catalog.option.table.name, input.data))
        .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      requests = [{ ...input.data, id: input.id }];
    } else {
      if (operation === "create" && call.commandName === "productCreateOptionsForWorkflow")
        yield* Effect.fromResult(decodeProductOptionCreateInput(call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      yield* Effect.fromResult(operation === "create" ? catalog.valueProfile.validateRelatedCreate(catalog.option.table.name, call.input)
        : catalog.valueProfile.validateRelatedChange(catalog.option.table.name, call.input)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      requests = yield* Effect.fromResult(decodeOptionObjects(Array.isArray(call.input) ? call.input : [call.input]));
      if (operation === "upsert") requests = [...requests.filter(row => row.id === undefined), ...requests.filter(row => row.id !== undefined)];
    }
    const results = yield* Effect.fromResult(decodeOptionObjects(Array.isArray(call.result) ? call.result : [call.result]));
    if (call.commandName === "productCreateOptionsForWorkflow" || operation === "selector")
      yield* Effect.fromResult(decodeProductOptionOutput(call.result)).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    if (requests.length !== results.length || options.size !== results.length ||
      [...options.keys()].some((id, index) => results[index]?.id !== id)) return yield* Effect.fail(mismatch());
    const expectedValues = new Set<string>();
    for (const [index, result] of results.entries()) {
      const request = requests[index], id = result.id;
      if (request === undefined || typeof id !== "string" || request.id !== undefined && request.id !== id) return yield* Effect.fail(mismatch());
      const mutation = options.get(id), before = mutation?.before, after = mutation?.after;
      if (after == null || request.id !== undefined && operation !== "create" && before == null ||
        typeof after.title !== "string" || typeof after.product_id !== "string") return yield* Effect.fail(mismatch());
      const { values: returnedValues, product, ...scalars } = result;
      if (!matchesPublicRow(after, scalars) || !Array.isArray(returnedValues)) return yield* Effect.fail(mismatch());
      if (product !== undefined) {
        const parent = activity.observedRows.find(row => row.table === catalog.product.table.name && row.row.id === after.product_id)?.row;
        if (parent === undefined || !matchesPublicRow(parent, product)) return yield* Effect.fail(mismatch());
      }
      if (before != null) {
        if (before.deleted_at !== null || !optionSameOutside(before, after, new Set(["updated_at", ...Object.keys(request).filter(field => field !== "id" && field !== "values")])))
          return yield* Effect.fail(mismatch());
      } else if (request.metadata === undefined && after.metadata !== null) return yield* Effect.fail(mismatch());
      for (const [field, value] of Object.entries(request)) if (field !== "values" && (after[field] === undefined || !jsonEqual(after[field], value)))
        return yield* Effect.fail(mismatch());
      const persisted = [...initialValues.values()].filter(row => row[catalog.foreignKeys.value] === id);
      const old = persisted.filter(row => row.deleted_at === null);
      const expected = new Map<string, JsonObject>();
      if (request.values === undefined) {
        for (const row of old) if (typeof row.id === "string") expected.set(row.id, row);
        if ([...values.values()].some(change => (change.after ?? change.before)?.[catalog.foreignKeys.value] === id)) return yield* Effect.fail(mismatch());
      } else {
        if (!Array.isArray(request.values) || request.values.some(value => typeof value !== "string") || new Set(request.values).size !== request.values.length)
          return yield* Effect.fail(mismatch());
        for (const value of request.values) {
          const reused = old.find(row => row.value === value);
          if (reused !== undefined && typeof reused.id === "string") {
            const change = values.get(reused.id);
            if (change !== undefined) {
              if (change.before === null || change.after === null || !jsonEqual(change.before, reused) ||
                !optionSameOutside(change.before, change.after, new Set(["updated_at"]))) return yield* Effect.fail(mismatch());
              expectedValues.add(reused.id);
            }
            expected.set(reused.id, change?.after ?? reused);
            continue;
          }
          const candidates = [...values].filter(([, change]) => change.after?.[catalog.foreignKeys.value] === id && change.after.value === value);
          if (candidates.length !== 1) return yield* Effect.fail(mismatch());
          const candidate = candidates[0];
          if (candidate === undefined) return yield* Effect.fail(mismatch());
          const [valueId, change] = candidate;
          const afterValue = change.after;
          if (afterValue === null || change.operation !== "insert" || change.before !== null || afterValue.metadata !== null) return yield* Effect.fail(mismatch());
          expectedValues.add(valueId); expected.set(valueId, afterValue);
        }
        for (const row of persisted) if (typeof row.id === "string" && !expected.has(row.id)) {
          const removed = values.get(row.id);
          if (removed?.operation !== "delete" || removed.before === null || !jsonEqual(removed.before, row)) return yield* Effect.fail(mismatch());
          expectedValues.add(row.id); removedValues.add(row.id);
        }
      }
      if (returnedValues.length !== expected.size) return yield* Effect.fail(mismatch());
      for (const returned of returnedValues) if (!isJsonObject(returned) || typeof returned.id !== "string" ||
        !expected.has(returned.id) || !matchesPublicRow(expected.get(returned.id) ?? {}, returned) || !expected.delete(returned.id)) return yield* Effect.fail(mismatch());
    }
    if (expectedValues.size !== values.size) return yield* Effect.fail(mismatch());
  }
  const expectedPivots = new Set<string>();
  const recordPivot = (table: string, row: JsonObject) => {
    const value = row[catalog.pivot.valueColumn], variant = row[catalog.pivot.variantColumn];
    if (table === catalog.pivot.table.name && typeof value === "string" && typeof variant === "string" && removedValues.has(value))
      expectedPivots.add(JSON.stringify([variant, value]));
  };
  for (const observation of activity.observedRows) recordPivot(observation.table, observation.row);
  for (const mutation of pivots) if (mutation.before !== null) recordPivot(mutation.table, mutation.before);
  for (const mutation of pivots) if (!expectedPivots.delete(JSON.stringify([
    mutation.before?.[catalog.pivot.variantColumn], mutation.before?.[catalog.pivot.valueColumn],
  ]))) return yield* Effect.fail(mismatch());
  if (expectedPivots.size !== 0) return yield* Effect.fail(mismatch());
});
