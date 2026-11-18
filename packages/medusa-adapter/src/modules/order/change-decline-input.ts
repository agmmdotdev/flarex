import { Result, Schema, type Effect } from "effect";
import { OrderChangeStatus } from "@medusajs/framework/utils/portable";
import { commerceDecoder } from "../../value/decoder";
import { OrderChangeId } from "./change-contracts";
import type { captureOrderMetadata } from "./schema";
import { OrderChangeLifecycleMetadata, compileOrderChangeLifecycleContracts } from "./change-lifecycle-contracts";

export const OrderChangeDeclineInput = Schema.Struct({ id: OrderChangeId,
  declined_by: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(OrderChangeLifecycleMetadata) });
export const OrderChangeDeclinePreimage = Schema.Struct({ id: OrderChangeId,
  status: Schema.Literals([OrderChangeStatus.PENDING, OrderChangeStatus.REQUESTED]),
  declined_at: Schema.NullOr(Schema.String), declined_by: Schema.NullOr(Schema.String),
  metadata: Schema.optionalKey(OrderChangeLifecycleMetadata) });
const Selection = Schema.Struct({ ...OrderChangeDeclinePreimage.fields,
  status: Schema.NullOr(Schema.Literals(Object.values(OrderChangeStatus))) });
export const OrderChangeDeclineFields = Object.freeze(Object.keys(OrderChangeDeclinePreimage.fields));
export const OrderChangeDeclineRead = Schema.Struct({ id: OrderChangeId, config: Schema.Struct({
  select: Schema.Array(Schema.Literals(OrderChangeDeclineFields)).pipe(Schema.mutable).check(Schema.isLengthBetween(4, 5),
    Schema.makeFilter(fields => ["id", "status", "declined_at", "declined_by"].every(field => fields.includes(field)) &&
      new Set(fields).size === fields.length || "Expected decline preimage fields")),
  relations: Schema.Array(Schema.Never).pipe(Schema.mutable),
}) });
export const decodeOrderChangeDeclineInput = commerceDecoder(OrderChangeDeclineInput, "invalidInput");
export const decodeOrderChangeDeclineRead = commerceDecoder(OrderChangeDeclineRead, "invalidInput");
export const decodeOrderChangeDeclinePreimage = commerceDecoder(OrderChangeDeclinePreimage, "invalidInput");
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

export function compileOrderChangeDeclineContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileOrderChangeLifecycleContracts(metadata, commerceDecoder(Selection, "storedCorruption"));
    const shape = commerceDecoder(OrderChangeDeclinePreimage, "storedCorruption");
    const decodePreimage = (input: unknown) => shape(input).pipe(
      Result.flatMap(value => contracts.projection(value).pipe(Result.map(() => value))));
    return { ...contracts, Preimage: OrderChangeDeclinePreimage, decodePreimage };
  });
}
