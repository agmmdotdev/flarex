import { Effect, Result, Schema } from "effect";
import { selectCalculatedPriceRows, validatePricingCurrencyCode, type PricingSelectionRows } from "@medusajs/pricing/calculation";
import { MedusaError } from "@medusajs/framework/utils/portable";
import { flattenObjectToKeyValuePairs } from "@medusajs/utils/common/flatten-object-to-key-value-pairs";
import type { CommerceCommandContext } from "@flarex/persistence-postgres/internal/commerce-adapter";
import { commerceError, type Json } from "@flarex/persistence-postgres/internal/commerce-values";
import { readCommerceRelationRows } from "../../query/relations";
import { commerceDecoder } from "../../value/decoder";
import { captureCommerceInput } from "../../value/input";
import { PricingId } from "./input";
import { decodeExactNumeric, encodeExactNumeric, ExactNumericRaw } from "../../value/exact-numeric";

const Numeric = Schema.Union([Schema.String, Schema.Number]);
const ContextValue = Numeric;
const Input = Schema.Struct({
  filters: Schema.Struct({ id: Schema.Array(PricingId).check(Schema.isMaxLength(16)) }),
  pricingContext: Schema.Struct({ context: Schema.optionalKey(Schema.Record(Schema.String, ContextValue)) }),
});
export const decodePricingCalculation = commerceDecoder(Input, "invalidInput");
/** The native Variant/item callback passes its complete JSON context. The
 * existing scalar calculation profile keeps its separate narrow contract. */
export const VariantItemPricingCalculationInput = Schema.Struct({
  filters: Input.fields.filters,
  pricingContext: Schema.Struct({ context: Schema.optionalKey(Schema.JsonObject) }),
});
export const decodeVariantItemPricingCalculation = commerceDecoder(VariantItemPricingCalculationInput, "invalidInput");
const FlatContextPrimitive = Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite()), Schema.Boolean]);
const decodeFlatVariantItemPricingContext = commerceDecoder(Schema.Record(Schema.String,
  Schema.Union([FlatContextPrimitive, Schema.Array(FlatContextPrimitive)])), "invalidInput");
/** The pinned utility owns nested/array/null normalization. Bound the resulting
 * non-control attributes before native candidate matching or indexed reads. */
export function prepareVariantItemPricingContext(context: typeof Schema.JsonObject.Type) {
  return Result.gen(function* () {
    const flattened = yield* decodeFlatVariantItemPricingContext(flattenObjectToKeyValuePairs(context));
    if (Object.keys(flattened).filter(key => key !== "currency_code" && key !== "quantity").length > 10)
      return yield* Result.fail(commerceError("limitExceeded"));
    return flattened;
  });
}
const CalculatedPrice = Schema.Struct({
  id: Schema.NullOr(PricingId), price_list_id: Schema.NullOr(PricingId),
  price_list_type: Schema.NullOr(Schema.Literals(["sale", "override"])),
  min_quantity: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  max_quantity: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
});
/** Validate every field returned by the native service before a workflow can
 * select amounts or attach the DTO to a Variant. Native DTO numbers may round
 * exact raw amounts, so their representation is not reinterpreted here. */
export const VariantItemPricingCalculationOutput = Schema.Array(Schema.Struct({
  id: PricingId,
  is_calculated_price_price_list: Schema.Boolean, is_calculated_price_tax_inclusive: Schema.Boolean,
  calculated_amount: Schema.NullOr(Schema.Number.check(Schema.isFinite())),
  raw_calculated_amount: Schema.NullOr(ExactNumericRaw),
  is_original_price_price_list: Schema.Boolean, is_original_price_tax_inclusive: Schema.Boolean,
  original_amount: Schema.NullOr(Schema.Number.check(Schema.isFinite())), raw_original_amount: Schema.NullOr(ExactNumericRaw),
  currency_code: Schema.NullOr(Schema.String), calculated_price: CalculatedPrice, original_price: CalculatedPrice,
})).check(Schema.isMaxLength(16));
const NullableText = Schema.NullOr(Schema.String);
const RawAmount = Schema.StructWithRest(Schema.Struct({ value: Numeric }), [Schema.Record(Schema.String, Schema.Json)]);
const PriceRow = Schema.StructWithRest(Schema.Struct({
  id: PricingId, price_set_id: PricingId, currency_code: Schema.String, amount: Numeric,
  raw_amount: Schema.NullOr(RawAmount), min_quantity: NullableText, max_quantity: NullableText,
  raw_min_quantity: Schema.NullOr(RawAmount), raw_max_quantity: Schema.NullOr(RawAmount),
  price_list_id: NullableText, rules_count: Schema.NullOr(Schema.Number), deleted_at: NullableText,
}), [Schema.Record(Schema.String, Schema.Json)]);
const ListRow = Schema.StructWithRest(Schema.Struct({
  id: PricingId, status: Schema.String, type: Schema.String, starts_at: NullableText,
  ends_at: NullableText, deleted_at: NullableText, rules_count: Schema.NullOr(Schema.Number),
}), [Schema.Record(Schema.String, Schema.Json)]);
const RuleRow = Schema.StructWithRest(Schema.Struct({
  price_id: PricingId, attribute: Schema.String, operator: Schema.String,
  value: Schema.String, deleted_at: NullableText,
}), [Schema.Record(Schema.String, Schema.Json)]);
const ListRuleRow = Schema.StructWithRest(Schema.Struct({
  price_list_id: PricingId, attribute: Schema.String, value: Schema.Json,
  deleted_at: NullableText,
}), [Schema.Record(Schema.String, Schema.Json)]);
const decodePrices = commerceDecoder(Schema.Array(PriceRow), "storedCorruption");
const decodeLists = commerceDecoder(Schema.Array(ListRow), "storedCorruption");
const decodeRules = commerceDecoder(Schema.Array(RuleRow), "storedCorruption");
const decodeListRules = commerceDecoder(Schema.Array(ListRuleRow), "storedCorruption");

/** Every stage is a complete core-owned indexed selection. Exceeding the
 * selected resource bound refuses instead of dropping a candidate. */
export const calculateLogicalPrices = Effect.fn("Pricing.calculateLogical")(function* (
  ctx: CommerceCommandContext, input: unknown, profile: "scalar" | "variant-item-pricing" = "scalar",
) {
  if (profile !== "scalar" && profile !== "variant-item-pricing") return yield* ctx.refuse(commerceError("unsupportedProfile"));
  const captured = yield* Effect.fromResult(captureCommerceInput(input, ctx.resources));
  const { filters, values } = yield* profile === "variant-item-pricing" ? Effect.gen(function* () {
    const parsed = yield* Effect.fromResult(decodeVariantItemPricingCalculation(captured));
    yield* Effect.try({
      try: () => validatePricingCurrencyCode(parsed.pricingContext.context?.currency_code),
      catch: cause => cause,
    }).pipe(Effect.catch(cause => cause instanceof MedusaError
      ? Effect.fail(commerceError("adapterFailure", cause)) : Effect.die(cause)));
    const values = yield* Effect.fromResult(prepareVariantItemPricingContext(parsed.pricingContext.context ?? {}));
    return { filters: parsed.filters, values };
  }) : Effect.fromResult(decodePricingCalculation(captured)
    .pipe(Result.map(parsed => ({ filters: parsed.filters, values: parsed.pricingContext.context ?? {} }))));
  if (profile === "scalar" && Object.keys(values).length > 10) return yield* ctx.refuse(commerceError("limitExceeded"));
  const currency = values.currency_code;
  if (typeof currency !== "string" || currency.length === 0)
    return yield* ctx.refuse(commerceError("invalidInput"));
  const quantity = values.quantity;
  if (quantity !== undefined && (typeof quantity !== "string" && typeof quantity !== "number"))
    return yield* ctx.refuse(commerceError("invalidInput"));
  if (quantity !== undefined) yield* encodeExactNumeric(quantity);
  const context = Object.fromEntries(Object.entries(values).filter(([key]) => key !== "quantity" && key !== "currency_code"));
  const ids = [...new Set(filters.id)];
  if (ids.length === 0) return [];
  const active = (column: string, keys: readonly string[]): Json => ({ kind: "and", children: [
    { kind: "in", column, values: [...keys] }, { kind: "isNull", column: "deleted_at" },
  ] });
  const select = Effect.fn("Pricing.selectIndexedRows")(function* (
    table: string, column: string, keys: readonly string[], withDeleted = false,
  ) {
    const rows = [];
    for (let offset = 0; offset < keys.length; offset += 16) {
      const chunk = keys.slice(offset, offset + 16);
      const predicate: Json = withDeleted ? { kind: "in", column, values: chunk } : active(column, chunk);
      rows.push(...yield* readCommerceRelationRows(ctx, table, predicate));
    }
    return rows;
  });
  const prices = yield* Effect.fromResult(decodePrices(yield* select("price", "price_set_id", ids)));
  for (const price of prices) {
    yield* decodeExactNumeric(price.amount, price.raw_amount);
    yield* decodeExactNumeric(price.min_quantity, price.raw_min_quantity, true);
    yield* decodeExactNumeric(price.max_quantity, price.raw_max_quantity, true);
  }
  // The native query restricts currency before joining PriceRule and PriceList.
  // Other currencies still count toward the complete Price-set read, but must
  // not consume the downstream join budget.
  const matchingPrices = prices.filter(price => price.currency_code === currency);
  const priceIds = [...new Set(matchingPrices.map(price => price.id))];
  const listIds = [...new Set(matchingPrices.map(price => price.price_list_id).filter((id): id is string => id !== null))];
  const lists = yield* Effect.fromResult(decodeLists(yield* select("price_list", "id", listIds, true)));
  for (const list of lists) if (list.starts_at !== null && !Number.isFinite(Date.parse(list.starts_at)) ||
    list.ends_at !== null && !Number.isFinite(Date.parse(list.ends_at)))
    return yield* ctx.refuse(commerceError("storedCorruption"));
  const priceRules = yield* Effect.fromResult(decodeRules(yield* select("price_rule", "price_id", priceIds)));
  // The selected native write profile admits equality rules. PostgreSQL's
  // numeric cast has a different overflow domain from Medusa BigNumber, so
  // range rules need their own connected parity proof before serving them.
  if (priceRules.some(rule => rule.operator !== "eq")) return yield* ctx.refuse(commerceError("unsupportedProfile"));
  const listRules = yield* Effect.fromResult(decodeListRules(yield* select("price_list_rule", "price_list_id", listIds)));
  if (ctx.transactionTime === undefined) return yield* ctx.refuse(commerceError("unsupportedProfile"));
  const now = new Date(yield* ctx.transactionTime);
  const rows: PricingSelectionRows = { prices: prices.map(price => ({ ...price,
    amount: String(price.amount), min_quantity: price.min_quantity, max_quantity: price.max_quantity,
    price_list_type: null })), lists, priceRules, listRules };
  return selectCalculatedPriceRows(ids, currency, quantity, context, now, rows);
});
