import { Result, Schema } from "effect";
import { commerceError } from "@flarex/persistence-postgres/internal/commerce-values";
import { commerceDecoder } from "../../value/decoder";
import { QueryEnvelope } from "../../query/decoder";
import { compileWhere, type WherePolicy, type ScalarFilter } from "../../query/predicate";

export const taxLinesLimits = Object.freeze({ items: 4, shipping: 4, regions: 2, rates: 8, rules: 16 });
export const TaxId = Schema.String.check(Schema.isLengthBetween(1, 256));
const Code = Schema.String.check(Schema.isMaxLength(256));
const RegionBranch = Schema.Struct({ country_code: Code, province_code: Schema.NullOr(Code) });
export const TaxRegionFilters = Schema.Struct({ $or: Schema.Tuple([RegionBranch, RegionBranch]) });
const RuleBranch = Schema.Struct({ reference: Schema.Literals(["product", "product_type", "shipping_option"]),
  reference_id: Schema.optionalKey(Schema.NullOr(TaxId)) });
const RuleSelection = Schema.Struct({ rules: Schema.Struct({ $or: Schema.Array(RuleBranch).check(Schema.isLengthBetween(1, 8)) }) });
export const TaxRateFilters = Schema.Struct({ $and: Schema.Tuple([
  Schema.Struct({ tax_region_id: Schema.Array(TaxId).check(Schema.isLengthBetween(1, taxLinesLimits.regions)) }),
  Schema.Struct({ $or: Schema.Union([Schema.Tuple([Schema.Struct({ is_default: Schema.Literal(true) })]),
    Schema.Tuple([Schema.Struct({ is_default: Schema.Literal(true) }), RuleSelection])]) }),
]) });
const decodeEnvelope = commerceDecoder(QueryEnvelope, "unsupportedProfile");
const decodeRegionFilters = commerceDecoder(TaxRegionFilters, "unsupportedProfile");
const decodeRateFilters = commerceDecoder(TaxRateFilters, "unsupportedProfile");
const NativeOrder = Schema.Struct({ id: Schema.Literal("ASC") });
const decodeRegionOptions = commerceDecoder(Schema.Struct({ populate: Schema.Array(Schema.Never), orderBy: NativeOrder }), "unsupportedProfile");
const decodeRateOptions = commerceDecoder(Schema.Struct({ populate: Schema.Tuple([Schema.Literal("tax_region"), Schema.Literal("rules")]), orderBy: NativeOrder }), "unsupportedProfile");
const logical = { decodeBranches: commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(8)), "unsupportedProfile"),
  nodes: 32, depth: 4, operands: 32, unwrapMembership: (value: unknown) => value };
const regionWhere: WherePolicy = { decode: commerceDecoder(Schema.JsonObject, "unsupportedProfile"), logical,
  fields: new Map<string, ScalarFilter>([
    ["country_code", { column: "country_code", decode: commerceDecoder(Code, "unsupportedProfile") }],
    ["province_code", { column: "province_code", decode: commerceDecoder(Schema.NullOr(Code), "unsupportedProfile") }],
  ]) };
const ruleWhere: WherePolicy = { decode: commerceDecoder(Schema.JsonObject, "unsupportedProfile"), logical,
  fields: new Map<string, ScalarFilter>([
    ["reference", { column: "reference", decode: commerceDecoder(RuleBranch.fields.reference, "unsupportedProfile") }],
    ["reference_id", { column: "reference_id", decode: commerceDecoder(Schema.NullOr(TaxId), "unsupportedProfile") }],
  ]) };

/** Admit the actual native service selectors and complete projections only. */
export function prepareTaxRegionQuery(input: unknown) {
  return Result.gen(function* () {
    const envelope = yield* decodeEnvelope(input), filters = yield* decodeRegionFilters(envelope.where);
    yield* decodeRegionOptions(envelope.options);
    const [country, province] = filters.$or;
    if (country.province_code !== null || country.country_code !== province.country_code)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    return { filters, predicate: yield* compileWhere(filters, regionWhere) };
  });
}

export function prepareTaxRateQuery(input: unknown) {
  return Result.gen(function* () {
    const envelope = yield* decodeEnvelope(input), filters = yield* decodeRateFilters(envelope.where);
    yield* decodeRateOptions(envelope.options);
    const regionIds = filters.$and[0].tax_region_id, ruleSelection = filters.$and[1].$or[1];
    return { filters, regionIds, rulePredicate: ruleSelection === undefined ? undefined
      : yield* compileWhere(ruleSelection.rules, ruleWhere) };
  });
}
