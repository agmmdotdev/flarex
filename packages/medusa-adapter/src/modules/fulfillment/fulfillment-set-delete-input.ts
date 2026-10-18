import { Result, Schema, type Effect } from "effect";
import { FulfillmentModuleService } from "@medusajs/fulfillment/services";
import { commerceDecoder } from "../../value/decoder";
import { compileFulfillmentLifecycleGraph } from "./fulfillment-graph-contracts";
import type { captureServiceZoneCreationMetadata } from "./shipping-profile-schema";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
export const FulfillmentSetDeletionIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeFulfillmentSetDeletionIds = commerceDecoder(FulfillmentSetDeletionIds, "invalidInput");
export const decodeFulfillmentSetDeletionArguments = commerceDecoder(Schema.Tuple([FulfillmentSetDeletionIds]), "invalidInput");
/** Link preserves all selected physical history IDs, including duplicates.
 * The actual distinct Set forest remains bounded independently. */
const CascadeIds = Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(8),
  Schema.makeFilter(ids => new Set(ids).size <= 4));
const Selector = Schema.Struct({ id: CascadeIds });
const nativeRouting = { __joinerConfig: FulfillmentModuleService.prototype.__joinerConfig(),
  __definition: { key: "fulfillment", defaultPackage: "@medusajs/fulfillment", label: "Fulfillment", isQueryable: true,
    defaultModuleDeclaration: { scope: "internal" as const } } };
const ReturnKeys = Schema.Struct({ returnLinkableKeys: Schema.Array(Schema.String).pipe(Schema.mutable).check(
  Schema.makeFilter(keys => {
    const declared = Object.keys(nativeRouting.__joinerConfig.linkableKeys ?? {});
    return keys.length === declared.length && keys.every((key, index) => key === declared[index]);
  })) });
export const fulfillmentSetDeletionRouting = () => structuredClone(nativeRouting);
const CascadeInput = Schema.Struct({ selector: Selector, config: ReturnKeys });
export const decodeFulfillmentSetLifecycleInput = commerceDecoder(Schema.Union([FulfillmentSetDeletionIds, CascadeInput]), "invalidInput");
export const decodeFulfillmentSetLifecycleArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([FulfillmentSetDeletionIds]), Schema.Tuple([Selector, ReturnKeys]),
]), "invalidInput");
const decodeRepositoryIds = commerceDecoder(Schema.Union([FulfillmentSetDeletionIds, Schema.Tuple([Selector])]), "invalidInput");
export const decodeFulfillmentSetRepositoryIds = (input: unknown) => decodeRepositoryIds(input).pipe(Result.map(value =>
  value.flatMap(item => typeof item === "string" ? [item] : item.id)));
export const decodeFulfillmentSetLifecycleIds = (input: unknown) => decodeFulfillmentSetLifecycleInput(input).pipe(Result.map(value =>
  Array.isArray(value) ? value : value.selector.id));
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
