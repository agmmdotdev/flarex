import { Result, Schema } from "effect";
import { commerceError, commerceLimits, type CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyColumns, type CurrencyPredicate, type CurrencyQuery } from "./currency-query-model";
import { captureCommerceInput } from "./commerce-input";
import { queryDecoder, QueryEnvelope, QueryLimit, QueryOffset } from "./query-decoder";

const decodeEnvelope = queryDecoder(QueryEnvelope, "invalidInput");
const decodeOptions = queryDecoder(Schema.Struct({
  fields: Schema.optionalKey(Schema.Unknown),
  limit: Schema.optionalKey(Schema.Unknown),
  offset: Schema.optionalKey(Schema.Unknown),
  orderBy: Schema.optionalKey(Schema.Unknown),
  populate: Schema.optionalKey(Schema.Unknown),
  filters: Schema.optionalKey(Schema.Unknown),
}), "unsupportedProfile");
const decodePopulate = queryDecoder(Schema.Tuple([]), "unsupportedProfile");
const decodeFieldArray = queryDecoder(Schema.Array(Schema.Unknown).check(
  Schema.isLengthBetween(1, currencyColumns.length),
), "invalidInput");
const decodeFields = queryDecoder(Schema.Array(Schema.Literals(currencyColumns)).check(Schema.isUnique()), "unsupportedProfile");
const decodeOffset = queryDecoder(QueryOffset, "limitExceeded");
const decodeLimit = queryDecoder(QueryLimit, "limitExceeded");
const decodeOrder = queryDecoder(Schema.Struct({ code: Schema.Literals(["ASC", "asc", "DESC", "desc"]) }), "unsupportedProfile");
const decodeFilters = queryDecoder(Schema.Struct({
  softDeletable: Schema.Struct({ withDeleted: Schema.Boolean }),
}), "unsupportedProfile");
const decodeWhere = queryDecoder(Schema.Struct({
  code: Schema.optionalKey(Schema.Unknown),
  $and: Schema.optionalKey(Schema.Unknown),
  $or: Schema.optionalKey(Schema.Unknown),
}), "unsupportedProfile");
const isInFilter = Schema.is(Schema.Struct({ $in: Schema.optionalKey(Schema.Unknown) }).annotate({
  parseOptions: { onExcessProperty: "error" },
}));
const Code = Schema.String.check(Schema.isLengthBetween(1, 256), Schema.isPattern(/^[^\0]*$/));
const decodeCodes = queryDecoder(Schema.Array(Code), "invalidInput");
const decodeBranches = queryDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(commerceLimits.filterNodes)), "invalidInput");

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
    let nodes = 0;
    let operands = 0;
    const predicate = (inputWhere: unknown, depth: number): Result.Result<CurrencyPredicate, CommerceTransactionError> => Result.gen(function* () {
      if (++nodes > commerceLimits.filterNodes || depth > commerceLimits.filterDepth) {
        return yield* Result.fail(commerceError("limitExceeded"));
      }
      const where = yield* decodeWhere(inputWhere);
      const children: CurrencyPredicate[] = [];
      for (const [key, member] of Object.entries(where)) {
        if (key === "code") {
          const selected = isInFilter(member) ? member.$in : member;
          const values = Array.isArray(selected) ? selected : [selected];
          operands += values.length;
          if (operands > commerceLimits.filterOperands) return yield* Result.fail(commerceError("limitExceeded"));
          children.push({ kind: "codes", values: Object.freeze(yield* decodeCodes(values)) });
        } else {
          const nested: CurrencyPredicate[] = [];
          for (const child of yield* decodeBranches(member)) nested.push(yield* predicate(child, depth + 1));
          children.push({ kind: key === "$and" ? "and" : "or", children: Object.freeze(nested) });
        }
      }
      return Object.freeze({ kind: "and", children: Object.freeze(children) });
    });
    return Object.freeze({ predicate: yield* predicate(value.where ?? {}, 0), fields: Object.freeze(fields), skip, take, order, withDeleted });
  });
}
