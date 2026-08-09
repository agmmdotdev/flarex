import { encodeBytesToLowercaseHex } from "@flarex/utils/bytes";
import { Result, Schema, type SchemaAST } from "effect";

import {
  ORDERED_INDEX_KEY_CODEC_VERSION_V1,
  OrderedIndexKeyCodecVersionSchema,
  type OrderedIndexKeyCodecVersion,
} from "./ordered-index";
import {
  MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS,
  SchemaManifestAppIndexFieldPathSchema,
  type SchemaManifestAppIndexFieldPath,
} from "./schema-manifest";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";

export const APP_UNIQUE_KEY_CODEC_IDENTITY_V1 =
  "flarex.unique-key/ordered-index-components/v1" as const;
export const APP_UNIQUE_KEY_CODEC_VERSION_V1: OrderedIndexKeyCodecVersion =
  ORDERED_INDEX_KEY_CODEC_VERSION_V1;
export const MAX_APP_UNIQUE_KEY_COMPONENTS_V1 =
  MAX_SCHEMA_MANIFEST_APP_INDEX_DECLARED_FIELDS;
export const MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1 = 131_072;

export const AppUniqueConstraintPhysicalSpecCodecVersionSchema =
  Schema.Literal(1).pipe(
    Schema.brand("FlarexDB/AppUniqueConstraintPhysicalSpecCodecVersion"),
  );
export type AppUniqueConstraintPhysicalSpecCodecVersion =
  typeof AppUniqueConstraintPhysicalSpecCodecVersionSchema.Type;
export const APP_UNIQUE_CONSTRAINT_PHYSICAL_SPEC_CODEC_VERSION_V1 =
  AppUniqueConstraintPhysicalSpecCodecVersionSchema.make(1);

const UniqueConstraintFieldsV1Schema = Schema.Array(
  SchemaManifestAppIndexFieldPathSchema,
).check(
  Schema.isMinLength(1),
  Schema.isMaxLength(MAX_APP_UNIQUE_KEY_COMPONENTS_V1),
  Schema.makeFilter((fields) =>
    new Set(fields).size === fields.length
      ? undefined
      : "Expected unique ordered field paths"
  ),
);

/**
 * First target-native unique-constraint generation.
 *
 * Localized constraints are deliberately absent until a locale authority and
 * deterministic document-to-locale projection are approved. A consumer must
 * fail closed rather than reinterpret this non-localized format.
 */
export const AppUniqueConstraintPhysicalSpecV1Schema = Schema.Struct({
  kind: Schema.Literal("appUniqueConstraint"),
  specVersion: Schema.Literal(1),
  orderedFields: UniqueConstraintFieldsV1Schema,
  sparse: Schema.Boolean,
  localePolicy: Schema.Struct({ kind: Schema.Literal("none") }).annotate(
    StrictStructOptions,
  ),
  keyCodecIdentity: Schema.Literal(APP_UNIQUE_KEY_CODEC_IDENTITY_V1),
  keyCodecVersion: OrderedIndexKeyCodecVersionSchema,
}).annotate(StrictStructOptions);
export type AppUniqueConstraintPhysicalSpecV1 =
  typeof AppUniqueConstraintPhysicalSpecV1Schema.Type;
const decodeAppUniqueConstraintPhysicalSpecV1ShapeResult =
  Schema.decodeUnknownResult(
    AppUniqueConstraintPhysicalSpecV1Schema,
    StrictParseOptions,
  );

export function decodeAppUniqueConstraintPhysicalSpecV1Result(
  value: unknown,
): Result.Result<AppUniqueConstraintPhysicalSpecV1, Schema.SchemaError> {
  return decodeAppUniqueConstraintPhysicalSpecV1ShapeResult(value).pipe(
    Result.map(snapshotPhysicalSpec),
  );
}

export function decodeAppUniqueConstraintPhysicalSpecV1(
  value: unknown,
): AppUniqueConstraintPhysicalSpecV1 {
  return Result.getOrThrow(decodeAppUniqueConstraintPhysicalSpecV1Result(value));
}

export const CanonicalAppUniqueConstraintSpecBytesHexV1Schema =
  Schema.String.check(
    Schema.makeFilter((value) => {
      if (value.length > MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1 * 2) {
        return `Expected at most ${MAX_CANONICAL_APP_UNIQUE_CONSTRAINT_SPEC_BYTES_V1} canonical spec bytes`;
      }
      return /^(?:[0-9a-f]{2})+$/.test(value)
        ? undefined
        : "Expected nonempty canonical lowercase hexadecimal bytes";
    }),
  ).pipe(
    Schema.brand("FlarexDB/CanonicalAppUniqueConstraintSpecBytesHexV1"),
  );
export type CanonicalAppUniqueConstraintSpecBytesHexV1 =
  typeof CanonicalAppUniqueConstraintSpecBytesHexV1Schema.Type;
const decodeCanonicalBytesHexResult = Schema.decodeUnknownResult(
  CanonicalAppUniqueConstraintSpecBytesHexV1Schema,
);

export const AppUniqueConstraintSpecSha256HexV1Schema = Schema.String.check(
  Schema.makeFilter((value) =>
    /^[0-9a-f]{64}$/.test(value)
      ? undefined
      : "Expected an exact lowercase hexadecimal SHA-256 digest"
  ),
).pipe(Schema.brand("FlarexDB/AppUniqueConstraintSpecSha256HexV1"));
export type AppUniqueConstraintSpecSha256HexV1 =
  typeof AppUniqueConstraintSpecSha256HexV1Schema.Type;
const decodeSha256HexResult = Schema.decodeUnknownResult(
  AppUniqueConstraintSpecSha256HexV1Schema,
);

export interface CanonicalAppUniqueConstraintPhysicalSpecV1 {
  readonly codecVersion: AppUniqueConstraintPhysicalSpecCodecVersion;
  readonly physicalSpec: AppUniqueConstraintPhysicalSpecV1;
  readonly canonicalText: string;
  readonly canonicalBytesHex: CanonicalAppUniqueConstraintSpecBytesHexV1;
  readonly sha256Hex: AppUniqueConstraintSpecSha256HexV1;
}

export async function canonicalizeAppUniqueConstraintPhysicalSpecV1(
  value: unknown,
): Promise<CanonicalAppUniqueConstraintPhysicalSpecV1> {
  const physicalSpec = decodeAppUniqueConstraintPhysicalSpecV1(value);
  const canonicalText =
    `{"format":"flarexdb-app-unique-constraint-physical-spec",` +
    `"physicalSpec":${encodePhysicalSpec(physicalSpec)},` +
    `"physicalSpecCodecVersion":1}`;
  const bytes = new TextEncoder().encode(canonicalText);
  const digestInput = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(digestInput).set(bytes);
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", digestInput),
  );
  return Object.freeze({
    codecVersion: APP_UNIQUE_CONSTRAINT_PHYSICAL_SPEC_CODEC_VERSION_V1,
    physicalSpec,
    canonicalText,
    canonicalBytesHex: Result.getOrThrow(
      decodeCanonicalBytesHexResult(encodeBytesToLowercaseHex(bytes)),
    ),
    sha256Hex: Result.getOrThrow(
      decodeSha256HexResult(encodeBytesToLowercaseHex(digest)),
    ),
  });
}

export function canonicalAppUniqueConstraintSpecBytesHexV1ToBytes(
  value: CanonicalAppUniqueConstraintSpecBytesHexV1,
): Uint8Array {
  return hexToBytes(Result.getOrThrow(decodeCanonicalBytesHexResult(value)));
}

export function appUniqueConstraintSpecSha256HexV1ToBytes(
  value: AppUniqueConstraintSpecSha256HexV1,
): Uint8Array {
  return hexToBytes(Result.getOrThrow(decodeSha256HexResult(value)));
}

export function decodeCanonicalAppUniqueConstraintSpecBytesHexV1(
  value: unknown,
  options?: SchemaAST.ParseOptions,
): CanonicalAppUniqueConstraintSpecBytesHexV1 {
  return Result.getOrThrow(decodeCanonicalBytesHexResult(value, options));
}

function snapshotPhysicalSpec(
  spec: AppUniqueConstraintPhysicalSpecV1,
): AppUniqueConstraintPhysicalSpecV1 {
  return Object.freeze({
    kind: spec.kind,
    specVersion: spec.specVersion,
    orderedFields: Object.freeze(Array.from(spec.orderedFields)),
    sparse: spec.sparse,
    localePolicy: Object.freeze({ kind: spec.localePolicy.kind }),
    keyCodecIdentity: spec.keyCodecIdentity,
    keyCodecVersion: spec.keyCodecVersion,
  });
}

function encodePhysicalSpec(spec: AppUniqueConstraintPhysicalSpecV1): string {
  const fields = spec.orderedFields.map(encodeJsonString).join(",");
  return (
    `{"keyCodecIdentity":"${APP_UNIQUE_KEY_CODEC_IDENTITY_V1}",` +
    `"keyCodecVersion":1,"kind":"appUniqueConstraint",` +
    `"localePolicy":{"kind":"none"},` +
    `"orderedFields":[${fields}],"sparse":${String(spec.sparse)},` +
    `"specVersion":1}`
  );
}

function encodeJsonString(value: SchemaManifestAppIndexFieldPath): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Validated unique field path was not JSON.");
  }
  return encoded;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}
