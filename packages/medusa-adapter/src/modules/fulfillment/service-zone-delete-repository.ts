import { Result, type Effect } from "effect";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";
import { prepareFulfillmentLifecycleRepository } from "./fulfillment-lifecycle-repository";
import { compileServiceZoneDeletionContracts, decodeServiceZoneDeletionIds } from "./service-zone-delete-input";

type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function prepareServiceZoneDeletionRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileServiceZoneDeletionContracts(metadata);
    return yield* prepareFulfillmentLifecycleRepository(metadata, contracts, decodeServiceZoneDeletionIds);
  });
}
