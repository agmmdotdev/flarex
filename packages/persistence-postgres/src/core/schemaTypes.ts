/**
 * Schema metadata translated from Convex common/bootstrap_model/schema_* and
 * database/bootstrap_model/schema* at db914cf06e2b06ee985646611b9e12ed7a770318.
 * Copyright 2026 Convex, Inc., FSL-1.1-Apache-2.0 (convex-backend/LICENSE.md).
 */
import { Data, Effect, Result, Schema, SchemaTransformation } from "effect";
import { DeveloperDocumentIdSchema } from "flarex-protocol/document-id";
import { captureDocumentValue } from "flarex-protocol/document-value";
import { SchemaManifestAppIdentifierSchema } from "flarex-protocol/schema-manifest";
import { ValidatorJsonV1, validatorIsValidRecordKeyV1, validatorJsonAdmissionIssueV1 } from "flarex-protocol/validator-json";
import { CoreIndexDeclarationSchema, type CoreIndexDeclaration } from "./indexState";
import { CorePersistenceError } from "./contracts";

export const SCHEMAS = "_schemas";
export const SCHEMA_VALIDATIONS = "_schema_validations";
export const SCHEMA_VALIDATION_PROGRESS = "_schema_validation_progress";
export const SCHEMAS_BY_STATE = "by_state";
export const VALIDATIONS_BY_SCHEMA_AND_TABLE = "by_schema_id_and_table_name";
export const PROGRESS_BY_VALIDATION = "by_validation_id";

export const CoreSchemaErrorReasonSchema = Schema.Literals([
  "invalidSchema", "unsupportedCapability", "unsupportedFloatLiteral", "hashFailure", "schemaNotFound",
  "schemaFailed", "schemaOverwritten", "notValidated", "stagedEnforcedConflict",
]);
export class CoreSchemaError extends Data.TaggedError("CoreSchemaError")<{
  readonly reason: typeof CoreSchemaErrorReasonSchema.Type;
  readonly message: string;
  readonly tableName?: string;
  readonly cause?: unknown;
}> {}

export const CoreSchemaIdentifierSchema = SchemaManifestAppIdentifierSchema;
const UserTableNameSchema = CoreSchemaIdentifierSchema.check(Schema.makeFilter(value =>
  value.startsWith("_") ? "System tables cannot appear in an application schema" : undefined));
export const CoreSchemaDocumentIdSchema = DeveloperDocumentIdSchema;

export const CoreSchemaStateSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["pending", "validated", "active", "overwritten"]) }),
  // SerializedSchemaState renames variants, not the fields within Failed.
  Schema.Struct({ state: Schema.Literal("failed"), error: Schema.String,
    table_name: Schema.NullOr(Schema.String).pipe(Schema.withDecodingDefaultKey(Effect.succeed(null))) }),
]);
export type CoreSchemaState = typeof CoreSchemaStateSchema.Type;
export type CoreSchemaUniqueState = "pending" | "validated" | "active";
export const CoreSchemaMetadataSchema = Schema.Struct({ state: CoreSchemaStateSchema, schema: Schema.String });
export type CoreSchemaMetadata = typeof CoreSchemaMetadataSchema.Type;
export const decodeCoreSchemaMetadata = Schema.decodeUnknownResult(CoreSchemaMetadataSchema);

const InputTableSchema = Schema.Struct({
  tableName: UserTableNameSchema,
  indexes: Schema.Array(CoreIndexDeclarationSchema),
  stagedDbIndexes: Schema.optionalKey(Schema.NullOr(Schema.Array(CoreIndexDeclarationSchema))),
  searchIndexes: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  stagedSearchIndexes: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  vectorIndexes: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  stagedVectorIndexes: Schema.optionalKey(Schema.NullOr(Schema.Array(Schema.Unknown))),
  documentType: Schema.optionalKey(Schema.Unknown),
  stagedDocumentType: Schema.optionalKey(Schema.Unknown),
});
export const CoreSchemaInputSchema = Schema.Struct({ tables: Schema.Array(InputTableSchema),
  schemaValidation: Schema.optionalKey(Schema.NullOr(Schema.Boolean)) });
export const CoreSchemaTableSchema = Schema.Struct({ tableName: UserTableNameSchema,
  indexes: Schema.Array(CoreIndexDeclarationSchema), stagedDbIndexes: Schema.Array(CoreIndexDeclarationSchema),
  documentType: Schema.optionalKey(ValidatorJsonV1), stagedDocumentType: Schema.optionalKey(ValidatorJsonV1) });
export type CoreSchemaTable = typeof CoreSchemaTableSchema.Type;
export const CoreSchemaDefinitionSchema = Schema.Struct({ tables: Schema.Array(CoreSchemaTableSchema),
  schemaValidation: Schema.Boolean });
export type CoreSchemaDefinition = typeof CoreSchemaDefinitionSchema.Type;

// Keep source JSON's ordered arrays; the derived index cannot outlive its schema.
const tablesBySchema = new WeakMap<CoreSchemaDefinition, ReadonlyMap<string, CoreSchemaTable>>();

/** Source DatabaseSchema.tables.get; captured schemas are detached and deeply frozen. */
export function coreSchemaTable(schema: CoreSchemaDefinition, tableName: string): CoreSchemaTable | undefined {
  let tables = tablesBySchema.get(schema);
  if (tables === undefined) {
    tables = new Map(schema.tables.map(table => [table.tableName, table]));
    tablesBySchema.set(schema, tables);
  }
  return tables.get(tableName);
}

export const CoreSchemaValidationStateSchema = Schema.Union([
  Schema.Struct({ state: Schema.Literals(["pending", "valid"]) }),
  Schema.Struct({ state: Schema.Literal("failed"), error: Schema.String }),
]);
const ValidationFields = {
  schemaId: CoreSchemaDocumentIdSchema, tableName: CoreSchemaIdentifierSchema,
  state: CoreSchemaValidationStateSchema,
};
const NormalizedValidationSchema = Schema.Struct({ ...ValidationFields, validatorHash: Schema.optionalKey(Schema.String) });
export const CoreSchemaValidationMetadataSchema = Schema.Struct({ ...ValidationFields,
  validatorHash: Schema.optionalKey(Schema.NullOr(Schema.String)) }).pipe(Schema.decodeTo(Schema.toType(NormalizedValidationSchema),
  SchemaTransformation.transform({ decode: ({ validatorHash, ...rest }) => ({ ...rest,
    ...(validatorHash == null ? {} : { validatorHash }) }), encode: value => value })));
export type CoreSchemaValidationMetadata = typeof CoreSchemaValidationMetadataSchema.Type;
export type CoreSchemaValidationState = typeof CoreSchemaValidationStateSchema.Type;
export const decodeCoreSchemaValidationMetadata = Schema.decodeUnknownResult(CoreSchemaValidationMetadataSchema);

/** Source in-memory u64 counters are checked into signed int64 document values. */
export const CoreSchemaCountSchema = Schema.BigInt.check(Schema.makeFilter(value =>
  value >= 0n && value <= 0x7fff_ffff_ffff_ffffn ? undefined : "Expected a nonnegative signed int64 counter"));
export const CoreSchemaValidationProgressSchema = Schema.Struct({ validationId: CoreSchemaDocumentIdSchema,
  numDocsValidated: CoreSchemaCountSchema, totalDocs: Schema.NullOr(CoreSchemaCountSchema).pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(null))) });
export type CoreSchemaValidationProgressValue = typeof CoreSchemaValidationProgressSchema.Type;
export const decodeCoreSchemaValidationProgress = Schema.decodeUnknownResult(CoreSchemaValidationProgressSchema);

export function coreSchemaCorrupt(cause?: unknown): CorePersistenceError {
  return new CorePersistenceError({ reason: "corruptData", ...(cause === undefined ? {} : { cause }) });
}
export function invalidCoreSchema(message: string, cause?: unknown, tableName?: string): CoreSchemaError {
  return new CoreSchemaError({ reason: "invalidSchema", message,
    ...(cause === undefined ? {} : { cause }), ...(tableName === undefined ? {} : { tableName }) });
}

const decodeInput = Schema.decodeUnknownResult(CoreSchemaInputSchema);
const decodeValidator = Schema.decodeUnknownResult(ValidatorJsonV1);
const identifier = Schema.decodeUnknownResult(CoreSchemaIdentifierSchema);

const captureIndexes = (items: readonly CoreIndexDeclaration[]) => Object.freeze(items.toSorted((a, b) =>
  a.indexDescriptor < b.indexDescriptor ? -1 : a.indexDescriptor > b.indexDescriptor ? 1 : 0).map(index =>
  Object.freeze({ indexDescriptor: index.indexDescriptor, fields: Object.freeze([...index.fields]) })));
const stripSystemFields = (object: Extract<ValidatorJsonV1, { type: "object" }>): ValidatorJsonV1 => Object.freeze({
  type: "object", value: Object.freeze(Object.fromEntries(Object.entries(object.value).filter(([key]) => !key.startsWith("_")))) });

/** Capture the producer's semantic protocol validators; persisted source JSON has a separate codec. */
export function captureCoreSchema(value: unknown): Result.Result<CoreSchemaDefinition, CoreSchemaError> {
  return Result.gen(function* () {
    const input = yield* Result.mapError(decodeInput(value), cause => invalidCoreSchema("Invalid schema declaration", cause));
    const tables = new Map<string, CoreSchemaTable>();
    for (const table of input.tables) {
      if ([table.searchIndexes, table.stagedSearchIndexes, table.vectorIndexes, table.stagedVectorIndexes]
        .some(indexes => (indexes?.length ?? 0) > 0)) return yield* Result.fail(new CoreSchemaError({
          reason: "unsupportedCapability", message: "Search and vector indexes are not implemented", tableName: table.tableName }));
      const indexes = [...table.indexes, ...(table.stagedDbIndexes ?? [])];
      if (indexes.length > 64) return yield* Result.fail(invalidCoreSchema("A table supports at most 64 declared indexes", undefined, table.tableName));
      const names = new Set<string>();
      const fields = new Set<string>();
      for (const index of indexes) {
        const key = JSON.stringify(index.fields);
        if (names.has(index.indexDescriptor) || fields.has(key)) return yield* Result.fail(invalidCoreSchema(
          "Index names and ordinary index field lists must be unique", undefined, table.tableName));
        names.add(index.indexDescriptor); fields.add(key);
      }
      const documentType = table.documentType == null ? undefined : yield* normalizeCoreDocumentValidator(table.documentType);
      const stagedDocumentType = table.stagedDocumentType == null ? undefined
        : yield* normalizeCoreDocumentValidator(table.stagedDocumentType);
      // BTreeMap collection in the source intentionally keeps the last declaration.
      tables.set(table.tableName, Object.freeze({ tableName: table.tableName,
        indexes: captureIndexes(table.indexes), stagedDbIndexes: captureIndexes(table.stagedDbIndexes ?? []),
        ...(documentType === undefined ? {} : { documentType }),
        ...(stagedDocumentType === undefined ? {} : { stagedDocumentType }) }));
    }
    return Object.freeze({ tables: Object.freeze([...tables.values()].toSorted((a, b) =>
      a.tableName < b.tableName ? -1 : a.tableName > b.tableName ? 1 : 0)), schemaValidation: input.schemaValidation ?? false });
  });
}

export function normalizeCoreDocumentValidator(value: unknown): Result.Result<ValidatorJsonV1, CoreSchemaError> {
  return Result.gen(function* () {
    const issue = validatorJsonAdmissionIssueV1(value);
    if (issue !== undefined) return yield* Result.fail(invalidCoreSchema("Validator admission failed", issue));
    const validator = yield* Result.mapError(decodeValidator(value), cause => invalidCoreSchema("Invalid validator", cause));
    const normalized = yield* captureValidator(validator);
    if (normalized.type === "any") return normalized;
    if (normalized.type === "object") return stripSystemFields(normalized);
    if (normalized.type !== "union" || normalized.value.some(member => member.type !== "object"))
      return yield* Result.fail(invalidCoreSchema("Document validators must be any, an object or a union of objects"));
    const members: ValidatorJsonV1[] = [];
    for (const member of normalized.value) if (member.type === "object") members.push(stripSystemFields(member));
    return members.length === 1 && members[0] !== undefined ? members[0]
      : Object.freeze({ type: "union", value: Object.freeze(members) });
  });
}

function captureValidator(validator: ValidatorJsonV1): Result.Result<ValidatorJsonV1, CoreSchemaError> {
  return Result.gen(function* () {
    switch (validator.type) {
      case "array": return Object.freeze({ type: "array", value: yield* captureValidator(validator.value) });
      case "union": {
        const values: ValidatorJsonV1[] = [];
        for (const value of validator.value) values.push(yield* captureValidator(value));
        return Object.freeze({ type: "union", value: Object.freeze(values) });
      }
      case "object": {
        const fields: [string, { readonly fieldType: ValidatorJsonV1; readonly optional: boolean }][] = [];
        for (const [key, field] of Object.entries(validator.value).toSorted(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
          yield* Result.mapError(identifier(key), cause => invalidCoreSchema("Invalid object field identifier", cause));
          fields.push([key, Object.freeze({ fieldType: yield* captureValidator(field.fieldType), optional: field.optional })]);
        }
        return Object.freeze({ type: "object", value: Object.freeze(Object.fromEntries(fields)) });
      }
      case "record": {
        if (!validatorIsValidRecordKeyV1(validator.keys))
          return yield* Result.fail(invalidCoreSchema("Records require string keys without string literals"));
        return Object.freeze({ type: "record", keys: yield* captureValidator(validator.keys),
          values: yield* captureValidator(validator.values) });
      }
      case "id":
        yield* Result.mapError(identifier(validator.tableName), cause => invalidCoreSchema("Invalid ID table name", cause));
        return Object.freeze({ ...validator });
      case "literal":
        yield* Result.mapError(captureDocumentValue(validator.value), cause => invalidCoreSchema("Invalid literal value", cause));
        return Object.freeze({ ...validator });
      case "null": case "number": case "bigint": case "boolean": case "string": case "bytes": case "any":
        return Object.freeze({ ...validator });
    }
  });
}

/** Source DatabaseSchema::check_index_references, called by the schema analysis owner. */
export function checkCoreSchemaIndexReferences(schema: CoreSchemaDefinition): Result.Result<void, CoreSchemaError> {
  if (!schema.schemaValidation) return Result.succeed(undefined);
  for (const table of schema.tables) {
    if (table.documentType === undefined) continue;
    for (const index of [...table.indexes, ...table.stagedDbIndexes]) for (const field of index.fields) {
      const parts = field.split(".");
      if (parts.length === 1 && field.startsWith("_")) continue;
      if (!validatorContainsField(table.documentType, parts)) return Result.fail(invalidCoreSchema(
        `Index ${index.indexDescriptor} references absent field ${field}`, undefined, table.tableName));
    }
  }
  return Result.succeed(undefined);
}

function validatorContainsField(validator: ValidatorJsonV1, parts: readonly string[]): boolean {
  const first = parts[0];
  if (first === undefined) return true;
  if (validator.type === "any") return true;
  if (validator.type === "union") return validator.value.some(member => validatorContainsField(member, parts));
  const field = validator.type === "object" ? validator.value[first] : undefined;
  return field !== undefined && validatorContainsField(field.fieldType, parts.slice(1));
}
