import { Option, Result, Schema } from "effect";
import { FlarexValueCodecV1Error } from "flarex-protocol/value";
import { compileAppOrderedIndexBoundsV1, encodeOrderedIndexComponentsV1, orderedIndexValueFromFlarexValueV1,
  InvalidOrderedIndexRangeV1Error, OrderedIndexKeyTooLargeError, type OrderedIndexRangeExpressionV1 } from "flarex-protocol/ordered-index";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LogicalDocumentFailure } from "./model";

const Scalar = Schema.Union([Schema.String, Schema.Number, Schema.Boolean, Schema.Null]);
const Range = Schema.Struct({ gt: Schema.optionalKey(Scalar), gte: Schema.optionalKey(Scalar),
  lt: Schema.optionalKey(Scalar), lte: Schema.optionalKey(Scalar),
}).annotate({ parseOptions: { onExcessProperty: "error" } }).check(Schema.makeFilter(range =>
  Object.keys(range).length > 0 && !(Object.hasOwn(range, "gt") && Object.hasOwn(range, "gte")) &&
    !(Object.hasOwn(range, "lt") && Object.hasOwn(range, "lte")) ? undefined : "Expected one lower and/or upper bound"));
export const LogicalFindQuery = Schema.Struct({
  where: Schema.Record(Schema.String, Schema.Union([Scalar, Range])),
  offset: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  limit: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: Number.MAX_SAFE_INTEGER })),
});
export const decodeLogicalFindQuery = Schema.decodeUnknownResult(LogicalFindQuery, { onExcessProperty: "error" });
export type LogicalWhere = typeof LogicalFindQuery.Type["where"];
export const isLogicalRange = (value: LogicalWhere[string] | undefined): value is typeof Range.Type => value !== null && typeof value === "object";

/** Select a declared equality prefix and at most one following range. The shared
 * ordered codec owns bounds and value ordering; this does not grant authority. */
export function selectLogicalIndex<Failure>(definitions: readonly LocatedAppIndexDefinitionV1[], tableId: CatalogTableId, where: LogicalWhere, error: LogicalDocumentFailure<Failure>) {
  return Result.try({ try: () => {
    let selected = Option.none<{ definition: LocatedAppIndexDefinitionV1; expressions: OrderedIndexRangeExpressionV1[]; fields: number }>();
    for (const definition of definitions) {
      if (definition.access.kind !== "developer" || definition.access.tableId !== tableId) continue;
      const membership = definition.physicalSpec.predicate;
      if (membership !== undefined && where[membership.field] !== null) continue;
      // This scalar query contract describes native values, never decimal text.
      if (definition.physicalSpec.orderedFields.some(field => field.kind === "documentPath" && field.valueFormat !== undefined)) continue;
      const expressions: OrderedIndexRangeExpressionV1[] = [];
      let fields = 0;
      for (const field of definition.physicalSpec.orderedFields) {
        if (field.kind !== "documentPath" || field.path.includes(".")) break;
        const predicate = where[field.path];
        if (predicate === undefined) break;
        fields++;
        if (isLogicalRange(predicate)) {
          for (const op of ["gt", "gte", "lt", "lte"] as const) if (Object.hasOwn(predicate, op)) {
            const value = predicate[op];
            if (value !== undefined) expressions.push({ op, field, value: orderedIndexValueFromFlarexValueV1(value) });
          }
          break;
        }
        expressions.push({ op: "eq", field, value: orderedIndexValueFromFlarexValueV1(predicate) });
      }
      if (fields > 0 && (Option.isNone(selected) || fields > selected.value.fields)) selected = Option.some({ definition, expressions, fields });
    }
    if (Option.isNone(selected)) return Option.none();
    const chosen = selected.value;
    const compiled = compileAppOrderedIndexBoundsV1({ spec: chosen.definition.physicalSpec, expressions: chosen.expressions });
    const bounds = compiled.startInclusive !== undefined && compiled.endExclusive !== undefined && compiled.startInclusive > compiled.endExclusive
      ? { startInclusive: compiled.startInclusive, endExclusive: compiled.startInclusive } : compiled;
    return Option.some(Object.freeze({ definition: chosen.definition, bounds,
      identity: JSON.stringify([chosen.definition.indexDefinitionId, bounds.startInclusive ?? null, bounds.endExclusive ?? null]) }));
  }, catch: cause => {
    if (cause instanceof InvalidOrderedIndexRangeV1Error || cause instanceof OrderedIndexKeyTooLargeError || cause instanceof FlarexValueCodecV1Error) return error("invalidInput", cause);
    throw cause;
  } });
}

export function logicalQueryMatches<Failure>(document: Record<string, unknown>, where: LogicalWhere, error: LogicalDocumentFailure<Failure>) {
  return Result.try({ try: () => Object.entries(where).every(([field, predicate]) => {
    if (!Object.hasOwn(document, field)) return false;
    const actual = document[field];
    if (!isLogicalRange(predicate)) return typeof actual === "number" && typeof predicate === "number" ? Object.is(actual, predicate) : actual === predicate;
    if (actual !== null && typeof actual !== "string" && typeof actual !== "number" && typeof actual !== "boolean") return false;
    const key = encodeOrderedIndexComponentsV1([orderedIndexValueFromFlarexValueV1(actual)]);
    return (["gt", "gte", "lt", "lte"] as const).every(op => {
      const value = predicate[op];
      if (value === undefined) return true;
      const bound = encodeOrderedIndexComponentsV1([orderedIndexValueFromFlarexValueV1(value)]);
      return op === "gt" ? key > bound : op === "gte" ? key >= bound : op === "lt" ? key < bound : key <= bound;
    });
  }), catch: cause => {
    if (cause instanceof FlarexValueCodecV1Error) return error("invalidInput", cause);
    if (cause instanceof OrderedIndexKeyTooLargeError) return error("limitExceeded", cause);
    throw cause;
  } });
}
