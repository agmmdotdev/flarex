import { Result, Schema, type Effect } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { compileFulfillmentLifecycleGraph } from "./fulfillment-graph-contracts";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ServiceZoneDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeServiceZoneDeletionIds = commerceDecoder(ServiceZoneDeletionIds, "invalidInput");
export const decodeServiceZoneDeletionArguments = commerceDecoder(Schema.Tuple([ServiceZoneDeletionIds]), "invalidInput");
export const ServiceZoneDeletionOutput = Schema.Struct({
  service_zone_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 4))),
  geo_zone_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 16))),
  shipping_option_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 8))),
  shipping_option_rule_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 16))),
});
export const decodeServiceZoneDeletionOutput = commerceDecoder(ServiceZoneDeletionOutput, "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function compileServiceZoneDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const graph = yield* compileFulfillmentLifecycleGraph(metadata, "serviceZone");
    return { ...graph, decodeOutput: decodeServiceZoneDeletionOutput, Output: ServiceZoneDeletionOutput };
  });
}
