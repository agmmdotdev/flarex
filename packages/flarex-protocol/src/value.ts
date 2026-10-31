import {
  bytesEqualFullScan as bytesEqual,
  copyBytes,
  copyBytesToArrayBuffer,
  isUint8Array,
} from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Effect, Schema } from "effect";

import { isCanonicalArrayIndex } from "./canonical-array-index";
import {
  encodeCanonicalJson,
  isJsonObjectFromUnknown,
  type CanonicalJsonEncodingInvariantIssue,
  type Json,
} from "./json";
import {
  canonicalFlarexRuntimeValueToJsonV1,
  createOwnedCanonicalFlarexRuntimeValueProjectionV1,
  decodeCanonicalFlarexBase64V1,
  decodeFlarexNumericTagV1,
  decodedFlarexBase64LengthV1,
  FLAREX_APP_DOCUMENT_LIMITS_V1,
  FLAREX_GENERAL_VALUE_LIMITS_V1,
  FlarexValueRuntimeCoreV1Error,
  isCanonicalFlarexRuntimeObjectV1,
  MAX_FLAREX_VALUE_OBJECT_FIELD_BYTES_V1,
  normalizeFlarexRuntimeValueV1,
  type CanonicalFlarexRuntimeValueV1,
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

interface CanonicalValueOwnership {
  readonly runtime: CanonicalFlarexRuntimeValueV1;
  readonly policy: Json;
  readonly bytes: Uint8Array;
  readonly digest: Uint8Array;
  readonly read: () => CanonicalFlarexRuntimeValueV1;
  readonly binaryMatches: () => boolean;
}
const canonicalValueOwnership = new WeakMap<CanonicalFlarexValueV1, CanonicalValueOwnership>();

/** Only this codec's successful canonicalization issues ownership, before its
 * normalized runtime escapes. No caller can register a supplied wrapper. */
function retainCanonicalFlarexValueOwnershipV1(document: CanonicalFlarexValueV1): CanonicalFlarexValueV1 {
  const projection = createOwnedCanonicalFlarexRuntimeValueProjectionV1(document.value);
  canonicalValueOwnership.set(document, { runtime: document.value, policy: document.valueJson,
    bytes: copyBytes(document.canonicalBytes), digest: copyBytes(document.sha256), ...projection });
  return document;
}

/** Read-only codec ownership loan. Foreign wrappers gain no provenance;
 * changed exact evidence is reported separately from the protected runtime. */
export function inspectCanonicalFlarexValueOwnershipV1(document: CanonicalFlarexValueV1):
  Readonly<{ intact: boolean; read: () => CanonicalFlarexRuntimeValueV1 }> | undefined {
  const state = canonicalValueOwnership.get(document);
  if (state === undefined) return undefined;
  return { intact: state.runtime === document.value && state.policy === document.valueJson &&
    bytesEqual(document.canonicalBytes, state.bytes) && bytesEqual(document.sha256, state.digest) &&
    state.binaryMatches(), read: state.read };
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
    return rethrowValueRuntimeCoreError(cause);
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
    parsed = JSON.parse(text);
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

export const decodeCanonicalFlarexValueEvidenceV1Effect = Effect.fn(
  "FlarexValue.decodeCanonicalEvidenceV1",
)((
  input: DecodeCanonicalFlarexValueEvidenceV1Input,
): Effect.Effect<
  CanonicalFlarexValueV1,
  FlarexValueCodecV1Error | FlarexValueEvidenceV1Error
> =>
  Effect.tryPromise({
    try: () => decodeCanonicalFlarexValueEvidenceV1(input),
    catch: (cause): unknown => cause,
  }).pipe(Effect.catch((cause: unknown) =>
    cause instanceof FlarexValueEvidenceV1Error ||
      cause instanceof FlarexValueCodecV1Error
      ? Effect.fail(cause)
      : Effect.die(cause)
  )));

export function isFlarexValueEnvelopeV1(
  value: unknown,
): value is FlarexValueEnvelopeV1 {
  if (!isJsonObjectFromUnknown(value)) {
    return false;
  }
  const record = value;
  const keys = Object.keys(record).toSorted(compareUtf16Strings);
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
  return retainCanonicalFlarexValueOwnershipV1(Object.freeze({
    ...normalized,
    codecVersion: FLAREX_VALUE_CODEC_VERSION_V1,
    canonicalText,
    canonicalBytes,
    sha256,
  } satisfies CanonicalFlarexValueV1));
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

function normalizeJsonObject<T extends object>(
  value: T,
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
    for (const entry of descriptors.toSorted(compareDataProperties)) {
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
  if (tag === "$integer" || tag === "$float") {
    let numeric: number | bigint;
    try {
      numeric = decodeFlarexNumericTagV1(tag, entry.value, "canonical", path);
    } catch (cause) {
      return rethrowValueRuntimeCoreError(cause);
    }
    return primitiveNode(numeric, taggedJson(tag, entry.value), 9, path, context);
  }
  const bytes = decodeCanonicalBase64(entry.value, path, tag);
  switch (tag) {
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

  const decodedLength = decodedFlarexBase64LengthV1(encoded);
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

function enumerableDataProperties<T extends object>(
  value: T,
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

function validatePlainObject<T extends object>(
  value: T,
  path: string,
): void {
  const prototype = Object.getPrototypeOf(value);
  if (
    prototype === Object.prototype ||
    prototype === null ||
    isCrossRealmObjectPrototype(prototype)
  ) return;
  throw invalidContainer(path, "value object must be a plain object");
}

function isCrossRealmObjectPrototype<T extends object>(
  prototype: T,
): boolean {
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

function withAncestor<A extends object, T>(
  value: A,
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

/** The public synchronous codec retains its thrown input-error contract. */
function rethrowValueRuntimeCoreError(cause: unknown): never {
  if (cause instanceof FlarexValueRuntimeCoreV1Error) {
    // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: protocol - synchronous Value Codec maps only its known pure input failure to the existing public codec error.
    throw new FlarexValueCodecV1Error({ issue: cause.issue });
  }
  // oxlint-disable-next-line flarex/no-throw-inside-effect-operation -- REVIEW: invariant - unexpected defects retain their original identity rather than becoming codec input failures.
  throw cause;
}

function decodeCanonicalBase64(encoded: string, path: string, tag: string): Uint8Array {
  try {
    return decodeCanonicalFlarexBase64V1(encoded, path, tag);
  } catch (cause) {
    return rethrowValueRuntimeCoreError(cause);
  }
}

function base64EncodedLength(decodedBytes: number): number {
  return Math.ceil(decodedBytes / 3) * 4;
}

function evidenceBytes(
  value: unknown,
  exactLength: number | undefined,
  reason: "invalidSha256" | "invalidCanonicalBytes",
  detail: string,
): Uint8Array {
  if (!isUint8Array(value)) {
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
const ENCODED_FLOAT64_BASE64_LENGTH = 12;
