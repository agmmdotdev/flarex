import { Schema } from "effect";
import { commerceDecoder } from "../../value/decoder";
import { ScalarId } from "../../repository/scalar-id-read";
import { QueryLimit } from "../../query/decoder";
import { InventoryDeletionConfig } from "./deletion-lifecycle";

/** The workflow returns these raw IDs, including duplicates and missing IDs. */
export const InventoryItemDeletionInput = Schema.Array(ScalarId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const InventoryItemDeletionCommandInput = Schema.Struct({ selector: InventoryItemDeletionInput, config: InventoryDeletionConfig });
export const InventoryItemDeletionArguments = Schema.Union([Schema.Tuple([InventoryItemDeletionInput]),
  Schema.Tuple([InventoryItemDeletionInput, InventoryDeletionConfig])]);
export const InventoryItemDeletionOutput = Schema.Struct({
  inventory_item_id: Schema.optionalKey(Schema.Array(ScalarId).check(Schema.isMaxLength(4))),
  inventory_level_id: Schema.optionalKey(Schema.Array(ScalarId).check(Schema.isMaxLength(8))),
  reservation_item_id: Schema.optionalKey(Schema.Array(ScalarId).check(Schema.isMaxLength(4))),
});
export const InventoryItemDeletionReadInput = Schema.Struct({ filters: Schema.Struct({ id: Schema.Union([ScalarId, InventoryItemDeletionInput]) }),
  config: Schema.Struct({ select: Schema.Array(Schema.Literals(["id", "reserved_quantity"])).check(Schema.isLengthBetween(2, 2),
    Schema.makeFilter(fields => new Set(fields).size === 2 ? undefined : "Expected both Item guard fields")),
    relations: Schema.optionalKey(Schema.Array(Schema.Never)), take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(Schema.Literal(0)),
    order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })) }) });
export const decodeInventoryItemDeletionInput = commerceDecoder(InventoryItemDeletionInput, "invalidInput");
export const decodeInventoryItemDeletionCommandInput = commerceDecoder(InventoryItemDeletionCommandInput, "invalidInput");
export const decodeInventoryItemDeletionArguments = commerceDecoder(InventoryItemDeletionArguments, "unsupportedProfile");
export const decodeInventoryItemDeletionReadInput = commerceDecoder(InventoryItemDeletionReadInput, "unsupportedProfile");
export const decodeInventoryItemDeletionResult = commerceDecoder(InventoryItemDeletionOutput, "storedCorruption");
