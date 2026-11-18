import type { Result } from "effect";
import { fulfillmentLifecyclePolicy } from "./fulfillment-lifecycle-receipt";
import { decodeFulfillmentSetLifecycleIds, type compileFulfillmentSetDeletionContracts } from "./fulfillment-set-delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileFulfillmentSetDeletionContracts>>;

export function fulfillmentSetDeletionPolicy(contracts: Contracts) {
  return fulfillmentLifecyclePolicy(contracts, { softDelete: "fulfillmentSetSoftDeleteForWorkflow",
    restore: "fulfillmentSetRestoreForWorkflow", decodeIds: decodeFulfillmentSetLifecycleIds });
}
