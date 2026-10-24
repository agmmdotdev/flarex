import { Result, Schema, type Effect } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { OrderChangeId } from "./change-contracts";
import { OrderChangeLifecycleMetadata } from "./change-lifecycle-contracts";
import { prepareOrderChangeLifecycleRepository } from "./change-lifecycle-repository";
import { compileOrderChangeCancellationContracts } from "./change-cancellation-input";
import type { captureOrderMetadata } from "./schema";

const fields = ["id", "status", "canceled_at", "canceled_by", "metadata", "order_id", "return_id", "claim_id", "exchange_id", "version"];
const patch = Schema.Struct({ id: OrderChangeId, status: Schema.Literals(["pending", "requested", "canceled"]),
  canceled_at: Schema.NullOr(Schema.String), canceled_by: Schema.optionalKey(Schema.NullOr(Schema.String)),
  metadata: Schema.optionalKey(OrderChangeLifecycleMetadata) });
const decodePairs = commerceDecoder(Schema.Array(Schema.Struct({ entity: Schema.JsonObject, update: patch }))
  .check(Schema.isLengthBetween(1, 1)), "unsupportedProfile");
type Metadata = Effect.Success<ReturnType<typeof captureOrderMetadata>>["frame"];

/** The cancellation profile owns its fields and forward/inverse patch domain.
 * Existing-row capture, native metadata correlation and writes have one owner. */
export function prepareOrderChangeCancellationRepository(metadata: Metadata) {
  return Result.gen(function* () {
    const contracts = yield* compileOrderChangeCancellationContracts(metadata);
    return yield* prepareOrderChangeLifecycleRepository(contracts, {
      fields, businessDate: "canceled_at", decodePairs,
      acceptsPatch: (update, replace) => replace
        ? update.status !== "canceled" && update.canceled_by !== undefined
        : update.status === "canceled" && update.canceled_at !== null,
    });
  });
}
