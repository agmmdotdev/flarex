import { Schema } from "effect";

import { CatalogTableIdSchema, type CatalogTableId } from "./catalog";
import type { Json } from "./json";
import {
  ObjectValidatorJsonV1,
  type ValidatorJsonV1,
} from "./validator-json";

export const MAX_CATALOG_SCHEMA_VERSION = 2_147_483_647;
export const MAX_SCHEMA_MANIFEST_NESTING_DEPTH = 128;
export const MAX_SCHEMA_MANIFEST_APP_IDENTIFIER_LENGTH = 64;
export const MAX_SCHEMA_MANIFEST_APP_TABLES = 10_000;

const NonBlankPostgresText = Schema.String.check(
  Schema.makeFilter((value) =>
    value.trim().length > 0 && isPostgresJsonString(value)
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

const StrictManifestStructOptions: {
  readonly parseOptions: {
    readonly onExcessProperty: "error";
  };
} = {
  parseOptions: { onExcessProperty: "error" },
};

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
).annotate(StrictManifestStructOptions);
export type SchemaManifestAppDocumentDefinitionV1 =
  typeof SchemaManifestAppDocumentDefinitionV1Schema.Type;

export const SchemaManifestAppTableDefinitionV1Schema = Schema.Struct({
  tableId: CatalogTableIdSchema,
  namespace: Schema.Literal("app"),
  logicalName: SchemaManifestAppTableNameSchema,
  definition: SchemaManifestAppDocumentDefinitionV1Schema,
}).annotate(StrictManifestStructOptions);
export type SchemaManifestAppTableDefinitionV1 =
  typeof SchemaManifestAppTableDefinitionV1Schema.Type;

export const SchemaManifestAppTableDeclarationV1Schema = Schema.Struct({
  logicalName: SchemaManifestAppTableNameSchema,
  definition: SchemaManifestAppDocumentDefinitionV1Schema,
}).annotate(StrictManifestStructOptions);
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

const decodeSchemaManifestAppTableCount = Schema.decodeUnknownSync(
  SchemaManifestAppTableCountSchema,
);

const decodeSchemaManifestAppTableDeclarationsV1Shape =
  Schema.decodeUnknownSync(
    SchemaManifestAppTableDeclarationsV1Schema,
    { onExcessProperty: "error" },
  );

export function decodeSchemaManifestAppTableDeclarationsV1(
  value: unknown,
): ReadonlyArray<SchemaManifestAppTableDeclarationV1> {
  preflightSchemaManifestAppTableArray(value);
  const wrapper = decodeSchemaManifestJson({ declarations: value });
  return decodeSchemaManifestAppTableDeclarationsV1Shape(
    wrapper.declarations,
  );
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
}).annotate(StrictManifestStructOptions);
export type SchemaManifestTableDefinitionsV1 =
  typeof SchemaManifestTableDefinitionsV1Schema.Type;

const decodeSchemaManifestTableDefinitionsV1Shape = Schema.decodeUnknownSync(
  SchemaManifestTableDefinitionsV1Schema,
  { onExcessProperty: "error" },
);

export function decodeSchemaManifestTableDefinitionsV1(
  value: unknown,
): SchemaManifestTableDefinitionsV1 {
  preflightSchemaManifestTableDefinitions(value);
  return decodeSchemaManifestTableDefinitionsV1Shape(
    decodeSchemaManifestJson(value),
  );
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
  const manifestText = encodeCanonicalJson(manifest);
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
  return isCanonicalJsonValue(value, 0, new WeakSet()) &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value);
}

function preflightSchemaManifestTableDefinitions(value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const descriptor = Object.getOwnPropertyDescriptor(value, "tables");
  if (descriptor !== undefined && "value" in descriptor) {
    preflightSchemaManifestAppTableArray(descriptor.value);
  }
}

function preflightSchemaManifestAppTableArray(value: unknown): void {
  if (Array.isArray(value)) {
    decodeSchemaManifestAppTableCount(value.length);
  }
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

function isCanonicalArrayIndex(key: string, length: number): boolean {
  if (!/^(?:0|[1-9][0-9]*)$/.test(key)) return false;
  const index = Number(key);
  return Number.isSafeInteger(index) && index >= 0 && index < length;
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

function encodeCanonicalJson(value: Json): string {
  if (isJsonArray(value)) {
    const items: string[] = [];
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index];
      if (item === undefined) {
        throw new Error("Validated JSON array lost an item during encoding.");
      }
      items.push(encodeCanonicalJson(item));
    }
    return `[${items.join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort(compareUtf16)
      .map((key) => {
        const item = value[key];
        if (item === undefined) {
          throw new Error("Validated JSON object lost a property during encoding.");
        }
        return `${JSON.stringify(key)}:${encodeCanonicalJson(item)}`;
      })
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Validated JSON value could not be encoded.");
  }
  return encoded;
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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

function isJsonArray(value: Json): value is ReadonlyArray<Json> {
  return Array.isArray(value);
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
