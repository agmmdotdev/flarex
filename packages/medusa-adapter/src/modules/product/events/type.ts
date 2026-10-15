import { Effect } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { mergeMetadata } from "@medusajs/utils/common/merge-metadata";
import { isPresent } from "@medusajs/framework/utils/portable";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { ProductTypeCreateInput, decodeProductTypeUpdateInput } from "../type-input";
import { commerceDecoder } from "../../../value/decoder";
import { productLogicalEntityEventPolicy } from "./entity";
import { matchesPublicRow } from "./result";

const decodeCreate = commerceDecoder(ProductTypeCreateInput, "receiptMismatch");
const mismatch = () => commerceError("receiptMismatch");

/** Type creation retains native input/result order and binds complete DTOs to
 * the exact inserted roots and their existing module-event contract. */
export function productLogicalTypeWorkflowCreatePolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const entity = productLogicalEntityEventPolicy(catalog, catalog.type, "productCreateTypesForWorkflow", "created");
  return Effect.fn("ProductEvents.validateLogicalTypeWorkflowCreate")(function* (call, activity) {
    yield* entity.validateLogicalCall(call, activity);
    const requested = yield* Effect.fromResult(decodeCreate(call.input));
    const results = call.result;
    if (call.mode !== "write" || !Array.isArray(results) || requested.length !== results.length ||
      activity.mutations.length !== results.length || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0) return yield* Effect.fail(mismatch());
    for (const [index, request] of requested.entries()) {
      const mutation = activity.mutations[index], result = results[index];
      const after = mutation?.after;
      if (after == null || result === undefined || !matchesPublicRow(after, result) ||
        request.id !== undefined && request.id !== after.id ||
        Object.entries(request).some(([field, value]) => after[field] === undefined || !jsonEqual(after[field], value)))
        return yield* Effect.fail(mismatch());
    }
  });
}

/** The native selector lists complete active roots before normalizing keyed
 * updates. First mutation preimages retain their state before native metadata
 * merging mutates the DAL's framework-owned entity objects. */
export function productLogicalTypeSelectorUpdatePolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const entity = productLogicalEntityEventPolicy(catalog, catalog.type, "productUpdateTypesBySelector", "updated");
  // The logical relational reader orders text by complete UTF-8 bytes. The
  // native buildQuery first deduplicates service ID arrays; the pinned
  // repository preserves the normalized filter order for keyed updates.
  const encoder = new TextEncoder();
  const compareIds = ([left]: readonly [string, JsonObject], [right]: readonly [string, JsonObject]) =>
    compareBytesLexicographically(encoder.encode(left), encoder.encode(right));
  return Effect.fn("ProductEvents.validateLogicalTypeSelectorUpdate")(function* (call, activity) {
    yield* entity.validateLogicalCall(call, activity);
    const input = yield* Effect.fromResult(decodeProductTypeUpdateInput(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const results = call.result;
    if (call.mode !== "write" || !Array.isArray(results) || results.length > 4 ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 ||
      activity.referenceReplacements.length !== 0) return yield* Effect.fail(mismatch());
    const preimages = new Map<string, JsonObject>();
    for (const observed of activity.observedRows)
      if (observed.table === catalog.type.table.name && typeof observed.row.id === "string") preimages.set(observed.row.id, observed.row);
    const beforeIds = new Set<string>();
    for (const mutation of activity.mutations) {
      const before = mutation.before;
      if (mutation.table !== catalog.type.table.name || before === null || typeof before.id !== "string" || beforeIds.has(before.id))
        return yield* Effect.fail(mismatch());
      beforeIds.add(before.id); preimages.set(before.id, before);
    }
    const ids = input.selector.id === undefined ? undefined : new Set(typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id);
    const selected = new Map([...preimages].filter(([id, row]) => row.deleted_at === null &&
      (ids === undefined || ids.has(id)) && (input.selector.value === undefined || row.value === input.selector.value)));
    if (selected.size > 4 || selected.size !== results.length || activity.mutations.length !== selected.size)
      return yield* Effect.fail(mismatch());
    const nativeWhere = buildQuery(input.selector, { order: { id: "ASC" } }).where;
    const orderedRoots = preservePrimaryKeyOrFilterOrder([...selected].toSorted(compareIds).map(([, row]) => row),
      nativeWhere, ["id"], [["id", "ASC"]]);
    for (const [index, result] of results.entries()) {
      const mutation = activity.mutations[index], before = mutation?.before, after = mutation?.after;
      if (!isJsonObject(result) || typeof result.id !== "string" || result.id !== orderedRoots[index]?.id || before == null || after == null ||
        before.id !== result.id || !selected.delete(result.id) || !matchesPublicRow(after, result)) return yield* Effect.fail(mismatch());
      for (const [field, value] of Object.entries(before)) {
        if (field === "updated_at") continue;
        let expected = value;
        if (field === "value" && input.update.value !== undefined) expected = input.update.value;
        if (field === "metadata" && input.update.metadata !== undefined) {
          const incoming = input.update.metadata;
          if (isPresent(incoming)) {
            if (!isJsonObject(incoming) || value !== null && !isJsonObject(value)) return yield* Effect.fail(mismatch());
            expected = mergeMetadata(value ?? {}, incoming);
          } else expected = incoming;
        }
        if (after[field] === undefined || !jsonEqual(after[field], expected)) return yield* Effect.fail(mismatch());
      }
    }
    if (selected.size !== 0) return yield* Effect.fail(mismatch());
    let eventOrdinal = 0;
    for (const event of call.events) {
      const message = yield* entity.capture(event);
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (id !== orderedRoots[eventOrdinal++]?.id) return yield* Effect.fail(mismatch());
    }
    if (eventOrdinal !== orderedRoots.length) return yield* Effect.fail(mismatch());
  });
}
