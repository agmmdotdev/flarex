import { Result, Schema, type Effect } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { compileFulfillmentLifecycleGraph } from "./fulfillment-graph-contracts";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
/** Raw requests retain missing and repeated identities. The historical closure
 * is checked independently before any lifecycle mutation. */
export const ShippingOptionDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeShippingOptionDeletionIds = commerceDecoder(ShippingOptionDeletionIds, "invalidInput");
export const decodeShippingOptionDeletionArguments = commerceDecoder(Schema.Tuple([ShippingOptionDeletionIds]), "invalidInput");
export const ShippingOptionDeletionOutput = Schema.Struct({
  shipping_option_id: Schema.optionalKey(Schema.Array(Id).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 4))),
  shipping_option_rule_id: Schema.optionalKey(Schema.Array(Id).pipe(Schema.mutable).check(Schema.isLengthBetween(1, 16))),
});
export const decodeShippingOptionDeletionOutput = commerceDecoder(ShippingOptionDeletionOutput, "storedCorruption");
type Metadata = Effect.Success<ReturnType<typeof captureServiceZoneCreationMetadata>>["frame"];

export function compileShippingOptionDeletionContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const graph = yield* compileFulfillmentLifecycleGraph(metadata, "shippingOption");
    return { ...graph, decodeOutput: decodeShippingOptionDeletionOutput, Output: ShippingOptionDeletionOutput };
  });
}
