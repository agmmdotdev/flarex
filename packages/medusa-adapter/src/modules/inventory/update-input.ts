import { Schema } from "effect";

import { commerceDecoder } from "../../value/decoder";
import { InventoryItemRows } from "./item-contracts";
import { InventoryId, InventoryItemInput } from "./item-input";

/** Raw duplicates remain native service input; they still consume the bound. */
export const InventoryItemUpdate = Schema.Struct({ ...InventoryItemInput.fields, id: InventoryId });
export const InventoryItemUpdates = Schema.Array(InventoryItemUpdate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const InventoryItemUpdateCommandInput = Schema.Union([InventoryItemUpdate, InventoryItemUpdates]);
export const InventoryItemUpdateInput = Schema.Struct({ updates: InventoryItemUpdates });
export const InventoryItemUpdateReadInput = Schema.Struct({ filters: Schema.Struct({ id: Schema.Array(InventoryId).check(Schema.isMaxLength(4)) }), config: Schema.Struct({}) });
export const InventoryItemUpdateOutput = InventoryItemRows;
export const decodeInventoryItemUpdates = commerceDecoder(InventoryItemUpdates, "invalidInput");
export const decodeInventoryItemUpdateCommandInput = commerceDecoder(InventoryItemUpdateCommandInput, "invalidInput");
export const decodeInventoryItemUpdateReadInput = commerceDecoder(InventoryItemUpdateReadInput, "invalidInput");
