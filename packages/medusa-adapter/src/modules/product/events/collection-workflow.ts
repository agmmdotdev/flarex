import { Effect } from "effect";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import { preservePrimaryKeyOrFilterOrder } from "@medusajs/drizzle/relation-query";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { decodeProductCollectionUpdateInput } from "../collection-input";
import { matchesCollectionUpdateRow } from "./collection";
import { productModuleEventCapture } from "./capture";

const unchangedOutside = (before: JsonObject, after: JsonObject, allowed: ReadonlySet<string>) => {
  const fields = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...fields].every(field => allowed.has(field) ||
    before[field] !== undefined && after[field] !== undefined && jsonEqual(before[field], after[field]));
};

/** Native selectors read all membership cohorts before the ordered Product
 * updates. Validate those initial cohorts against each attempt's pending row;
 * repeated Products across selected Collections retain native last-write wins. */
export function collectionWorkflowSelectorUpdatePolicy(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  // Match the logical relational reader's native binary text ordering before
  // applying native buildQuery normalization and the pinned repository's
  // primary-key filter ordering. Service arrays are deduplicated first.
  const encoder = new TextEncoder();
  const compareIds = ([left]: readonly [string, JsonObject], [right]: readonly [string, JsonObject]) =>
    compareBytesLexicographically(encoder.encode(left), encoder.encode(right));
  const mismatch = () => commerceError("receiptMismatch");
  return Effect.fn("ProductEvents.validateCollectionSelectorUpdate")(function* (call, activity) {
    const input = yield* Effect.fromResult(decodeProductCollectionUpdateInput(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const results = call.result;
    if (call.commandName !== "productUpdateCollectionsBySelector" || call.mode !== "write" ||
      !Array.isArray(results) || results.length > 4 || activity.mutations.length > results.length + 32 ||
      activity.lifecycle.length !== 0 || activity.setNull.length !== 0 || activity.referenceReplacements.length !== 0)
      return yield* Effect.fail(mismatch());
    const preimages = new Map<string, JsonObject>();
    const products = new Map<string, JsonObject>();
    for (const observation of activity.observedRows) {
      const rows = observation.table === catalog.collection.table.name ? preimages
        : observation.table === catalog.product.table.name ? products : undefined;
      if (rows !== undefined && typeof observation.row.id === "string") rows.set(observation.row.id, observation.row);
    }
    const firstBefore = new Set<string>();
    for (const mutation of activity.mutations) {
      const before = mutation.before;
      const rows = mutation.table === catalog.collection.table.name ? preimages
        : mutation.table === catalog.product.table.name ? products : undefined;
      if (rows === undefined || before === null || typeof before.id !== "string")
        return yield* Effect.fail(mismatch());
      const key = JSON.stringify([mutation.table, before.id]);
      if (!firstBefore.has(key)) { firstBefore.add(key); rows.set(before.id, before); }
    }
    const ids = input.selector.id === undefined ? undefined : new Set(typeof input.selector.id === "string" ? [input.selector.id] : input.selector.id);
    const selected = new Map([...preimages].filter(([id, row]) => row.deleted_at === null && (ids === undefined || ids.has(id)) &&
      (input.selector.title === undefined || row.title === input.selector.title) &&
      (input.selector.handle === undefined || row.handle === input.selector.handle)));
    if (selected.size > 4 || selected.size !== results.length)
      return yield* Effect.fail(mismatch());
    const nativeWhere = buildQuery(input.selector, { order: { id: "ASC" } }).where;
    const orderedRoots = preservePrimaryKeyOrFilterOrder([...selected].toSorted(compareIds).map(([, row]) => row),
      nativeWhere, ["id"], [["id", "ASC"]]);
    const desired = input.update.product_ids === undefined ? undefined : new Set(input.update.product_ids);
    const expectedEvents: string[] = [];
    const roots: string[] = [];
    const collectionFields = new Set(["updated_at", ...Object.keys(input.update).filter(field => field !== "product_ids")]);
    for (const [index, result] of results.entries()) {
      const mutation = activity.mutations[index], before = mutation?.before, after = mutation?.after;
      if (!isJsonObject(result) || typeof result.id !== "string" || result.id !== orderedRoots[index]?.id ||
        mutation?.table !== catalog.collection.table.name ||
        !["patch", "replace"].includes(mutation.operation) || before == null || after == null || before.id !== result.id ||
        after.id !== result.id || before.deleted_at !== null || after.deleted_at !== null ||
        !jsonEqual(before, selected.get(result.id) ?? null) ||
        !selected.delete(result.id) || !matchesCollectionUpdateRow(before, after, result, input.update) ||
        !unchangedOutside(before, after, collectionFields)) return yield* Effect.fail(mismatch());
      roots.push(result.id);
      expectedEvents.push(catalog.collection.updatedEvent + ":" + result.id);
    }
    const current = new Map(products);
    const orderedProducts = [...products].toSorted(compareIds);
    const touched = new Set<string>();
    let cursor = results.length;
    if (desired !== undefined) for (const root of roots) {
      const prior = orderedProducts.filter(([, row]) => row.deleted_at === null && row.collection_id === root);
      if (prior.length > 4) return yield* Effect.fail(mismatch());
      const detach = prior.filter(([id]) => !desired.has(id)).map(([id]) => id);
      const associate = orderedProducts.filter(([id, row]) => desired.has(id) && row.deleted_at === null).map(([id]) => id);
      for (const [cohort, target] of [[detach, null], [associate, root]] as const) {
        for (const id of cohort) {
          const mutation = activity.mutations[cursor++], before = mutation?.before, after = mutation?.after;
          if (mutation?.table !== catalog.product.table.name || !["patch", "replace"].includes(mutation.operation) ||
            before == null || after == null || typeof before.id !== "string" || after.id !== before.id ||
            before.id !== id || !jsonEqual(before, current.get(before.id) ?? null) ||
            after.collection_id !== target || !unchangedOutside(before, after, new Set(["collection_id", "updated_at"])))
            return yield* Effect.fail(mismatch());
          current.set(before.id, after);
          if (!touched.has(before.id)) {
            touched.add(before.id);
            expectedEvents.push(catalog.product.updatedEvent + ":" + before.id);
          }
        }
      }
    }
    if (selected.size !== 0 || cursor !== activity.mutations.length || touched.size > 20)
      return yield* Effect.fail(mismatch());
    let eventCursor = 0;
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.metadata.action !== "updated") return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (expectedEvents[eventCursor++] !== message.name + ":" + id)
          return yield* Effect.fail(mismatch());
    }
    if (eventCursor !== expectedEvents.length) return yield* Effect.fail(mismatch());
  });
}
