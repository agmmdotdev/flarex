import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { InventoryId, InventoryItemInput } from "./item-input";

export const InventoryItemCreates = Schema.Array(InventoryItemInput).check(Schema.isMaxLength(4));
export const InventoryItemPhysicalDeletionIds = Schema.Array(InventoryId).check(Schema.isMaxLength(4));
export const decodeInventoryItemCreates = commerceDecoder(InventoryItemCreates, "invalidInput");
export const decodeInventoryItemPhysicalDeletionIds = commerceDecoder(InventoryItemPhysicalDeletionIds, "invalidInput");
export const decodeInventoryItemPhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: InventoryId })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");
