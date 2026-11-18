import { Schema } from "effect";
import { ScalarId } from "../../repository/scalar-id-read";
import { commerceDecoder } from "../../value/decoder";
import { InventoryLevelRows } from "./level-contracts";

const Quantity = Schema.Number.check(Schema.isFinite());
export const InventoryLevelUpdate = Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId,
  id: Schema.optionalKey(ScalarId), stocked_quantity: Schema.optionalKey(Quantity), incoming_quantity: Schema.optionalKey(Quantity) });
export const InventoryLevelUpdates = Schema.Array(InventoryLevelUpdate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const InventoryLevelUpdateCommandInput = Schema.Union([InventoryLevelUpdate, InventoryLevelUpdates]);
export const InventoryLevelUpdateInput = Schema.Struct({ updates: InventoryLevelUpdates });
const Tuple = Schema.Struct({ inventory_item_id: ScalarId, location_id: ScalarId });
export const InventoryLevelUpdateReadInput = Schema.Struct({ filters: Schema.Struct({
  $or: Schema.Array(Tuple).pipe(Schema.mutable).check(Schema.isMaxLength(4)),
}), config: Schema.Struct({}) });
export const InventoryLevelUpdateOutput = InventoryLevelRows;
export const decodeInventoryLevelUpdates = commerceDecoder(InventoryLevelUpdates, "invalidInput");
export const decodeInventoryLevelUpdateCommandInput = commerceDecoder(InventoryLevelUpdateCommandInput, "invalidInput");
export const decodeInventoryLevelUpdateReadInput = commerceDecoder(InventoryLevelUpdateReadInput, "invalidInput");
