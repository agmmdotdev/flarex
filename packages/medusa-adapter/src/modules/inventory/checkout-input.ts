import { Result, Schema } from "effect";
import { MathBN } from "@medusajs/framework/utils/portable";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { ScalarId } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { captureNativeNumericComparisonResult } from "../../value/exact-numeric";
import { captureNativeNumericDto } from "../../value/native-numeric";

const Quantity = Schema.String;
export const CheckoutReservations = Schema.Array(Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId,
  line_item_id: ScalarId, quantity: Quantity, allow_backorder: Schema.Boolean })).check(Schema.isMaxLength(4));
export const CheckoutReservationIds = Schema.Array(ScalarId).check(Schema.isMaxLength(4));
const decodeRows = commerceDecoder(CheckoutReservations, "invalidInput");
export const decodeCheckoutReservationIds = commerceDecoder(CheckoutReservationIds, "invalidInput");
export const decodeCheckoutReservationArguments = commerceDecoder(Schema.Tuple([CheckoutReservations]), "invalidInput");
export const decodeCheckoutReservationIdArguments = commerceDecoder(Schema.Tuple([CheckoutReservationIds]), "invalidInput");
export const decodeCheckoutReservations = (input: unknown) => Result.gen(function* () {
  const rows = yield* decodeRows(input);
  for (const row of rows) {
    const value = yield* captureNativeNumericComparisonResult(row.quantity);
    if (MathBN.lt(value, 0)) return yield* Result.fail(commerceError("invalidInput"));
  }
  return rows;
});

/** The genuine reserve step supplies MathBN products. The existing inert native
 * numeric owner snapshots them before the strict JSON command boundary. */
export const normalizeCheckoutReservationArguments = (input: unknown) =>
  captureNativeNumericDto(input).pipe(Result.flatMap(decodeCheckoutReservationArguments));

export const CheckoutReservationOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({ id: ScalarId,
  line_item_id: ScalarId, inventory_item_id: ScalarId, location_id: ScalarId,
  quantity: Schema.Finite, allow_backorder: Schema.Boolean,
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(4));
export const decodeCheckoutReservationOutput = commerceDecoder(CheckoutReservationOutput, "storedCorruption");
