import { Option, Result, Schema } from "effect";
import { FlarexValueCodecV1Error } from "flarex-protocol/value";
import { compileAppOrderedIndexBoundsV1, encodeOrderedIndexComponentsV1, orderedIndexValueFromFlarexValueV1,
  orderedIndexValueForAppFieldV1,
  InvalidOrderedIndexRangeV1Error, OrderedIndexCodecV1InputError, OrderedIndexKeyTooLargeError,
  type OrderedIndexRangeExpressionV1 } from "flarex-protocol/ordered-index";
import type { CatalogTableId } from "flarex-protocol/catalog";
import type { LocatedAppIndexDefinitionV1 } from "../appIndexDefinitions";
import type { LocatedAppUniqueConstraintDefinitionV1 } from "../appUniqueConstraintDefinitions";
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

/** The working set's existing first eligible complete unique-key selection. */
export function selectLogicalUniqueConstraint(definitions: readonly LocatedAppUniqueConstraintDefinitionV1[], tableId: CatalogTableId,
  where: LogicalWhere) {
  return definitions.find(candidate => candidate.tableId === tableId && candidate.physicalSpec.predicate === undefined &&
    !(candidate.physicalSpec.nullsDistinct === true && candidate.physicalSpec.orderedFields.some(field => where[field] === null)) &&
    candidate.physicalSpec.orderedFields.every(field => !field.includes(".") && Object.hasOwn(where, field) && !isLogicalRange(where[field])));
}

/** A page's physical order must be equality-prefix + requested column, with
 * only the intrinsic creation time and core row identity as tie-breaks. A longer suffix cannot be sorted
 * away without changing the bounded-work contract. */
export function selectLogicalPageIndex<Failure>(definitions: readonly LocatedAppIndexDefinitionV1[], tableId: CatalogTableId,
  orderColumn: string, equality: Readonly<{ column: string; value: string | boolean }> | undefined,
  requiredNulls: readonly string[], error: LogicalDocumentFailure<Failure>) {
  return Result.try({ try: () => {
    for (const definition of definitions) {
      if (definition.access.kind !== "developer" || definition.access.tableId !== tableId) continue;
      const predicate = definition.physicalSpec.predicate;
      if (predicate !== undefined && !(predicate.kind === "fieldIsNull" ? requiredNulls.includes(predicate.field)
        : requiredNulls.includes(predicate.nullField) && equality?.column === predicate.textField && equality.value === predicate.value)) continue;
      const ordered = definition.physicalSpec.orderedFields;
      if (ordered.at(-1)?.kind !== "systemCreationTime") continue;
      const fields = ordered.slice(0, -1);
      if (equality !== undefined && equality.column !== orderColumn && fields.length !== 2) continue;
      const last = fields[fields.length - 1];
      if (last?.kind !== "documentPath" || last.path !== orderColumn || last.valueFormat !== undefined) continue;
      const expressions: OrderedIndexRangeExpressionV1[] = [];
      let aligned = true;
      for (const field of fields.slice(0, -1)) {
        if (field.kind !== "documentPath" || field.valueFormat !== undefined || field.path !== equality?.column) { aligned = false; break; }
        expressions.push({ op: "eq", field, value: orderedIndexValueForAppFieldV1(field, equality.value) });
      }
      if (!aligned) continue;
      if (equality?.column === orderColumn) expressions.push({ op: "eq", field: last,
        value: orderedIndexValueForAppFieldV1(last, equality.value) });
      return Option.some(Object.freeze({ definition, bounds: compileAppOrderedIndexBoundsV1({ spec: definition.physicalSpec, expressions }) }));
    }
    return Option.none();
  }, catch: cause => {
    if (cause instanceof InvalidOrderedIndexRangeV1Error || cause instanceof OrderedIndexCodecV1InputError ||
      cause instanceof OrderedIndexKeyTooLargeError || cause instanceof FlarexValueCodecV1Error) return error("invalidInput", cause);
    throw cause;
  } });
}

/** Select a declared equality prefix and at most one following range. The shared
 * ordered codec owns bounds and value ordering; this does not grant authority. */
export function selectLogicalIndex<Failure>(definitions: readonly LocatedAppIndexDefinitionV1[], tableId: CatalogTableId, where: LogicalWhere,
  error: LogicalDocumentFailure<Failure>, exactPoint?: Readonly<{ columns: readonly string[]; nullColumn?: string }>) {
  return Result.try({ try: () => {
    let selected = Option.none<{ definition: LocatedAppIndexDefinitionV1; expressions: OrderedIndexRangeExpressionV1[]; fields: number }>();
    for (const definition of definitions) {
      if (definition.access.kind !== "developer" || definition.access.tableId !== tableId) continue;
      const membership = definition.physicalSpec.predicate;
      if (exactPoint !== undefined && (definition.physicalSpec.orderedFields.length < exactPoint.columns.length ||
        !exactPoint.columns.every((column, offset) => {
          const field = definition.physicalSpec.orderedFields[offset];
          return field?.kind === "documentPath" && field.path === column;
        }) || (exactPoint.nullColumn === undefined ? membership !== undefined :
          membership?.kind !== "fieldIsNull" || membership.field !== exactPoint.nullColumn))) continue;
      if (membership !== undefined && !(membership.kind === "fieldIsNull"
        ? where[membership.field] === null
        : where[membership.nullField] === null && where[membership.textField] === membership.value)) continue;
      const expressions: OrderedIndexRangeExpressionV1[] = [];
      let fields = 0;
      for (const field of definition.physicalSpec.orderedFields) {
        // A decimal suffix does not invalidate an earlier native scalar prefix.
        if (field.kind !== "documentPath" || field.path.includes(".") || field.valueFormat === "exactDecimal") break;
        const predicate = where[field.path];
        if (predicate === undefined) break;
        if (field.valueFormat === "sha256TextV1" && isLogicalRange(predicate)) break;
        fields++;
        if (isLogicalRange(predicate)) {
          for (const op of ["gt", "gte", "lt", "lte"] as const) if (Object.hasOwn(predicate, op)) {
            const value = predicate[op];
            if (value !== undefined) expressions.push({ op, field, value: orderedIndexValueFromFlarexValueV1(value) });
          }
          break;
        }
        expressions.push({ op: "eq", field, value: orderedIndexValueForAppFieldV1(field, predicate) });
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
    if (cause instanceof InvalidOrderedIndexRangeV1Error || cause instanceof OrderedIndexCodecV1InputError ||
      cause instanceof OrderedIndexKeyTooLargeError || cause instanceof FlarexValueCodecV1Error) return error("invalidInput", cause);
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
