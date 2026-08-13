import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  copyBytesToArrayBuffer,
} from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Schema } from "effect";

import { isCanonicalArrayIndex } from "./canonical-array-index";
import {
  encodeCanonicalJson,
  isJsonArray,
  isJsonObject,
  isJsonObjectFromUnknown,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
  type JsonObject,
} from "./json";
import {
  canonicalFlarexRuntimeValueToJsonV1,
  FLAREX_APP_DOCUMENT_LIMITS_V1,
  FLAREX_GENERAL_VALUE_LIMITS_V1,
  FlarexValueRuntimeCoreV1Error,
  isCanonicalFlarexRuntimeObjectV1,
  MAX_FLAREX_INT64_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELD_BYTES_V1,
  normalizeFlarexRuntimeValueV1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type FlarexValue,
  type FlarexValueCodecV1Issue,
  type FlarexValueLimitsV1,
  type FlarexValueProfileV1,
} from "./value-runtime-core";

export {
  FLAREX_APP_DOCUMENT_LIMITS_V1,
  FLAREX_GENERAL_VALUE_LIMITS_V1,
  isCanonicalFlarexRuntimeObjectV1,
  MAX_FLAREX_APP_DOCUMENT_NESTING_V1,
  MAX_FLAREX_APP_DOCUMENT_SEMANTIC_BYTES_V1,
  MAX_FLAREX_INT64_V1,
  MAX_FLAREX_VALUE_ARRAY_ITEMS_V1,
  MAX_FLAREX_VALUE_NESTING_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELD_BYTES_V1,
  MAX_FLAREX_VALUE_OBJECT_FIELDS_V1,
  MAX_FLAREX_VALUE_SEMANTIC_BYTES_V1,
  MIN_FLAREX_INT64_V1,
  type CanonicalFlarexRuntimeObjectV1,
  type CanonicalFlarexRuntimeValueV1,
  type FlarexValue,
  type FlarexValueCodecV1Issue,
  type FlarexValueLimitsV1,
  type FlarexValueProfileV1,
} from "./value-runtime-core";

/**
 * The JavaScript value domain accepted at Flarex API boundaries.
 *
 * Undefined object properties are omitted from the logical value, matching
 * Convex. Undefined is not valid at the top level or in arrays.
 */
export const FlarexValueCodecVersionSchema = Schema.Literal(1).pipe(
  Schema.brand("FlarexDB/ValueCodecVersion"),
);
export type FlarexValueCodecVersion =
  typeof FlarexValueCodecVersionSchema.Type;
export const decodeFlarexValueCodecVersion = Schema.decodeUnknownSync(
  FlarexValueCodecVersionSchema,
);
export const FLAREX_VALUE_CODEC_VERSION_V1 =
  decodeFlarexValueCodecVersion(1);

export interface FlarexValueEnvelopeV1 {
  readonly format: "flarex-value";
  readonly value: Json;
  readonly valueCodecVersion: 1;
}

/**
 * The strict structural contract for a Value Codec V1 JSON envelope.
 * Canonical byte spelling is proved separately by byte-for-byte comparison.
 */
export const FlarexValueEnvelopeV1Schema =
  Schema.declare<FlarexValueEnvelopeV1>(isFlarexValueEnvelopeV1, {
    title: "FlarexValueEnvelopeV1",
    description:
      "A strict Flarex Value Codec V1 envelope containing a validated JSON value.",
  });

export const CanonicalFlarexValueBytesV1Schema = Schema.Uint8Array.check(
  Schema.isMinLength(1),
).pipe(Schema.brand("FlarexDB/CanonicalValueBytesV1"));
export type CanonicalFlarexValueBytesV1 =
  typeof CanonicalFlarexValueBytesV1Schema.Type;
export const decodeCanonicalFlarexValueBytesV1 = Schema.decodeUnknownSync(
  CanonicalFlarexValueBytesV1Schema,
);

export const FlarexValueSha256V1Schema = Schema.Uint8Array.check(
  Schema.isMinLength(32),
  Schema.isMaxLength(32),
).pipe(Schema.brand("FlarexDB/ValueSha256V1"));
export type FlarexValueSha256V1 = typeof FlarexValueSha256V1Schema.Type;
export const decodeFlarexValueSha256V1 = Schema.decodeUnknownSync(
  FlarexValueSha256V1Schema,
);

export interface NormalizedFlarexValueV1 {
  readonly profile: FlarexValueProfileV1;
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly valueJson: Json;
  readonly semanticSizeBytes: number;
  readonly nestingDepth: number;
}

export interface CanonicalFlarexValueV1 extends NormalizedFlarexValueV1 {
  readonly codecVersion: FlarexValueCodecVersion;
  readonly canonicalText: string;
  readonly canonicalBytes: CanonicalFlarexValueBytesV1;
  readonly sha256: FlarexValueSha256V1;
}

export class FlarexValueCodecV1Error extends Data.TaggedError(
  "FlarexValueCodecV1Error",
)<{
  readonly issue: FlarexValueCodecV1Issue;
}> {}

export type FlarexValueEvidenceV1Issue =
  | {
      readonly reason: "unsupportedCodecVersion";
      readonly actual: unknown;
    }
  | {
      readonly reason: "invalidSha256";
      readonly detail: string;
    }
  | {
      readonly reason: "invalidCanonicalBytes";
      readonly detail: string;
    }
  | {
      readonly reason: "sha256Mismatch";
    }
  | {
      readonly reason: "canonicalBytesMismatch";
    };

export class FlarexValueEvidenceV1Error extends Data.TaggedError(
  "FlarexValueEvidenceV1Error",
)<{
  readonly issue: FlarexValueEvidenceV1Issue;
}> {}

class FlarexValueEvidenceForeignError extends Data.TaggedError(
  "FlarexValueEvidenceForeignError",
)<{ readonly cause: unknown }> {}

export interface VerifyFlarexValueEvidenceV1Input {
  readonly codecVersion: unknown;
  readonly valueJson: unknown;
  readonly sha256: unknown;
  readonly canonicalBytes?: unknown;
  readonly profile?: FlarexValueProfileV1;
}

export interface DecodeCanonicalFlarexValueEvidenceV1Input {
  readonly canonicalBytes: unknown;
  readonly sha256: unknown;
  readonly profile?: FlarexValueProfileV1;
}

interface NormalizedNode {
  readonly value: CanonicalFlarexRuntimeValueV1;
  readonly json: Json;
  readonly semanticSizeBytes: number;
  readonly nestingDepth: number;
}

interface CodecContext {
  readonly limits: FlarexValueLimitsV1;
  readonly ancestors: WeakSet<object>;
}

export function normalizeFlarexValueV1(
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
): NormalizedFlarexValueV1 {
  try {
    const normalized = normalizeFlarexRuntimeValueV1(value, profile);
    return Object.freeze({
      profile: normalized.profile,
      value: normalized.value,
      valueJson: canonicalFlarexRuntimeValueToJsonV1(normalized.value),
      semanticSizeBytes: normalized.semanticSizeBytes,
      nestingDepth: normalized.nestingDepth,
    } satisfies NormalizedFlarexValueV1);
  } catch (cause) {
    if (cause instanceof FlarexValueRuntimeCoreV1Error) {
      throw new FlarexValueCodecV1Error({ issue: cause.issue });
    }
    throw cause;
  }
}

export function flarexValueToJsonV1(
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
): Json {
  return normalizeFlarexValueV1(value, profile).valueJson;
}

export function jsonToFlarexValueV1(
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
): CanonicalFlarexRuntimeValueV1 {
  return normalizeFlarexValueJsonV1(value, profile).value;
}

export function normalizeFlarexValueJsonV1(
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
): NormalizedFlarexValueV1 {
  const limits = limitsForProfile(profile);
  const node = normalizeJsonNode(
    value,
    "$",
    0,
    { limits, ancestors: new WeakSet() },
  );
  assertProfileRoot(node.value, limits);
  return Object.freeze({
    profile,
    value: node.value,
    valueJson: node.json,
    semanticSizeBytes: node.semanticSizeBytes,
    nestingDepth: node.nestingDepth,
  } satisfies NormalizedFlarexValueV1);
}

export async function canonicalizeFlarexValueV1(
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
): Promise<CanonicalFlarexValueV1> {
  return canonicalizeNormalizedValue(normalizeFlarexValueV1(value, profile));
}

export async function canonicalizeFlarexValueJsonV1(
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
): Promise<CanonicalFlarexValueV1> {
  return canonicalizeNormalizedValue(normalizeFlarexValueJsonV1(value, profile));
}

/**
 * Effect boundary for the Promise-based Value Codec. Expected codec failures
 * remain typed; foreign hashing/runtime failures remain defects.
 */
export const canonicalizeFlarexValueV1Effect = Effect.fn(
  "FlarexValue.canonicalizeV1",
)((
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
): Effect.Effect<CanonicalFlarexValueV1, FlarexValueCodecV1Error> =>
  Effect.tryPromise({
    try: () => canonicalizeFlarexValueV1(value, profile),
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch((cause: unknown) =>
    cause instanceof FlarexValueCodecV1Error
      ? Effect.fail(cause)
      : Effect.die(cause)
  )));

export const canonicalizeFlarexValueJsonV1Effect = Effect.fn(
  "FlarexValue.canonicalizeJsonV1",
)((
  value: unknown,
  profile: FlarexValueProfileV1 = "generalValue",
): Effect.Effect<CanonicalFlarexValueV1, FlarexValueCodecV1Error> =>
  Effect.tryPromise({
    try: () => canonicalizeFlarexValueJsonV1(value, profile),
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch((cause: unknown) =>
    cause instanceof FlarexValueCodecV1Error
      ? Effect.fail(cause)
      : Effect.die(cause)
  )));

export async function verifyFlarexValueEvidenceV1(
  input: VerifyFlarexValueEvidenceV1Input,
): Promise<CanonicalFlarexValueV1> {
  if (input.codecVersion !== 1) {
    throw new FlarexValueEvidenceV1Error({
      issue: {
        reason: "unsupportedCodecVersion",
        actual: input.codecVersion,
      },
    });
  }
  const expectedSha256 = evidenceBytes(
    input.sha256,
    32,
    "invalidSha256",
    "stored SHA-256 must contain exactly 32 bytes",
  );
  const canonical = await canonicalizeFlarexValueJsonV1(
    input.valueJson,
    input.profile,
  );
  if (!bytesEqual(expectedSha256, canonical.sha256)) {
    throw new FlarexValueEvidenceV1Error({
      issue: { reason: "sha256Mismatch" },
    });
  }
  if (input.canonicalBytes !== undefined) {
    const expectedCanonicalBytes = evidenceBytes(
      input.canonicalBytes,
      undefined,
      "invalidCanonicalBytes",
      "stored canonical bytes must be a Uint8Array",
    );
    if (!bytesEqual(expectedCanonicalBytes, canonical.canonicalBytes)) {
      throw new FlarexValueEvidenceV1Error({
        issue: { reason: "canonicalBytesMismatch" },
      });
    }
  }
  return canonical;
}

/**
 * Decodes the canonical Value Codec V1 envelope owned by this module, then
 * re-canonicalizes it so callers can trust neither stored bytes nor SHA alone.
 */
export async function decodeCanonicalFlarexValueEvidenceV1(
  input: DecodeCanonicalFlarexValueEvidenceV1Input,
): Promise<CanonicalFlarexValueV1> {
  const expectedBytes = evidenceBytes(
    input.canonicalBytes,
    undefined,
    "invalidCanonicalBytes",
    "stored canonical bytes must be a Uint8Array",
  );
  const expectedSha256 = evidenceBytes(
    input.sha256,
    32,
    "invalidSha256",
    "stored SHA-256 must contain exactly 32 bytes",
  );
  let text: string;
  try {
    text = TEXT_DECODER.decode(expectedBytes);
  } catch {
    throw new FlarexValueEvidenceV1Error({
      issue: {
        reason: "invalidCanonicalBytes",
        detail: "stored canonical bytes are not valid UTF-8",
      },
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new FlarexValueEvidenceV1Error({
      issue: {
        reason: "invalidCanonicalBytes",
        detail: "stored canonical bytes are not valid JSON",
      },
    });
  }
  if (!isFlarexValueEnvelopeV1(parsed)) {
    throw new FlarexValueEvidenceV1Error({
      issue: {
        reason: "invalidCanonicalBytes",
        detail: "stored canonical bytes are not a strict Value Codec V1 envelope",
      },
    });
  }
  const canonical = await canonicalizeFlarexValueJsonV1(
    parsed.value,
    input.profile,
  );
  if (!bytesEqual(expectedBytes, canonical.canonicalBytes)) {
    throw new FlarexValueEvidenceV1Error({
      issue: { reason: "canonicalBytesMismatch" },
    });
  }
  if (!bytesEqual(expectedSha256, canonical.sha256)) {
    throw new FlarexValueEvidenceV1Error({
      issue: { reason: "sha256Mismatch" },
    });
  }
  return canonical;
}

/**
 * Effect boundary for stored canonical Value Codec V1 evidence. Expected
 * codec/evidence failures remain typed; foreign hashing/runtime failures stay
 * defects.
 */
export const decodeCanonicalFlarexValueEvidenceV1Effect = Effect.fn(
  "FlarexValue.decodeCanonicalEvidenceV1",
)((
  input: DecodeCanonicalFlarexValueEvidenceV1Input,
): Effect.Effect<
  CanonicalFlarexValueV1,
  FlarexValueEvidenceV1Error | FlarexValueCodecV1Error
> =>
  Effect.tryPromise({
    try: () => decodeCanonicalFlarexValueEvidenceV1(input),
    catch: cause => new FlarexValueEvidenceForeignError({ cause }),
  }).pipe(Effect.catchTag("FlarexValueEvidenceForeignError", failure =>
    failure.cause instanceof FlarexValueEvidenceV1Error
      || failure.cause instanceof FlarexValueCodecV1Error
      ? Effect.fail(failure.cause)
      : Effect.die(failure.cause)
  )));

export function isFlarexValueEnvelopeV1(
  value: unknown,
): value is FlarexValueEnvelopeV1 {
  if (!isJsonObjectFromUnknown(value)) {
    return false;
  }
  const record = value;
  const keys = Object.keys(record).sort(compareUtf16Strings);
  return (
    keys.length === 3 &&
    keys[0] === "format" &&
    keys[1] === "value" &&
    keys[2] === "valueCodecVersion" &&
    record.format === "flarex-value" &&
    record.valueCodecVersion === 1
  );
}

export function copyCanonicalFlarexValueBytesV1(
  value: CanonicalFlarexValueBytesV1,
): CanonicalFlarexValueBytesV1 {
  return decodeCanonicalFlarexValueBytesV1(copyBytes(value));
}

export function copyFlarexValueSha256V1(
  value: FlarexValueSha256V1,
): FlarexValueSha256V1 {
  return decodeFlarexValueSha256V1(copyBytes(value));
}

async function canonicalizeNormalizedValue(
  normalized: NormalizedFlarexValueV1,
): Promise<CanonicalFlarexValueV1> {
  const valueText = encodeCanonicalJson(
    normalized.valueJson,
    valueJsonEncodingInvariantFailure,
  );
  const canonicalText =
    `{"format":"flarex-value","value":${valueText},` +
    `"valueCodecVersion":1}`;
  const canonicalBytes = decodeCanonicalFlarexValueBytesV1(
    TEXT_ENCODER.encode(canonicalText),
  );
  const digestInput = copyBytesToArrayBuffer(canonicalBytes);
  const sha256 = decodeFlarexValueSha256V1(
    new Uint8Array(await crypto.subtle.digest("SHA-256", digestInput)),
  );
  return Object.freeze({
    ...normalized,
    codecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    canonicalText,
    canonicalBytes,
    sha256,
  } satisfies CanonicalFlarexValueV1);
}

function normalizeJsonNode(
  value: unknown,
  path: string,
  parentNesting: number,
  context: CodecContext,
): NormalizedNode {
  if (value === null) return primitiveNode(null, null, 1, path, context);
  if (typeof value === "boolean") {
    return primitiveNode(value, value, 1, path, context);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw unsupported(path, "special float must use the canonical $float tag");
    }
    return primitiveNode(value, value, 9, path, context);
  }
  if (typeof value === "string") {
    assertWellFormedUnicode(value, path);
    if (value.includes(NUL)) {
      throw unsupported(path, "NUL-containing string must use the canonical $string tag");
    }
    return normalizeJsonString(value, path, context);
  }
  if (isUnknownArray(value)) {
    return normalizeJsonArray(value, path, parentNesting, context);
  }
  if (typeof value === "object") {
    return normalizeJsonObject(value, path, parentNesting, context);
  }
  throw unsupported(path, "expected a canonical tagged JSON value");
}

function normalizeJsonString(
  value: string,
  path: string,
  context: CodecContext,
): NormalizedNode {
  if (value.length > context.limits.maxSemanticBytes) {
    assertSemanticSize(value.length + 2, path, context.limits);
  }
  const semanticSizeBytes = 2 + TEXT_ENCODER.encode(value).byteLength;
  assertSemanticSize(semanticSizeBytes, path, context.limits);
  return Object.freeze({
    value,
    json: value,
    semanticSizeBytes,
    nestingDepth: 0,
  } satisfies NormalizedNode);
}

function normalizeJsonArray(
  value: ReadonlyArray<unknown>,
  path: string,
  parentNesting: number,
  context: CodecContext,
): NormalizedNode {
  validateArrayShape(value, path);
  assertArrayLength(value.length, path, context.limits);
  const nesting = parentNesting + 1;
  assertNesting(nesting, path, context.limits);
  return withAncestor(value, path, context, () => {
    const normalizedValues: CanonicalFlarexRuntimeValueV1[] = [];
    const jsonValues: Json[] = [];
    let semanticSizeBytes = 2;
    let childDepth = 0;
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
      if (descriptor === undefined || !("value" in descriptor)) {
        throw invalidContainer(path, "JSON array must be dense and contain only data properties");
      }
      const child = normalizeJsonNode(
        descriptor.value,
        `${path}[${index}]`,
        nesting,
        context,
      );
      semanticSizeBytes += child.semanticSizeBytes;
      assertSemanticSize(semanticSizeBytes, path, context.limits);
      childDepth = Math.max(childDepth, child.nestingDepth);
      normalizedValues.push(child.value);
      jsonValues.push(child.json);
    }
    return Object.freeze({
      value: Object.freeze(normalizedValues),
      json: Object.freeze(jsonValues),
      semanticSizeBytes,
      nestingDepth: 1 + childDepth,
    } satisfies NormalizedNode);
  });
}

function normalizeJsonObject(
  value: object,
  path: string,
  parentNesting: number,
  context: CodecContext,
): NormalizedNode {
  validatePlainObject(value, path);
  const descriptors = enumerableDataProperties(value, path);
  const tagged = decodeTaggedValue(descriptors, path, context);
  if (tagged !== undefined) return tagged;
  assertObjectFieldCount(descriptors.length, path, context.limits);
  const nesting = parentNesting + 1;
  assertNesting(nesting, path, context.limits);
  return withAncestor(value, path, context, () => {
    const normalizedObject: Record<string, CanonicalFlarexRuntimeValueV1> = {};
    const jsonObject: Record<string, Json> = {};
    let semanticSizeBytes = 2;
    let childDepth = 0;
    for (const entry of descriptors.sort(compareDataProperties)) {
      validateObjectField(entry.key, path);
      const child = normalizeJsonNode(
        entry.value,
        propertyPath(path, entry.key),
        nesting,
        context,
      );
      semanticSizeBytes += entry.key.length + 1 + child.semanticSizeBytes;
      assertSemanticSize(semanticSizeBytes, path, context.limits);
      childDepth = Math.max(childDepth, child.nestingDepth);
      defineFrozenProperty(normalizedObject, entry.key, child.value);
      defineFrozenProperty(jsonObject, entry.key, child.json);
    }
    return Object.freeze({
      value: Object.freeze(normalizedObject),
      json: Object.freeze(jsonObject),
      semanticSizeBytes,
      nestingDepth: 1 + childDepth,
    } satisfies NormalizedNode);
  });
}

function decodeTaggedValue(
  descriptors: ReadonlyArray<DataProperty>,
  path: string,
  context: CodecContext,
): NormalizedNode | undefined {
  if (descriptors.length !== 1) return undefined;
  const entry = descriptors[0];
  if (entry === undefined || !entry.key.startsWith("$")) return undefined;
  const tag = entry.key;
  if (
    tag !== "$integer" &&
    tag !== "$float" &&
    tag !== "$bytes" &&
    tag !== "$string"
  ) {
    throw invalidTag(path, tag, "unknown reserved value tag");
  }
  if (typeof entry.value !== "string") {
    throw invalidTag(path, tag, "tag payload must be a canonical base64 string");
  }
  preflightTaggedPayload(tag, entry.value, path, context.limits);
  const bytes = decodeCanonicalBase64(entry.value, path, tag);
  switch (tag) {
    case "$integer": {
      if (bytes.byteLength !== 8) {
        throw invalidTag(path, tag, "signed integer tag must contain exactly 8 bytes");
      }
      const integer = decodeInt64(bytes);
      return primitiveNode(integer, taggedJson(tag, entry.value), 9, path, context);
    }
    case "$float": {
      if (bytes.byteLength !== 8) {
        throw invalidTag(path, tag, "float tag must contain exactly 8 bytes");
      }
      const number = decodeFloat64(bytes);
      if (!isSpecialFloat(number)) {
        throw invalidTag(path, tag, "ordinary finite float must be encoded as a JSON number");
      }
      return primitiveNode(number, taggedJson(tag, entry.value), 9, path, context);
    }
    case "$bytes": {
      const semanticSizeBytes = 2 + bytes.byteLength;
      assertSemanticSize(semanticSizeBytes, path, context.limits);
      return Object.freeze({
        value: copyBytesToArrayBuffer(bytes),
        json: taggedJson(tag, entry.value),
        semanticSizeBytes,
        nestingDepth: 0,
      } satisfies NormalizedNode);
    }
    case "$string": {
      let stringValue: string;
      try {
        stringValue = TEXT_DECODER.decode(bytes);
      } catch {
        throw invalidTag(path, tag, "string tag must contain valid UTF-8 bytes");
      }
      assertWellFormedUnicode(stringValue, path);
      if (!stringValue.includes(NUL)) {
        throw invalidTag(path, tag, "$string is canonical only for strings containing NUL");
      }
      const semanticSizeBytes = 2 + bytes.byteLength;
      assertSemanticSize(semanticSizeBytes, path, context.limits);
      return Object.freeze({
        value: stringValue,
        json: taggedJson(tag, entry.value),
        semanticSizeBytes,
        nestingDepth: 0,
      } satisfies NormalizedNode);
    }
  }
}

function preflightTaggedPayload(
  tag: "$integer" | "$float" | "$bytes" | "$string",
  encoded: string,
  path: string,
  limits: FlarexValueLimitsV1,
): void {
  if (tag === "$integer" || tag === "$float") {
    if (encoded.length !== ENCODED_FLOAT64_BASE64_LENGTH) {
      throw invalidTag(
        path,
        tag,
        "eight-byte numeric tag must contain exactly 12 Base64 characters",
      );
    }
    return;
  }

  const maximumDecodedBytes = limits.maxSemanticBytes - 2;
  const maximumEncodedCharacters = base64EncodedLength(maximumDecodedBytes);
  if (encoded.length <= maximumEncodedCharacters) return;

  const decodedLength = decodedBase64LengthFromShape(encoded);
  if (decodedLength !== undefined) {
    assertSemanticSize(2 + decodedLength, path, limits);
  }
  throw invalidTag(
    path,
    tag,
    `tag payload exceeds the ${limits.profile} encoded-length ceiling`,
  );
}

interface DataProperty {
  readonly key: string;
  readonly value: unknown;
}

function enumerableDataProperties(
  value: object,
  path: string,
): DataProperty[] {
  const properties: DataProperty[] = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") {
      throw invalidContainer(path, "symbol properties are not supported");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw invalidContainer(path, "object must contain only enumerable data properties");
    }
    properties.push({ key, value: descriptor.value });
  }
  return properties;
}

function validateArrayShape(value: ReadonlyArray<unknown>, path: string): void {
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1) {
    throw invalidContainer(path, "array must be dense and have no extra properties");
  }
  for (const key of keys) {
    if (key === "length") continue;
    if (typeof key !== "string" || !isCanonicalArrayIndex(key, value.length)) {
      throw invalidContainer(path, "array contains a non-index property");
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw invalidContainer(path, "array items must be enumerable data properties");
    }
  }
}

function validatePlainObject(value: object, path: string): void {
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype === Object.prototype ||
    prototype === null ||
    isCrossRealmObjectPrototype(prototype)
  ) return;
  throw invalidContainer(path, "value object must be a plain object");
}

function isCrossRealmObjectPrototype(prototype: object): boolean {
  const constructor = Object.getOwnPropertyDescriptor(
    prototype,
    "constructor",
  );
  return constructor !== undefined &&
    "value" in constructor &&
    typeof constructor.value === "function" &&
    constructor.value.name === "Object";
}

function validateObjectField(field: string, path: string): void {
  if (field.length > MAX_FLAREX_VALUE_OBJECT_FIELD_BYTES_V1) {
    throw invalidField(path, field, "field exceeds 1,024 ASCII bytes");
  }
  if (field.startsWith("$")) {
    throw invalidField(path, field, "field starts with reserved '$'");
  }
  for (let index = 0; index < field.length; index += 1) {
    const code = field.charCodeAt(index);
    if (code < 0x20 || code >= 0x7f) {
      throw invalidField(path, field, "field must contain only non-control ASCII characters");
    }
  }
}

function assertWellFormedUnicode(value: string, path: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!Number.isInteger(next) || next < 0xdc00 || next > 0xdfff) {
        throw unsupported(path, "string contains an unpaired high surrogate");
      }
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      throw unsupported(path, "string contains an unpaired low surrogate");
    }
  }
}

function assertProfileRoot(
  value: CanonicalFlarexRuntimeValueV1,
  limits: FlarexValueLimitsV1,
): void {
  if (
    limits.requireDocumentObject &&
    !isCanonicalFlarexRuntimeObjectV1(value)
  ) {
    throw new FlarexValueCodecV1Error({
      issue: { reason: "appDocumentRoot", path: "$" },
    });
  }
}

function assertNesting(
  observed: number,
  path: string,
  limits: FlarexValueLimitsV1,
): void {
  if (observed > limits.maxNesting) {
    throw new FlarexValueCodecV1Error({
      issue: {
        reason: "nestingTooDeep",
        path,
        profile: limits.profile,
        observed,
        maximum: limits.maxNesting,
      },
    });
  }
}

function assertSemanticSize(
  observedBytes: number,
  path: string,
  limits: FlarexValueLimitsV1,
): void {
  if (observedBytes > limits.maxSemanticBytes) {
    throw new FlarexValueCodecV1Error({
      issue: {
        reason: "valueTooLarge",
        path,
        profile: limits.profile,
        observedBytes,
        maximumBytes: limits.maxSemanticBytes,
      },
    });
  }
}

function assertArrayLength(
  observed: number,
  path: string,
  limits: FlarexValueLimitsV1,
): void {
  if (observed > limits.maxArrayItems) {
    throw new FlarexValueCodecV1Error({
      issue: {
        reason: "arrayTooLong",
        path,
        observed,
        maximum: limits.maxArrayItems,
      },
    });
  }
}

function assertObjectFieldCount(
  observed: number,
  path: string,
  limits: FlarexValueLimitsV1,
): void {
  if (observed > limits.maxObjectFields) {
    throw new FlarexValueCodecV1Error({
      issue: {
        reason: "objectTooLarge",
        path,
        observed,
        maximum: limits.maxObjectFields,
      },
    });
  }
}

function primitiveNode(
  value: CanonicalFlarexRuntimeValueV1,
  json: Json,
  semanticSizeBytes: number,
  path: string,
  context: CodecContext,
): NormalizedNode {
  assertSemanticSize(semanticSizeBytes, path, context.limits);
  return Object.freeze({
    value,
    json,
    semanticSizeBytes,
    nestingDepth: 0,
  } satisfies NormalizedNode);
}

function withAncestor<T>(
  value: object,
  path: string,
  context: CodecContext,
  operation: () => T,
): T {
  if (context.ancestors.has(value)) {
    throw new FlarexValueCodecV1Error({
      issue: { reason: "cyclicValue", path },
    });
  }
  context.ancestors.add(value);
  try {
    return operation();
  } finally {
    context.ancestors.delete(value);
  }
}

function taggedJson(tag: string, payload: string): Json {
  const value: Record<string, Json> = {};
  defineFrozenProperty(value, tag, payload);
  return Object.freeze(value);
}

const VALUE_JSON_ENCODING_INVARIANT_MESSAGES = {
  missingArrayItem: "Validated Flarex value JSON lost an array item.",
  missingObjectProperty:
    "Validated Flarex value JSON lost an object property.",
  primitiveEncodingFailed: "Validated Flarex value JSON could not be encoded.",
} as const satisfies Record<
  CanonicalJsonEncodingInvariantIssue["reason"],
  string
>;

function valueJsonEncodingInvariantFailure(
  issue: CanonicalJsonEncodingInvariantIssue,
): never {
  throw new Error(VALUE_JSON_ENCODING_INVARIANT_MESSAGES[issue.reason]);
}

function encodeInt64(value: bigint): string {
  let unsigned = value < 0 ? value + (1n << 64n) : value;
  const bytes = new Uint8Array(8);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(unsigned & 0xffn);
    unsigned >>= 8n;
  }
  return encodeBase64(bytes);
}

function decodeInt64(bytes: Uint8Array): bigint {
  let unsigned = 0n;
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    const byte = bytes[index];
    if (byte === undefined) throw new Error("Validated int64 bytes lost an item.");
    unsigned = (unsigned << 8n) | BigInt(byte);
  }
  return unsigned > MAX_FLAREX_INT64_V1 ? unsigned - (1n << 64n) : unsigned;
}

function encodeFloat64(value: number): string {
  const buffer = new ArrayBuffer(8);
  new DataView(buffer).setFloat64(0, value, true);
  return encodeBase64(new Uint8Array(buffer));
}

function decodeFloat64(bytes: Uint8Array): number {
  return new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength,
  ).getFloat64(0, true);
}

function isSpecialFloat(value: number): boolean {
  return Number.isNaN(value) || !Number.isFinite(value) || Object.is(value, -0);
}

function encodeBase64(bytes: Uint8Array): string {
  let output = "";
  let index = 0;
  while (index + 2 < bytes.length) {
    const first = requiredByte(bytes, index);
    const second = requiredByte(bytes, index + 1);
    const third = requiredByte(bytes, index + 2);
    output += base64Character(first >> 2);
    output += base64Character(((first & 0x03) << 4) | (second >> 4));
    output += base64Character(((second & 0x0f) << 2) | (third >> 6));
    output += base64Character(third & 0x3f);
    index += 3;
  }
  const remaining = bytes.length - index;
  if (remaining === 1) {
    const first = requiredByte(bytes, index);
    output += base64Character(first >> 2);
    output += base64Character((first & 0x03) << 4);
    output += "==";
  } else if (remaining === 2) {
    const first = requiredByte(bytes, index);
    const second = requiredByte(bytes, index + 1);
    output += base64Character(first >> 2);
    output += base64Character(((first & 0x03) << 4) | (second >> 4));
    output += base64Character((second & 0x0f) << 2);
    output += "=";
  }
  return output;
}

function decodeCanonicalBase64(
  encoded: string,
  path: string,
  tag: string,
): Uint8Array {
  const decodedLength = decodedBase64LengthFromShape(encoded);
  if (decodedLength === undefined) {
    throw invalidTag(path, tag, "tag payload is not canonical standard base64");
  }
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  const dataCharacterCount = encoded.length - padding;
  for (let index = 0; index < dataCharacterCount; index += 1) {
    if (base64Value(encoded.charCodeAt(index)) < 0) {
      throw invalidTag(
        path,
        tag,
        "tag payload contains an invalid base64 character",
      );
    }
  }
  if (
    (padding === 2 &&
      (base64Value(encoded.charCodeAt(encoded.length - 3)) & 0x0f) !== 0) ||
    (padding === 1 &&
      (base64Value(encoded.charCodeAt(encoded.length - 2)) & 0x03) !== 0)
  ) {
    throw invalidTag(path, tag, "tag payload is not canonical base64");
  }
  const bytes = new Uint8Array(decodedLength);
  let outputIndex = 0;
  for (let index = 0; index < encoded.length; index += 4) {
    const first = base64Value(encoded.charCodeAt(index));
    const second = base64Value(encoded.charCodeAt(index + 1));
    const thirdCharacter = encoded.charAt(index + 2);
    const fourthCharacter = encoded.charAt(index + 3);
    const third = thirdCharacter === "=" ? 0 : base64Value(thirdCharacter.charCodeAt(0));
    const fourth = fourthCharacter === "=" ? 0 : base64Value(fourthCharacter.charCodeAt(0));
    if (first < 0 || second < 0 || third < 0 || fourth < 0) {
      throw invalidTag(path, tag, "tag payload contains an invalid base64 character");
    }
    if (outputIndex < bytes.length) {
      bytes[outputIndex] = (first << 2) | (second >> 4);
      outputIndex += 1;
    }
    if (outputIndex < bytes.length) {
      bytes[outputIndex] = ((second & 0x0f) << 4) | (third >> 2);
      outputIndex += 1;
    }
    if (outputIndex < bytes.length) {
      bytes[outputIndex] = ((third & 0x03) << 6) | fourth;
      outputIndex += 1;
    }
  }
  return bytes;
}

function base64EncodedLength(decodedBytes: number): number {
  return Math.ceil(decodedBytes / 3) * 4;
}

function decodedBase64LengthFromShape(encoded: string): number | undefined {
  if (encoded.length % 4 !== 0) return undefined;
  if (encoded.length === 0) return 0;
  const finalCharacter = encoded.charAt(encoded.length - 1);
  const penultimateCharacter = encoded.charAt(encoded.length - 2);
  if (penultimateCharacter === "=" && finalCharacter !== "=") return undefined;
  const padding = finalCharacter !== "="
    ? 0
    : penultimateCharacter === "="
      ? 2
      : 1;
  return (encoded.length / 4) * 3 - padding;
}

function base64Value(code: number): number {
  if (code >= 0x41 && code <= 0x5a) return code - 0x41;
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26;
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52;
  if (code === 0x2b) return 62;
  if (code === 0x2f) return 63;
  return -1;
}

function base64Character(index: number): string {
  return BASE64_ALPHABET.charAt(index);
}

function requiredByte(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  if (value === undefined) throw new Error("Byte array lost an item during base64 encoding.");
  return value;
}

function evidenceBytes(
  value: unknown,
  exactLength: number | undefined,
  reason: "invalidSha256" | "invalidCanonicalBytes",
  detail: string,
): Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new FlarexValueEvidenceV1Error({
      issue: { reason, detail },
    });
  }
  if (exactLength !== undefined && value.byteLength !== exactLength) {
    throw new FlarexValueEvidenceV1Error({
      issue: { reason, detail },
    });
  }
  return copyBytes(value);
}

function limitsForProfile(profile: FlarexValueProfileV1): FlarexValueLimitsV1 {
  if (profile === "generalValue") return FLAREX_GENERAL_VALUE_LIMITS_V1;
  if (profile === "appDocument") return FLAREX_APP_DOCUMENT_LIMITS_V1;
  throw unsupported("$profile", `unsupported value profile ${String(profile)}`);
}

function isUnknownArray(value: unknown): value is ReadonlyArray<unknown> {
  return Array.isArray(value);
}

function compareDataProperties(left: DataProperty, right: DataProperty): number {
  return compareUtf16Strings(left.key, right.key);
}

function propertyPath(path: string, field: string): string {
  return `${path}[${JSON.stringify(field)}]`;
}

function defineFrozenProperty<Value>(
  target: Record<string, Value>,
  key: string,
  value: Value,
): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    writable: false,
    value,
  });
}

function unsupported(path: string, detail: string): FlarexValueCodecV1Error {
  return new FlarexValueCodecV1Error({
    issue: { reason: "unsupportedValue", path, detail },
  });
}

function invalidContainer(path: string, detail: string): FlarexValueCodecV1Error {
  return new FlarexValueCodecV1Error({
    issue: { reason: "invalidContainer", path, detail },
  });
}

function invalidField(
  path: string,
  field: string,
  detail: string,
): FlarexValueCodecV1Error {
  return new FlarexValueCodecV1Error({
    issue: { reason: "invalidObjectField", path, field, detail },
  });
}

function invalidTag(
  path: string,
  tag: string,
  detail: string,
): FlarexValueCodecV1Error {
  return new FlarexValueCodecV1Error({
    issue: { reason: "invalidTaggedValue", path, tag, detail },
  });
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });
const NUL = "\u0000";
const BASE64_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const ENCODED_FLOAT64_BASE64_LENGTH = 12;
