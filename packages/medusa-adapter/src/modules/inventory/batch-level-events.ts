import { Effect, Result } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { captureInventoryLevelEvent } from "./level-events";
import type { LogicalCallReceiptValidation } from "../../repository/call-receipt";
import { compileInventoryLevelContracts } from "./level-contracts";
import { inventoryLevelCreationEventPolicy } from "./level-creation-events";
import { inventoryLevelUpdateEventPolicy } from "./update-level-events";
import { inventoryLevelDeletionEventPolicy } from "./delete-level-events";

type Contracts = Result.Result.Success<ReturnType<typeof compileInventoryLevelContracts>>;
/** One Level participant composes the established command-specific receipts.
 * The retained physical inverse authenticates removals rather than accepting a
 * void result as evidence, and never grants Item or quantity mutation. */
export function inventoryLevelBatchEventPolicy(contracts: Contracts) {
  const creation = inventoryLevelCreationEventPolicy(contracts), update = inventoryLevelUpdateEventPolicy(contracts),
    managed = inventoryLevelDeletionEventPolicy(contracts);
  const capture = captureInventoryLevelEvent;
  const validateLogicalCall: LogicalCallReceiptValidation = Effect.fn("InventoryLevelBatch.validateCall")(function* (call, activity) {
    const mismatch = () => commerceError("receiptMismatch");
    switch (call.commandName) {
      case "inventoryLevelListForUpdate":
      case "inventoryLevelUpdateForWorkflow":
        return yield* update.validateLogicalCall(call, activity);
      case "inventoryLevelCountForDeletion":
      case "inventoryLevelSoftDeleteForWorkflow":
      case "inventoryLevelRestoreForWorkflow":
        return yield* managed.validateLogicalCall(call, activity);
      case "inventoryCreateLevels":
      case "inventoryLevelPhysicalDeleteForWorkflow":
        return yield* creation.validateLogicalCall(call, activity);
      default:
        return yield* Effect.fail(mismatch());
    }
  });
  return { capture, validateLogicalCall };
}
