import { Result, Schema } from "effect";
import { commerceError, commerceLimits, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyColumns, type CurrencyQuery } from "./currency-query-model";
import { captureCommerceInput } from "./commerce-input";
import { QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";
import { commerceDecoder } from "./commerce-decoder";
import { compileWhere, type WherePolicy } from "./query/predicate";

const decodeEnvelope = commerceDecoder(QueryEnvelope, "invalidInput");
const decodeOptions = commerceDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Unknown),
  limit: Schema.optionalKey(Schema.Unknown),
  offset: Schema.optionalKey(Schema.Unknown),
  orderBy: Schema.optionalKey(Schema.Unknown),
  populate: Schema.optionalKey(Schema.Unknown),
  filters: Schema.optionalKey(Schema.Unknown),
}), "unsupportedProfile");
const decodePopulate = commerceDecoder(Schema.Tuple([]), "unsupportedProfile");
const decodeFieldArray = commerceDecoder(Schema.Array(Schema.Unknown).check(
  Schema.isLengthBetween(1, currencyColumns.length),
), "invalidInput");
const decodeFields = commerceDecoder(Schema.Array(Schema.Literals(currencyColumns)).check(Schema.isUnique()), "unsupportedProfile");
const decodeOffset = commerceDecoder(QueryOffset, "limitExceeded");
const decodeLimit = commerceDecoder(QueryLimit, "limitExceeded");
const decodeOrder = commerceDecoder(Schema.Struct({ code: Schema.Literals(["ASC", "asc", "DESC", "desc"]) }), "unsupportedProfile");
const decodeFilters = commerceDecoder(Schema.Struct({
  softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }),
}), "unsupportedProfile");
const decodeWhere = commerceDecoder(Schema.Struct({
  code: Schema.optionalKey(Schema.Unknown),
  $and: Schema.optionalKey(Schema.Unknown),
  $or: Schema.optionalKey(Schema.Unknown),
}), "unsupportedProfile");
const isInFilter = Schema.is(Schema.Struct({ $in: Schema.optionalKey(Schema.Unknown) }).annotate({
  parseOptions: { onExcessProperty: "error" },
}));
const Code = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[^\0]*$/));
const decodeCodes = commerceDecoder(Schema.Array(Code), "invalidInput");
const decodeBranches = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(commerceLimits.filterNodes)), "invalidInput");

const wherePolicy: WherePolicy = {
  decode: decodeWhere,
  fields: new Map([["code", { column: "code", decode: input => decodeCodes(Array.isArray(input) ? input : [input]) }]]),
  logical: {
    decodeBranches, nodes: commerceLimits.filterNodes, depth: commerceLimits.filterDepth, operands: commerceLimits.filterOperands,
    unwrapMembership: member => isInFilter(member) ? member.$in : member,
  },
};

/** Capture the Medusa boundary once, then decode the selected DAL profile.
 * Node decoding is staged during traversal: cumulative budgets must refuse a
 * node before inspecting its shape, preserving the established failure order. */
export function decodeCurrencyQuery(input: unknown): Result.Result<CurrencyQuery, CommerceTransactionError> {
  return Result.gen(function* () {
    const captured = yield* captureCommerceInput(input);
    const value = yield* decodeEnvelope(captured);
    const options = yield* decodeOptions(value.options ?? {});
    if (options.populate !== undefined) yield* decodePopulate(options.populate);
    const fields = options.fields === undefined
      ? [...currencyColumns]
      : [...yield* decodeFields(yield* decodeFieldArray(options.fields))];
    // Medusa's numeric projection includes its exact raw companion.
    if (fields.includes("rounding") && !fields.includes("raw_rounding")) fields.push("raw_rounding");
    const skip = yield* decodeOffset(options.offset ?? 0);
    const take = yield* decodeLimit(options.limit ?? commerceLimits.catalogRows);
    const ordering = options.orderBy === undefined ? { code: "ASC" } : yield* decodeOrder(options.orderBy);
    const order = ordering.code === "DESC" || ordering.code === "desc" ? "desc" : "asc";
    const withDeleted = options.filters === undefined ? false : (yield* decodeFilters(options.filters)).softDeletable.withDeleted;
    return Object.freeze({ predicate: yield* compileWhere(value.where ?? {}, wherePolicy), fields: Object.freeze(fields), skip, take, order, withDeleted });
  });
}
