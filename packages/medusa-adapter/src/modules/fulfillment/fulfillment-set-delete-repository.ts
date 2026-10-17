import { Result, type Effect } from "effect";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareFulfillmentLifecycleRepository } from "./fulfillment-lifecycle-repository";
import { compileFulfillmentSetDeletionContracts, decodeFulfillmentSetDeletionIds } from "./fulfillment-set-delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function prepareFulfillmentSetDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileFulfillmentSetDeletionContracts(metadata);
    return yield* prepareFulfillmentLifecycleRepository(metadata, contracts, decodeFulfillmentSetDeletionIds);
  });
}
