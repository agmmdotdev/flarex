import { Result, Schema, type Effect } from "effect";
import { PriceListPriceCreationWorkflowInput, PriceListPriceRemovalIds, compilePriceListPriceCreationContracts } from "./price-list-price-input";
import { PriceListPriceUpdateWorkflowInput, compilePriceListPriceUpdateContracts } from "./price-list-price-update-input";
import type { capturePricingMetadata } from "./schema";

const CreationEntry = PriceListPriceCreationWorkflowInput.fields.data.value;
const UpdatePrice = PriceListPriceUpdateWorkflowInput.fields.data.value.fields.prices.value;
/** The native parent requires update IDs. The standalone update child's
 * optional-ID extension does not widen this parent's contract. */
export const PriceListPriceBatchWorkflowInput = Schema.Struct({ data: Schema.Struct({
  id: CreationEntry.fields.id,
  create: CreationEntry.fields.prices,
  update: Schema.Array(Schema.Struct({ ...UpdatePrice.fields, id: CreationEntry.fields.id })).check(Schema.isMaxLength(2)),
  delete: PriceListPriceRemovalIds,
}) });

/** Child DML/output decoders retain complete native rows. Named slots retain
 * values and identities without imposing reference aliases between children. */
export function compilePriceListPriceBatchContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const creation = yield* compilePriceListPriceCreationContracts(metadata);
    const update = yield* compilePriceListPriceUpdateContracts(metadata);
    return { Output: Schema.Struct({
      created: creation.Output.check(Schema.isMaxLength(2)),
      updated: update.Output.check(Schema.isMaxLength(2)),
      deleted: PriceListPriceRemovalIds,
    }) };
  });
}
