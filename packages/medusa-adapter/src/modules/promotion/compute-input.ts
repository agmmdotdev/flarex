import { Effect, Schema } from "effect";
import { commerceError, isJsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { encodeExactNumeric } from "../../value/exact-numeric";
import { captureNativeNumericDto } from "../../value/native-numeric";
import { captureNativeRecord } from "../../value/native-record";

const Id = Schema.String.check(Schema.isLengthBetween(1, 256));
const Numeric = Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite()),
  Schema.Struct({ value: Schema.Union([Schema.String, Schema.Number.check(Schema.isFinite())]), precision: Schema.optionalKey(Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 }))) })]);
const rest = [Schema.Record(Schema.String, Schema.Json)];
const adjustment = Schema.StructWithRest(Schema.Struct({ id: Id, code: Schema.optionalKey(Schema.NullOr(Schema.String)) }), rest);
const product = Schema.StructWithRest(Schema.Struct({ id: Id, collection_id: Schema.optionalKey(Schema.NullOr(Id)), type_id: Schema.optionalKey(Schema.NullOr(Id)),
  tags: Schema.optionalKey(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }), rest)).pipe(Schema.mutable)),
  categories: Schema.optionalKey(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }), rest)).pipe(Schema.mutable)) }), rest);
const item = Schema.StructWithRest(Schema.Struct({ id: Id, quantity: Numeric, subtotal: Numeric, original_total: Numeric, is_discountable: Schema.Boolean,
  adjustments: Schema.optionalKey(Schema.Array(adjustment).pipe(Schema.mutable)), product: Schema.optionalKey(Schema.NullOr(product)) }), rest);
const shipping = Schema.StructWithRest(Schema.Struct({ id: Id, subtotal: Numeric, original_total: Numeric,
  adjustments: Schema.optionalKey(Schema.Array(adjustment).pipe(Schema.mutable)),
  shipping_option: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({ shipping_option_type_id: Schema.optionalKey(Schema.NullOr(Id)) }), rest))) }), rest);
export const PromotionComputeContext = Schema.StructWithRest(Schema.Struct({ currency_code: Schema.String,
  customer: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({ id: Id, groups: Schema.optionalKey(Schema.Array(Schema.StructWithRest(Schema.Struct({ id: Id }), rest)).pipe(Schema.mutable)) }), rest))),
  region: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({ id: Id }), rest))),
  shipping_address: Schema.optionalKey(Schema.NullOr(Schema.StructWithRest(Schema.Struct({ country_code: Schema.optionalKey(Schema.NullOr(Schema.String)) }), rest))),
  sales_channel_id: Schema.optionalKey(Schema.NullOr(Schema.String)), email: Schema.optionalKey(Schema.NullOr(Schema.String)),
  items: Schema.optionalKey(Schema.Array(item).pipe(Schema.mutable)), shipping_methods: Schema.optionalKey(Schema.Array(shipping).pipe(Schema.mutable)),
}), rest);
export const PromotionComputeOptions = Schema.Struct({ prevent_auto_promotions: Schema.optionalKey(Schema.Boolean), skip_usage_limit_checks: Schema.optionalKey(Schema.Boolean) });
export const PromotionComputeInput = Schema.Struct({ codes: Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(256)),
  context: PromotionComputeContext, options: Schema.optionalKey(PromotionComputeOptions) });
export const decodePromotionComputeInput = commerceDecoder(PromotionComputeInput, "invalidInput");
export const decodePromotionComputeArguments = commerceDecoder(Schema.Union([
  Schema.Tuple([PromotionComputeInput.fields.codes, PromotionComputeContext]),
  Schema.Tuple([PromotionComputeInput.fields.codes, PromotionComputeContext, Schema.Union([PromotionComputeOptions, Schema.Undefined])]),
]), "invalidInput");
export const PromotionGraphRead = Schema.Struct({ filters: Schema.Struct({
  id: Schema.optionalKey(Schema.Union([Id, Schema.Array(Id).pipe(Schema.mutable).check(Schema.isMaxLength(256))])),
  code: Schema.optionalKey(Schema.Union([Schema.String, Schema.Array(Schema.String).pipe(Schema.mutable).check(Schema.isMaxLength(256))])),
}), config: Schema.Struct({ select: Schema.Array(Schema.Literals(["id", "code"])).pipe(Schema.mutable),
  relations: Schema.Array(Schema.Never).pipe(Schema.mutable), order: Schema.Struct({ id: Schema.Literal("ASC") }),
  skip: Schema.optionalKey(Schema.Literal(0)), take: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: 256 })) }) });
export const decodePromotionGraphRead = commerceDecoder(PromotionGraphRead, "invalidInput");

const common = { code: Schema.String, description: Schema.optionalKey(Schema.String) };
export const PromotionComputedActions = Schema.Array(Schema.Union([
  Schema.Struct({ ...common, action: Schema.Literal("addItemAdjustment"), item_id: Id, amount: Schema.String,
    is_tax_inclusive: Schema.optionalKey(Schema.Boolean) }),
  Schema.Struct({ ...common, action: Schema.Literal("addShippingMethodAdjustment"), shipping_method_id: Id, amount: Schema.String }),
  Schema.Struct({ ...common, action: Schema.Literal("removeItemAdjustment"), item_id: Id, adjustment_id: Id }),
  Schema.Struct({ ...common, action: Schema.Literal("removeShippingMethodAdjustment"), shipping_method_id: Id, adjustment_id: Id }),
  Schema.Struct({ code: Schema.String, action: Schema.Literals(["campaignBudgetExceeded", "promotionLimitExceeded"]) }),
])).pipe(Schema.mutable).check(Schema.isMaxLength(256));
export const decodePromotionComputedActions = commerceDecoder(PromotionComputedActions, "storedCorruption");

/** Native computed amounts remain BigNumberInput quantities across the command
 * boundary. Convert only this declared field with the existing exact owner. */
export const capturePromotionComputedActions = Effect.fn("Promotion.captureComputedActions")(function* (input: unknown) {
  const snapshot = yield* Effect.fromResult(captureNativeNumericDto(input));
  if (!Array.isArray(input) || !Array.isArray(snapshot) || input.length !== snapshot.length)
    return yield* Effect.fail(commerceError("storedCorruption"));
  const rows = [];
  for (let index = 0; index < snapshot.length; index++) {
    const value = snapshot[index];
    if (value === undefined || !isJsonObject(value)) return yield* Effect.fail(commerceError("storedCorruption"));
    const original = yield* captureNativeRecord(input[index]);
    rows.push(Object.hasOwn(original, "amount") ? { ...value, amount: (yield* encodeExactNumeric(original.amount)).value } : value);
  }
  return yield* Effect.fromResult(decodePromotionComputedActions(rows));
});
