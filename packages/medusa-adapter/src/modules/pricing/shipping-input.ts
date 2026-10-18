import { Result, Schema, type Effect } from "effect";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { PricingId, BasePriceInput } from "./input";
import { PricingLifecycleConfig, pricingLifecycleIds } from "./lifecycle";
import type { capturePricingMetadata } from "./schema";

const Text = Schema.String.check(Schema.isLengthBetween(1, 256));
const Operator = Schema.Literals(["gte", "lte", "gt", "lt", "eq"]);
// Native normalizePrices owns operator validity and its MedusaError ordering.
// This boundary captures the finite raw grammar before that business check.
const NumericRule = Schema.Struct({ operator: Schema.String, value: Schema.Number.check(Schema.isFinite()) });
export const ShippingPriceInput = Schema.Struct({ ...BasePriceInput.fields,
  rules: Schema.optionalKey(Schema.Record(Text, Schema.NullOr(Schema.Union([Text,
    Schema.Array(NumericRule).check(Schema.isMaxLength(3))]))).check(Schema.makeFilter(rules => Object.keys(rules).length <= 3))),
});
const SetInput = Schema.Struct({ id: Schema.optionalKey(PricingId),
  prices: Schema.optionalKey(Schema.Array(ShippingPriceInput).check(Schema.isMaxLength(2))) });
export const ShippingPriceSetsInput = Schema.Array(SetInput).check(Schema.isMaxLength(4));
export const decodeShippingPriceSetCreate = commerceDecoder(Schema.Union([SetInput, ShippingPriceSetsInput]), "invalidInput");
export const ShippingNormalizedRule = Schema.Struct({ id: Schema.optionalKey(PricingId), attribute: Text, value: Schema.String,
  operator: Schema.optionalKey(Operator), priority: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 23 }))) });
export const ShippingNormalizedPrice = Schema.Struct({ id: BasePriceInput.fields.id, title: BasePriceInput.fields.title,
  currency_code: BasePriceInput.fields.currency_code, amount: BasePriceInput.fields.amount,
  min_quantity: BasePriceInput.fields.min_quantity, max_quantity: BasePriceInput.fields.max_quantity,
  // Native normalizePrices retains an empty rules object; only populated rules
  // become price_rules. This metadata is not a Price DML column.
  rules: Schema.optionalKey(Schema.Record(Schema.String, Schema.Never)),
  rules_count: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 24 }))),
  price_rules: Schema.optionalKey(Schema.Array(ShippingNormalizedRule).check(Schema.isMaxLength(24))) });
export const ShippingNormalizedSet = Schema.Struct({ id: Schema.optionalKey(PricingId),
  prices: Schema.Array(ShippingNormalizedPrice).check(Schema.isMaxLength(2)) });
const Ids = Schema.Array(PricingId).check(Schema.isMaxLength(8));
const Selector = Schema.Struct({ id: Schema.Union([PricingId, Ids]) });
export const ShippingPricingSelection = Schema.Union([PricingId, Ids, Selector, Schema.Array(Selector).check(Schema.isMaxLength(8))])
  .check(Schema.makeFilter(selection => {
    const ids = pricingLifecycleIds(selection);
    return ids.length <= 8 && new Set(ids).size <= 8;
  }));
export const ShippingPricingLifecycleInput = Schema.Struct({ selector: ShippingPricingSelection, config: PricingLifecycleConfig });
export const decodeShippingPricingLifecycle = commerceDecoder(ShippingPricingLifecycleInput, "invalidInput");
export const decodeShippingPricingSelection = commerceDecoder(ShippingPricingSelection, "unsupportedProfile");
export const ShippingPriceSetDeletionIds = Schema.Array(PricingId).check(Schema.isMaxLength(4));
export const decodeShippingPriceSetDeletionIds = commerceDecoder(ShippingPriceSetDeletionIds, "invalidInput");
export const decodeShippingPricingPhysicalSelection = commerceDecoder(Schema.Struct({
  $or: Schema.Array(Schema.Struct({ id: PricingId })).check(Schema.isMaxLength(4)),
}), "unsupportedProfile");

export function shippingPricingIds(selection: typeof ShippingPricingSelection.Type) {
  // The native Link cascade may repeat a reachable PriceSet through history.
  return [...new Set(pricingLifecycleIds(selection))];
}

/** Complete selected DTOs follow the installed native DML, including exact
 * numeric companions and explicitly populated native relations. */
export function compileShippingPricingOutput(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const tables = ["price_set", "price", "price_rule"].map(name => metadata.tables.find(table => table.name === name));
    const [set, price, rule] = tables;
    if (!set || !price || !rule) return yield* Result.fail(commerceError("unsupportedProfile"));
    const setRow = yield* compileCompleteRow(set), priceRow = yield* compileCompleteRow(price), ruleRow = yield* compileCompleteRow(rule);
    const decodeRaw = commerceDecoder(ExactNumericRaw, "storedCorruption");
    const decodeArray = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(4)), "storedCorruption");
    return (input: unknown) => Result.gen(function* () {
      const output = yield* decodeArray(input);
      let ruleCount = 0;
      for (const root of output) {
        const { prices, ...scalar } = root; yield* setRow(scalar);
        if (!Array.isArray(prices) || prices.length > 2) return yield* Result.fail(commerceError("storedCorruption"));
        for (const child of prices) {
          if (!isJsonObject(child)) return yield* Result.fail(commerceError("storedCorruption"));
          const { price_rules, price_list, ...values } = child;
          yield* priceRow(values);
          if (price_list !== null || !Array.isArray(price_rules) || price_rules.length > 24)
            return yield* Result.fail(commerceError("storedCorruption"));
          for (const column of price.columns.filter(column => column.type === "bigNumber")) {
            const value = child[column.name], raw = child["raw_" + column.name];
            if (value === null && raw === null && column.nullable) continue;
            yield* decodeRaw(raw);
          }
          for (const item of price_rules) yield* ruleRow(item);
          ruleCount += price_rules.length;
        }
      }
      if (ruleCount > 24) return yield* Result.fail(commerceError("storedCorruption"));
      return output;
    });
  });
}
