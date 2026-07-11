import { Schema } from "effect";

import type { Json } from "./json";

export const MAX_CATALOG_SCHEMA_VERSION = 2_147_483_647;
export const MAX_SCHEMA_MANIFEST_NESTING_DEPTH = 128;

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
