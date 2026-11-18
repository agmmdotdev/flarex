import type { Result } from "effect";
import { fulfillmentLifecyclePolicy } from "./fulfillment-lifecycle-receipt";
import { decodeServiceZoneDeletionIds, type compileServiceZoneDeletionContracts } from "./service-zone-delete-input";

type Contracts = Result.Result.Success<ReturnType<typeof compileServiceZoneDeletionContracts>>;

export function serviceZoneDeletionPolicy(contracts: Contracts) {
  return fulfillmentLifecyclePolicy(contracts, { softDelete: "serviceZoneSoftDeleteForWorkflow",
    restore: "serviceZoneRestoreForWorkflow", decodeIds: decodeServiceZoneDeletionIds });
}
