import { Schema } from "effect";
import { ScalarId } from "../../repository/scalar-id-read";
import { QueryLimit } from "../../query/decoder";

const Ids = Schema.Array(ScalarId).check(Schema.isMaxLength(8));
const Member = Schema.Union([ScalarId, Ids]);
const Config = Schema.optionalKey(Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.Never)),
  take: Schema.optionalKey(QueryLimit), skip: Schema.optionalKey(Schema.Literal(0)),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literal("ASC")) })),
}));

/** Independent native graph reads retain the existing complete cohort bounds;
 * relationship assembly remains with the authenticated graph owner. */
export const InventoryVariantPriceCalculationItemRead = Schema.Struct({
  filters: Schema.Struct({ id: Member }), config: Config,
});
export const InventoryVariantPriceCalculationLevelRead = Schema.Struct({
  filters: Schema.Struct({ id: Schema.optionalKey(Member), inventory_item_id: Schema.optionalKey(Member) })
    .check(Schema.makeFilter(filters => filters.id !== undefined || filters.inventory_item_id !== undefined)),
  config: Config,
});

/** The native quantity serializer owns available_quantity. Its computed field
 * is selected from the real stocked/reserved pair, never from stored columns. */
export function inventoryVariantPriceCalculationLevelConfig(config: typeof InventoryVariantPriceCalculationLevelRead.Type["config"]) {
  if (config?.select?.includes("available_quantity") !== true) return config;
  return { ...config, select: [...new Set([...config.select.filter(field => field !== "available_quantity"),
    "stocked_quantity", "reserved_quantity"])] };
}
