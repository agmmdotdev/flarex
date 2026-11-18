import { Result, type Effect } from "effect";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareFulfillmentLifecycleRepository } from "./fulfillment-lifecycle-repository";
import { compileShippingOptionDeletionContracts, decodeShippingOptionDeletionIds } from "./shipping-option-delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];
export function prepareShippingOptionDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileShippingOptionDeletionContracts(metadata);
    return yield* prepareFulfillmentLifecycleRepository(metadata, contracts, decodeShippingOptionDeletionIds);
  });
}
