import type { Result } from "effect";
import { fulfillmentLifecyclePolicy } from "./fulfillment-lifecycle-receipt";
import { decodeShippingOptionDeletionIds, type compileShippingOptionDeletionContracts } from "./shipping-option-delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileShippingOptionDeletionContracts>>;
export function shippingOptionDeletionPolicy(contracts: Contracts) {
  return fulfillmentLifecyclePolicy(contracts, { softDelete: "shippingOptionSoftDeleteForWorkflow",
    restore: "shippingOptionRestoreForWorkflow", decodeIds: decodeShippingOptionDeletionIds });
}
