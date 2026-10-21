import { Effect, Result } from "effect";
import { buildQuery } from "@medusajs/utils/modules-sdk/build-query";
import { MathBN } from "@medusajs/framework/utils/portable";
import { inventoryLevelsAvailableQuantity } from "@medusajs/inventory/inventory-level-availability";
import { jsonEqual } from "flarex-protocol/json";
import { commerceError, defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { orderNativeIdRows, projectNativeRow } from "../../repository/result";
import { commerceRelationReadQuery } from "../../query/relations";
import { captureCommerceInput } from "../../value/input";
import { decodeInventoryConfirmation, type InventoryConfirmationContracts } from "./confirmation-input";
import { inventoryConfirmationLevelPredicate, type prepareInventoryConfirmationRepository } from "./confirmation-repository";

type LevelRow = Effect.Success<ReturnType<InventoryConfirmationContracts["levelContracts"]["decodeStoredRow"]>>;

/** The workflow wrapper authenticates the command token. Exact call-local read
 * queries and complete selected cohorts bind the native boolean to its Item,
 * Locations and raw quantity companions without reconstructing native math. */
export function inventoryConfirmationPolicy(contracts: InventoryConfirmationContracts,
  query: Result.Result.Success<ReturnType<typeof prepareInventoryConfirmationRepository>>["query"]) {
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("Inventory.validateConfirmation")(function* (call, activity) {
    if (call.commandName !== "inventoryConfirmForWorkflow" || call.mode !== "read" || call.events.length ||
      activity.mutations.length || activity.lifecycle.length || activity.setNull.length || activity.referenceReplacements.length)
      return yield* Effect.fail(commerceError("receiptMismatch"));
    const input = yield* Effect.fromResult(decodeInventoryConfirmation(call.input))
      .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
    const levels: LevelRow[] = [];
    if (input.location_ids.length === 0) {
      // The real native module returns zero before looking up even the Item.
      if (activity.observedRows.length || activity.relationalReads.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
    } else {
      if (activity.relationalReads.length !== 2) return yield* Effect.fail(commerceError("receiptMismatch"));
      const itemPlan = yield* Effect.fromResult(captureCommerceInput(buildQuery({ id: input.inventory_item_id }, { select: ["id"] }))
        .pipe(Result.flatMap(query))).pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
      if (!jsonEqual(activity.relationalReads[0] ?? null, { table: contracts.item.name,
        query: commerceRelationReadQuery(defaultCommerceResources, itemPlan.query.predicate, "id"), total: 1, returned: 1 }))
        return yield* Effect.fail(commerceError("receiptMismatch"));
      let itemCount = 0;
      for (const observation of activity.observedRows) {
        if (observation.table === contracts.item.name) {
          const item = yield* Effect.fromResult(contracts.itemContracts.decodeRow(projectNativeRow(observation.row)))
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (item.id !== input.inventory_item_id || item.deleted_at !== null) return yield* Effect.fail(commerceError("receiptMismatch"));
          itemCount++;
        } else if (observation.table === contracts.level.name) {
          const row = yield* contracts.levelContracts.decodeStoredRow(projectNativeRow(observation.row))
            .pipe(Effect.mapError(cause => commerceError("receiptMismatch", cause)));
          if (row.inventory_item_id !== input.inventory_item_id || !input.location_ids.includes(row.location_id) || row.deleted_at !== null)
            return yield* Effect.fail(commerceError("receiptMismatch"));
          levels.push(row);
        } else return yield* Effect.fail(commerceError("receiptMismatch"));
      }
      if (itemCount !== 1 || levels.length > 16 || new Set(levels.map(row => row.id)).size !== levels.length)
        return yield* Effect.fail(commerceError("receiptMismatch"));
      const identities = orderNativeIdRows(levels, {}).map(row => ({ id: row.id }));
      const actual = activity.relationalReads[1];
      if (!actual || !jsonEqual(actual, { table: contracts.level.name,
        query: commerceRelationReadQuery(defaultCommerceResources,
          inventoryConfirmationLevelPredicate(input.inventory_item_id, input.location_ids), "id", { includeIdentities: true }),
        total: levels.length, returned: levels.length, orderedIdentities: identities }))
        return yield* Effect.fail(commerceError("receiptMismatch"));
    }
    const expected = yield* Effect.try({ try: () => MathBN.gte(inventoryLevelsAvailableQuantity(levels), input.quantity),
      catch: cause => commerceError("receiptMismatch", cause) });
    if (call.result !== expected) return yield* Effect.fail(commerceError("receiptMismatch"));
  });
  return { capture: () => Effect.fail(commerceError("unadmittedEvent")), validateLogicalCall };
}
