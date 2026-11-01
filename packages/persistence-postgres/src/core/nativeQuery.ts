/** Native scalar selection policy over the shared Source index/range codec. */
import { Result, Schema } from "effect";
import type { BTreeEx as BTree } from "sorted-btree/extended/index.js";
import { compareBytesLexicographically } from "@flarex/utils/bytes";
import type { DocumentObject } from "flarex-protocol/document-value";
import type { JsonObject } from "flarex-protocol/json";
import { encodeIndexValue } from "flarex-protocol/index-key";
import { compileIndexRange, type CapturedIndexRangeExpression } from "flarex-protocol/index-range";
import { capturePrivateJsonData } from "../values/privateJsonData";
import { CoreNativeQueryError, CoreTransactionError, type CoreError, type CoreIndexDefinition,
  type CoreTableDefinition } from "./api";
import type { CoreInterval } from "./contracts";
import { CORE_TRANSACTION_REFERENCE_LIMITS } from "./accounting";
import { coreNativeConstraintEligibility, coreNativeConstraintFields, coreNativeConstraintNullsDistinct,
  coreNativeEligibilityTerms, coreNativeEligibilityMatches } from "./nativePolicy";

const Scalar = Schema.Union([Schema.String, Schema.Finite, Schema.Boolean, Schema.Null]);
export type CoreNativeScalar = typeof Scalar.Type;
const isScalar = Schema.is(Scalar);
const Range = Schema.Struct({ gt: Schema.optionalKey(Scalar), gte: Schema.optionalKey(Scalar),
  lt: Schema.optionalKey(Scalar), lte: Schema.optionalKey(Scalar),
}).annotate({ parseOptions: { onExcessProperty: "error" } }).check(Schema.makeFilter(value =>
  Object.keys(value).length > 0 && !(Object.hasOwn(value, "gt") && Object.hasOwn(value, "gte"))
    && !(Object.hasOwn(value, "lt") && Object.hasOwn(value, "lte")) ? undefined : "Expected one lower and/or upper bound"));
export const CoreNativeWhereSchema = Schema.Record(Schema.String, Schema.Union([Scalar, Range]));
export type CoreNativeWhere = typeof CoreNativeWhereSchema.Type;
type Predicate = CoreNativeWhere[string];
type Constraint = NonNullable<CoreTableDefinition["nativePolicy"]>["uniqueConstraints"][number];
const decodeWhere = Schema.decodeUnknownResult(CoreNativeWhereSchema, { onExcessProperty: "error" });
const invalid = (cause?: unknown) => new CoreNativeQueryError({ reason: "invalidInput", cause });
export const isCoreNativeRange = (value: Predicate | undefined): value is typeof Range.Type =>
  value !== null && typeof value === "object";

/** Select the existing incrementally maintained pending index. A bounded
 * native lookup must not re-encode or inspect unrelated pending documents.
 * Tombstones suppress originals through the writes map; they are not members. */
export function* coreNativePendingIndexDocuments(
  pending: Pick<BTree<Uint8Array, DocumentObject | null>, "entries"> | undefined, interval: CoreInterval,
): Generator<DocumentObject> {
  if (pending === undefined) return;
  for (const [key, document] of pending.entries(interval.start ?? undefined)) {
    if (interval.end !== null && compareBytesLexicographically(key, interval.end) >= 0) break;
    if (document !== null) yield document;
  }
}

export function captureCoreNativeWhere(input: JsonObject): Result.Result<CoreNativeWhere, CoreError> {
  return Result.gen(function* () {
    // Structural ownership permits escaped surrogates. Selected operands and
    // residual comparisons retain their original lazy value-validation order.
    const captured = yield* capturePrivateJsonData(input, CORE_TRANSACTION_REFERENCE_LIMITS.bytesRead,
      (reason, cause) => reason === "limitExceeded" ? new CoreTransactionError({ reason: "capacity", cause }) : invalid(cause));
    return yield* Result.mapError(decodeWhere(captured.value), invalid);
  });
}

export type CoreNativeQueryPlan = Readonly<{ kind: "all" }> | Readonly<{ kind: "id"; id: string }>
  | Readonly<{ kind: "unique"; constraint: Constraint; values: readonly CoreNativeScalar[]; index: CoreIndexDefinition; interval: CoreInterval }>
  | Readonly<{ kind: "range"; index: CoreIndexDefinition; interval: CoreInterval }>;

export function coreNativeUniqueValues(constraint: Constraint, document: DocumentObject): Result.Result<readonly CoreNativeScalar[] | null, CoreTransactionError> {
  const eligibility = coreNativeConstraintEligibility(constraint);
  if (eligibility !== undefined && !coreNativeEligibilityMatches(eligibility, document)) return Result.succeed(null);
  const values: CoreNativeScalar[] = [];
  for (const field of coreNativeConstraintFields(constraint)) {
    const value = document[field];
    if (!isScalar(value)) return Result.fail(new CoreTransactionError({ reason: "documentValidation" }));
    values.push(value);
  }
  return Result.succeed(coreNativeConstraintNullsDistinct(constraint) && values.some(value => value === null) ? null : values);
}

export function coreNativeUniqueSelection(table: CoreTableDefinition, constraint: Constraint, values: readonly (Predicate | undefined)[]) {
  return Result.gen(function* () {
    const index = table.indexes.find(candidate => candidate.name === constraint.indexName);
    if (index === undefined) return yield* Result.fail(new CoreTransactionError({ reason: "indexUnavailable" }));
    const expressions: CapturedIndexRangeExpression[] = [];
    const fields = coreNativeConstraintFields(constraint);
    const eligibility = coreNativeConstraintEligibility(constraint);
    const prefix = eligibility === undefined ? [] : coreNativeEligibilityTerms(eligibility);
    for (const term of prefix) expressions.push({ op: "eq", field: term.field, value: term.value });
    for (const [position, field] of fields.entries()) {
      const value = values[position];
      if (value === undefined || isCoreNativeRange(value)) return yield* Result.fail(invalid());
      yield* Result.mapError(encodeIndexValue(value), invalid);
      if (!prefix.some(term => term.field === field)) expressions.push({ op: "eq", field, value });
    }
    return { index, interval: yield* Result.mapError(compileIndexRange(expressions, index.fields), invalid) };
  });
}

/** A trusted native page names an ordinary index; equality does not promote it to a unique slot. */
export function coreNativePageInterval(index: CoreIndexDefinition, where: CoreNativeWhere): Result.Result<CoreInterval, CoreError> {
  return Result.gen(function* () {
    const expressions: CapturedIndexRangeExpression[] = [];
    for (const field of index.fields) {
      if (!Object.hasOwn(where, field)) break;
      const value = where[field];
      if (value === undefined) break;
      if (isCoreNativeRange(value)) {
        for (const op of ["gt", "gte", "lt", "lte"] as const)
          if (Object.hasOwn(value, op) && value[op] !== undefined) expressions.push({ op, field, value: value[op] });
        break;
      }
      expressions.push({ op: "eq", field, value });
    }
    for (const expression of expressions) yield* Result.mapError(encodeIndexValue(expression.value), invalid);
    const interval = yield* Result.mapError(compileIndexRange(expressions, index.fields), invalid);
    return interval.end !== null && compareBytesLexicographically(interval.start, interval.end) > 0
      ? { start: interval.start, end: interval.start } : interval;
  });
}

/** Deterministic ID, complete unique tuple, longest ordinary prefix, then table. */
export function planCoreNativeQuery(table: CoreTableDefinition, where: CoreNativeWhere): Result.Result<CoreNativeQueryPlan, CoreError> {
  return Result.gen(function* () {
    if (Object.hasOwn(where, "_id")) {
      if (typeof where._id !== "string") return yield* Result.fail(invalid());
      return { kind: "id", id: where._id };
    }
    for (const constraint of table.nativePolicy?.uniqueConstraints ?? []) {
      const fields = coreNativeConstraintFields(constraint);
      const eligibility = coreNativeConstraintEligibility(constraint);
      if (eligibility !== undefined && !coreNativeEligibilityMatches(eligibility, where)) continue;
      if (!fields.every(field => Object.hasOwn(where, field) && !isCoreNativeRange(where[field]))
        || coreNativeConstraintNullsDistinct(constraint) && fields.some(field => where[field] === null)) continue;
      const values: CoreNativeScalar[] = [];
      for (const field of fields) {
        const value = where[field];
        if (value === undefined || isCoreNativeRange(value)) return yield* Result.fail(invalid());
        values.push(value);
      }
      const selected = yield* coreNativeUniqueSelection(table, constraint, values);
      return { kind: "unique", constraint, values, ...selected };
    }
    let selected: Readonly<{ index: CoreIndexDefinition; expressions: readonly CapturedIndexRangeExpression[]; count: number }> | undefined;
    for (const index of table.indexes) {
      if (index.name === "by_id" || index.name === "by_creation_time") continue;
      const expressions: CapturedIndexRangeExpression[] = [];
      let count = 0;
      for (const field of index.fields) {
        if (!Object.hasOwn(where, field)) break;
        const value = where[field];
        if (value === undefined) break;
        count += 1;
        if (isCoreNativeRange(value)) {
          for (const op of ["gt", "gte", "lt", "lte"] as const)
            if (Object.hasOwn(value, op) && value[op] !== undefined) expressions.push({ op, field, value: value[op] });
          break;
        }
        expressions.push({ op: "eq", field, value });
      }
      if (count > 0 && (selected === undefined || count > selected.count)) selected = { index, expressions, count };
    }
    if (selected === undefined) return { kind: "all" };
    for (const expression of selected.expressions) yield* Result.mapError(encodeIndexValue(expression.value), invalid);
    const interval = yield* Result.mapError(compileIndexRange(selected.expressions, selected.index.fields), invalid);
    return { kind: "range", index: selected.index, interval: interval.end !== null
      && compareBytesLexicographically(interval.start, interval.end) > 0 ? { start: interval.start, end: interval.start } : interval };
  });
}

/** Ordered, short-circuiting comparisons. Unused residual operands are not lowered. */
export function prepareCoreNativePredicate(where: CoreNativeWhere) {
  const fields = Object.entries(where).map(([field, predicate]) => ({ field, predicate,
    bounds: new Map<"gt" | "gte" | "lt" | "lte", Uint8Array>() }));
  return (document: DocumentObject): Result.Result<boolean, CoreNativeQueryError> => Result.gen(function* () {
    for (const member of fields) {
      if (!Object.hasOwn(document, member.field)) return false;
      const actual = document[member.field];
      if (!isCoreNativeRange(member.predicate)) {
        if (!(typeof actual === "number" && typeof member.predicate === "number"
          ? Object.is(actual, member.predicate) : actual === member.predicate)) return false;
        continue;
      }
      if (actual !== null && typeof actual !== "number" && typeof actual !== "boolean" && typeof actual !== "string") return false;
      const key = yield* Result.mapError(encodeIndexValue(actual), invalid);
      for (const op of ["gt", "gte", "lt", "lte"] as const) {
        const value = member.predicate[op];
        if (value === undefined) continue;
        let bound = member.bounds.get(op);
        if (bound === undefined) {
          bound = yield* Result.mapError(encodeIndexValue(value), invalid);
          member.bounds.set(op, bound);
        }
        const comparison = compareBytesLexicographically(key, bound);
        if (!(op === "gt" ? comparison > 0 : op === "gte" ? comparison >= 0 : op === "lt" ? comparison < 0 : comparison <= 0)) return false;
      }
    }
    return true;
  });
}
