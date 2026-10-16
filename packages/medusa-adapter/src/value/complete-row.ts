import { Result, Schema } from "effect";
import { commerceError, type CommerceTransactionError, type JsonObject } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../schema/model";
import { commerceDecoder } from "./decoder";

/** Compile full row shape and value representation from the checked DML.
 * Storage still owns defaults, required writes, references and constraints. */
export function compileCompleteRow(table: SchemaTable) {
  return Result.gen(function* () {
    const values: { readonly name: string; readonly decode: (input: unknown) => Result.Result<unknown, CommerceTransactionError> }[] = [];
    for (const column of table.columns) {
      const scalar = column.type === "id" || column.type === "text" || column.type === "dateTime" ? Schema.String :
        column.type === "boolean" ? Schema.Boolean : column.type === "json" ? Schema.Json :
          column.type === "array" ? Schema.Array(Schema.String) :
            column.type === "enum" && column.options?.choices !== undefined ? Schema.Literals(column.options.choices) : undefined;
      if (scalar === undefined) return yield* Result.fail(commerceError("unsupportedProfile"));
      values.push({ name: column.name, decode: commerceDecoder(column.nullable ? Schema.NullOr(scalar) : scalar, "storedCorruption") });
    }
    const decodeShape = commerceDecoder(Schema.Record(Schema.Literals(table.columns.map(column => column.name)), Schema.Json), "storedCorruption");
    return (input: unknown): Result.Result<JsonObject, CommerceTransactionError> => Result.gen(function* () {
      const row = yield* decodeShape(input);
      for (const value of values) yield* value.decode(row[value.name]);
      return row;
    });
  });
}
