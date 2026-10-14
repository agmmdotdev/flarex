import type { LogicalCallReceiptValidation } from "../../../repository/call-receipt";
import { Effect, Schema } from "effect";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import { CommonEvents } from "@medusajs/framework/utils/portable";
import type { ProductRuntimeMetadata } from "../runtime-metadata";
import { ProductRelationshipResultRows } from "../relationship-workflow-input";
import { ProductRelationshipUpsertRows } from "../value-profile";
import { productModuleEventCapture } from "./capture";

/** Read only the two module-local Product memberships declared by pinned DML. */
export const productMembershipPivots = Effect.fn("ProductEvents.membershipPivots")(function* (catalog: ProductRuntimeMetadata) {
  const pivots: Array<{ readonly table: string; readonly productColumn: string; readonly targetColumn: string }> = [];
  for (const name of ["tags", "categories"] as const) {
    const relation = catalog.queryRelations.get(catalog.product.table.name)?.get(name);
    const join = relation?.join;
    if (join?.type !== "manyToMany") return yield* Effect.fail(commerceError("unsupportedProfile"));
    const table = join.pivotTable;
    if (join.sourceColumns.length !== 1 || join.targetColumns.length !== 1 ||
      !catalog.writablePivots.some(pivot => pivot.name === table) || table === catalog.pivot.table.name)
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    const productColumn = join.sourceColumns[0];
    const targetColumn = join.targetColumns[0];
    if (productColumn === undefined || targetColumn === undefined || pivots.some(pivot => pivot.table === table))
      return yield* Effect.fail(commerceError("unsupportedProfile"));
    pivots.push({ table, productColumn, targetColumn });
  }
  return pivots;
});

export const validateProductMembershipRows = Effect.fn("ProductEvents.validateMembershipRows")(function* (
  pivots: Effect.Success<ReturnType<typeof productMembershipPivots>>,
  rows: ReadonlyMap<string, readonly JsonObject[]>, products: ReadonlyMap<string, JsonObject>,
) {
  for (const pivot of pivots) {
    const identities = new Set<string>();
    for (const row of rows.get(pivot.table) ?? []) {
      const product = row[pivot.productColumn], target = row[pivot.targetColumn];
      const identity = JSON.stringify([product, target]);
      if (typeof product !== "string" || !products.has(product) || typeof target !== "string" ||
        identities.has(identity)) return yield* Effect.fail(commerceError("receiptMismatch"));
      identities.add(identity);
    }
  }
});

export function productRelationshipCallReceipt(catalog: ProductRuntimeMetadata): LogicalCallReceiptValidation {
  const input = Schema.decodeUnknownEffect(ProductRelationshipUpsertRows, { onExcessProperty: "error" });
  const output = Schema.decodeUnknownEffect(ProductRelationshipResultRows, { onExcessProperty: "error" });
  const capture = productModuleEventCapture(catalog, defaultCommerceResources);
  return Effect.fn("ProductEvents.validateRelationshipCall")(function* (call, activity) {
    const requested = yield* input(call.input).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const returned = yield* output(call.result).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const desired = new Map(requested.map(row => [row.id, new Set(row.category_ids)]));
    const resultIds = new Set(returned.map(row => row.id));
    const pivot = (yield* productMembershipPivots(catalog))[1];
    const mismatch = () => commerceError("receiptMismatch");
    if (pivot === undefined || desired.size !== requested.length || resultIds.size !== returned.length ||
      resultIds.size !== desired.size || [...resultIds].some(id => !desired.has(id))) return yield* Effect.fail(mismatch());
    const changed = new Set<string>(), pairs = new Set<string>();
    for (const mutation of activity.mutations) {
      const before = mutation.before, after = mutation.after;
      if (mutation.table === catalog.product.table.name) {
        if ((mutation.operation !== "patch" && mutation.operation !== "replace") || before === null || after === null ||
          typeof before.id !== "string" || before.id !== after.id || before.deleted_at !== null ||
          !desired.has(before.id) || changed.has(before.id)) return yield* Effect.fail(mismatch());
        for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (key === "updated_at") continue;
          if (before[key] === undefined || after[key] === undefined || !jsonEqual(before[key], after[key]))
            return yield* Effect.fail(mismatch());
        }
        changed.add(before.id);
      } else {
        const insert = mutation.operation === "insert" && before === null && after !== null;
        const remove = mutation.operation === "delete" && before !== null && after === null;
        const row = insert ? after : before;
        const product = row?.[pivot.productColumn], category = row?.[pivot.targetColumn];
        const selected = typeof product === "string" ? desired.get(product) : undefined;
        const pair = JSON.stringify([product, category]);
        if (mutation.table !== pivot.table || (!insert && !remove) || selected === undefined || typeof category !== "string" ||
          pairs.has(pair) || selected.has(category) !== insert) return yield* Effect.fail(mismatch());
        pairs.add(pair);
      }
    }
    if (changed.size !== desired.size) return yield* Effect.fail(mismatch());
    const actual = new Map([...desired.keys()].map(id => [id, new Set<string>()]));
    for (const observation of activity.observedRows) {
      if (observation.table !== pivot.table) continue;
      const product = observation.row[pivot.productColumn], category = observation.row[pivot.targetColumn];
      const selected = typeof product === "string" ? actual.get(product) : undefined;
      if (selected === undefined) continue;
      if (typeof category !== "string" || selected.has(category)) return yield* Effect.fail(mismatch());
      selected.add(category);
    }
    for (const [id, selected] of desired) {
      const observed = actual.get(id);
      if (observed?.size !== selected.size || [...selected].some(category => !observed.has(category))) return yield* Effect.fail(mismatch());
    }
    for (const event of call.events) {
      const message = yield* capture(event);
      if (message.name !== catalog.product.updatedEvent || message.metadata.action !== CommonEvents.UPDATED)
        return yield* Effect.fail(mismatch());
      for (const id of Array.isArray(message.data.id) ? message.data.id : [message.data.id])
        if (!changed.delete(id)) return yield* Effect.fail(mismatch());
    }
    if (changed.size !== 0) return yield* Effect.fail(mismatch());
  });
}
