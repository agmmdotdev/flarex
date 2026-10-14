import { Schema } from "effect";
import { ScalarId, ScalarIdRead } from "../../repository/scalar-id-read";
export const ReservationQuantity = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
export const ReservationCreate = Schema.Struct({
  inventory_item_id: ScalarId, location_id: ScalarId, quantity: ReservationQuantity,
  allow_backorder: Schema.optionalKey(Schema.Boolean),
  line_item_id: Schema.optionalKey(Schema.NullOr(Schema.String)), external_id: Schema.optionalKey(Schema.NullOr(Schema.String)),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)), created_by: Schema.optionalKey(Schema.NullOr(Schema.String)),
  metadata: Schema.optionalKey(Schema.NullOr(Schema.JsonObject)),
});
export const ReservationCreates = Schema.Array(ReservationCreate).check(Schema.isMaxLength(1));
export const ReservationUpdates = Schema.Array(Schema.Struct({ id: ScalarId, quantity: ReservationQuantity })).check(Schema.isMaxLength(1));
export const ReservationIds = Schema.Array(ScalarId).check(Schema.isMaxLength(1));
export const ReservationRead = ScalarIdRead;
export const ReservationOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: ScalarId, inventory_item_id: ScalarId, location_id: ScalarId, quantity: ReservationQuantity,
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(1));
export const Adjustments = Schema.Array(Schema.Struct({ inventoryItemId: ScalarId, locationId: ScalarId,
  adjustment: Schema.Number.check(Schema.isFinite()) })).check(Schema.isMaxLength(4));
