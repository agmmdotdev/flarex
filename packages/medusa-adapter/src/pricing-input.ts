import { Schema } from "effect";
import { commerceDecoder } from "./commerce-decoder";
import { QueryLimit, QueryOffset } from "./query-decoder";

export const PricingId = Schema.String.check(Schema.isLengthBetween(1, 256));
const Text = Schema.String.check(Schema.isLengthBetween(1, 256));
const Numeric = Schema.Union([Schema.String, Schema.Number]);
export const BasePriceInput = Schema.Struct({
  id: Schema.optionalKey(PricingId), title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  currency_code: Text, amount: Numeric,
  min_quantity: Schema.optionalKey(Schema.NullOr(Numeric)), max_quantity: Schema.optionalKey(Schema.NullOr(Numeric)),
  rules: Schema.optionalKey(Schema.Record(Text, Text).check(Schema.makeFilter(value => Object.keys(value).length <= 1))),
});
export const PriceSetInput = Schema.Struct({ id: Schema.optionalKey(PricingId),
  prices: Schema.optionalKey(Schema.Array(BasePriceInput).check(Schema.isMaxLength(2))),
});
export const PriceSetsInput = Schema.Array(PriceSetInput).check(Schema.isMaxLength(4));
export const decodePriceSetCreate = commerceDecoder(Schema.Union([PriceSetInput, PriceSetsInput]), "invalidInput");
const ListPriceInput = Schema.Struct({ id: Schema.optionalKey(PricingId), price_set_id: PricingId,
  currency_code: Text, amount: Numeric, title: Schema.optionalKey(Schema.NullOr(Schema.String)),
  min_quantity: Schema.optionalKey(Schema.NullOr(Numeric)), max_quantity: Schema.optionalKey(Schema.NullOr(Numeric)),
});
const PriceListInput = Schema.Struct({ id: Schema.optionalKey(PricingId), title: Text, description: Schema.String,
  status: Schema.Literals(["active", "draft"]), type: Schema.Literals(["sale", "override"]),
  starts_at: Schema.optionalKey(Schema.NullOr(Text)), ends_at: Schema.optionalKey(Schema.NullOr(Text)),
  prices: Schema.Array(ListPriceInput).check(Schema.isMaxLength(2)),
  rules: Schema.optionalKey(Schema.Struct({ region_id: Schema.Array(Text).check(Schema.isLengthBetween(1, 2)) })),
});
export const PriceListsInput = Schema.Array(PriceListInput).check(Schema.isLengthBetween(1, 4));
export const decodePriceListCreate = commerceDecoder(PriceListsInput, "invalidInput");
export const PricePreferencesInput = Schema.Array(Schema.Struct({
  attribute: Text,
  value: Text,
  is_tax_inclusive: Schema.optionalKey(Schema.Boolean),
})).check(Schema.isLengthBetween(1, 4));
export const decodePricePreferenceCreate = commerceDecoder(PricePreferencesInput, "invalidInput");
export const PriceSetFilters = Schema.Struct({ id: Schema.optionalKey(Schema.Union([PricingId, Schema.Array(PricingId).check(Schema.isMaxLength(256))])) });
export const PriceSetConfig = Schema.Struct({
  select: Schema.optionalKey(Schema.Array(Schema.String).check(Schema.isMinLength(1))),
  relations: Schema.optionalKey(Schema.Array(Schema.Literals(["prices", "prices.price_rules"])).check(Schema.isMaxLength(2))),
  skip: Schema.optionalKey(QueryOffset), take: Schema.optionalKey(QueryLimit),
  order: Schema.optionalKey(Schema.Struct({ id: Schema.optionalKey(Schema.Literals(["ASC", "DESC"])) })),
  withDeleted: Schema.optionalKey(Schema.Boolean),
});
export const decodePriceSetRead = commerceDecoder(Schema.Struct({ filters: Schema.optionalKey(PriceSetFilters), config: Schema.optionalKey(PriceSetConfig) }), "invalidInput");
export const decodePriceSetRetrieve = commerceDecoder(Schema.Struct({ id: PricingId, config: Schema.optionalKey(PriceSetConfig) }), "invalidInput");
