import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, isJsonObject, type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommonEvents, isPresent, kebabCase } from "@medusajs/framework/utils/portable";
import { mergeMetadata } from "@medusajs/utils/common/merge-metadata";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { matchesPublicRow } from "../../../repository/result";
import { decodeProductLifecycleIds } from "../lifecycle";
import { productLogicalNullableReferenceDeleteEventPolicy } from "./entity";

/** Collection deletion admits only requested roots before its set-null receipt. */
export function collectionDeleteEventPolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const policy = productLogicalNullableReferenceDeleteEventPolicy(catalog, catalog.collection,
    "collection_id", "productDeletecollection");
  return Effect.fn("ProductEvents.validateCollectionDelete")(function* (call, activity) {
    const decoded = yield* Effect.fromResult(decodeProductLifecycleIds(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const requested = new Set(typeof decoded === "string" ? [decoded] : decoded);
    if (call.result !== null || activity.referenceReplacements.length !== 0 ||
      activity.mutations.some(mutation => typeof mutation.before?.id !== "string" || !requested.has(mutation.before.id)))
      return yield* Effect.fail(commerceError("receiptMismatch"));
    yield* policy.validateLogicalCall(call, activity);
  });
}
import { productModuleEventCapture } from "./capture";

/** Native Collection update returns requested Product ID stubs, not a loaded relation. */
export function matchesCollectionUpdateRow(before: JsonObject, stored: JsonObject, returned: Json, input: Json | undefined): boolean {
  if (!isJsonObject(returned) || input === undefined || !isJsonObject(input)) return false;
  for (const field of ["title", "handle", "metadata"] as const) {
    const supplied = input[field];
    if (supplied === undefined) continue;
    const persisted = stored[field];
    if (field === "metadata" && isPresent(supplied)) {
      const prior = before.metadata;
      if (!isJsonObject(supplied) || prior !== undefined && prior !== null && !isJsonObject(prior) || persisted === undefined ||
        !jsonEqual(mergeMetadata(prior ?? {}, supplied), persisted)) return false;
    } else if (persisted === undefined || !jsonEqual(supplied, persisted)) return false;
  }
  const { products, ...scalars } = returned;
  const ids = input.product_ids ?? [];
  return matchesPublicRow(stored, scalars) && products !== undefined && Array.isArray(ids) &&
    ids.every(id => typeof id === "string") && jsonEqual(products, ids.map(id => ({ id })));
}

/** Native Collection writes may change their own roots and, when product_ids
 * is present, only the requested Product.collection_id memberships. */
export function collectionWriteEventPolicy(catalog: ProductRuntimeMetadata,
  operation: "create" | "update" | "upsert") {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  const mismatch = () => commerceError("receiptMismatch");
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("ProductEvents.validateLogicalCollectionWrite")(
    function* (write, activity) {
      const { mutations, lifecycle, setNull, referenceReplacements } = activity;
      const emitted = write.events;
      if (lifecycle.length !== 0 || setNull.length !== 0) return yield* Effect.fail(mismatch());
      const upsertMembership = operation === "upsert" && Array.isArray(write.input) &&
        write.input.length === 1 && isJsonObject(write.input[0]) &&
        typeof write.input[0].id === "string" && Object.hasOwn(write.input[0], "product_ids")
        ? write.input[0] : undefined;
      const updateMembership = operation === "update" && isJsonObject(write.input) &&
        write.input.data !== undefined && isJsonObject(write.input.data) &&
        Object.hasOwn(write.input.data, "product_ids") ? write.input.data : undefined;
      const mixedMembership = operation === "upsert" && Array.isArray(write.input)
        ? write.input.filter(row => isJsonObject(row) && typeof row.id === "string" &&
          Object.hasOwn(row, "product_ids")) : [];
      const suppliedMembership = updateMembership ?? upsertMembership ??
        (mixedMembership.length === 1 ? mixedMembership[0] : undefined);
      const replacesMembership = suppliedMembership !== undefined;
      if (replacesMembership && referenceReplacements.length !== 1) return yield* Effect.fail(mismatch());
      if (referenceReplacements.length !== 0) {
        const intent = referenceReplacements[0];
        const supplied = suppliedMembership?.product_ids;
        const desired = Array.isArray(supplied) && supplied.every(id => typeof id === "string")
          ? [...new Set(supplied)] : undefined;
        const root = mutations[0];
        const event = emitted[0] === undefined ? undefined : yield* capture(emitted[0]);
        const rootId = operation === "update" && isJsonObject(write.input) ? write.input.id
          : suppliedMembership?.id;
        const returned = operation === "update" ? write.result
          : Array.isArray(write.result) && write.result.length === 1 ? write.result[0] : undefined;
        if (!replacesMembership || referenceReplacements.length !== 1 || intent === undefined ||
          intent.sourceTable !== catalog.product.table.name || intent.sourceColumn !== "collection_id" ||
          intent.targetTable !== catalog.collection.table.name || intent.targetColumn !== "id" ||
          typeof rootId !== "string" || intent.targetKey !== rootId || desired === undefined ||
          desired.length !== intent.desiredKeys.length ||
          desired.some((id, index) => id !== intent.desiredKeys[index]))
          return yield* Effect.fail(mismatch());
        if (operation === "upsert" && Array.isArray(write.input) && write.input.length > 1) {
          // The single sealed replacement belongs to the selected updated
          // root; ordinary receipt validation below owns the remaining roots.
          if (mixedMembership.length !== 1) return yield* Effect.fail(mismatch());
        } else if (
          mutations.length !== 1 || root?.table !== catalog.collection.table.name ||
          !["patch", "replace"].includes(root.operation) || root.before?.id !== intent.targetKey ||
          root.after?.id !== intent.targetKey || root.after.deleted_at !== null ||
          !matchesCollectionUpdateRow(root.before, root.after, returned, suppliedMembership) ||
          emitted.length !== 1 || event?.name !== catalog.collection.updatedEvent ||
          event.metadata.object !== catalog.collection.eventObject ||
          event.metadata.action !== CommonEvents.UPDATED || event.data.id !== intent.targetKey)
          return yield* Effect.fail(mismatch());
        else return;
      }
      const updateId = operation === "update" && isJsonObject(write.input) && typeof write.input.id === "string"
        ? write.input.id : undefined;
      if (operation === "update" && (updateId === undefined || !isJsonObject(write.result) || write.result.id !== updateId))
        return yield* Effect.fail(mismatch());
      const requested = operation === "update" ? [write.input] : Array.isArray(write.input) ? write.input : [write.input];
      const createdRequests = operation === "create" ? requested : operation === "upsert"
        ? requested.filter(item => isJsonObject(item) && typeof item.id !== "string") : [];
      const createdCount = createdRequests.length;
      const updatedIds = operation === "upsert" ? new Set(requested.flatMap(item =>
        isJsonObject(item) && typeof item.id === "string" ? [item.id] : [])) : new Set<string>();
      const returnsRoots = operation !== "update";
      const resultRows = returnsRoots
        ? Array.isArray(write.result) ? write.result : [write.result] : [];
      const returnedIds = new Set<string>();
      if (returnsRoots) {
        if (resultRows.length !== requested.length) return yield* Effect.fail(mismatch());
        for (const row of resultRows) {
          if (!isJsonObject(row) || typeof row.id !== "string" || row.id.length === 0 || returnedIds.has(row.id))
            return yield* Effect.fail(mismatch());
          returnedIds.add(row.id);
        }
        if (operation === "create") {
          for (const [index, item] of requested.entries()) {
            const returned = resultRows[index];
            if (!isJsonObject(item) || typeof item.id === "string" && (!isJsonObject(returned) || returned.id !== item.id))
              return yield* Effect.fail(mismatch());
          }
        } else {
          if (resultRows.slice(createdCount).length !== updatedIds.size ||
            resultRows.slice(createdCount).some(row => !isJsonObject(row) || typeof row.id !== "string" || !updatedIds.has(row.id)))
            return yield* Effect.fail(mismatch());
        }
      }
      const memberships = new Map<string, ReadonlySet<string>>();
      let createdOrdinal = 0;
      for (const [index, item] of requested.entries()) {
        if (!isJsonObject(item)) return yield* Effect.fail(mismatch());
        const generatedOrdinal = typeof item.id === "string" ? undefined : createdOrdinal++;
        const row = operation === "update" ? item.data : item;
        if (row === undefined || !isJsonObject(row) || !Object.hasOwn(row, "product_ids")) continue;
        const ids = row.product_ids;
        const result = operation === "upsert" ? resultRows[generatedOrdinal ?? -1] : resultRows[index];
        const rootId = typeof item.id === "string" ? item.id : isJsonObject(result) ? result.id : undefined;
        if (typeof rootId !== "string" || !Array.isArray(ids) ||
          ids.some(id => typeof id !== "string") || memberships.has(rootId))
          return yield* Effect.fail(mismatch());
        memberships.set(rootId, new Set(ids));
      }
      const expected = new Set<string>();
      const roots = new Set<string>();
      const createdRoots: string[] = [];
      const createdRootRows = new Map<string, JsonObject>();
      const updatedRoots: string[] = [];
      const attachedByRoot = new Map<string, Map<string, JsonObject>>();
      const returnedMembers = new Map<string, readonly Json[]>();
      for (const mutation of mutations) {
        const { before, after } = mutation;
        const created = mutation.operation === "insert" && before === null && after?.deleted_at === null;
        const updated = (mutation.operation === "patch" || mutation.operation === "replace") &&
          before !== null && before.deleted_at === null && after?.deleted_at === null && before.id === after.id;
        if (!(created || updated) || typeof after?.id !== "string") return yield* Effect.fail(mismatch());
        if (mutation.table === catalog.product.table.name) {
          if (!updated || before === null)
            return yield* Effect.fail(mismatch());
          const allowed = new Set(["collection_id", "updated_at"]);
          const unchanged = Object.keys(before).filter(key => !allowed.has(key));
          if (unchanged.length !== Object.keys(after).filter(key => !allowed.has(key)).length ||
            unchanged.some(key => {
              const left = before[key], right = after[key];
              return left === undefined || right === undefined || !jsonEqual(left, right);
            }))
            return yield* Effect.fail(mismatch());
          const attached = typeof after.collection_id === "string" && memberships.get(after.collection_id)?.has(after.id);
          const detached = typeof before.collection_id === "string" &&
            memberships.has(before.collection_id) && after.collection_id === null &&
            !memberships.get(before.collection_id)?.has(after.id);
          if (!attached && !detached) return yield* Effect.fail(mismatch());
          if (attached && typeof after.collection_id === "string") {
            const members = attachedByRoot.get(after.collection_id) ?? new Map<string, JsonObject>();
            members.set(after.id, after);
            attachedByRoot.set(after.collection_id, members);
          }
          const identity = catalog.product.updatedEvent + ":" + after.id;
          if (expected.has(identity)) return yield* Effect.fail(mismatch());
          expected.add(identity);
          continue;
        }
        if (mutation.table !== catalog.collection.table.name ||
          operation === "create" && !created || operation === "update" && (!updated || after.id !== updateId) || roots.has(after.id))
          return yield* Effect.fail(mismatch());
        if (returnsRoots && !returnedIds.has(after.id)) return yield* Effect.fail(mismatch());
        const returned = operation === "update" ? write.result
          : resultRows.find(row => isJsonObject(row) && row.id === after.id);
        if (returned === undefined || !isJsonObject(returned)) return yield* Effect.fail(mismatch());
        if (created) {
          // Native create uses upsertWithReplace(..., { relations: ["products"] });
          // updated roots instead return their normalized requested ID stubs.
          const { products, ...scalars } = returned;
          if (!Array.isArray(products) || !matchesPublicRow(after, scalars)) return yield* Effect.fail(mismatch());
          returnedMembers.set(after.id, products);
        } else {
          const input = operation === "update" && isJsonObject(write.input) ? write.input.data
            : requested.find(row => isJsonObject(row) && row.id === after.id);
          if (before === null || !matchesCollectionUpdateRow(before, after, returned, input)) return yield* Effect.fail(mismatch());
        }
        roots.add(after.id);
        (created ? createdRoots : updatedRoots).push(after.id);
        if (created) createdRootRows.set(after.id, after);
        const identity = (created ? catalog.collection.createdEvent : catalog.collection.updatedEvent) + ":" + after.id;
        if (expected.has(identity)) return yield* Effect.fail(mismatch());
        expected.add(identity);
      }
      for (const root of memberships.keys()) if (!roots.has(root)) return yield* Effect.fail(mismatch());
      if (returnsRoots && roots.size !== returnedIds.size) return yield* Effect.fail(mismatch());
      if (returnsRoots && (createdRoots.length !== createdCount || updatedRoots.length !== updatedIds.size ||
        updatedRoots.some(id => !updatedIds.has(id)))) return yield* Effect.fail(mismatch());
      if (returnsRoots) for (const [index, input] of createdRequests.entries()) {
        const returned = resultRows[index];
        const stored = isJsonObject(returned) && typeof returned.id === "string"
          ? createdRootRows.get(returned.id) : undefined;
        if (!isJsonObject(input) || !isJsonObject(returned) || stored === undefined ||
          returned.id !== stored.id) return yield* Effect.fail(mismatch());
        for (const field of ["title", "handle", "metadata"] as const) {
          // normalizeCreateProductCollectionInput generates a missing/falsy
          // handle from a truthy title, including an explicit empty handle.
          const generated = field === "handle" && !input.handle && typeof input.title === "string" && input.title;
          if (!generated && !Object.hasOwn(input, field)) continue;
          const supplied = generated ? kebabCase(generated) : input[field], persisted = stored[field];
          if (supplied === undefined || persisted === undefined || !jsonEqual(supplied, persisted))
            return yield* Effect.fail(mismatch());
        }
      }
      for (const root of createdRoots) {
        const selected = memberships.get(root);
        if (selected !== undefined && ((attachedByRoot.get(root)?.size ?? 0) !== selected.size ||
          [...selected].some(id => !attachedByRoot.get(root)?.has(id)))) return yield* Effect.fail(mismatch());
        const returned = returnedMembers.get(root);
        const expectedMembers = new Map(attachedByRoot.get(root));
        if (returned === undefined || returned.length !== expectedMembers.size) return yield* Effect.fail(mismatch());
        for (const member of returned) {
          if (!isJsonObject(member) || typeof member.id !== "string") return yield* Effect.fail(mismatch());
          const stored = expectedMembers.get(member.id);
          if (stored === undefined || !matchesPublicRow(stored, member)) return yield* Effect.fail(mismatch());
          expectedMembers.delete(member.id);
        }
      }
      if (operation === "update" && (updateId === undefined || !roots.has(updateId)))
        return yield* Effect.fail(mismatch());
      for (const event of emitted) {
        const message = yield* capture(event);
        const created = message.name === catalog.collection.createdEvent && message.metadata.action === CommonEvents.CREATED &&
          message.metadata.object === catalog.collection.eventObject;
        const updated = message.name === catalog.collection.updatedEvent && message.metadata.action === CommonEvents.UPDATED &&
          message.metadata.object === catalog.collection.eventObject;
        const product = message.name === catalog.product.updatedEvent && message.metadata.action === CommonEvents.UPDATED &&
          message.metadata.object === catalog.product.eventObject;
        if (!(created || updated || product)) return yield* Effect.fail(mismatch());
        for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
          if (!expected.delete(message.name + ":" + id)) return yield* Effect.fail(mismatch());
      }
      if (expected.size !== 0) return yield* Effect.fail(mismatch());
    });
  return { capture, validateLogicalCall };
}
