import { Data, Result } from "effect";
import { isCanonicalIsoInstant } from "@flarex/time/iso-instant";
import type { Json, JsonObject } from "../json";
import type { RelationalColumnType, RelationalTableDefinition } from "./model";
import { decodeExactDecimal } from "../exact-decimal";

/** Values have already passed bounded JSON capture. Preserve their strings and
 * object keys across relational storage, without coercing exact numeric text. */
export function isRelationalJsonValue(value: Json): boolean {
  if (typeof value === "string") return relationalText(value);
  if (typeof value === "number") return Number.isFinite(value);
  if (value === null || typeof value !== "object") return true;
  return Array.isArray(value) ? value.every(isRelationalJsonValue) :
    Object.entries(value).every(([key, member]) => relationalText(key) && isRelationalJsonValue(member));
}

function relationalText(value: string): boolean {
  return !value.includes("\0") && !/[\uD800-\uDFFF]/u.test(value);
}

export function isRelationalColumnValue(type: RelationalColumnType, nullable: boolean, value: Json): boolean {
  if (value === null) return nullable;
  switch (type) {
    case "text": return typeof value === "string" && relationalText(value);
    case "boolean": return typeof value === "boolean";
    case "integer": return typeof value === "number" && Number.isSafeInteger(value) && value >= -2147483648 && value <= 2147483647;
    case "numeric": return ((typeof value === "number" && Number.isFinite(value)) ||
      (typeof value === "string" && value.length <= 1024 && /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?(?![\s\S])/.test(value))) &&
      Result.isSuccess(decodeExactDecimal(String(value)));
    case "jsonb": return isRelationalJsonValue(value);
    // Our native transport is canonical ISO text. PostgreSQL does not accept
    // ISO year zero or JS Date's signed six-digit expansion through this cast.
    case "timestamptz": return typeof value === "string" && /^(?!0000)\d{4}-/.test(value) && isCanonicalIsoInstant(value);
  }
}

export class RelationalRowValueError extends Data.TaggedError("RelationalRowValueError")<{
  readonly reason: "unknownColumn" | "missingColumn" | "invalidValue" | "constraintViolation";
  readonly column: string;
}> {}

/** Complete row-local contract for an authenticated, normalized table. Defaults
 * must already be applied by the semantic owner. Keys, foreign keys, lifecycle
 * capabilities and serving authority require their separate shared owners. */
export function validateRelationalRowValues(table: RelationalTableDefinition, row: JsonObject): Result.Result<void, RelationalRowValueError> {
  for (const name of Object.keys(row)) {
    if (!table.columns.some(column => column.identity.columnId === name))
      return Result.fail(new RelationalRowValueError({ reason: "unknownColumn", column: name }));
  }
  for (const column of table.columns) {
    const name = column.identity.columnId;
    if (!Object.hasOwn(row, name)) return Result.fail(new RelationalRowValueError({ reason: "missingColumn", column: name }));
    const value = row[name];
    // PostgreSQL integer input folds signed zero. Stored rows must have that
    // canonical value before shared ordered and unique keys are derived.
    if (value === undefined || !isRelationalColumnValue(column.type, column.nullable, value) ||
        (column.type === "integer" && Object.is(value, -0)))
      return Result.fail(new RelationalRowValueError({ reason: "invalidValue", column: name }));
  }
  for (const constraint of table.constraints) {
    if (constraint.kind === "foreignKey") continue;
    const value = row[constraint.column.columnId];
    // SQL CHECK predicates admit NULL; the column contract owns nullability.
    if (value === null) continue;
    const valid = constraint.kind === "textSet"
      ? typeof value === "string" && constraint.values.includes(value)
      : typeof value === "number" && (constraint.minimum === null || value >= constraint.minimum) &&
        (constraint.maximum === null || value <= constraint.maximum);
    if (!valid) return Result.fail(new RelationalRowValueError({ reason: "constraintViolation", column: constraint.column.columnId }));
  }
  return Result.succeed(undefined);
}
