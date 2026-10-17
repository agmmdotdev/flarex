import { Result, Schema, type Effect } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { compileFulfillmentLifecycleGraph } from "./fulfillment-graph-contracts";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const FulfillmentSetDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeFulfillmentSetDeletionIds = commerceDecoder(FulfillmentSetDeletionIds, "invalidInput");
export const decodeFulfillmentSetDeletionArguments = commerceDecoder(Schema.Tuple([FulfillmentSetDeletionIds]), "invalidInput");
export const FulfillmentSetDeletionOutput = Schema.Struct({
  fulfillment_set_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 4))),
  service_zone_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 4))),
  geo_zone_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 16))),
  shipping_option_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 8))),
  shipping_option_rule_id: Schema.optionalKey(Schema.Array(Id).check(Schema.isLengthBetween(1, 16))),
});
export const decodeFulfillmentSetDeletionOutput = commerceDecoder(FulfillmentSetDeletionOutput, "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function compileFulfillmentSetDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const graph = yield* compileFulfillmentLifecycleGraph(metadata, "fulfillmentSet");
    return { ...graph, decodeOutput: decodeFulfillmentSetDeletionOutput, Output: FulfillmentSetDeletionOutput };
  });
}
