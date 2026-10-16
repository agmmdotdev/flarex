import { Result, Schema } from "effect";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../schema/model";
import { commerceDecoder, commerceRowDecoder } from "./decoder";

/** Compile checked DML scalar representations once for complete rows and native
 * selected preimages. Storage retains defaults, writes and constraints. */
function compileColumnValues(table: SchemaTable) {
  return Result.gen(function* () {
    const values: { readonly name: string; readonly decode: (input: unknown) => Result.Result<unknown, CommerceTransactionError> }[] = [];
    for (const column of table.columns) {
      const scalar = column.type === "id" || column.type === "text" || column.type === "dateTime" ? Schema.String :
        column.type === "boolean" ? Schema.Boolean : column.type === "json" ? Schema.Json :
          column.type === "number" ? Schema.Number.check(Schema.isFinite()) :
          column.type === "array" ? Schema.Array(Schema.String) :
            column.type === "enum" && column.options?.choices !== undefined ? Schema.Literals(column.options.choices) : undefined;
      if (scalar === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      values.push({ name: column.name, decode: commerceDecoder(column.nullable ? Schema.NullOr(scalar) : scalar, "storedCorruption") });
    }
    return values;
  });
}

/** Full native returns require every checked DML column. */
export function compileCompleteRow(table: SchemaTable) {
  return Result.gen(function* () {
    const values = yield* compileColumnValues(table);
    const decodeShape = commerceDecoder(Schema.Record(Schema.Literals(table.columns.map(column => column.name)), Schema.Json), "storedCorruption");
    return (input: unknown): Result.Result<JsonObject, CommerceTransactionError> => Result.gen(function* () {
      const row = yield* decodeShape(input);
      for (const value of values) yield* value.decode(row[value.name]);
      return row;
    });
  });
}

/** Native workflow preimages may select a subset; supplied values and keys
 * still follow the same checked DML contract as complete rows. */
export function compileRowProjection(table: SchemaTable) {
  return Result.gen(function* () {
    const values = yield* compileColumnValues(table);
    const decodeShape = commerceRowDecoder(table.columns.map(column => column.name), "storedCorruption");
    return (input: unknown) => Result.gen(function* () {
      const row = yield* decodeShape(input);
      for (const value of values) if (row[value.name] !== undefined) yield* value.decode(row[value.name]);
      return row;
    });
  });
}
