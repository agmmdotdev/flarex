import { Result, Schema } from "effect";
import { decodeExactDecimal } from "flarex-protocol/internal/exact-decimal";
import { isRelationalColumnValue, validateRelationalRowColumns, validateRelationalRowValues,
  type RelationalColumnIdentity, type RelationalConstraintIdentity, type RelationalPersistenceCapability,
  type RelationalTableDefinition, RelationalRowValueError } from "flarex-protocol/internal/relational-schema";
import { isJsonObject, type JsonObject } from "flarex-protocol/json";
import { inspectCapturedPrivateJsonData, useCapturedPrivateJsonData } from "./privateJsonData";

export type RelationalRowFailureReason = "invalidInput" | "documentInvalid" | "storedCorruption" | "limitExceeded";
export type RelationalRowFailureDiagnostic =
  | Readonly<{ origin: "input" | "row"; kind: "missing" | "null"; column: string; candidate: JsonObject }>
  | Readonly<{ origin: "row"; kind: "check"; column: string; constraint: RelationalConstraintIdentity; candidate: JsonObject }>;
/** The execution owner supplies its failure and diagnostic provenance. These
 * row-local facts grant no storage, canonical-document or conversion authority. */
export type RelationalRowFailure<Failure> = (reason: RelationalRowFailureReason, cause?: unknown,
  diagnostic?: RelationalRowFailureDiagnostic) => Failure;

export function relationalTextIdentity<Failure>(table: RelationalTableDefinition, error: (reason: "invalidInput") => Failure) {
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

export const relationalManagedUpdatedColumns = (table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[]) => capabilities.flatMap(capability =>
  capability.kind === "managedTimestamps" && belongsTo(table, capability.createdAtColumn)
    ? [capability.updatedAtColumn.columnId] : []);

/** The row validator has already selected this issue. Preserve required-column
 * and CHECK diagnostics without repeating validation at the execution boundary. */
function rowValueFailure<Failure>(table: RelationalTableDefinition, row: JsonObject,
  reason: "documentInvalid" | "storedCorruption", error: RelationalRowFailure<Failure>, cause: RelationalRowValueError): Failure {
  const diagnostic = reason === "documentInvalid" && cause.reason === "missingColumn" &&
    table.columns.some(column => column.identity.columnId === cause.column && !column.nullable)
    ? { origin: "row" as const, kind: "missing" as const, column: cause.column, candidate: row }
    : reason === "documentInvalid" && cause.reason === "constraintViolation" && cause.constraint !== undefined
      ? { origin: "row" as const, kind: "check" as const, column: cause.column, constraint: cause.constraint, candidate: row }
      : undefined;
  return error(reason, cause, diagnostic);
}

/** Complete native values are checked before projection or mutation. Relation
 * enforcement and actual storage conversion belong to their execution owners. */
export function prepareRelationalRowValues<Failure>(table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[], error: RelationalRowFailure<Failure>) {
  const companions = capabilities.flatMap(capability => capability.kind === "exactNumericCompanion" && belongsTo(table, capability.numericColumn)
    ? [{ numeric: capability.numericColumn.columnId, raw: capability.rawColumn.columnId }] : []);
  return (row: JsonObject, reason: "documentInvalid" | "storedCorruption") => Result.gen(function* () {
    yield* validateRelationalRowValues(table, row).pipe(Result.mapError(cause => rowValueFailure(table, row, reason, error, cause)));
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

/** Shared row-local defaults and values. The trusted execution owner supplies
 * one timestamp and retains any required storage-conversion/canonical proofs.
 * Native adapters keep their input coercion and numeric precision semantics. */
export function prepareRelationalRows<Failure>(table: RelationalTableDefinition,
  capabilities: readonly RelationalPersistenceCapability[], error: RelationalRowFailure<Failure>) {
  return Result.gen(function* () {
    const validate = prepareRelationalRowValues(table, capabilities, error);
    const keyColumns = yield* relationalTextIdentity(table, error);
    const managed = relationalManagedUpdatedColumns(table, capabilities);
    const deletions = capabilities.flatMap(capability => capability.kind === "softDelete" && belongsTo(table, capability.deletedAtColumn)
      ? [capability.deletedAtColumn.columnId] : []);
    const managedColumns = capabilities.flatMap(capability =>
      capability.kind === "managedTimestamps" && belongsTo(table, capability.createdAtColumn)
        ? [capability.createdAtColumn.columnId, capability.updatedAtColumn.columnId]
        : capability.kind === "softDelete" && belongsTo(table, capability.deletedAtColumn) ? [capability.deletedAtColumn.columnId] : []);
    const columnsByName = new Map<string, typeof table.columns[number]>(table.columns.map(column => [column.identity.columnId, column]));
    const suppliedRows = new WeakSet<JsonObject>();
    const validateInput = (input: JsonObject, required: "defer" | undefined = undefined) => Result.gen(function* () {
      // A native write cannot smuggle internal identity fields or columns
      // outside its source. Entity batches retain these guards, then check
      // non-key scalars after the required sweep.
      for (const [name, value] of Object.entries(input)) {
        const column = columnsByName.get(name);
        const deferredScalar = required === "defer" && !keyColumns.some(key => key === name);
        if (column === undefined || !deferredScalar && !(column.default.kind === "serialNext" && value === null) &&
          !(required === "defer" && !column.nullable && value === null) && !isRelationalColumnValue(column.type, column.nullable, value)) {
          return yield* Result.fail(error("documentInvalid", undefined,
            column !== undefined && !column.nullable && value === null
              ? { origin: "input", kind: "null", column: name, candidate: input } : undefined));
        }
      }
      // Only the capture owner's exact detached immutable tree can retain this
      // supplied-input verdict. A frozen foreign wrapper is insufficient.
      if (required === undefined && inspectCapturedPrivateJsonData(input)?.value === input) suppliedRows.add(input);
    });
    const applyDefaults = (input: JsonObject, previous: JsonObject | null, timestamp: string,
      managedUpdate: "advance" | "preserve") => {
      const row = { ...previous, ...input };
      if (previous === null) for (const column of table.columns) {
        const name = column.identity.columnId;
        if (Object.hasOwn(row, name)) continue;
        const value = column.default;
        switch (value.kind) {
          case "none": if (column.nullable) row[name] = null; break;
          // Serial allocation needs indexed membership and its dependencies.
          // The execution owner supplies it before row-local normalization.
          case "serialNext": break;
          case "currentTimestamp": row[name] = timestamp; break;
          case "emptyJsonArray": row[name] = []; break;
          case "emptyJsonObject": row[name] = {}; break;
          case "exactNumericRawLiteral": row[name] = { value: value.value, precision: value.precision }; break;
          case "booleanLiteral": case "textLiteral": case "integerLiteral": case "doublePrecisionLiteral": case "exactNumericLiteral": row[name] = value.value; break;
        }
      }
      else if (managedUpdate === "advance") for (const column of managed) row[column] = timestamp;
      for (const column of table.columns) {
        if ((column.type === "integer" || column.type === "doublePrecision") && Object.is(row[column.identity.columnId], -0))
          row[column.identity.columnId] = 0;
      }
      return row;
    };
    // This phase checks only required values after ordinary pure defaults,
    // including omitted transaction-time fields. Explicit null is not a
    // default request. No scalar conversion or CHECK runs here.
    const validateInsertRequired = (input: JsonObject, timestamp: string) => Result.gen(function* () {
      const row = applyDefaults(input, null, timestamp, "advance");
      for (const column of table.columns) {
        if (column.nullable || column.default.kind === "serialNext") continue;
        const name = column.identity.columnId;
        const missing = !Object.hasOwn(row, name);
        if (!missing && row[name] !== null) continue;
        const captured = yield* useCapturedPrivateJsonData(row, Number.MAX_SAFE_INTEGER, error);
        if (!isJsonObject(captured.value)) return yield* Result.fail(error("documentInvalid"));
        if (missing) return yield* Result.fail(rowValueFailure(table, captured.value, "documentInvalid", error,
          new RelationalRowValueError({ reason: "missingColumn", column: name })));
        return yield* Result.fail(error("documentInvalid", undefined,
          { origin: "input", kind: "null", column: name, candidate: captured.value }));
      }
    });
    const normalize = (input: JsonObject, previous: JsonObject | null, timestamp: string,
      managedUpdate: "advance" | "preserve" = "advance") => Result.gen(function* () {
      if (!suppliedRows.has(input)) yield* validateInput(input);
      const row = applyDefaults(input, previous, timestamp, managedUpdate);
      // Request/document accounting remains with the accepting execution owner.
      const captured = yield* useCapturedPrivateJsonData(row, Number.MAX_SAFE_INTEGER, error);
      if (!isJsonObject(captured.value)) return yield* Result.fail(error("documentInvalid"));
      const normalizedRow = captured.value;
      yield* table.columns.some(column => column.type === "real")
        ? validateRelationalRowColumns(table, normalizedRow).pipe(Result.mapError(cause => rowValueFailure(table, normalizedRow, "documentInvalid", error, cause)))
        : validate(normalizedRow, "documentInvalid");
      return normalizedRow;
    });
    return Object.freeze({ keyColumns, managedColumns: Object.freeze(managedColumns), normalize, validate, validateInput, validateInsertRequired,
      deletedAt: deletions.length === 1 ? deletions[0] : undefined });
  });
}
