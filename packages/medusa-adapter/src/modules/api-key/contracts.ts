import { Effect, Result, Schema } from "effect";
import { commerceError, type JsonObject, type defaultCommerceResources } from "@flarex/persistence-postgres/internal/commerce-values";
import type { SchemaTable } from "../../schema/model";
import { commerceDecoder } from "../../value/decoder";
import { compileCompleteRow, compileRowProjection } from "../../value/complete-row";
import { captureCommerceInput } from "../../value/input";

export const ApiKeyId = Schema.String.check(Schema.isLengthBetween(1, 256));
export const ApiKeyCreate = Schema.Struct({ title: Schema.String.check(Schema.isMaxLength(256)), type: Schema.Literal("publishable"),
  created_by: Schema.String.check(Schema.isMaxLength(256)) });
export const ApiKeyCreateRows = Schema.Array(ApiKeyCreate).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const ApiKeyCreationInput = Schema.Struct({ api_keys: ApiKeyCreateRows });
export const ApiKeyIds = Schema.Array(ApiKeyId).pipe(Schema.mutable).check(Schema.isMaxLength(4));
export const decodeApiKeyCreation = commerceDecoder(ApiKeyCreateRows, "unsupportedProfile");
export const decodeApiKeyIds = commerceDecoder(ApiKeyIds, "unsupportedProfile");
const decodeUnknownRows = commerceDecoder(Schema.Array(Schema.Unknown).check(Schema.isMaxLength(4)), "storedCorruption");
const decodeJsonRow = commerceDecoder(Schema.JsonObject, "storedCorruption");
const decodePreimageId = commerceDecoder(ApiKeyId, "storedCorruption");

/** Checked DML owns every returned field; the native public DTO deliberately
 * hides only salt. Publishable creation has the native empty stored salt. */
export function compileApiKeyContracts(table: SchemaTable) {
  return Result.gen(function* () {
    if (table.name !== "api_key" || table.foreignKeys.length)
      return yield* Result.fail(commerceError("unsupportedProfile"));
    const complete = yield* compileCompleteRow(table);
    const projection = yield* compileRowProjection(table);
    const preimages = (input: unknown) => decodeUnknownRows(input).pipe(Result.flatMap(values => Result.gen(function* () {
      const rows: JsonObject[] = [];
      for (const value of values) {
        const row = yield* decodeJsonRow(value);
        yield* projection(row);
        yield* decodePreimageId(row.id);
        if (Object.hasOwn(row, "salt")) return yield* Result.fail(commerceError("storedCorruption"));
        rows.push(row);
      }
      return rows;
    })));
    const output = (input: unknown) => decodeUnknownRows(input).pipe(Result.flatMap(values => Result.gen(function* () {
      const rows: JsonObject[] = [];
      for (const value of values) {
        const row = yield* decodeJsonRow(value);
        if (Object.hasOwn(row, "salt") || row.type !== "publishable" || typeof row.token !== "string" || !/^pk_[0-9a-f]{64}$/.test(row.token))
          return yield* Result.fail(commerceError("storedCorruption"));
        yield* complete({ ...row, salt: "" });
        rows.push(row);
      }
      return rows;
    })));
    const captureOutput = Effect.fn("ApiKey.captureNativeOutput")(function* (input: unknown, resources: typeof defaultCommerceResources) {
      let unsupportedOmission = false;
      const captured = yield* Effect.fromResult(captureCommerceInput(input, resources, path => {
        if (path.length !== 2 || !/^(0|[1-3])$/.test(path[0] ?? "") || path[1] !== "salt") unsupportedOmission = true;
      }));
      if (unsupportedOmission) return yield* Effect.fail(commerceError("storedCorruption"));
      return yield* Effect.fromResult(output(captured));
    });
    const capturePreimages = Effect.fn("ApiKey.captureNativePreimages")(function* (input: unknown, resources: typeof defaultCommerceResources) {
      let unsupportedOmission = false;
      const captured = yield* Effect.fromResult(captureCommerceInput(input, resources, path => {
        // Native omitToken assigns an own undefined token on projections that
        // did not select it. Salt is deliberately removed by that formatter.
        if (path.length !== 2 || !/^(0|[1-3])$/.test(path[0] ?? "") || path[1] !== "token") unsupportedOmission = true;
      }));
      if (unsupportedOmission) return yield* Effect.fail(commerceError("storedCorruption"));
      return yield* Effect.fromResult(preimages(captured));
    });
    const captureStored = Effect.fn("ApiKey.captureNativeStoredOutput")(function* (input: unknown, resources: typeof defaultCommerceResources) {
      let omitted = false;
      const captured = yield* Effect.fromResult(captureCommerceInput(input, resources, () => { omitted = true; }));
      if (omitted) return yield* Effect.fail(commerceError("storedCorruption"));
      const rows = yield* Effect.fromResult(decodeUnknownRows(captured));
      for (const value of rows) {
        const row = yield* Effect.fromResult(complete(value));
        if (row.salt !== "") return yield* Effect.fail(commerceError("storedCorruption"));
        const { salt: _salt, ...publicRow } = row;
        yield* Effect.fromResult(output([publicRow]));
      }
    });
    return { complete, output, captureOutput, preimages, capturePreimages, captureStored };
  });
}
