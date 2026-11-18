/**
 * Source JSON layout: Convex common/schemas/json.rs at db914cf06. Numeric layout:
 * serde_json 1.0.151 / zmij 1.0.23 (FloatTraits::min/max_decimal_exponent).
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Effect, Result } from "effect";
import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import type { ValidatorJsonV1 } from "flarex-protocol/validator-json";
import { serializeSourceSchemaFloat, serializeValidatorSourceResult } from "flarex-protocol/internal/validator-source-serialization";
import { MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1 } from "flarex-protocol/internal/value-runtime-core";
import { convertValidatorSourceDto, parseSourceJsonText, SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS, type SourceResult } from "flarex-protocol/internal/validator-source";
import { decodeDatabaseSchemaSourceDto } from "flarex-protocol/internal/native-schema-dto";
import { captureCoreSchema, CoreSchemaError, invalidCoreSchema, normalizeCoreDocumentValidator,
  type CoreSchemaDefinition } from "./schemaTypes";

const quote = (value: string): string => JSON.stringify(value);
const serializationResult = <Value>(result: SourceResult<Value>): Result.Result<Value, CoreSchemaError> => result.ok
  ? Result.succeed(result.value) : Result.fail(result.issue.reason === "unsupportedFloatLiteral"
    ? new CoreSchemaError({ reason: "unsupportedFloatLiteral", message: result.issue.message })
    : invalidCoreSchema(result.issue.message, result.issue));

export function serializeCoreSchemaFloat(value: number): Result.Result<string, CoreSchemaError> {
  return serializationResult(serializeSourceSchemaFloat(value));
}

/** The shared backend Source writer owns the exact persisted validator/hash bytes. */
export function serializeCoreDocumentValidator(validator: ValidatorJsonV1): Result.Result<string, CoreSchemaError> {
  return serializationResult(serializeValidatorSourceResult(validator));
}

type SerializedValidators = WeakMap<ValidatorJsonV1, Result.Result<string, CoreSchemaError>>;
// DatabaseSchema root object -> tables array -> TableDefinition object.
const SchemaDocumentSourceProfile = { maximumRawContainers: SOURCE_JSON_MAXIMUM_OPEN_CONTAINERS - 3 };
function serializeValidator(validator: ValidatorJsonV1, memo: SerializedValidators): Result.Result<string, CoreSchemaError> {
  const known = memo.get(validator);
  if (known !== undefined) return known;
  const serialized = serializationResult(serializeValidatorSourceResult(validator, SchemaDocumentSourceProfile));
  memo.set(validator, serialized);
  return serialized;
}
/** Source TryFrom<DatabaseSchema>: finite validation belongs to persistence conversion. */
export function serializeCoreSchema(schema: CoreSchemaDefinition): Result.Result<string, CoreSchemaError> {
  return Result.gen(function* () {
    const tables: string[] = [];
    const validators: SerializedValidators = new WeakMap();
    let bytes = `{"tables":[],"schemaValidation":${schema.schemaValidation}}`.length;
    for (const table of schema.tables) {
      const indexes = (values: typeof table.indexes) => `[${values.map(index =>
        `{"indexDescriptor":${quote(index.indexDescriptor)},"fields":${JSON.stringify(index.fields)}}`).join(",")}]`;
      const documentType = table.documentType === undefined ? "null" : yield* serializeValidator(table.documentType, validators);
      const stagedDocumentType = table.stagedDocumentType === undefined ? "null" : yield* serializeValidator(table.stagedDocumentType, validators);
      const serialized = `{"tableName":${quote(table.tableName)},"indexes":${indexes(table.indexes)},"stagedDbIndexes":${indexes(table.stagedDbIndexes)},"searchIndexes":[],"stagedSearchIndexes":[],"vectorIndexes":[],"stagedVectorIndexes":[],"documentType":${documentType},"stagedDocumentType":${stagedDocumentType}}`;
      const size = new TextEncoder().encode(serialized).byteLength + (tables.length === 0 ? 0 : 1);
      if (size > MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1 - bytes)
        return yield* Result.fail(invalidCoreSchema("Serialized schema exceeds its system-value metadata byte budget"));
      bytes += size;
      tables.push(serialized);
    }
    return `{"tables":[${tables.join(",")}],"schemaValidation":${schema.schemaValidation}}`;
  });
}

export const coreDocumentValidatorHash = Effect.fn("CoreSchema.validatorHash")(function* (validator: ValidatorJsonV1) {
  const serialized = yield* Effect.fromResult(serializeCoreDocumentValidator(validator));
  const bytes = new TextEncoder().encode(serialized);
  const digest = yield* Effect.tryPromise({ try: () => globalThis.crypto.subtle.digest("SHA-256", bytes),
    catch: (cause: unknown) => new CoreSchemaError({ reason: "hashFailure", message: "Could not hash the schema validator", cause }) });
  return encodeBytesToLowercaseHex(new Uint8Array(digest));
});
const fromSource = <T>(result: SourceResult<T>): Result.Result<T, CoreSchemaError> => result.ok
  ? Result.succeed(result.value) : Result.fail(invalidCoreSchema("Invalid source schema JSON", result.issue));

/** Stored schema reads deserialize lazily; finite conversion remains exclusively a fresh serialization policy. */
export function parseCoreSchema(raw: string): Result.Result<CoreSchemaDefinition, CoreSchemaError> {
  return Result.gen(function* () {
    const parsed = yield* fromSource(parseSourceJsonText(raw));
    const input = yield* fromSource(decodeDatabaseSchemaSourceDto(parsed));
    const tables = [];
    for (const table of input.tables) {
      const documentType = table.documentType === undefined ? undefined
        : yield* normalizeCoreDocumentValidator(yield* fromSource(convertValidatorSourceDto(table.documentType)));
      const stagedDocumentType = table.stagedDocumentType === undefined ? undefined
        : yield* normalizeCoreDocumentValidator(yield* fromSource(convertValidatorSourceDto(table.stagedDocumentType)));
      const captured = yield* captureCoreSchema({ tables: [{ ...table,
        ...(documentType === undefined ? {} : { documentType }),
        ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) }], schemaValidation: input.schemaValidation ?? false });
      tables.push(...captured.tables);
    }
    return yield* captureCoreSchema({ tables, schemaValidation: input.schemaValidation ?? false });
  });
}
