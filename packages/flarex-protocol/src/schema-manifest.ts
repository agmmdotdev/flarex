import { isNonArrayRecord } from "@flarex/utils/records";
import { isNonBlankString } from "@flarex/utils/strings";
import { Result, Schema } from "effect";

import { isCanonicalArrayIndex } from "./canonical-array-index";
import {
  CatalogIndexIdSchema,
  CatalogTableIdSchema,
  type CatalogIndexId,
  type CatalogTableId,
} from "./catalog";
import {
  encodeCanonicalJson,
  isJsonArray,
  isJsonObject,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
} from "./json";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  ObjectValidatorJsonV1,
  type ValidatorJsonV1,
} from "./validator-json";

export const MAX_CATALOG_SCHEMA_VERSION = 2_147_483_647;
export const MAX_SCHEMA_MANIFEST_NESTING_DEPTH = 128;
export const MAX_SCHEMA_MANIFEST_APP_IDENTIFIER_LENGTH = 64;
export const MAX_SCHEMA_MANIFEST_APP_TABLES = 10_000;
export const MAX_SCHEMA_MANIFEST_APP_INDEXES = 10_000;
export const MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE = 64;
/**
 * Convex appends `_creationTime` to developer fields and uses `_id` as the
 * implicit final tie-breaker. Keeping one slot for `_creationTime` makes the
 * effective ordered field list fit Convex's 16-field limit.
 */
export const MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS = 15;

const NonBlankPostgresText = Schema.String.check(
  Schema.makeFilter((value) =>
    isNonBlankString(value) && isPostgresJsonString(value)
      ? undefined
      : "Expected nonblank PostgreSQL-safe text",
  ),
);

export const CatalogSchemaVersionIdSchema = NonBlankPostgresText.pipe(
  Schema.brand("FlarexDB/CatalogSchemaVersionId"),
);
export type CatalogSchemaVersionId =
  typeof CatalogSchemaVersionIdSchema.Type;
export const decodeCatalogSchemaVersionId = Schema.decodeUnknownSync(
  CatalogSchemaVersionIdSchema,
);

export const CatalogSchemaVersionSchema = Schema.Int.check(
  Schema.isBetween({ minimum: 1, maximum: MAX_CATALOG_SCHEMA_VERSION }),
).pipe(Schema.brand("FlarexDB/CatalogSchemaVersion"));
export type CatalogSchemaVersion = typeof CatalogSchemaVersionSchema.Type;
export const decodeCatalogSchemaVersion = Schema.decodeUnknownSync(
  CatalogSchemaVersionSchema,
);

export const SchemaManifestCodecVersionSchema = Schema.Literal(1).pipe(
  Schema.brand("FlarexDB/SchemaManifestCodecVersion"),
);
export type SchemaManifestCodecVersion =
  typeof SchemaManifestCodecVersionSchema.Type;
export const SCHEMA_MANIFEST_CODEC_VERSION_V1 =
  SchemaManifestCodecVersionSchema.make(1);
export const decodeSchemaManifestCodecVersion = Schema.decodeUnknownSync(
  SchemaManifestCodecVersionSchema,
);

const SchemaManifestAppIdentifierSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isValidSchemaManifestAppIdentifier(value)
      ? undefined
      : "Expected a Convex-compatible app identifier",
  ),
);

export const SchemaManifestAppTableNameSchema =
  SchemaManifestAppIdentifierSchema.check(
    Schema.makeFilter((value) =>
      value.startsWith("_")
        ? "Expected an app table name outside the reserved system namespace"
        : undefined,
    ),
  ).pipe(
    Schema.brand("FlarexDB/SchemaManifestAppTableName"),
  );
export type SchemaManifestAppTableName =
  typeof SchemaManifestAppTableNameSchema.Type;
export const decodeSchemaManifestAppTableName = Schema.decodeUnknownSync(
  SchemaManifestAppTableNameSchema,
);

export const SchemaManifestAppDocumentDefinitionV1Schema = Schema.Struct({
  kind: Schema.Literal("appDocument"),
  definitionVersion: Schema.Literal(1),
  documentType: ObjectValidatorJsonV1,
}).check(
  Schema.makeFilter((definition) =>
    validateSchemaManifestAppValidatorIdentifiers(
      definition.documentType,
      "documentType",
    ),
  ),
).annotate(StrictStructOptions);
export type SchemaManifestAppDocumentDefinitionV1 =
  typeof SchemaManifestAppDocumentDefinitionV1Schema.Type;

export const SchemaManifestAppTableDefinitionV1Schema = Schema.Struct({
  tableId: CatalogTableIdSchema,
  namespace: Schema.Literal("app"),
  logicalName: SchemaManifestAppTableNameSchema,
  definition: SchemaManifestAppDocumentDefinitionV1Schema,
}).annotate(StrictStructOptions);
export type SchemaManifestAppTableDefinitionV1 =
  typeof SchemaManifestAppTableDefinitionV1Schema.Type;

export const SchemaManifestAppTableDeclarationV1Schema = Schema.Struct({
  logicalName: SchemaManifestAppTableNameSchema,
  definition: SchemaManifestAppDocumentDefinitionV1Schema,
}).annotate(StrictStructOptions);
export type SchemaManifestAppTableDeclarationV1 =
  typeof SchemaManifestAppTableDeclarationV1Schema.Type;
export type SchemaManifestAppTableDeclarationInputV1 =
  typeof SchemaManifestAppTableDeclarationV1Schema.Encoded & {
    readonly tableId?: never;
    readonly namespace?: never;
  };

const SchemaManifestAppTableDeclarationsV1Schema = Schema.Array(
  SchemaManifestAppTableDeclarationV1Schema,
).check(
  Schema.isMaxLength(MAX_SCHEMA_MANIFEST_APP_TABLES),
  Schema.makeFilter((tables) =>
    validateSchemaManifestDeclarationIdentities(tables)
  ),
);

const SchemaManifestAppTableCountSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: 0,
    maximum: MAX_SCHEMA_MANIFEST_APP_TABLES,
  }),
);

const decodeSchemaManifestAppTableCountResult = Schema.decodeUnknownResult(
  SchemaManifestAppTableCountSchema,
);

const decodeSchemaManifestAppTableDeclarationsV1ShapeResult =
  Schema.decodeUnknownResult(
    SchemaManifestAppTableDeclarationsV1Schema,
    StrictParseOptions,
  );

export function decodeSchemaManifestAppTableDeclarationsV1(
  value: unknown,
): ReadonlyArray<SchemaManifestAppTableDeclarationV1> {
  return Result.getOrThrow(
    decodeSchemaManifestAppTableDeclarationsV1Result(value),
  );
}

export function decodeSchemaManifestAppTableDeclarationsV1Result(
  value: unknown,
): Result.Result<
  ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
  Schema.SchemaError
> {
  return Result.gen(function* () {
    yield* preflightSchemaManifestAppTableArrayResult(value);
    const wrapper = yield* decodeSchemaManifestJsonResult({
      declarations: value,
    });
    return yield* decodeSchemaManifestAppTableDeclarationsV1ShapeResult(
      wrapper.declarations,
    );
  });
}

const SchemaManifestAppTableDefinitionsV1Schema = Schema.Array(
  SchemaManifestAppTableDefinitionV1Schema,
).check(
  Schema.isMaxLength(MAX_SCHEMA_MANIFEST_APP_TABLES),
  Schema.makeFilter((tables) => validateSchemaManifestTableOrder(tables)),
);

export const SchemaManifestTableDefinitionsV1Schema = Schema.Struct({
  kind: Schema.Literal("tableDefinitions"),
  sectionVersion: Schema.Literal(1),
  tables: SchemaManifestAppTableDefinitionsV1Schema,
}).annotate(StrictStructOptions);
export type SchemaManifestTableDefinitionsV1 =
  typeof SchemaManifestTableDefinitionsV1Schema.Type;

const decodeSchemaManifestTableDefinitionsV1ShapeResult = Schema.decodeUnknownResult(
  SchemaManifestTableDefinitionsV1Schema,
  StrictParseOptions,
);

export function decodeSchemaManifestTableDefinitionsV1(
  value: unknown,
): SchemaManifestTableDefinitionsV1 {
  return Result.getOrThrow(
    decodeSchemaManifestTableDefinitionsV1Result(value),
  );
}

export function decodeSchemaManifestTableDefinitionsV1Result(
  value: unknown,
): Result.Result<SchemaManifestTableDefinitionsV1, Schema.SchemaError> {
  return Result.gen(function* () {
    yield* preflightSchemaManifestTableDefinitionsResult(value);
    const manifest = yield* decodeSchemaManifestJsonResult(value);
    return yield* decodeSchemaManifestTableDefinitionsV1ShapeResult(manifest);
  });
}

export const SchemaManifestAppIndexDescriptorSchema =
  SchemaManifestAppIdentifierSchema.check(
    Schema.makeFilter((value) =>
      isReservedSchemaManifestAppIndexDescriptor(value)
        ? "Expected a developer index descriptor outside the reserved system index namespace"
        : undefined,
    ),
  ).pipe(
    Schema.brand("FlarexDB/SchemaManifestAppIndexDescriptor"),
  );
export type SchemaManifestAppIndexDescriptor =
  typeof SchemaManifestAppIndexDescriptorSchema.Type;
export const decodeSchemaManifestAppIndexDescriptor =
  Schema.decodeUnknownSync(SchemaManifestAppIndexDescriptorSchema);

export const SchemaManifestAppIndexFieldPathSchema = Schema.String.check(
  Schema.makeFilter((value) =>
    isValidSchemaManifestAppFieldPath(value)
      ? undefined
      : "Expected a canonical Convex-compatible app field path",
  ),
).pipe(Schema.brand("FlarexDB/SchemaManifestAppIndexFieldPath"));
export type SchemaManifestAppIndexFieldPath =
  typeof SchemaManifestAppIndexFieldPathSchema.Type;
export const decodeSchemaManifestAppIndexFieldPath = Schema.decodeUnknownSync(
  SchemaManifestAppIndexFieldPathSchema,
);

const SchemaManifestAppIndexDeclaredFieldsV1Schema = Schema.Array(
  SchemaManifestAppIndexFieldPathSchema,
).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS),
  Schema.makeFilter((fields) =>
    validateSchemaManifestAppIndexDeclaredFields(fields)
  ),
);

export const SchemaManifestAppDeveloperOrderedIndexSpecV1Schema =
  Schema.Struct({
    kind: Schema.Literal("developerOrdered"),
    specVersion: Schema.Literal(1),
    fields: SchemaManifestAppIndexDeclaredFieldsV1Schema,
  }).annotate(StrictStructOptions);
export type SchemaManifestAppDeveloperOrderedIndexSpecV1 =
  typeof SchemaManifestAppDeveloperOrderedIndexSpecV1Schema.Type;
export const decodeSchemaManifestAppDeveloperOrderedIndexSpecV1 =
  Schema.decodeUnknownSync(
    SchemaManifestAppDeveloperOrderedIndexSpecV1Schema,
    StrictParseOptions,
  );

export const SchemaManifestAppIndexDeclarationV1Schema = Schema.Struct({
  tableLogicalName: SchemaManifestAppTableNameSchema,
  descriptor: SchemaManifestAppIndexDescriptorSchema,
  fields: SchemaManifestAppIndexDeclaredFieldsV1Schema,
}).annotate(StrictStructOptions);
export type SchemaManifestAppIndexDeclarationV1 =
  typeof SchemaManifestAppIndexDeclarationV1Schema.Type;
export type SchemaManifestAppIndexDeclarationInputV1 =
  typeof SchemaManifestAppIndexDeclarationV1Schema.Encoded & {
    readonly logicalIndexId?: never;
    readonly indexId?: never;
    readonly indexDefinitionId?: never;
    readonly tableId?: never;
    readonly namespace?: never;
    readonly spec?: never;
    readonly keyCodecVersion?: never;
    readonly lifecycle?: never;
  };

const SchemaManifestAppIndexDeclarationsV1Schema = Schema.Array(
  SchemaManifestAppIndexDeclarationV1Schema,
).check(
  Schema.isMaxLength(MAX_SCHEMA_MANIFEST_APP_INDEXES),
  Schema.makeFilter((indexes) =>
    validateSchemaManifestAppIndexDeclarations(indexes)
  ),
);

const SchemaManifestAppIndexCountSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: 0,
    maximum: MAX_SCHEMA_MANIFEST_APP_INDEXES,
  }),
);

const decodeSchemaManifestAppIndexCountResult = Schema.decodeUnknownResult(
  SchemaManifestAppIndexCountSchema,
);

const SchemaManifestAppIndexDeclaredFieldCountSchema = Schema.Int.check(
  Schema.isBetween({
    minimum: 1,
    maximum: MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS,
  }),
);

const decodeSchemaManifestAppIndexDeclaredFieldCountResult =
  Schema.decodeUnknownResult(SchemaManifestAppIndexDeclaredFieldCountSchema);

const decodeSchemaManifestAppIndexDeclarationsV1ShapeResult =
  Schema.decodeUnknownResult(
    SchemaManifestAppIndexDeclarationsV1Schema,
    StrictParseOptions,
  );

export function decodeSchemaManifestAppIndexDeclarationsV1(
  value: unknown,
): ReadonlyArray<SchemaManifestAppIndexDeclarationV1> {
  return Result.getOrThrow(
    decodeSchemaManifestAppIndexDeclarationsV1Result(value),
  );
}

export function decodeSchemaManifestAppIndexDeclarationsV1Result(
  value: unknown,
): Result.Result<
  ReadonlyArray<SchemaManifestAppIndexDeclarationV1>,
  Schema.SchemaError
> {
  return Result.gen(function* () {
    yield* preflightSchemaManifestAppIndexArrayResult(value);
    const wrapper = yield* decodeSchemaManifestJsonResult({
      declarations: value,
    });
    return yield* decodeSchemaManifestAppIndexDeclarationsV1ShapeResult(
      wrapper.declarations,
    );
  });
}

export const SchemaManifestAppIndexBindingV1Schema = Schema.Struct({
  logicalIndexId: CatalogIndexIdSchema,
  tableId: CatalogTableIdSchema,
  namespace: Schema.Literal("app"),
  descriptor: SchemaManifestAppIndexDescriptorSchema,
  spec: SchemaManifestAppDeveloperOrderedIndexSpecV1Schema,
}).annotate(StrictStructOptions);
export type SchemaManifestAppIndexBindingV1 =
  typeof SchemaManifestAppIndexBindingV1Schema.Type;

const SchemaManifestAppIndexBindingsV1Schema = Schema.Array(
  SchemaManifestAppIndexBindingV1Schema,
).check(
  Schema.isMaxLength(MAX_SCHEMA_MANIFEST_APP_INDEXES),
  Schema.makeFilter((indexes) =>
    validateSchemaManifestAppIndexBindings(indexes)
  ),
);

export const SchemaManifestIndexBindingsV1Schema = Schema.Struct({
  kind: Schema.Literal("indexBindings"),
  sectionVersion: Schema.Literal(1),
  indexes: SchemaManifestAppIndexBindingsV1Schema,
}).annotate(StrictStructOptions);
export type SchemaManifestIndexBindingsV1 =
  typeof SchemaManifestIndexBindingsV1Schema.Type;

interface SchemaManifestAppSchemaReferences {
  readonly tableDefinitions: SchemaManifestTableDefinitionsV1;
  readonly indexBindings: SchemaManifestIndexBindingsV1;
}

const decodeSchemaManifestIndexBindingsV1ShapeResult = Schema.decodeUnknownResult(
  SchemaManifestIndexBindingsV1Schema,
  StrictParseOptions,
);

export function decodeSchemaManifestIndexBindingsV1(
  value: unknown,
): SchemaManifestIndexBindingsV1 {
  return Result.getOrThrow(
    decodeSchemaManifestIndexBindingsV1Result(value),
  );
}

export function decodeSchemaManifestIndexBindingsV1Result(
  value: unknown,
): Result.Result<SchemaManifestIndexBindingsV1, Schema.SchemaError> {
  return Result.gen(function* () {
    yield* preflightSchemaManifestIndexBindingsResult(value);
    const manifest = yield* decodeSchemaManifestJsonResult(value);
    return yield* decodeSchemaManifestIndexBindingsV1ShapeResult(manifest);
  });
}

export const SchemaManifestAppSchemaV1Schema = Schema.Struct({
  kind: Schema.Literal("appSchema"),
  manifestVersion: Schema.Literal(1),
  tableDefinitions: SchemaManifestTableDefinitionsV1Schema,
  indexBindings: SchemaManifestIndexBindingsV1Schema,
}).check(
  Schema.makeFilter((manifest) =>
    validateSchemaManifestAppSchemaReferences(manifest)
  ),
).annotate(StrictStructOptions);
export type SchemaManifestAppSchemaV1 =
  typeof SchemaManifestAppSchemaV1Schema.Type;

const decodeSchemaManifestAppSchemaV1ShapeResult = Schema.decodeUnknownResult(
  SchemaManifestAppSchemaV1Schema,
  StrictParseOptions,
);

export function decodeSchemaManifestAppSchemaV1(
  value: unknown,
): SchemaManifestAppSchemaV1 {
  return Result.getOrThrow(decodeSchemaManifestAppSchemaV1Result(value));
}

export function decodeSchemaManifestAppSchemaV1Result(
  value: unknown,
): Result.Result<SchemaManifestAppSchemaV1, Schema.SchemaError> {
  return Result.gen(function* () {
    yield* preflightSchemaManifestAppSchemaResult(value);
    const manifest = yield* decodeSchemaManifestJsonResult(value);
    return yield* decodeSchemaManifestAppSchemaV1ShapeResult(manifest);
  });
}

export type SchemaManifestJson = {
  readonly [key: string]: Json;
};

export const SchemaManifestJsonSchema = Schema.declare<SchemaManifestJson>(
  isSchemaManifestJson,
  {
    title: "SchemaManifestJson",
    description:
      "A strict JSON object accepted by the FlarexDB schema manifest codec.",
  },
);
export const decodeSchemaManifestJson = Schema.decodeUnknownSync(
  SchemaManifestJsonSchema,
);
const decodeSchemaManifestJsonResult = Schema.decodeUnknownResult(
  SchemaManifestJsonSchema,
);

export const CanonicalSchemaManifestBytesSchema = Schema.Uint8Array.check(
  Schema.isMinLength(1),
).pipe(Schema.brand("FlarexDB/CanonicalSchemaManifestBytes"));
export type CanonicalSchemaManifestBytes =
  typeof CanonicalSchemaManifestBytesSchema.Type;
export const decodeCanonicalSchemaManifestBytes = Schema.decodeUnknownSync(
  CanonicalSchemaManifestBytesSchema,
);

export const SchemaManifestSha256Schema = Schema.Uint8Array.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(32),
).pipe(Schema.brand("FlarexDB/SchemaManifestSha256"));
export type SchemaManifestSha256 = typeof SchemaManifestSha256Schema.Type;
export const decodeSchemaManifestSha256 = Schema.decodeUnknownSync(
  SchemaManifestSha256Schema,
);

export interface CanonicalSchemaManifestV1 {
  readonly codecVersion: SchemaManifestCodecVersion;
  readonly manifestJson: SchemaManifestJson;
  readonly canonicalText: string;
  readonly canonicalBytes: CanonicalSchemaManifestBytes;
  readonly sha256: SchemaManifestSha256;
}

export async function canonicalizeSchemaManifestV1(
  value: unknown,
): Promise<CanonicalSchemaManifestV1> {
  const manifest = decodeSchemaManifestJson(value);
  const manifestText = encodeCanonicalJson(
    manifest,
    schemaManifestJsonEncodingInvariantFailure,
  );
  const canonicalText =
    `{"format":"flarexdb-schema-manifest","manifest":${manifestText},` +
    `"manifestCodecVersion":1}`;
  const canonicalBytes = decodeCanonicalSchemaManifestBytes(
    new TextEncoder().encode(canonicalText),
  );
  const digestInput = new ArrayBuffer(canonicalBytes.byteLength);
  new Uint8Array(digestInput).set(canonicalBytes);
  const sha256 = decodeSchemaManifestSha256(
    new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput)),
  );
  const normalizedManifest: unknown = JSON.parse(manifestText);
  const manifestJson = cloneAndFreezeManifest(
    decodeSchemaManifestJson(normalizedManifest),
  );

  return {
    codecVersion: SCHEMA_MANIFEST_CODEC_VERSION_V1,
    manifestJson,
    canonicalText,
    canonicalBytes,
    sha256,
  } satisfies CanonicalSchemaManifestV1;
}

export function isSchemaManifestJson(
  value: unknown,
): value is SchemaManifestJson {
  return isCanonicalJsonValue(value, 0, new WeakSet()) && isJsonObject(value);
}

function preflightSchemaManifestTableDefinitionsResult(
  value: unknown,
): Result.Result<void, Schema.SchemaError> {
  if (!isNonArrayRecord(value)) return Result.succeed(undefined);
  const descriptor = Object.getOwnPropertyDescriptor(value, "tables");
  if (descriptor !== undefined && "value" in descriptor) {
    return preflightSchemaManifestAppTableArrayResult(descriptor.value);
  }
  return Result.succeed(undefined);
}

function preflightSchemaManifestAppTableArrayResult(
  value: unknown,
): Result.Result<void, Schema.SchemaError> {
  if (Array.isArray(value)) {
    return decodeSchemaManifestAppTableCountResult(value.length).pipe(
      Result.map(() => undefined),
    );
  }
  return Result.succeed(undefined);
}

function preflightSchemaManifestAppSchemaResult(
  value: unknown,
): Result.Result<void, Schema.SchemaError> {
  if (!isNonArrayRecord(value)) return Result.succeed(undefined);
  return Result.gen(function* () {
    const tableDefinitions = Object.getOwnPropertyDescriptor(
      value,
      "tableDefinitions",
    );
    if (tableDefinitions !== undefined && "value" in tableDefinitions) {
      yield* preflightSchemaManifestTableDefinitionsResult(
        tableDefinitions.value,
      );
    }
    const indexBindings = Object.getOwnPropertyDescriptor(
      value,
      "indexBindings",
    );
    if (indexBindings !== undefined && "value" in indexBindings) {
      yield* preflightSchemaManifestIndexBindingsResult(indexBindings.value);
    }
  });
}

function preflightSchemaManifestIndexBindingsResult(
  value: unknown,
): Result.Result<void, Schema.SchemaError> {
  if (!isNonArrayRecord(value)) return Result.succeed(undefined);
  const descriptor = Object.getOwnPropertyDescriptor(value, "indexes");
  if (descriptor !== undefined && "value" in descriptor) {
    return preflightSchemaManifestAppIndexArrayResult(descriptor.value);
  }
  return Result.succeed(undefined);
}

function preflightSchemaManifestAppIndexArrayResult(
  value: unknown,
): Result.Result<void, Schema.SchemaError> {
  if (!Array.isArray(value)) return Result.succeed(undefined);
  return Result.gen(function* () {
    yield* decodeSchemaManifestAppIndexCountResult(value.length);
    for (let index = 0; index < value.length; index += 1) {
      const item = Object.getOwnPropertyDescriptor(value, String(index));
      if (item !== undefined && "value" in item) {
        yield* preflightSchemaManifestAppIndexFieldsResult(item.value);
      }
    }
  });
}

function preflightSchemaManifestAppIndexFieldsResult(
  value: unknown,
): Result.Result<void, Schema.SchemaError> {
  if (!isNonArrayRecord(value)) return Result.succeed(undefined);
  return Result.gen(function* () {
    const directFields = Object.getOwnPropertyDescriptor(value, "fields");
    if (directFields !== undefined && "value" in directFields) {
      yield* preflightSchemaManifestAppIndexFieldArrayResult(
        directFields.value,
      );
    }
    const spec = Object.getOwnPropertyDescriptor(value, "spec");
    if (
      spec !== undefined &&
      "value" in spec &&
      isNonArrayRecord(spec.value)
    ) {
      const specFields = Object.getOwnPropertyDescriptor(spec.value, "fields");
      if (specFields !== undefined && "value" in specFields) {
        yield* preflightSchemaManifestAppIndexFieldArrayResult(
          specFields.value,
        );
      }
    }
  });
}

function preflightSchemaManifestAppIndexFieldArrayResult(
  value: unknown,
): Result.Result<void, Schema.SchemaError> {
  if (Array.isArray(value)) {
    return decodeSchemaManifestAppIndexDeclaredFieldCountResult(
      value.length,
    ).pipe(Result.map(() => undefined));
  }
  return Result.succeed(undefined);
}

function validateSchemaManifestTableOrder(
  tables: ReadonlyArray<{
    readonly tableId: CatalogTableId;
    readonly namespace: "app";
    readonly logicalName: SchemaManifestAppTableName;
  }>,
): string | undefined {
  let previousTableId: CatalogTableId | undefined;
  const logicalIdentities = new Set<string>();

  for (const table of tables) {
    if (
      previousTableId !== undefined &&
      table.tableId <= previousTableId
    ) {
      return "Expected table IDs in strictly increasing numeric order";
    }
    previousTableId = table.tableId;

    const logicalIdentity = JSON.stringify([
      table.namespace,
      table.logicalName,
    ]);
    if (logicalIdentities.has(logicalIdentity)) {
      return "Expected unique table namespace and logical-name bindings";
    }
    logicalIdentities.add(logicalIdentity);
  }

  return undefined;
}

function validateSchemaManifestDeclarationIdentities(
  tables: ReadonlyArray<SchemaManifestAppTableDeclarationV1>,
): string | undefined {
  const logicalNames = new Set<SchemaManifestAppTableName>();
  for (const table of tables) {
    if (logicalNames.has(table.logicalName)) {
      return "Expected unique app table logical-name declarations";
    }
    logicalNames.add(table.logicalName);
  }
  return undefined;
}

function validateSchemaManifestAppIndexDeclarations(
  indexes: ReadonlyArray<SchemaManifestAppIndexDeclarationV1>,
): string | undefined {
  const identities = new Set<string>();
  const fieldLists = new Set<string>();
  const countByTable = new Map<SchemaManifestAppTableName, number>();

  for (const index of indexes) {
    const identity = JSON.stringify([
      index.tableLogicalName,
      index.descriptor,
    ]);
    if (identities.has(identity)) {
      return "Expected unique app index table and descriptor declarations";
    }
    identities.add(identity);

    const fieldList = JSON.stringify([
      index.tableLogicalName,
      index.fields,
    ]);
    if (fieldLists.has(fieldList)) {
      return "Expected unique ordered app index field lists per table";
    }
    fieldLists.add(fieldList);

    const nextCount = (countByTable.get(index.tableLogicalName) ?? 0) + 1;
    if (nextCount > MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE) {
      return `Expected at most ${MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE} developer indexes per app table`;
    }
    countByTable.set(index.tableLogicalName, nextCount);
  }
  return undefined;
}

function validateSchemaManifestAppIndexBindings(
  indexes: ReadonlyArray<SchemaManifestAppIndexBindingV1>,
): string | undefined {
  let previousIndexId: CatalogIndexId | undefined;
  const identities = new Set<string>();
  const fieldLists = new Set<string>();
  const countByTable = new Map<CatalogTableId, number>();

  for (const index of indexes) {
    if (
      previousIndexId !== undefined &&
      index.logicalIndexId <= previousIndexId
    ) {
      return "Expected logical index IDs in strictly increasing numeric order";
    }
    previousIndexId = index.logicalIndexId;

    const identity = JSON.stringify([
      index.tableId,
      index.namespace,
      index.descriptor,
    ]);
    if (identities.has(identity)) {
      return "Expected unique app index table and descriptor bindings";
    }
    identities.add(identity);

    const fieldList = JSON.stringify([index.tableId, index.spec.fields]);
    if (fieldLists.has(fieldList)) {
      return "Expected unique ordered app index field bindings per table";
    }
    fieldLists.add(fieldList);

    const nextCount = (countByTable.get(index.tableId) ?? 0) + 1;
    if (nextCount > MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE) {
      return `Expected at most ${MAX_SCHEMA_MANIFEST_APP_INDEXES_PER_TABLE} developer indexes per app table`;
    }
    countByTable.set(index.tableId, nextCount);
  }
  return undefined;
}

function validateSchemaManifestAppSchemaReferences(
  manifest: SchemaManifestAppSchemaReferences,
): string | undefined {
  const tableIds = new Set(
    manifest.tableDefinitions.tables.map((table) => table.tableId),
  );
  for (const index of manifest.indexBindings.indexes) {
    if (!tableIds.has(index.tableId)) {
      return `Expected logical index ${index.logicalIndexId} to reference an app table in this manifest`;
    }
  }
  return undefined;
}

function validateSchemaManifestAppIndexDeclaredFields(
  fields: ReadonlyArray<SchemaManifestAppIndexFieldPath>,
): string | undefined {
  const uniqueFields = new Set<SchemaManifestAppIndexFieldPath>();
  for (const field of fields) {
    if (field.split(".").some((segment) => segment.startsWith("_"))) {
      return "Expected developer index fields outside the reserved system field namespace";
    }
    if (uniqueFields.has(field)) {
      return "Expected unique ordered fields within an app index";
    }
    uniqueFields.add(field);
  }
  return undefined;
}

function isReservedSchemaManifestAppIndexDescriptor(value: string): boolean {
  return value.startsWith("_") ||
    value === "by_id" ||
    value === "by_creation_time";
}

function isValidSchemaManifestAppFieldPath(value: string): boolean {
  if (value.length === 0 || value.startsWith(".") || value.endsWith(".")) {
    return false;
  }
  const segments = value.split(".");
  return segments.length <= MAX_SCHEMA_MANIFEST_NESTING_DEPTH &&
    segments.every(isValidSchemaManifestAppIdentifier);
}

function isValidSchemaManifestAppIdentifier(value: string): boolean {
  if (
    value.length === 0 ||
    value.length > MAX_SCHEMA_MANIFEST_APP_IDENTIFIER_LENGTH
  ) {
    return false;
  }

  const first = value.charCodeAt(0);
  if (!isAsciiLetter(first) && first !== 0x5f) return false;

  let hasNonUnderscore = false;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (isAsciiLetter(codeUnit) || isAsciiDigit(codeUnit)) {
      hasNonUnderscore = true;
    } else if (codeUnit !== 0x5f) {
      return false;
    }
  }
  return hasNonUnderscore;
}

function isAsciiLetter(codeUnit: number): boolean {
  return (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
    (codeUnit >= 0x61 && codeUnit <= 0x7a);
}

function isAsciiDigit(codeUnit: number): boolean {
  return codeUnit >= 0x30 && codeUnit <= 0x39;
}

function validateSchemaManifestAppValidatorIdentifiers(
  validator: ValidatorJsonV1,
  path: string,
): string | undefined {
  switch (validator.type) {
    case "id":
      return isValidSchemaManifestAppIdentifier(validator.tableName)
        ? undefined
        : `${path}.tableName must be a Convex-compatible table identifier`;
    case "array":
      return validateSchemaManifestAppValidatorIdentifiers(
        validator.value,
        `${path}.value`,
      );
    case "object":
      for (const [fieldName, field] of Object.entries(validator.value)) {
        if (!isValidSchemaManifestAppIdentifier(fieldName)) {
          return `${path}.value field ${JSON.stringify(
            fieldName,
          )} must be a Convex-compatible identifier`;
        }
        const fieldError = validateSchemaManifestAppValidatorIdentifiers(
          field.fieldType,
          `${path}.value.${fieldName}.fieldType`,
        );
        if (fieldError !== undefined) return fieldError;
      }
      return undefined;
    case "record": {
      const keyError = validateSchemaManifestAppValidatorIdentifiers(
        validator.keys,
        `${path}.keys`,
      );
      return keyError ?? validateSchemaManifestAppValidatorIdentifiers(
        validator.values,
        `${path}.values`,
      );
    }
    case "union":
      for (let index = 0; index < validator.value.length; index += 1) {
        const member = validator.value[index];
        if (member === undefined) {
          return `${path}.value lost a validator member`;
        }
        const memberError = validateSchemaManifestAppValidatorIdentifiers(
          member,
          `${path}.value[${index}]`,
        );
        if (memberError !== undefined) return memberError;
      }
      return undefined;
    case "null":
    case "number":
    case "bigint":
    case "boolean":
    case "string":
    case "bytes":
    case "any":
    case "literal":
      return undefined;
  }

  return assertNeverSchemaManifestValidator(validator);
}

function assertNeverSchemaManifestValidator(value: never): never {
  throw new Error(
    `Unexpected ValidatorJsonV1 variant: ${JSON.stringify(value)}`,
  );
}

function isCanonicalJsonValue(
  value: unknown,
  depth: number,
  ancestors: WeakSet<object>,
): value is Json {
  if (depth > MAX_SCHEMA_MANIFEST_NESTING_DEPTH) return false;
  if (value === null || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value === "string") return isPostgresJsonString(value);
  if (typeof value !== "object") return false;
  if (ancestors.has(value)) return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? isCanonicalJsonArray(value, depth, ancestors)
    : isCanonicalJsonRecord(value, depth, ancestors);
  ancestors.delete(value);
  return valid;
}

function isCanonicalJsonArray(
  value: ReadonlyArray<unknown>,
  depth: number,
  ancestors: WeakSet<object>,
): value is ReadonlyArray<Json> {
  if (Object.getPrototypeOf(value) !== Array.prototype) return false;
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== value.length + 1) return false;
  for (let index = 0; index < value.length; index += 1) {
    const key = String(index);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !isCanonicalJsonValue(descriptor.value, depth + 1, ancestors)
    ) {
      return false;
    }
  }
  return ownKeys.every(
    (key) => key === "length" ||
      (typeof key === "string" && isCanonicalArrayIndex(key, value.length)),
  );
}

function isCanonicalJsonRecord(
  value: object,
  depth: number,
  ancestors: WeakSet<object>,
): value is { readonly [key: string]: Json } {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !isPostgresJsonString(key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable ||
      !isCanonicalJsonValue(descriptor.value, depth + 1, ancestors)
    ) {
      return false;
    }
  }
  return true;
}

function isPostgresJsonString(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit === 0) return false;
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const SCHEMA_MANIFEST_JSON_ENCODING_INVARIANT_MESSAGES = {
  missingArrayItem: "Validated JSON array lost an item during encoding.",
  missingObjectProperty:
    "Validated JSON object lost a property during encoding.",
  primitiveEncodingFailed: "Validated JSON value could not be encoded.",
} as const satisfies Record<
  CanonicalJsonEncodingInvariantIssue["reason"],
  string
>;

function schemaManifestJsonEncodingInvariantFailure(
  issue: CanonicalJsonEncodingInvariantIssue,
): never {
  throw new Error(
    SCHEMA_MANIFEST_JSON_ENCODING_INVARIANT_MESSAGES[issue.reason],
  );
}

function cloneAndFreezeManifest(
  value: SchemaManifestJson,
): SchemaManifestJson {
  const copy: Record<string, Json> = {};
  for (const key of Object.keys(value)) {
    const item = value[key];
    if (item === undefined) {
      throw new Error("Decoded schema manifest lost a property during cloning.");
    }
    defineFrozenJsonProperty(copy, key, cloneAndFreezeJson(item));
  }
  return Object.freeze(copy);
}

function cloneAndFreezeJson(value: Json): Json {
  if (isJsonArray(value)) {
    return Object.freeze(value.map(cloneAndFreezeJson));
  }
  if (value !== null && typeof value === "object") {
    const copy: Record<string, Json> = {};
    for (const key of Object.keys(value)) {
      const item = value[key];
      if (item === undefined) {
        throw new Error("Decoded JSON object lost a property during cloning.");
      }
      defineFrozenJsonProperty(copy, key, cloneAndFreezeJson(item));
    }
    return Object.freeze(copy);
  }
  return value;
}

function defineFrozenJsonProperty(
  target: Record<string, Json>,
  key: string,
  value: Json,
): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}
