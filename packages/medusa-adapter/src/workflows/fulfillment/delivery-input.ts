import { Effect, Schema } from "effect";
import { bytesEqualFullScan } from "@flarex/utils/bytes";
import { makeTaskInputReferenceV1, decodeTaskInputReferenceV1 } from "@flarex/durable-task/internal/run-creation-v1";
import { canonicalizeFlarexValueV1Effect } from "flarex-protocol/value";
import { capturePrivateJsonData, commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { FulfillmentCreationId } from "../../modules/fulfillment/fulfillment-create-input";

export const fulfillmentDeliveryProfile = "medusa.fulfillment.delivery";
export const fulfillmentDeliveryPolicy = Object.freeze({ nativeLockProvider: "in-memory", lockTimeoutSeconds: 2,
  lockTtlSeconds: 10, maximumItems: 4, maximumLabels: 4, maximumDatabaseOccurrences: 4,
  recovery: "terminal-or-control", checkpointedChildren: 1 });
export const FulfillmentDeliveryInput = Schema.Struct({ id: FulfillmentCreationId });
export type FulfillmentDeliveryInput = typeof FulfillmentDeliveryInput.Type;
const decodeInput = Schema.decodeUnknownEffect(FulfillmentDeliveryInput, { onExcessProperty: "error" });

/** The existing Task body owner stores these canonical bytes; this facade owns
 * only the selected native root input and its immutable content reference. */
export const prepareFulfillmentDeliveryInput = Effect.fn("FulfillmentDelivery.prepareInput")(function* (raw: unknown) {
  const captured = yield* Effect.fromResult(capturePrivateJsonData(raw, 4096, commerceError));
  const value = yield* decodeInput(captured.value).pipe(Effect.mapError(cause => commerceError("invalidInput", cause)));
  const canonical = yield* canonicalizeFlarexValueV1Effect(value);
  const reference = yield* Effect.fromResult(makeTaskInputReferenceV1(canonical.sha256, canonical.canonicalBytes.byteLength));
  return Object.freeze({ value: Object.freeze(value), reference, canonicalBytes: canonical.canonicalBytes });
});

export const verifyFulfillmentDeliveryInput = Effect.fn("FulfillmentDelivery.verifyInput")(function* (raw: unknown, expected: unknown) {
  const reference = yield* Effect.fromResult(decodeTaskInputReferenceV1(expected));
  const prepared = yield* prepareFulfillmentDeliveryInput(raw);
  if (reference.byteLength !== prepared.reference.byteLength || !bytesEqualFullScan(reference.sha256, prepared.reference.sha256))
    return yield* commerceError("requestConflict");
  return prepared.value;
});
