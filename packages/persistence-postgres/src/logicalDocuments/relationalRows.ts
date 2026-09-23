import { Result, Schema } from "effect";
import { decodeExactDecimal } from "flarex-protocol/internal/exact-decimal";
import { isRelationalColumnValue, validateRelationalRowValues, type RelationalColumnIdentity, type RelationalPersistenceCapability, type RelationalTableDefinition } from "flarex-protocol/internal/relational-schema";
import type { JsonObject } from "flarex-protocol/json";
import type { LogicalDocumentFailure } from "./model";

export function relationalTextIdentity<Failure>(table: RelationalTableDefinition, error: LogicalDocumentFailure<Failure>) {
  const primary = table.keys.find(key => key.kind === "primary");
  const unique = table.keys.filter(key => key.kind === "unique");
  const selected = primary ?? (unique.length === 1 ? unique[0] : undefined);
  const columns = selected?.columns.map(column => column.columnId);
  return columns === undefined || columns.length === 0 ||
    columns.some(key => {
      const column = table.columns.find(candidate => candidate.identity.columnId === key);
      return column?.type !== "text" || column.nullable;
    }) ? Result.fail(error("invalidInput")) : Result.succeed(Object.freeze(columns));
}

const Raw = Schema.Struct({ value: Schema.String,
  precision: Schema.Number.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 1000 })),
}).annotate({ parseOptions: { onExcessProperty: "ignore" } });
const decodeRaw = Schema.decodeUnknownResult(Raw);

const belongsTo = (table: RelationalTableDefinition, column: RelationalColumnIdentity) =>
  column.owner === table.identity.owner && column.lineageId === table.identity.lineageId && column.tableId === table.identity.tableId;

/** Complete native values are checked before projection or mutation. Relation
 * enforcement is a separate execution capability, not a row-value rule. */
export function prepareLogicalRelationalRowValues<Failure>(table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[], error: LogicalDocumentFailure<Failure>) {
  const companions = capabilities.flatMap(capability => capability.kind === "exactNumericCompanion" && belongsTo(table, capability.numericColumn)
    ? [{ numeric: capability.numericColumn.columnId, raw: capability.rawColumn.columnId }] : []);
  return (row: JsonObject, reason: "documentInvalid" | "storedCorruption") => Result.gen(function* () {
    yield* validateRelationalRowValues(table, row).pipe(Result.mapError(cause => error(reason, cause)));
    for (const companion of companions) {
      const value = row[companion.numeric];
      const rawValue = row[companion.raw];
      if (value === null && rawValue === null) continue;
      const raw = yield* decodeRaw(rawValue).pipe(Result.mapError(cause => error(reason, cause)));
      const numeric = yield* decodeExactDecimal(String(value)).pipe(Result.mapError(cause => error(reason, cause)));
      const exact = yield* decodeExactDecimal(raw.value).pipe(Result.mapError(cause => error(reason, cause)));
      if (numeric.canonical !== exact.canonical) return yield* Result.fail(error(reason));
    }
  });
}

/** Row-local semantics for the admitted scalar relational profile. Defaults and
 * managed fields use the borrowed transaction's timestamp. Native adapters keep
 * ownership of their input coercion and numeric precision rules. */
export function prepareLogicalRelationalRows<Failure>(table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[], error: LogicalDocumentFailure<Failure>) {
  return Result.gen(function* () {
    const keyColumns = yield* relationalTextIdentity(table, error);
    const managed = capabilities.flatMap(capability => capability.kind === "managedTimestamps" && belongsTo(table, capability.createdAtColumn)
      ? [capability.updatedAtColumn.columnId] : []);
    const deletions = capabilities.flatMap(capability => capability.kind === "softDelete" && belongsTo(table, capability.deletedAtColumn)
      ? [capability.deletedAtColumn.columnId] : []);
    const validate = prepareLogicalRelationalRowValues(table, capabilities, error);
    const validateInput = (input: JsonObject) => Result.gen(function* () {
      // A native write cannot smuggle internal Flarex identity fields or columns
      // outside its source. Complete rows are validated again after defaults.
      for (const [name, value] of Object.entries(input)) {
        const column = table.columns.find(candidate => candidate.identity.columnId === name);
        if (column === undefined || !isRelationalColumnValue(column.type, column.nullable, value))
          return yield* Result.fail(error("documentInvalid"));
      }
    });
    const normalize = (input: JsonObject, previous: JsonObject | null, timestamp: string) => Result.gen(function* () {
      yield* validateInput(input);
      const row = { ...previous, ...input };
      if (previous === null) for (const column of table.columns) {
        const name = column.identity.columnId;
        if (Object.hasOwn(row, name)) continue;
        const value = column.default;
        switch (value.kind) {
          case "none": if (column.nullable) row[name] = null; break;
          case "currentTimestamp": row[name] = timestamp; break;
          case "exactNumericRawLiteral": row[name] = { value: value.value, precision: value.precision }; break;
          case "booleanLiteral": case "textLiteral": case "integerLiteral": case "exactNumericLiteral": row[name] = value.value; break;
        }
      }
      else for (const column of managed) row[column] = timestamp;
      for (const column of table.columns) {
        if (column.type === "integer" && Object.is(row[column.identity.columnId], -0))
          row[column.identity.columnId] = 0;
      }
      yield* validate(row, "documentInvalid");
      return row;
    });
    return Object.freeze({ keyColumns, normalize, validate, validateInput, deletedAt: deletions.length === 1 ? deletions[0] : undefined });
  });
}
