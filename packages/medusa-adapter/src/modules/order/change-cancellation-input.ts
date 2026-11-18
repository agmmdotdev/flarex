import { Result, Schema, type Effect } from "effect";
import { OrderChangeStatus } from "@medusajs/framework/utils/portable";
import { commerceDecoder } from "../../value/decoder";
import { OrderChangeId } from "./change-contracts";
import type { captureOrderMetadata } from "./schema";
import { OrderChangeLifecycleMetadata, compileOrderChangeLifecycleContracts } from "./change-lifecycle-contracts";

export const OrderChangeCancellationInput = Schema.Struct({ id: OrderChangeId,
  canceled_by: Schema.optionalKey(Schema.String), metadata: Schema.optionalKey(OrderChangeLifecycleMetadata) });
export const OrderChangeCancellationPreimage = Schema.Struct({ id: OrderChangeId,
  status: Schema.Literals([OrderChangeStatus.PENDING, OrderChangeStatus.REQUESTED]),
  canceled_at: Schema.NullOr(Schema.String), canceled_by: Schema.NullOr(Schema.String),
  metadata: Schema.optionalKey(OrderChangeLifecycleMetadata) });
const Selection = Schema.Struct({ ...OrderChangeCancellationPreimage.fields,
  status: Schema.NullOr(Schema.Literals(Object.values(OrderChangeStatus))) });
export const OrderChangeCancellationFields = Object.freeze(Object.keys(OrderChangeCancellationPreimage.fields));
export const OrderChangeCancellationRead = Schema.Struct({ id: OrderChangeId, config: Schema.Struct({
  select: Schema.Array(Schema.Literals(OrderChangeCancellationFields)).pipe(Schema.mutable).check(Schema.isLengthBetween(4, 5),
    Schema.makeFilter(fields => ["id", "status", "canceled_at", "canceled_by"].every(field => fields.includes(field)) &&
      new Set(fields).size === fields.length || "Expected cancellation preimage fields")),
  relations: Schema.Array(Schema.Never).pipe(Schema.mutable),
}) });
export const decodeOrderChangeCancellationInput = commerceDecoder(OrderChangeCancellationInput, "invalidInput");
export const decodeOrderChangeCancellationRead = commerceDecoder(OrderChangeCancellationRead, "invalidInput");
export const decodeOrderChangeCancellationPreimage = commerceDecoder(OrderChangeCancellationPreimage, "invalidInput");
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

export function compileOrderChangeCancellationContracts(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileOrderChangeLifecycleContracts(metadata, commerceDecoder(Selection, "storedCorruption"));
    const shape = commerceDecoder(OrderChangeCancellationPreimage, "storedCorruption");
    const decodePreimage = (input: unknown) => shape(input).pipe(
      Result.flatMap(value => contracts.projection(value).pipe(Result.map(() => value))));
    return { ...contracts, Preimage: OrderChangeCancellationPreimage, decodePreimage };
  });
}
