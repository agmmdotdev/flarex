import { Result } from "effect";
import { isNonArrayRecord } from "@flarex/utils/records";
import { capturePrivateJsonData, commerceError, commerceLimits } from "@flarex/persistence-postgres/internal/commerce-values";
import { currencyColumns } from "./currency-query-model";
import type { CommerceTransactionError } from "@flarex/persistence-postgres/internal/commerce-values";
import type { CurrencyColumn, CurrencyPredicate, CurrencyQuery } from "./currency-query-model";

const isColumn = (input: unknown): input is CurrencyColumn =>
  currencyColumns.some(column => column === input);
const onlyKeys = (input: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(input).every(key => keys.includes(key));
const isCount = (input: unknown, maximum: number): input is number =>
  typeof input === "number" && Number.isSafeInteger(input) && input >= 0 && input <= maximum;

/** Decode the selected DAL query after Medusa's own normalization/buildQuery. */
export function decodeCurrencyQuery(input: unknown): Result.Result<CurrencyQuery, CommerceTransactionError> {
  return Result.gen(function* () {
    const captured = yield* capturePrivateJsonData(input, commerceLimits.commandBytes, commerceError);
    const value = captured.value;
    if (!isNonArrayRecord(value) || !onlyKeys(value, ["where", "options"])) return yield* Result.fail(commerceError("invalidInput"));
    const options = value.options ?? {};
    if (!isNonArrayRecord(options) || !onlyKeys(options, ["fields", "limit", "offset", "orderBy", "populate", "filters"])) {
      return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    if (options.populate !== undefined && (!Array.isArray(options.populate) || options.populate.length !== 0)) {
      return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    const fields: CurrencyColumn[] = [];
    if (options.fields === undefined) fields.push(...currencyColumns);
    else {
      if (!Array.isArray(options.fields) || options.fields.length === 0 || options.fields.length > currencyColumns.length) {
        return yield* Result.fail(commerceError("invalidInput"));
      }
      for (const field of options.fields) {
        if (!isColumn(field) || fields.includes(field)) return yield* Result.fail(commerceError("unsupportedProfile"));
        fields.push(field);
      }
    }
    // The raw companion is part of the selected Medusa numeric projection contract.
    if (fields.includes("rounding") && !fields.includes("raw_rounding")) fields.push("raw_rounding");
    const skip = options.offset ?? 0;
    const take = options.limit ?? commerceLimits.catalogRows;
    if (!isCount(skip, commerceLimits.catalogRows - 1) || !isCount(take, commerceLimits.catalogRows)) {
      return yield* Result.fail(commerceError("limitExceeded"));
    }
    let order: "asc" | "desc" = "asc";
    if (options.orderBy !== undefined) {
      if (!isNonArrayRecord(options.orderBy) || !onlyKeys(options.orderBy, ["code"])) return yield* Result.fail(commerceError("unsupportedProfile"));
      const direction = options.orderBy.code;
      if (direction === "ASC" || direction === "asc") order = "asc";
      else if (direction === "DESC" || direction === "desc") order = "desc";
      else return yield* Result.fail(commerceError("unsupportedProfile"));
    }
    let withDeleted = false;
    if (options.filters !== undefined) {
      const filters = options.filters;
      if (!isNonArrayRecord(filters) || !onlyKeys(filters, ["softDeletable"])) return yield* Result.fail(commerceError("unsupportedProfile"));
      const soft = filters.softDeletable;
      if (!isNonArrayRecord(soft) || !onlyKeys(soft, ["withDeleted"]) || typeof soft.withDeleted !== "boolean") {
        return yield* Result.fail(commerceError("unsupportedProfile"));
      }
      withDeleted = soft.withDeleted;
    }
    let nodes = 0;
    let operands = 0;
    const predicate = (where: unknown, depth: number): Result.Result<CurrencyPredicate, CommerceTransactionError> => Result.gen(function* () {
      if (++nodes > commerceLimits.filterNodes || depth > commerceLimits.filterDepth) return yield* Result.fail(commerceError("limitExceeded"));
      if (!isNonArrayRecord(where) || !onlyKeys(where, ["code", "$and", "$or"])) return yield* Result.fail(commerceError("unsupportedProfile"));
      const children: CurrencyPredicate[] = [];
      for (const [key, member] of Object.entries(where)) {
        if (key === "code") {
          const selected = isNonArrayRecord(member) && onlyKeys(member, ["$in"]) ? member.$in : member;
          const values = Array.isArray(selected) ? selected : [selected];
          operands += values.length;
          if (operands > commerceLimits.filterOperands) return yield* Result.fail(commerceError("limitExceeded"));
          const codes: string[] = [];
          for (const code of values) {
            if (typeof code !== "string" || code.length === 0 || code.length > 256 || code.includes("\0")) return yield* Result.fail(commerceError("invalidInput"));
            codes.push(code);
          }
          children.push({ kind: "codes", values: Object.freeze(codes) });
        } else {
          if (!Array.isArray(member) || member.length > commerceLimits.filterNodes) return yield* Result.fail(commerceError("invalidInput"));
          const nested: CurrencyPredicate[] = [];
          for (const child of member) nested.push(yield* predicate(child, depth + 1));
          children.push({ kind: key === "$and" ? "and" : "or", children: Object.freeze(nested) });
        }
      }
      return Object.freeze({ kind: "and", children: Object.freeze(children) });
    });
    return Object.freeze({ predicate: yield* predicate(value.where ?? {}, 0), fields: Object.freeze(fields), skip, take, order, withDeleted });
  });
}
