import { Schema } from "effect";
import { ScalarId } from "../../repository/scalar-id-read";

const Quantity = Schema.Number.check(Schema.isFinite());
export const InventoryLevelInput = Schema.Struct({
  inventory_item_id: ScalarId, location_id: ScalarId,
  stocked_quantity: Schema.optionalKey(Quantity), incoming_quantity: Schema.optionalKey(Quantity),
});
export const InventoryLevelsInput = Schema.Array(InventoryLevelInput).check(Schema.isMaxLength(8));
export const InventoryLevelsOutput = Schema.Array(Schema.StructWithRest(Schema.Struct({
  id: ScalarId, inventory_item_id: ScalarId, location_id: ScalarId,
  stocked_quantity: Quantity, incoming_quantity: Quantity, reserved_quantity: Quantity, available_quantity: Quantity,
}), [Schema.Record(Schema.String, Schema.Json)])).check(Schema.isMaxLength(8));
