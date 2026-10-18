import { isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { Effect } from "effect";
import { trimZeros } from "@medusajs/utils/common/trim-zeros";
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

/** Selected genuine Manual returns exactly data:{}. Native MikroORM DAL uses
 * manager.assign(...,{mergeObjectProperties:true}); EntityAssigner retains a
 * prior plain JSON object for that empty patch, otherwise assigns {}. This
 * finite translation makes no claim about arbitrary provider JSON patches. */
export function selectedManualDataAssignment(prior: JsonObject): JsonObject {
  const data = prior.data ?? null;
  return isJsonObject(data) ? data : {};
}
