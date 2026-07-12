import { Schema } from "effect";

import {
  CatalogIndexIdSchema,
  CatalogTableIdSchema,
  type CatalogIndexId,
  type CatalogTableId,
} from "./catalog";
import {
  decodeAppOrderedIndexPhysicalSpecV1,
  type AppOrderedIndexPhysicalFieldV1,
  type AppOrderedIndexPhysicalSpecV1,
} from "./ordered-index";

/**
 * A valid v1 spec can contain fifteen 8,319-byte nested field paths. This
 * ceiling is above that closed semantic maximum while keeping corrupt rows and
 * future widened formats from becoming unbounded inputs to the trusted reader.
 */
export const MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1 = 131_072;

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;

export const AppIndexPhysicalSpecCodecVersionSchema = Schema.Literal(1).pipe(
  Schema.brand("FlarexDB/AppIndexPhysicalSpecCodecVersion"),
);
export type AppIndexPhysicalSpecCodecVersion =
  typeof AppIndexPhysicalSpecCodecVersionSchema.Type;
export const APP_INDEX_PHYSICAL_SPEC_CODEC_VERSION_V1 =
  AppIndexPhysicalSpecCodecVersionSchema.make(1);
export const decodeAppIndexPhysicalSpecCodecVersion =
  Schema.decodeUnknownSync(AppIndexPhysicalSpecCodecVersionSchema);

export const CanonicalAppIndexPhysicalSpecBytesHexV1Schema =
  Schema.String.check(
    Schema.makeFilter((value) => {
      if (value.length > MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1 * 2) {
        return `Expected at most ${MAX_CANONICAL_APP_INDEX_PHYSICAL_SPEC_BYTES_V1} canonical spec bytes`;
      }
      return /^(?:[0-9a-f]{2})+$/.test(value)
        ? undefined
        : "Expected nonempty canonical lowercase hexadecimal bytes";
    }),
  ).pipe(Schema.brand("FlarexDB/CanonicalAppIndexPhysicalSpecBytesHexV1"));
export type CanonicalAppIndexPhysicalSpecBytesHexV1 =
  typeof CanonicalAppIndexPhysicalSpecBytesHexV1Schema.Type;
export const decodeCanonicalAppIndexPhysicalSpecBytesHexV1 =
  Schema.decodeUnknownSync(CanonicalAppIndexPhysicalSpecBytesHexV1Schema);

export const AppIndexPhysicalSpecSha256HexV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[0-9a-f]{64}$/.test(value)
      ? undefined
      : "Expected an exact lowercase hexadecimal SHA-256 digest"
  ),
).pipe(Schema.brand("FlarexDB/AppIndexPhysicalSpecSha256HexV1"));
export type AppIndexPhysicalSpecSha256HexV1 =
  typeof AppIndexPhysicalSpecSha256HexV1Schema.Type;
export const decodeAppIndexPhysicalSpecSha256HexV1 = Schema.decodeUnknownSync(
  AppIndexPhysicalSpecSha256HexV1Schema,
);

export const AppDeveloperPhysicalIndexAccessIdentityV1Schema = Schema.Struct({
  kind: Schema.Literal("developer"),
  tableId: CatalogTableIdSchema,
  logicalIndexId: CatalogIndexIdSchema,
}).annotate(StrictStructOptions);
export type AppDeveloperPhysicalIndexAccessIdentityV1 =
  typeof AppDeveloperPhysicalIndexAccessIdentityV1Schema.Type;

export const AppCreationTimePhysicalIndexAccessIdentityV1Schema =
  Schema.Struct({
    kind: Schema.Literal("by_creation_time"),
    tableId: CatalogTableIdSchema,
  }).annotate(StrictStructOptions);
export type AppCreationTimePhysicalIndexAccessIdentityV1 =
  typeof AppCreationTimePhysicalIndexAccessIdentityV1Schema.Type;

/**
 * Stable owner of a persisted app physical index generation.
 *
 * `by_id` is intentionally absent: app index v1 satisfies it directly through
 * the separate row identity and therefore has neither index entries nor a
 * buildable physical definition.
 */
export const AppPhysicalIndexAccessIdentityV1Schema = Schema.Union([
  AppDeveloperPhysicalIndexAccessIdentityV1Schema,
  AppCreationTimePhysicalIndexAccessIdentityV1Schema,
]);
export type AppPhysicalIndexAccessIdentityV1 =
  typeof AppPhysicalIndexAccessIdentityV1Schema.Type;
const decodeAppPhysicalIndexAccessIdentityV1Shape = Schema.decodeUnknownSync(
  AppPhysicalIndexAccessIdentityV1Schema,
  { onExcessProperty: "error" },
);

export type AppPhysicalIndexAccessKindV1 =
  AppPhysicalIndexAccessIdentityV1["kind"];

export type AppPhysicalIndexAccessStorageIdentityV1 =
  | {
      readonly kind: "developer";
      readonly accessIdentityId: CatalogIndexId;
      readonly tableId: CatalogTableId;
      readonly logicalIndexId: CatalogIndexId;
    }
  | {
      readonly kind: "by_creation_time";
      readonly accessIdentityId: CatalogTableId;
      readonly tableId: CatalogTableId;
      readonly logicalIndexId: null;
    };

export interface CanonicalAppIndexPhysicalSpecV1 {
  readonly codecVersion: AppIndexPhysicalSpecCodecVersion;
  readonly physicalSpec: AppOrderedIndexPhysicalSpecV1;
  readonly canonicalText: string;
  readonly canonicalBytesHex: CanonicalAppIndexPhysicalSpecBytesHexV1;
  readonly sha256Hex: AppIndexPhysicalSpecSha256HexV1;
}

export function decodeAppPhysicalIndexAccessIdentityV1(
  value: unknown,
): AppPhysicalIndexAccessIdentityV1 {
  const identity = decodeAppPhysicalIndexAccessIdentityV1Shape(value);
  return identity.kind === "developer"
    ? Object.freeze({
      kind: identity.kind,
      tableId: identity.tableId,
      logicalIndexId: identity.logicalIndexId,
    })
    : Object.freeze({ kind: identity.kind, tableId: identity.tableId });
}

export function appPhysicalIndexAccessStorageIdentityV1(
  value: AppDeveloperPhysicalIndexAccessIdentityV1,
): Extract<
  AppPhysicalIndexAccessStorageIdentityV1,
  { readonly kind: "developer" }
>;
export function appPhysicalIndexAccessStorageIdentityV1(
  value: AppCreationTimePhysicalIndexAccessIdentityV1,
): Extract<
  AppPhysicalIndexAccessStorageIdentityV1,
  { readonly kind: "by_creation_time" }
>;
export function appPhysicalIndexAccessStorageIdentityV1(
  value: AppPhysicalIndexAccessIdentityV1,
): AppPhysicalIndexAccessStorageIdentityV1;
export function appPhysicalIndexAccessStorageIdentityV1(
  value: AppPhysicalIndexAccessIdentityV1,
): AppPhysicalIndexAccessStorageIdentityV1 {
  const identity = decodeAppPhysicalIndexAccessIdentityV1(value);
  return identity.kind === "developer"
    ? Object.freeze({
      kind: identity.kind,
      accessIdentityId: identity.logicalIndexId,
      tableId: identity.tableId,
      logicalIndexId: identity.logicalIndexId,
    })
    : Object.freeze({
      kind: identity.kind,
      accessIdentityId: identity.tableId,
      tableId: identity.tableId,
      logicalIndexId: null,
    });
}

export async function canonicalizeAppIndexPhysicalSpecV1(
  value: unknown,
): Promise<CanonicalAppIndexPhysicalSpecV1> {
  const physicalSpec = decodeAppOrderedIndexPhysicalSpecV1(value);
  const physicalSpecText = encodeCanonicalPhysicalSpec(physicalSpec);
  const canonicalText =
    `{"format":"flarexdb-app-index-physical-spec",` +
    `"physicalSpec":${physicalSpecText},` +
    `"physicalSpecCodecVersion":1}`;
  const canonicalBytes = new TextEncoder().encode(canonicalText);
  const canonicalBytesHex =
    canonicalAppIndexPhysicalSpecBytesHexV1FromBytes(canonicalBytes);
  const digestInput = new ArrayBuffer(canonicalBytes.byteLength);
  new Uint8Array(digestInput).set(canonicalBytes);
  const sha256Hex = appIndexPhysicalSpecSha256HexV1FromBytes(
    new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput)),
  );

  return Object.freeze({
    codecVersion: APP_INDEX_PHYSICAL_SPEC_CODEC_VERSION_V1,
    physicalSpec,
    canonicalText,
    canonicalBytesHex,
    sha256Hex,
  } satisfies CanonicalAppIndexPhysicalSpecV1);
}

export function canonicalAppIndexPhysicalSpecBytesHexV1FromBytes(
  value: Uint8Array,
): CanonicalAppIndexPhysicalSpecBytesHexV1 {
  return decodeCanonicalAppIndexPhysicalSpecBytesHexV1(bytesToHex(value));
}

export function canonicalAppIndexPhysicalSpecBytesHexV1ToBytes(
  value: CanonicalAppIndexPhysicalSpecBytesHexV1,
): Uint8Array {
  return hexToBytes(decodeCanonicalAppIndexPhysicalSpecBytesHexV1(value));
}

export function appIndexPhysicalSpecSha256HexV1FromBytes(
  value: Uint8Array,
): AppIndexPhysicalSpecSha256HexV1 {
  return decodeAppIndexPhysicalSpecSha256HexV1(bytesToHex(value));
}

export function appIndexPhysicalSpecSha256HexV1ToBytes(
  value: AppIndexPhysicalSpecSha256HexV1,
): Uint8Array {
  return hexToBytes(decodeAppIndexPhysicalSpecSha256HexV1(value));
}

function encodeCanonicalPhysicalSpec(
  spec: AppOrderedIndexPhysicalSpecV1,
): string {
  const fields = spec.orderedFields
    .map(encodeCanonicalPhysicalField)
    .join(",");
  return (
    `{"accessPath":${encodeJsonString(spec.accessPath)},` +
    `"collation":"binaryUtf8",` +
    `"keyCodecVersion":1,` +
    `"kind":"appOrdered",` +
    `"maxEncodedKeyBytes":2048,` +
    `"orderedFields":[${fields}],` +
    `"specVersion":1,` +
    `"tieBreaker":{"byteLength":16,"kind":"separateRowIdentity"}}`
  );
}

function encodeCanonicalPhysicalField(
  field: AppOrderedIndexPhysicalFieldV1,
): string {
  return field.kind === "documentPath"
    ? `{"kind":"documentPath","path":${encodeJsonString(field.path)}}`
    : `{"kind":"systemCreationTime"}`;
}

function encodeJsonString(value: string): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Validated app index physical-spec string was not JSON.");
  }
  return encoded;
}

function bytesToHex(value: Uint8Array): string {
  let hex = "";
  for (const byte of value) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}
