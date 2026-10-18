import { Effect, Result, Schema } from "effect";
import { commerceError, isJsonObject, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow } from "../../value/complete-row";
import { ExactNumericRaw } from "../../value/exact-numeric";
import { PricingId, BasePriceInput, BasePriceUpdateInput } from "./input";
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
// The native Shipping update step supplies the linked PriceSet on every raw
// price before invoking the scalar Pricing ABI. Pricing itself assigns the
// authoritative parent again during normalization.
export const ShippingMutationManaged = {
  created_at: Schema.optionalKey(Schema.String), updated_at: Schema.optionalKey(Schema.String),
  deleted_at: Schema.optionalKey(Schema.Null),
};
const ReadIds = Schema.Array(PricingId).check(Schema.isMaxLength(8));
export const ShippingPricingIdConfig = Schema.Struct({ select: Schema.Array(Schema.Literal("id")).check(Schema.isLengthBetween(1, 1)) });
export const ShippingPriceReadInput = Schema.Struct({ filters: Schema.Struct({ id: ReadIds }), config: ShippingPricingIdConfig });
export const ShippingRuleReadInput = Schema.Union([
  Schema.Struct({ filters: Schema.Struct({ id: Schema.Array(PricingId).check(Schema.isMaxLength(24)) }), config: ShippingPricingIdConfig }),
  Schema.Struct({ filters: Schema.Struct({ price_id: ReadIds }), config: Schema.Struct({}) }),
]);
export const decodeShippingPriceRead = commerceDecoder(ShippingPriceReadInput, "invalidInput");
export const decodeShippingRuleRead = commerceDecoder(ShippingRuleReadInput, "invalidInput");
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
export const ShippingNormalizedMutationRule = Schema.Struct({ ...ShippingNormalizedRule.fields, ...ShippingMutationManaged,
  price_id: Schema.optionalKey(PricingId) });
const ShippingNormalizedMutationPrice = Schema.Struct({ ...ShippingNormalizedPrice.fields,
  ...ShippingMutationManaged, price_set_id: PricingId,
  // Native normalizePrices assigns undefined for a base price's absent list.
  // Ordinary insertion materializes this nullable DML relation; retained-row
  // reconstitution needs the same explicit value before its exact-row proof.
  price_list_id: Schema.Null.pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))),
  price_list: Schema.optionalKey(Schema.Null), raw_amount: Schema.optionalKey(ExactNumericRaw),
  raw_min_quantity: Schema.optionalKey(Schema.NullOr(ExactNumericRaw)), raw_max_quantity: Schema.optionalKey(Schema.NullOr(ExactNumericRaw)),
  price_rules: Schema.optionalKey(Schema.Array(ShippingNormalizedMutationRule).check(Schema.isMaxLength(24))),
});
export const decodeShippingNormalizedPriceCreate = commerceDecoder(ShippingNormalizedMutationPrice, "unsupportedProfile");
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

/** Shipping compensation carries actual native complete DTOs. DML validates
 * every scalar before the selected repository admits their managed preimages. */
export function compileShippingPricingMutationContracts(metadata: Effect.Success<ReturnType<typeof capturePricingMetadata>>["frame"]) {
  return Result.gen(function* () {
    const set = metadata.tables.find(table => table.name === "price_set"), price = metadata.tables.find(table => table.name === "price"),
      rule = metadata.tables.find(table => table.name === "price_rule");
    if (!set || !price || !rule) return yield* Result.fail(commerceError("unsupportedProfile"));
    const setRow = yield* compileCompleteRow(set), priceRow = yield* compileCompleteRow(price), ruleRow = yield* compileCompleteRow(rule);
    const object = commerceDecoder(Schema.JsonObject, "invalidInput");
    const decodePrices = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)), "invalidInput");
    const decodeRules = commerceDecoder(Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(24)), "invalidInput");
    const raw = commerceDecoder(Schema.Struct({ ...BasePriceUpdateInput.fields, id: BasePriceInput.fields.id, rules: ShippingPriceInput.fields.rules,
      price_set_id: Schema.optionalKey(PricingId) }), "invalidInput");
    const attribute = commerceDecoder(ShippingNormalizedRule.fields.attribute, "invalidInput"), value = commerceDecoder(ShippingNormalizedRule.fields.value, "invalidInput");
    const decodeRuleRows = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeRules(input);
      const output: Array<JsonObject & Pick<typeof ShippingNormalizedRule.Type, "attribute" | "value">> = [];
      for (const row of rows) {
        yield* ruleRow(row);
        output.push({ ...row, attribute: yield* attribute(row.attribute), value: yield* value(row.value) });
      }
      return output;
    });
    const idRow = commerceDecoder(Schema.Struct({ id: PricingId }), "storedCorruption");
    const decodeRuleReadOutput = (input: unknown) => Result.gen(function* () {
      const rows = yield* decodeRules(input);
      for (const row of rows) {
        if (Object.keys(row).length === 1 && Object.hasOwn(row, "id")) yield* idRow(row);
        else yield* ruleRow(row);
      }
      return rows;
    });
    const decodePrice = (input: unknown, requireRules: boolean) => Result.gen(function* () {
      const row = yield* object(input);
      const { price_rules, price_list, ...values } = row;
      yield* priceRow(values);
      if (price_list !== undefined && price_list !== null || requireRules && price_rules === undefined)
        return yield* Result.fail(commerceError("invalidInput"));
      if (price_rules !== undefined) yield* decodeRuleRows(price_rules);
      return row;
    });
    const envelope = commerceDecoder(Schema.Struct({ selector: PricingId, update: Schema.Struct({ prices: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)) }) }), "invalidInput");
    const decodeUpdate = (input: unknown) => Result.gen(function* () {
      const parsed = yield* envelope(input);
      let rules = 0;
      for (const row of parsed.update.prices) {
        if (Object.hasOwn(row, "created_at")) {
          yield* decodePrice(row, true);
          if (Array.isArray(row.price_rules)) rules += row.price_rules.length;
        } else yield* raw(row);
      }
      if (rules > 24) return yield* Result.fail(commerceError("invalidInput"));
      return parsed;
    });
    const args = commerceDecoder(Schema.Tuple([PricingId, Schema.Struct({ prices: Schema.Array(Schema.JsonObject).check(Schema.isMaxLength(2)) })]), "invalidInput");
    const decodeArguments = (input: unknown) => Result.gen(function* () {
      const parsed = yield* args(input);
      yield* decodeUpdate({ selector: parsed[0], update: parsed[1] });
      return parsed;
    });
    const decodeOutput = (input: unknown) => Result.gen(function* () {
      const row = yield* object(input), { prices, ...values } = row;
      yield* setRow(values);
      for (const child of yield* decodePrices(prices)) yield* decodePrice(child, false);
      return row;
    });
    return { tables: { set, price, rule }, decodeUpdate, decodeArguments, decodeOutput, decodeRuleRows, decodeRuleReadOutput,
      decodeStoredPrice: (input: unknown) => decodePrice(input, false), decodeStoredRule: ruleRow };
  });
}

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
