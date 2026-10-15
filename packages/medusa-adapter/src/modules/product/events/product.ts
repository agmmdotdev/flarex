import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductEntityMetadata, ProductRuntimeMetadata } from "../runtime-metadata";
import { productModuleEventCapture } from "./capture";
import { productMembershipPivots, validateProductMembershipRows } from "./memberships";
import { productResultGraphMatcher } from "./result";
import { decodeProductSelectorUpdate } from "../product-update-input";

/** The native Product create command owns every inserted entity and its
 * variant/value pivot. No other command or Product table is admitted here. */
export function productLogicalCreateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCreate")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== "productCreate") return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
    if (lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const memberships = yield* productMembershipPivots(catalog);
    const membershipRows = new Map(memberships.map(pivot => [pivot.table, [] as JsonObject[]]));
    const expected = new Set<string>();
    const inserted = new Map(entities.map(entity => [entity.table.name, new Map<string, JsonObject>()]));
    const pivots: JsonObject[] = [];
    for (const mutation of mutations) {
      if (mutation.operation !== "insert" || mutation.before !== null || mutation.after === null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (mutation.table === catalog.pivot.table.name) { pivots.push(mutation.after); continue; }
      const members = membershipRows.get(mutation.table);
      if (members !== undefined) { members.push(mutation.after); continue; }
      const entity = byTable.get(mutation.table);
      const id = mutation.after.id;
      if (entity === undefined || mutation.after.deleted_at !== null || typeof id !== "string" || inserted.get(entity.table.name)?.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      inserted.get(entity.table.name)?.set(id, mutation.after);
      expected.add(entity.createdEvent + ":" + id);
    }
    const products = inserted.get(catalog.product.table.name);
    const options = inserted.get(catalog.option.table.name);
    const values = inserted.get(catalog.value.table.name);
    const variants = inserted.get(catalog.variant.table.name);
    if (products === undefined || products.size === 0 || options === undefined || values === undefined || variants === undefined)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    yield* validateProductMembershipRows(memberships, membershipRows, products);
    for (const [table, foreignKey, parents] of [
      [catalog.option.table.name, catalog.foreignKeys.option, products],
      [catalog.image.table.name, catalog.foreignKeys.image, products],
      [catalog.variant.table.name, catalog.foreignKeys.variant, products],
      [catalog.value.table.name, catalog.foreignKeys.value, options],
    ] as const) for (const row of inserted.get(table)?.values() ?? []) {
      const parent = row[foreignKey];
      if (typeof parent !== "string" || !parents.has(parent)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    for (const pivot of pivots) {
      const variant = pivot[catalog.pivot.variantColumn], value = pivot[catalog.pivot.valueColumn];
      const variantRow = typeof variant === "string" ? variants.get(variant) : undefined;
      const valueRow = typeof value === "string" ? values.get(value) : undefined;
      const optionId = valueRow?.[catalog.foreignKeys.value];
      const optionRow = typeof optionId === "string" ? options.get(optionId) : undefined;
      if (variantRow === undefined || optionRow === undefined ||
        variantRow[catalog.foreignKeys.variant] !== optionRow[catalog.foreignKeys.option])
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    for (const event of emitted) {
      const message = yield* capture(event);
      if (message.metadata.action !== CommonEvents.CREATED) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id]) {
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      }
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

/** Direct internal Product service calls change scalar Product roots without
 * public module events. Bind each service result to its charged row attempt. */
export function productLogicalInternalProductWriteEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update"): LogicalCallReceiptValidation {
  const mismatch = () => commerceError("receiptMismatch");
  const commandName = "productInternalProduct" + operation;
  return Effect.fn("ProductEvents.validateLogicalInternalProductWrite")(function* (call, activity) {
    const requests = Array.isArray(call.input) ? call.input : [call.input];
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== commandName || call.mode !== "write" || call.events.length !== 0 ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0 || requests.length === 0 ||
      requests.length !== results.length || results.length !== activity.mutations.length ||
      requests.some(row => !isJsonObject(row)) || results.some(row => !isJsonObject(row)))
      return yield* Effect.fail(mismatch());
    const changed = new Map<string, JsonObject>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after, id = after?.id;
      const admitted = operation === "create"
        ? mutation.operation === "insert" && before === null && after?.deleted_at === null
        : (mutation.operation === "patch" || mutation.operation === "replace") &&
          before !== null && before.id === id && before.deleted_at === null && after?.deleted_at === null;
      if (!admitted || mutation.table !== catalog.product.table.name ||
        typeof id !== "string" || after === null || changed.has(id))
        return yield* Effect.fail(mismatch());
      changed.set(id, after);
    }
    const matchesResult = productResultGraphMatcher(catalog, catalog.product.table.name, activity);
    // The native internal DAL returns bulk updates in its read order, which
    // need not match the caller's input order (for example batch-10 precedes
    // batch-2). Authenticate an update by its selected identity instead.
    const requestedById = new Map<string, JsonObject>();
    if (operation === "update") {
      for (const request of requests) {
        if (!isJsonObject(request)) return yield* Effect.fail(mismatch());
        const id = request.selector !== undefined && isJsonObject(request.selector)
          ? request.selector.id : request.id;
        if (typeof id !== "string" || requestedById.has(id)) return yield* Effect.fail(mismatch());
        requestedById.set(id, request);
      }
    }
    for (const [index, result] of results.entries()) {
      const request = operation === "update" && isJsonObject(result) && typeof result.id === "string"
        ? requestedById.get(result.id) : requests[index];
      if (!isJsonObject(result) || !isJsonObject(request) || typeof result.id !== "string")
        return yield* Effect.fail(mismatch());
      const stored = changed.get(result.id);
      const selected = operation === "update" && request.selector !== undefined && isJsonObject(request.selector)
        ? request.selector.id : request.id;
      const values = operation === "update" && request.data !== undefined && isJsonObject(request.data)
        ? request.data : request;
      if (stored === undefined || !isJsonObject(values) ||
        typeof selected === "string" && selected !== result.id ||
        !matchesResult(stored, result) ||
        Object.entries(values).some(([field, value]) => field !== "id" &&
          stored[field] !== undefined && !jsonEqual(stored[field], value)))
        return yield* Effect.fail(mismatch());
      changed.delete(result.id);
      if (operation === "update") requestedById.delete(result.id);
    }
    if (changed.size !== 0 || requestedById.size !== 0) return yield* Effect.fail(mismatch());
  });
}

/** Native upsert preserves its creation branch and delegates all existing-root
 * graph reconciliation to the same Product update receipt owner. */
export function productLogicalUpsertEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const created = productLogicalCreateEventPolicy(catalog);
  const updated = productLogicalUpdateEventPolicy(catalog);
  return Effect.fn("ProductEvents.validateLogicalUpsert")(function* (call, activity) {
    const requested = Array.isArray(call.input) ? call.input : [call.input];
    if (call.commandName !== "productUpsert" || call.mode !== "write" || requested.length === 0 ||
      requested.some(row => !isJsonObject(row))) return yield* Effect.fail(commerceError("receiptMismatch"));
    if (requested.length === 1 && isJsonObject(requested[0]) && typeof requested[0].id !== "string")
      return yield* created.validateLogicalCall({ ...call, commandName: "productCreate" }, activity);
    yield* updated.validateLogicalCall({ ...call, commandName: "productUpdate" }, activity);
  });
}

/** Selector methods retain native missing/empty selection behavior. Authenticate
 * returned roots against the selector, then reuse the complete graph owner. */
export function productLogicalSelectorUpdateEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const updated = productLogicalUpdateEventPolicy(catalog);
  return Effect.fn("ProductEvents.validateSelectorUpdate")(function* (call, activity) {
    const decoded = yield* Effect.fromResult(decodeProductSelectorUpdate(call.input));
    const ids = new Set(typeof decoded.selector.id === "string" ? [decoded.selector.id] : decoded.selector.id);
    const rows = Array.isArray(call.result) ? call.result : [call.result];
    if (call.commandName !== "productUpdateProductsForWorkflow" || call.mode !== "write" ||
      rows.some(row => !isJsonObject(row) || typeof row.id !== "string" || !ids.has(row.id)))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    if (rows.length === 0) {
      if (activity.mutations.length || activity.lifecycle.length || activity.setNull.length ||
        activity.referenceReplacements.length || call.events.length) return yield* Effect.fail(commerceError("receiptMismatch"));
      return;
    }
    yield* updated.validateLogicalCall({ ...call, commandName: "productUpdate",
      input: rows.map(row => isJsonObject(row) ? { ...decoded.update, id: row.id } : row) }, activity);
  });
}

/** A native Product update owns its root, direct children and declared
 * tag/category memberships. Core authenticates rows and FK targets; this
 * policy binds every transition and silent pivot to the root's native event. */
export function productLogicalUpdateEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalUpdate")(function* (call, activity) {
      const { mutations, lifecycle, observedRows } = activity;
    if (call.commandName !== "productUpdate") return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
    if (lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const memberships = yield* productMembershipPivots(catalog);
    const pivots = new Map(memberships.map(pivot => [pivot.table, pivot]));
    const children = new Map([
      [catalog.image.table.name, { entity: catalog.image, owner: catalog.foreignKeys.image }],
      [catalog.variant.table.name, { entity: catalog.variant, owner: catalog.foreignKeys.variant }],
      [catalog.option.table.name, { entity: catalog.option, owner: catalog.foreignKeys.option }],
    ]);
    const roots = new Map<string, JsonObject>();
    const seen = new Set<string>();
    const childAttempts: Array<{ mutation: typeof mutations[number]; entity: ProductEntityMetadata; owner: string }> = [];
    const valueAttempts: Array<typeof mutations[number]> = [];
    const variantOptionAttempts: Array<typeof mutations[number]> = [];
    for (const mutation of mutations) {
      if (mutation.table === catalog.product.table.name) {
        const before = mutation.before, after = mutation.after;
        if ((mutation.operation !== "patch" && mutation.operation !== "replace") ||
          before === null || after === null || typeof before.id !== "string" || before.id !== after.id ||
          before.deleted_at !== null || after.deleted_at !== null || roots.has(before.id))
          return yield* Effect.fail(commerceError("receiptMismatch"));
        roots.set(before.id, after);
        continue;
      }
      const child = children.get(mutation.table);
      if (child !== undefined) { childAttempts.push({ mutation, ...child }); continue; }
      if (mutation.table === catalog.value.table.name) { valueAttempts.push(mutation); continue; }
      if (mutation.table === catalog.pivot.table.name) { variantOptionAttempts.push(mutation); continue; }
      const pivot = pivots.get(mutation.table);
      const row = mutation.operation === "insert" ? mutation.after : mutation.operation === "delete" ? mutation.before : null;
      const productId = row?.[pivot?.productColumn ?? ""];
      const targetId = row?.[pivot?.targetColumn ?? ""];
      const identity = JSON.stringify([mutation.table, productId, targetId]);
      if (pivot === undefined || row === null ||
        (mutation.operation === "insert" ? mutation.before !== null : mutation.after !== null) ||
        typeof productId !== "string" || typeof targetId !== "string" || seen.has(identity))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      seen.add(identity);
    }
    if (roots.size === 0 || mutations.some(mutation => pivots.has(mutation.table) &&
      !roots.has(String((mutation.operation === "insert" ? mutation.after : mutation.before)?.[
        pivots.get(mutation.table)?.productColumn ?? ""]))))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const requested = Array.isArray(call.input) ? call.input : isJsonObject(call.input) && typeof call.input.id === "string" &&
      call.input.data !== undefined && isJsonObject(call.input.data)
      ? [{ ...call.input.data, id: call.input.id }] : [call.input];
    const requestedIds = new Set(requested.flatMap(row => isJsonObject(row) && typeof row.id === "string" ? [row.id] : []));
    const results = Array.isArray(call.result) ? call.result : [call.result];
    if (requestedIds.size !== requested.length || requested.length !== roots.size ||
      [...roots.keys()].some(id => !requestedIds.has(id)) || results.length !== roots.size)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const returned = new Set<string>();
    const matchesResult = productResultGraphMatcher(catalog, catalog.product.table.name, activity);
    for (const result of results) {
      if (!isJsonObject(result) || typeof result.id !== "string" || returned.has(result.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const stored = roots.get(result.id);
      if (stored === undefined || !matchesResult(stored, result)) return yield* Effect.fail(commerceError("receiptMismatch"));
      returned.add(result.id);
    }
    const expected = new Set([...roots.keys()].map(root => catalog.product.updatedEvent + ":" + root));
    const childIds = new Set<string>();
    const finalOptions = new Set<string>(), previousOptions = new Set<string>();
    const finalVariants = new Set<string>(), previousVariants = new Set<string>();
    const optionProducts = new Map<string, string>(), variantProducts = new Map<string, string>();
    for (const { mutation, entity, owner } of childAttempts) {
      const before = mutation.before, after = mutation.after;
      const row = mutation.operation === "delete" ? before : after;
      const eventName = mutation.operation === "insert" ? entity.createdEvent
        : mutation.operation === "delete" ? entity.deletedEvent : entity.updatedEvent;
      const valid = mutation.operation === "insert" ? before === null && after !== null && after.deleted_at === null
          : mutation.operation === "delete" ? before !== null && before.deleted_at === null && after === null
          : before !== null && after !== null && before.id === after.id &&
            before[owner] === after[owner] && before.deleted_at === null && after.deleted_at === null;
      if (!valid || row === null || typeof row.id !== "string" || !roots.has(String(row[owner])) ||
        childIds.has(entity.table.name + ":" + row.id)) return yield* Effect.fail(commerceError("receiptMismatch"));
      childIds.add(entity.table.name + ":" + row.id);
      if (entity === catalog.option) {
        optionProducts.set(row.id, String(row[owner]));
        if (before !== null) previousOptions.add(row.id);
        if (after !== null) finalOptions.add(row.id);
      }
      if (entity === catalog.variant) {
        variantProducts.set(row.id, String(row[owner]));
        if (before !== null) previousVariants.add(row.id);
        if (after !== null) finalVariants.add(row.id);
      }
      expected.add(eventName + ":" + row.id);
    }
    for (const observation of observedRows) {
      const row = observation.row;
      if (typeof row.id !== "string" || row.deleted_at !== null) continue;
      if (observation.table === catalog.option.table.name && roots.has(String(row[catalog.foreignKeys.option]))) {
        optionProducts.set(row.id, String(row[catalog.foreignKeys.option]));
        finalOptions.add(row.id);
        if (!childIds.has(catalog.option.table.name + ":" + row.id)) previousOptions.add(row.id);
      }
      if (observation.table === catalog.variant.table.name && roots.has(String(row[catalog.foreignKeys.variant]))) {
        variantProducts.set(row.id, String(row[catalog.foreignKeys.variant]));
        finalVariants.add(row.id);
        if (!childIds.has(catalog.variant.table.name + ":" + row.id)) previousVariants.add(row.id);
      }
    }
    const finalValues = new Set<string>(), previousValues = new Set<string>();
    const valueProducts = new Map<string, string>();
    for (const mutation of valueAttempts) {
      const before = mutation.before, after = mutation.after;
      const row = mutation.operation === "delete" ? before : after;
      const eventName = mutation.operation === "insert" ? catalog.value.createdEvent
        : mutation.operation === "delete" ? catalog.value.deletedEvent : catalog.value.updatedEvent;
      const valid = mutation.operation === "insert" ? before === null && after !== null && after.deleted_at === null
        : mutation.operation === "delete" ? before !== null && before.deleted_at === null && after === null
          : before !== null && after !== null && before.id === after.id &&
            before[catalog.foreignKeys.value] === after[catalog.foreignKeys.value] &&
            before.deleted_at === null && after.deleted_at === null;
      const beforeOption = before?.[catalog.foreignKeys.value], afterOption = after?.[catalog.foreignKeys.value];
      if (!valid || row === null || typeof row.id !== "string" ||
        (before !== null && (typeof beforeOption !== "string" || !previousOptions.has(beforeOption))) ||
        (after !== null && (typeof afterOption !== "string" || !finalOptions.has(afterOption))) ||
        childIds.has(catalog.value.table.name + ":" + row.id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      valueProducts.set(row.id, optionProducts.get(String(row[catalog.foreignKeys.value])) ?? "");
      childIds.add(catalog.value.table.name + ":" + row.id);
      if (before !== null) previousValues.add(row.id);
      if (after !== null) finalValues.add(row.id);
      expected.add(eventName + ":" + row.id);
    }
    for (const observation of observedRows) {
      if (observation.table !== catalog.value.table.name) continue;
      const row = observation.row, optionId = row[catalog.foreignKeys.value];
      if (row.deleted_at !== null || typeof row.id !== "string" || typeof optionId !== "string") continue;
      valueProducts.set(row.id, optionProducts.get(optionId) ?? "");
      if (finalOptions.has(optionId)) finalValues.add(row.id);
      if (!childIds.has(catalog.value.table.name + ":" + row.id) && previousOptions.has(optionId))
        previousValues.add(row.id);
    }
    for (const mutation of variantOptionAttempts) {
      const row = mutation.operation === "insert" ? mutation.after : mutation.operation === "delete" ? mutation.before : null;
      const variantId = row?.[catalog.pivot.variantColumn], valueId = row?.[catalog.pivot.valueColumn];
      const identity = JSON.stringify([mutation.table, variantId, valueId]);
      const ownedVariants = mutation.operation === "insert" ? finalVariants : previousVariants;
      const ownedValues = mutation.operation === "insert" ? finalValues : previousValues;
      if (row === null || (mutation.operation === "insert" ? mutation.before !== null : mutation.after !== null) ||
        typeof variantId !== "string" || typeof valueId !== "string" ||
        !ownedVariants.has(variantId) || !ownedValues.has(valueId) ||
        variantProducts.get(variantId) !== valueProducts.get(valueId) || seen.has(identity))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      seen.add(identity);
    }
    const allowedEvents = new Map([
      [catalog.product.updatedEvent, { object: catalog.product.eventObject, action: CommonEvents.UPDATED }],
      ...[catalog.image, catalog.variant, catalog.option, catalog.value].flatMap(entity => [
        [entity.createdEvent, { object: entity.eventObject, action: CommonEvents.CREATED }],
        [entity.updatedEvent, { object: entity.eventObject, action: CommonEvents.UPDATED }],
        [entity.deletedEvent, { object: entity.eventObject, action: CommonEvents.DELETED }],
      ] as const),
    ]);
    for (const event of emitted) {
      const message = yield* capture(event);
      const allowed = allowedEvents.get(message.name);
      if (allowed === undefined || message.metadata.object !== allowed.object ||
        message.metadata.action !== allowed.action) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}

/** The native public delete emits a Product root message while storage removes
 * its owned graph. Every silent child and pivot must trace to a deleted root. */
export function productLogicalDeleteEventPolicy(catalog: ProductRuntimeMetadata) {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const entities = [catalog.product, catalog.option, catalog.value, catalog.variant, catalog.image];
  const byTable = new Map(entities.map(entity => [entity.table.name, entity]));
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalDelete")(function* (call, activity) {
      const { mutations, lifecycle } = activity;
    if (call.commandName !== "productDeleteproduct") return yield* Effect.fail(commerceError("receiptMismatch"));
      const emitted = call.events;
    if (lifecycle.length !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
    const memberships = yield* productMembershipPivots(catalog);
    const membershipRows = new Map(memberships.map(pivot => [pivot.table, [] as JsonObject[]]));
    const removed = new Map(entities.map(entity => [entity.table.name, new Map<string, JsonObject>()]));
    const pivots: JsonObject[] = [];
    for (const mutation of mutations) {
      if (mutation.operation !== "delete" || mutation.before === null || mutation.after !== null)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      if (mutation.table === catalog.pivot.table.name) { pivots.push(mutation.before); continue; }
      const members = membershipRows.get(mutation.table);
      if (members !== undefined) { members.push(mutation.before); continue; }
      const entity = byTable.get(mutation.table);
      const id = mutation.before.id;
      if (entity === undefined || typeof id !== "string" || removed.get(entity.table.name)?.has(id))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      removed.get(entity.table.name)?.set(id, mutation.before);
    }
    const products = removed.get(catalog.product.table.name);
    const options = removed.get(catalog.option.table.name);
    const values = removed.get(catalog.value.table.name);
    const variants = removed.get(catalog.variant.table.name);
    if (products === undefined || options === undefined || values === undefined || variants === undefined)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    yield* validateProductMembershipRows(memberships, membershipRows, products);
    for (const [table, foreignKey, parents] of [
      [catalog.option.table.name, catalog.foreignKeys.option, products],
      [catalog.image.table.name, catalog.foreignKeys.image, products],
      [catalog.variant.table.name, catalog.foreignKeys.variant, products],
      [catalog.value.table.name, catalog.foreignKeys.value, options],
    ] as const) for (const row of removed.get(table)?.values() ?? []) {
      const parent = row[foreignKey];
      if (typeof parent !== "string" || !parents.has(parent)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    const pivotKeys = new Set<string>();
    for (const pivot of pivots) {
      const variant = pivot[catalog.pivot.variantColumn], value = pivot[catalog.pivot.valueColumn];
      const variantRow = typeof variant === "string" ? variants.get(variant) : undefined;
      const valueRow = typeof value === "string" ? values.get(value) : undefined;
      const optionId = valueRow?.[catalog.foreignKeys.value];
      const optionRow = typeof optionId === "string" ? options.get(optionId) : undefined;
      const identity = JSON.stringify([variant, value]);
      if (pivotKeys.has(identity) || variantRow === undefined || optionRow === undefined ||
        variantRow[catalog.foreignKeys.variant] !== optionRow[catalog.foreignKeys.option])
        return yield* Effect.fail(commerceError("receiptMismatch"));
      pivotKeys.add(identity);
    }
    const expected = new Set(products.keys());
    for (const event of emitted) {
      const message = yield* capture(event);
      if (message.name !== catalog.product.deletedEvent || message.metadata.object !== catalog.product.eventObject ||
        message.metadata.action !== CommonEvents.DELETED) return yield* Effect.fail(commerceError("receiptMismatch"));
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!expected.delete(id)) return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    if (expected.size !== 0) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture, validateLogicalCall };
}
