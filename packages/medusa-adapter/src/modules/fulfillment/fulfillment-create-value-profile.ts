import { type Json, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { Effect, Result, Schema } from "effect";
import { trimZeros } from "@medusajs/utils/common/trim-zeros";
import { assignNativeJsonObject, supportsNativeJsonObjectAssignment } from "@medusajs/utils/dal/json-assignment";
import { captureExactNumericRow, ExactNumericRaw } from "../../value/exact-numeric";
import { commerceDecoder } from "../../value/decoder";

const decodeRaw = commerceDecoder(ExactNumericRaw, "storedCorruption");
/** Native MikroOrmBigNumberProperty retains precision and removes trailing
 * zeroes from the raw companion. Other module profiles keep their encoding. */
export const captureFulfillmentItemQuantity = Effect.fn("FulfillmentCreation.captureItemQuantity")(function* (input: unknown) {
  const row = yield* captureExactNumericRow(input, [{ name: "quantity" }]);
  const raw = yield* Effect.fromResult(decodeRaw(row.raw_quantity));
  return { ...row, raw_quantity: { ...raw, value: trimZeros(raw.value) } };
});

export const FulfillmentAssignmentJson = Schema.NullOr(Schema.JsonObject).check(Schema.makeFilter(value =>
  supportsNativeJsonObjectAssignment(value) || "Unsupported native JSON assignment key"));
export const decodeFulfillmentAssignmentPrior = commerceDecoder(FulfillmentAssignmentJson, "unsupportedProfile");
const decodePatch = commerceDecoder(FulfillmentAssignmentJson, "invalidInput"), decodeAssigned = commerceDecoder(FulfillmentAssignmentJson, "storedCorruption");

/** Creation's genuine Manual data:{} and standalone updates share the actual
 * native mergeObjectProperties assignment owner. Constructor keys retain its
 * replace-or-merge decision; unsafe foreign merge inputs fail before the call. */
export function assignFulfillmentJson(before: Json | undefined, update: JsonObject | null) {
  return Result.gen(function* () {
    const current = yield* decodeFulfillmentAssignmentPrior(before ?? null), supplied = yield* decodePatch(update);
    return yield* decodeAssigned(assignNativeJsonObject(current, supplied));
  });
}
