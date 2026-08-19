import {
  compareBytesLexicographically,
  encodeBytesToLowercaseHex,
} from "@flarex/utils/bytes";
import { compareUtf16Strings } from "@flarex/utils/strings";
import { Data, Result, Schema } from "effect";

import {
  APP_ROW_ID_BYTES_V1,
  AppRowIdHexV1Schema,
  appRowIdHexV1FromBytesResult,
  appRowIdHexV1ToBytes,
  decodeAppRowIdHexV1,
  type AppRowIdHexV1,
} from "./app-document-id";
import { snapshotDecodedProtocolPlainData } from "./decoded-protocol-snapshot";
import {
  SchemaManifestAppIndexFieldPathSchema,
  decodeSchemaManifestAppDeveloperOrderedIndexSpecV1,
  decodeSchemaManifestAppIndexFieldPath,
  type SchemaManifestAppDeveloperOrderedIndexSpecV1,
  type SchemaManifestAppIndexFieldPath,
} from "./schema-manifest";
import {
  StrictParseOptions,
  StrictStructOptions,
} from "./strict-schema-options";
import {
  normalizeFlarexValueV1,
  type CanonicalFlarexRuntimeValueV1,
} from "./value";

export const MAX_ORDERED_INDEX_KEY_BYTES_V1 = 2_048;
export const MAX_ORDERED_INDEX_BOUND_BYTES_V1 =
  MAX_ORDERED_INDEX_KEY_BYTES_V1 + 1;
export const MAX_ORDERED_INDEX_BYTE_VALUE_BYTES_V1 =
  MAX_ORDERED_INDEX_KEY_BYTES_V1 - 2;
export const ORDERED_INDEX_ROW_ID_BYTES_V1 = APP_ROW_ID_BYTES_V1;
export const MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1 = 16;
export const MAX_ORDERED_INDEX_VALUE_DEPTH_V1 = 64;
export const MAX_ORDERED_INDEX_OBJECT_FIELD_BYTES_V1 = 1_024;
export const MAX_ORDERED_INDEX_CREATION_TIME_MS_EXCLUSIVE_V1 = 2 ** 53;

const MAX_ORDERED_INDEX_STRING_CODE_UNITS_V1 =
  MAX_ORDERED_INDEX_KEY_BYTES_V1 - 2;
const MAX_ORDERED_INDEX_ARRAY_ITEMS_V1 =
  MAX_ORDERED_INDEX_KEY_BYTES_V1 - 2;
const MAX_ORDERED_INDEX_OBJECT_ENTRIES_V1 = MAX_ORDERED_INDEX_KEY_BYTES_V1;
const MAX_ORDERED_INDEX_RANGE_EXPRESSIONS_V1 =
  MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1 + 1;

export const OrderedIndexKeyCodecVersionSchema = Schema.Literal(1).pipe(
  Schema.brand("FlarexDB/OrderedIndexKeyCodecVersion"),
);
export type OrderedIndexKeyCodecVersion =
  typeof OrderedIndexKeyCodecVersionSchema.Type;
export const decodeOrderedIndexKeyCodecVersion = Schema.decodeUnknownSync(
  OrderedIndexKeyCodecVersionSchema,
);
export const ORDERED_INDEX_KEY_CODEC_VERSION_V1 =
  decodeOrderedIndexKeyCodecVersion(1);

export const AppOrderedIndexDocumentPathV1Schema = Schema.Struct({
  kind: Schema.Literal("documentPath"),
  path: SchemaManifestAppIndexFieldPathSchema,
}).annotate(StrictStructOptions);
export type AppOrderedIndexDocumentPathV1 =
  typeof AppOrderedIndexDocumentPathV1Schema.Type;

export const AppOrderedIndexSystemCreationTimeV1Schema = Schema.Struct({
  kind: Schema.Literal("systemCreationTime"),
}).annotate(StrictStructOptions);
export type AppOrderedIndexSystemCreationTimeV1 =
  typeof AppOrderedIndexSystemCreationTimeV1Schema.Type;

export const AppOrderedIndexPhysicalFieldV1Schema = Schema.Union([
  AppOrderedIndexDocumentPathV1Schema,
  AppOrderedIndexSystemCreationTimeV1Schema,
]);
export type AppOrderedIndexPhysicalFieldV1 =
  typeof AppOrderedIndexPhysicalFieldV1Schema.Type;

const AppOrderedIndexPhysicalFieldsV1Schema = Schema.Array(
  AppOrderedIndexPhysicalFieldV1Schema,
).check(
  Schema.isMaxLength(MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1),
);

export const AppOrderedIndexPhysicalSpecV1Schema = Schema.Struct({
  kind: Schema.Literal("appOrdered"),
  specVersion: Schema.Literal(1),
  accessPath: Schema.Literals([
    "developer",
    "by_creation_time",
    "by_id",
  ]),
  orderedFields: AppOrderedIndexPhysicalFieldsV1Schema,
  tieBreaker: Schema.Struct({
    kind: Schema.Literal("separateRowIdentity"),
    byteLength: Schema.Literal(ORDERED_INDEX_ROW_ID_BYTES_V1),
  }).annotate(StrictStructOptions),
  keyCodecVersion: OrderedIndexKeyCodecVersionSchema,
  collation: Schema.Literal("binaryUtf8"),
  maxEncodedKeyBytes: Schema.Literal(MAX_ORDERED_INDEX_KEY_BYTES_V1),
}).check(
  Schema.makeFilter((spec) => validateAppOrderedIndexPhysicalSpecV1(spec)),
).annotate(StrictStructOptions);
export type AppOrderedIndexPhysicalSpecV1 =
  typeof AppOrderedIndexPhysicalSpecV1Schema.Type;

const decodeAppOrderedIndexPhysicalSpecV1ShapeResult =
  Schema.decodeUnknownResult(
    AppOrderedIndexPhysicalSpecV1Schema,
    StrictParseOptions,
  );
const decodeAppOrderedIndexPhysicalFieldV1Shape = Schema.decodeUnknownSync(
  AppOrderedIndexPhysicalFieldV1Schema,
  StrictParseOptions,
);
export const OrderedIndexKeyBytesHexV1Schema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value.length > MAX_ORDERED_INDEX_KEY_BYTES_V1 * 2) {
      return `Expected at most ${MAX_ORDERED_INDEX_KEY_BYTES_V1} encoded key bytes`;
    }
    return /^(?:[0-9a-f]{2})*$/.test(value)
      ? undefined
      : "Expected canonical lowercase hexadecimal bytes";
  }),
).pipe(Schema.brand("FlarexDB/OrderedIndexKeyBytesHexV1"));
export type OrderedIndexKeyBytesHexV1 =
  typeof OrderedIndexKeyBytesHexV1Schema.Type;
export const decodeOrderedIndexKeyBytesHexV1 = Schema.decodeUnknownSync(
  OrderedIndexKeyBytesHexV1Schema,
);

const OrderedIndexKeyHexV1Schema = OrderedIndexKeyBytesHexV1Schema.pipe(
  Schema.brand("FlarexDB/CanonicalOrderedIndexKeyHexV1"),
);
export type OrderedIndexKeyHexV1 = typeof OrderedIndexKeyHexV1Schema.Type;
const markCanonicalOrderedIndexKeyHexV1 = Schema.decodeUnknownSync(
  OrderedIndexKeyHexV1Schema,
);

export const OrderedIndexBoundHexV1Schema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value.length > MAX_ORDERED_INDEX_BOUND_BYTES_V1 * 2) {
      return `Expected at most ${MAX_ORDERED_INDEX_BOUND_BYTES_V1} encoded bound bytes`;
    }
    return /^(?:[0-9a-f]{2})*$/.test(value)
      ? undefined
      : "Expected canonical lowercase hexadecimal bytes";
  }),
).pipe(Schema.brand("FlarexDB/OrderedIndexBoundHexV1"));
export type OrderedIndexBoundHexV1 =
  typeof OrderedIndexBoundHexV1Schema.Type;
export const decodeOrderedIndexBoundHexV1 = Schema.decodeUnknownSync(
  OrderedIndexBoundHexV1Schema,
);

export const OrderedIndexRowIdHexV1Schema = AppRowIdHexV1Schema;
export type OrderedIndexRowIdHexV1 = AppRowIdHexV1;
export const decodeOrderedIndexRowIdHexV1 = decodeAppRowIdHexV1;

export const OrderedIndexByteValueHexV1Schema = Schema.String.check(
  Schema.makeFilter((value) => {
    if (value.length > MAX_ORDERED_INDEX_BYTE_VALUE_BYTES_V1 * 2) {
      return `Expected at most ${MAX_ORDERED_INDEX_BYTE_VALUE_BYTES_V1} byte-value bytes`;
    }
    return /^(?:[0-9a-f]{2})*$/.test(value)
      ? undefined
      : "Expected canonical lowercase hexadecimal bytes";
  }),
).pipe(Schema.brand("FlarexDB/OrderedIndexByteValueHexV1"));
export type OrderedIndexByteValueHexV1 =
  typeof OrderedIndexByteValueHexV1Schema.Type;
export const decodeOrderedIndexByteValueHexV1 = Schema.decodeUnknownSync(
  OrderedIndexByteValueHexV1Schema,
);

export interface OrderedIndexMissingV1 {
  readonly kind: "missing";
}

export interface OrderedIndexNullV1 {
  readonly kind: "null";
}

export interface OrderedIndexInt64V1 {
  readonly kind: "int64";
  readonly value: bigint;
}

export interface OrderedIndexFloat64V1 {
  readonly kind: "float64";
  readonly bits: bigint;
}

export interface OrderedIndexBooleanV1 {
  readonly kind: "boolean";
  readonly value: boolean;
}

export interface OrderedIndexStringV1 {
  readonly kind: "string";
  readonly value: string;
}

export interface OrderedIndexBytesV1 {
  readonly kind: "bytes";
  readonly hex: OrderedIndexByteValueHexV1;
}

export interface OrderedIndexArrayV1 {
  readonly kind: "array";
  readonly value: ReadonlyArray<OrderedIndexValueV1>;
}

export interface OrderedIndexObjectEntryV1 {
  readonly field: string;
  readonly value: OrderedIndexValueV1;
}

export interface OrderedIndexObjectV1 {
  readonly kind: "object";
  readonly entries: ReadonlyArray<OrderedIndexObjectEntryV1>;
}

export type OrderedIndexValueV1 =
  | OrderedIndexNullV1
  | OrderedIndexInt64V1
  | OrderedIndexFloat64V1
  | OrderedIndexBooleanV1
  | OrderedIndexStringV1
  | OrderedIndexBytesV1
  | OrderedIndexArrayV1
  | OrderedIndexObjectV1;

export type OrderedIndexComponentV1 =
  | OrderedIndexMissingV1
  | OrderedIndexValueV1;

export type OrderedIndexRangeExpressionV1 =
  | {
      readonly op: "eq";
      readonly field: AppOrderedIndexPhysicalFieldV1;
      readonly value: OrderedIndexComponentV1;
    }
  | {
      readonly op: "gt" | "gte" | "lt" | "lte";
      readonly field: AppOrderedIndexPhysicalFieldV1;
      readonly value: OrderedIndexComponentV1;
    };

export interface OrderedIndexBoundsV1 {
  readonly startInclusive?: OrderedIndexBoundHexV1;
  readonly endExclusive?: OrderedIndexBoundHexV1;
}

export interface OrderedIndexPositionV1 {
  readonly encodedKey: OrderedIndexKeyHexV1;
  readonly rowId: OrderedIndexRowIdHexV1;
}

export type OrderedIndexCodecV1InputIssue =
  | {
      readonly reason: "invalidValue";
      readonly path: string;
      readonly detail: string;
    }
  | {
      readonly reason: "nestingTooDeep";
      readonly path: string;
      readonly maxDepth: number;
    }
  | {
      readonly reason: "cyclicValue";
      readonly path: string;
    }
  | {
      readonly reason: "componentCountMismatch";
      readonly expected: number;
      readonly actual: number;
    }
  | {
      readonly reason: "componentCountOutOfRange";
      readonly actual: number;
      readonly maximum: number;
    }
  | {
      readonly reason: "invalidCreationTime";
      readonly fieldIndex: number;
    };

export class OrderedIndexCodecV1InputError extends Data.TaggedError(
  "OrderedIndexCodecV1InputError",
)<{
  readonly issue: OrderedIndexCodecV1InputIssue;
}> {}

export class OrderedIndexKeyTooLargeError extends Data.TaggedError(
  "OrderedIndexKeyTooLargeError",
)<{
  readonly observedBytes: number;
  readonly maximumBytes: number;
}> {}

export class InvalidEncodedOrderedIndexKeyV1Error extends Data.TaggedError(
  "InvalidEncodedOrderedIndexKeyV1Error",
)<{
  readonly offset: number;
  readonly detail: string;
  readonly cause?: unknown;
}> {}

export type OrderedIndexRangeV1Issue =
  | {
      readonly reason: "fieldOrder";
      readonly expressionIndex: number;
    }
  | {
      readonly reason: "equalityAfterInequality";
      readonly expressionIndex: number;
    }
  | {
      readonly reason: "duplicateLowerBound";
      readonly expressionIndex: number;
    }
  | {
      readonly reason: "duplicateUpperBound";
      readonly expressionIndex: number;
    }
  | {
      readonly reason: "unsupportedByIdExpression";
      readonly expressionIndex: number;
    }
  | {
      readonly reason: "invalidField";
      readonly expressionIndex: number;
    };

export class InvalidOrderedIndexRangeV1Error extends Data.TaggedError(
  "InvalidOrderedIndexRangeV1Error",
)<{
  readonly issue: OrderedIndexRangeV1Issue;
}> {}

export const ORDERED_INDEX_MISSING_V1 = Object.freeze({
  kind: "missing",
} satisfies OrderedIndexMissingV1);

export const ORDERED_INDEX_NULL_V1 = Object.freeze({
  kind: "null",
} satisfies OrderedIndexNullV1);

export const APP_ORDERED_INDEX_SYSTEM_CREATION_TIME_V1 = Object.freeze({
  kind: "systemCreationTime",
} satisfies AppOrderedIndexSystemCreationTimeV1);

const SEPARATE_ROW_ID_TIE_BREAKER = Object.freeze({
  kind: "separateRowIdentity",
  byteLength: ORDERED_INDEX_ROW_ID_BYTES_V1,
} as const);

export function decodeAppOrderedIndexPhysicalSpecV1(
  value: unknown,
): AppOrderedIndexPhysicalSpecV1 {
  return Result.getOrThrow(
    decodeAppOrderedIndexPhysicalSpecV1Result(value),
  );
}

export function decodeAppOrderedIndexPhysicalSpecV1Result(
  value: unknown,
): Result.Result<AppOrderedIndexPhysicalSpecV1, Schema.SchemaError> {
  return decodeAppOrderedIndexPhysicalSpecV1ShapeResult(value).pipe(
    Result.map(snapshotDecodedProtocolPlainData),
  );
}

export function lowerAppDeveloperOrderedIndexPhysicalSpecV1(
  logicalSpec: SchemaManifestAppDeveloperOrderedIndexSpecV1,
): AppOrderedIndexPhysicalSpecV1 {
  const decodedLogicalSpec =
    decodeSchemaManifestAppDeveloperOrderedIndexSpecV1(logicalSpec);
  return decodeAppOrderedIndexPhysicalSpecV1({
    kind: "appOrdered",
    specVersion: 1,
    accessPath: "developer",
    orderedFields: [
      ...decodedLogicalSpec.fields.map((path) => ({
        kind: "documentPath" as const,
        path,
      })),
      APP_ORDERED_INDEX_SYSTEM_CREATION_TIME_V1,
    ],
    tieBreaker: SEPARATE_ROW_ID_TIE_BREAKER,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    collation: "binaryUtf8",
    maxEncodedKeyBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
  });
}

export const APP_BY_CREATION_TIME_PHYSICAL_SPEC_V1 =
  decodeAppOrderedIndexPhysicalSpecV1({
    kind: "appOrdered",
    specVersion: 1,
    accessPath: "by_creation_time",
    orderedFields: [APP_ORDERED_INDEX_SYSTEM_CREATION_TIME_V1],
    tieBreaker: SEPARATE_ROW_ID_TIE_BREAKER,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    collation: "binaryUtf8",
    maxEncodedKeyBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
  });

export const APP_BY_ID_PHYSICAL_SPEC_V1 =
  decodeAppOrderedIndexPhysicalSpecV1({
    kind: "appOrdered",
    specVersion: 1,
    accessPath: "by_id",
    orderedFields: [],
    tieBreaker: SEPARATE_ROW_ID_TIE_BREAKER,
    keyCodecVersion: ORDERED_INDEX_KEY_CODEC_VERSION_V1,
    collation: "binaryUtf8",
    maxEncodedKeyBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
  });

export function orderedIndexFloat64FromNumberV1(
  value: number,
): OrderedIndexFloat64V1 {
  if (typeof value !== "number") {
    throw invalidValue("$", "float64 input must be a number");
  }
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setFloat64(0, value, false);
  return orderedIndexFloat64FromBitsV1(view.getBigUint64(0, false));
}

export function orderedIndexFloat64FromBitsV1(
  bits: bigint,
): OrderedIndexFloat64V1 {
  validateFloatBits(bits, "$float64.bits");
  return Object.freeze({ kind: "float64", bits });
}

export function orderedIndexFloat64ToNumberV1(
  value: OrderedIndexFloat64V1,
): number {
  validateFloatBits(value.bits, "$float64.bits");
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, value.bits, false);
  return view.getFloat64(0, false);
}

export function orderedIndexCreationTimeV1(
  milliseconds: number,
): OrderedIndexFloat64V1 {
  if (
    typeof milliseconds !== "number" ||
    !(milliseconds > 0) ||
    milliseconds >= MAX_ORDERED_INDEX_CREATION_TIME_MS_EXCLUSIVE_V1
  ) {
    throw new OrderedIndexCodecV1InputError({
      issue: { reason: "invalidCreationTime", fieldIndex: 0 },
    });
  }
  return orderedIndexFloat64FromNumberV1(milliseconds);
}

/**
 * Lowers one validated Flarex value into S05-A's already-frozen ordering
 * domain. Missing remains a separate index-path result and is never produced
 * from an ordinary stored value.
 */
export function orderedIndexValueFromFlarexValueV1(
  value: unknown,
): OrderedIndexValueV1 {
  const normalized = normalizeFlarexValueV1(value).value;
  const ordered = orderedIndexValueFromCanonicalFlarexValueV1(normalized);
  // Keep S05-A as the sole size, canonical-shape, and byte authority.
  encodeOrderedIndexComponentsV1([ordered]);
  return ordered;
}

export function orderedIndexRowIdHexV1FromBytesResult(
  value: unknown,
): Result.Result<OrderedIndexRowIdHexV1, OrderedIndexCodecV1InputError> {
  return appRowIdHexV1FromBytesResult(value).pipe(
    Result.mapError(() => invalidValue(
      "$rowId",
      `row identity must contain exactly ${ORDERED_INDEX_ROW_ID_BYTES_V1} bytes`,
    )),
  );
}

export function orderedIndexRowIdHexV1ToBytes(
  value: OrderedIndexRowIdHexV1,
): Uint8Array {
  return appRowIdHexV1ToBytes(decodeOrderedIndexRowIdHexV1(value));
}

export function orderedIndexBytesV1FromBytes(
  value: Uint8Array,
): OrderedIndexBytesV1 {
  if (!(value instanceof Uint8Array)) {
    throw invalidValue("$bytes", "byte value must be a Uint8Array");
  }
  if (value.byteLength > MAX_ORDERED_INDEX_BYTE_VALUE_BYTES_V1) {
    throw new OrderedIndexKeyTooLargeError({
      observedBytes: value.byteLength + 2,
      maximumBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
    });
  }
  return Object.freeze({
    kind: "bytes",
    hex: decodeOrderedIndexByteValueHexV1(encodeBytesToLowercaseHex(value)),
  });
}

export function orderedIndexBytesV1ToBytes(
  value: OrderedIndexBytesV1,
): Uint8Array {
  validateVariantDataObject(value, "$bytes");
  if (value.kind !== "bytes") {
    throw invalidValue("$bytes", "expected a normalized byte value");
  }
  return hexToBytes(decodeOrderedIndexByteValueHexV1(value.hex));
}

export function orderedIndexKeyBytesHexV1FromBytes(
  value: Uint8Array,
): OrderedIndexKeyBytesHexV1 {
  if (!(value instanceof Uint8Array)) {
    throw invalidValue("$key", "encoded key must be a Uint8Array");
  }
  if (value.byteLength > MAX_ORDERED_INDEX_KEY_BYTES_V1) {
    throw new OrderedIndexKeyTooLargeError({
      observedBytes: value.byteLength,
      maximumBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
    });
  }
  return decodeOrderedIndexKeyBytesHexV1(encodeBytesToLowercaseHex(value));
}

export function orderedIndexKeyBytesHexV1ToBytes(
  value: OrderedIndexKeyBytesHexV1,
): Uint8Array {
  return hexToBytes(decodeOrderedIndexKeyBytesHexV1(value));
}

export function orderedIndexKeyHexV1ToBytes(
  value: OrderedIndexKeyHexV1,
): Uint8Array {
  return orderedIndexKeyBytesHexV1ToBytes(value);
}

export function orderedIndexBoundHexV1FromBytes(
  value: Uint8Array,
): OrderedIndexBoundHexV1 {
  if (!(value instanceof Uint8Array)) {
    throw invalidValue("$bound", "encoded bound must be a Uint8Array");
  }
  if (value.byteLength > MAX_ORDERED_INDEX_BOUND_BYTES_V1) {
    throw new OrderedIndexKeyTooLargeError({
      observedBytes: value.byteLength,
      maximumBytes: MAX_ORDERED_INDEX_BOUND_BYTES_V1,
    });
  }
  return decodeOrderedIndexBoundHexV1(encodeBytesToLowercaseHex(value));
}

export function orderedIndexBoundHexV1ToBytes(
  value: OrderedIndexBoundHexV1,
): Uint8Array {
  return hexToBytes(decodeOrderedIndexBoundHexV1(value));
}

export function encodeOrderedIndexComponentsV1(
  values: ReadonlyArray<OrderedIndexComponentV1>,
): OrderedIndexKeyHexV1 {
  if (
    !Array.isArray(values) ||
    Object.getPrototypeOf(values) !== Array.prototype
  ) {
    throw invalidValue("$", "components must use a canonical dense array");
  }
  if (values.length > MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1) {
    throw new OrderedIndexCodecV1InputError({
      issue: {
        reason: "componentCountOutOfRange",
        actual: values.length,
        maximum: MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1,
      },
    });
  }
  validateCanonicalArrayShape(
    values,
    "$",
    "components",
    MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1,
  );
  const writer = new OrderedIndexByteWriter();
  const ancestors = new WeakSet<object>();
  for (let index = 0; index < values.length; index += 1) {
    const value = readCanonicalArrayElement(
      values,
      index,
      `$[${index}]`,
      "component",
    );
    encodeComponent(value, writer, 0, `$[${index}]`, ancestors, true);
  }
  return writer.finish();
}

export function encodeAppOrderedIndexKeyV1(input: {
  readonly spec: AppOrderedIndexPhysicalSpecV1;
  readonly values: ReadonlyArray<OrderedIndexComponentV1>;
}): OrderedIndexKeyHexV1 {
  const spec = decodeAppOrderedIndexPhysicalSpecV1(input.spec);
  validateCanonicalArrayShape(
    input.values,
    "$values",
    "components",
    MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1,
  );
  if (input.values.length !== spec.orderedFields.length) {
    throw new OrderedIndexCodecV1InputError({
      issue: {
        reason: "componentCountMismatch",
        expected: spec.orderedFields.length,
        actual: input.values.length,
      },
    });
  }
  validateCreationTimeComponents(spec, input.values);
  return encodeOrderedIndexComponentsV1(input.values);
}

export function decodeOrderedIndexComponentsV1(
  encodedKey: OrderedIndexKeyBytesHexV1,
  componentCount: number,
): ReadonlyArray<OrderedIndexComponentV1> {
  if (
    !Number.isInteger(componentCount) ||
    componentCount < 0 ||
    componentCount > MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1
  ) {
    throw new InvalidEncodedOrderedIndexKeyV1Error({
      offset: 0,
      detail:
        "component count must be an integer from 0 through " +
        MAX_APP_ORDERED_INDEX_ENCODED_FIELDS_V1,
    });
  }
  let keyBytes: OrderedIndexKeyBytesHexV1;
  try {
    keyBytes = decodeOrderedIndexKeyBytesHexV1(encodedKey);
  } catch (cause) {
    throw new InvalidEncodedOrderedIndexKeyV1Error({
      offset: 0,
      detail: "encoded key is not canonical lowercase hexadecimal",
      cause,
    });
  }
  const reader = new OrderedIndexByteReader(hexToBytes(keyBytes));
  const values: OrderedIndexComponentV1[] = [];
  for (let index = 0; index < componentCount; index += 1) {
    values.push(reader.readComponent(0, `$[${index}]`, true));
  }
  if (reader.remaining !== 0) {
    throw reader.invalid("encoded key has trailing bytes");
  }
  const frozen = snapshotDecodedProtocolPlainData(values);
  let reencoded: OrderedIndexKeyHexV1;
  try {
    reencoded = encodeOrderedIndexComponentsV1(frozen);
  } catch (cause) {
    throw new InvalidEncodedOrderedIndexKeyV1Error({
      offset: 0,
      detail: "decoded key contains a non-canonical value",
      cause,
    });
  }
  if (reencoded !== keyBytes) {
    throw new InvalidEncodedOrderedIndexKeyV1Error({
      offset: 0,
      detail: "encoded key is not in canonical form",
    });
  }
  return frozen;
}

export function decodeAppOrderedIndexKeyV1(input: {
  readonly spec: AppOrderedIndexPhysicalSpecV1;
  readonly encodedKey: OrderedIndexKeyBytesHexV1;
}): ReadonlyArray<OrderedIndexComponentV1> {
  const spec = decodeAppOrderedIndexPhysicalSpecV1(input.spec);
  const values = decodeOrderedIndexComponentsV1(
    input.encodedKey,
    spec.orderedFields.length,
  );
  validateCreationTimeComponents(spec, values);
  return values;
}

export function compareOrderedIndexKeysV1(
  left: OrderedIndexKeyHexV1,
  right: OrderedIndexKeyHexV1,
): number {
  return compareHexByteStrings(left, right);
}

export function compareOrderedIndexPositionsV1(
  left: OrderedIndexPositionV1,
  right: OrderedIndexPositionV1,
): number {
  const keyOrder = compareOrderedIndexKeysV1(left.encodedKey, right.encodedKey);
  if (keyOrder !== 0) return keyOrder;
  const leftRowId = decodeOrderedIndexRowIdHexV1(left.rowId);
  const rightRowId = decodeOrderedIndexRowIdHexV1(right.rowId);
  return leftRowId < rightRowId ? -1 : leftRowId > rightRowId ? 1 : 0;
}

export function compileAppOrderedIndexBoundsV1(input: {
  readonly spec: AppOrderedIndexPhysicalSpecV1;
  readonly expressions: ReadonlyArray<OrderedIndexRangeExpressionV1>;
}): OrderedIndexBoundsV1 {
  const spec = decodeAppOrderedIndexPhysicalSpecV1(input.spec);
  validateCanonicalArrayShape(
    input.expressions,
    "$expressions",
    "range expressions",
    MAX_ORDERED_INDEX_RANGE_EXPRESSIONS_V1,
  );
  const equalities: OrderedIndexComponentV1[] = [];
  let lower: OrderedIndexRangeExpressionV1 | undefined;
  let upper: OrderedIndexRangeExpressionV1 | undefined;

  for (let index = 0; index < input.expressions.length; index += 1) {
    const expression = readCanonicalArrayElement(
      input.expressions,
      index,
      `$expressions[${index}]`,
      "range expression",
    );
    validatePlainDataObject(
      expression,
      `$expressions[${index}]`,
      ["op", "field", "value"],
    );
    if (
      expression.op !== "eq" &&
      expression.op !== "gt" &&
      expression.op !== "gte" &&
      expression.op !== "lt" &&
      expression.op !== "lte"
    ) {
      throw invalidValue(
        `$expressions[${index}].op`,
        "range expression operator is invalid",
      );
    }
    const expressionField = decodeOrderedIndexRangeFieldV1(
      expression.field,
      index,
    );
    const expectedField = spec.orderedFields[equalities.length];
    if (spec.accessPath === "by_id") {
      throw new InvalidOrderedIndexRangeV1Error({
        issue: { reason: "unsupportedByIdExpression", expressionIndex: index },
      });
    }
    if (!samePhysicalField(expressionField, expectedField)) {
      throw new InvalidOrderedIndexRangeV1Error({
        issue: { reason: "fieldOrder", expressionIndex: index },
      });
    }
    validateRangeValue(expectedField, expression.value, equalities.length);
    if (expression.op === "eq") {
      if (lower !== undefined || upper !== undefined) {
        throw new InvalidOrderedIndexRangeV1Error({
          issue: { reason: "equalityAfterInequality", expressionIndex: index },
        });
      }
      equalities.push(expression.value);
      continue;
    }
    if (expression.op === "gt" || expression.op === "gte") {
      if (lower !== undefined) {
        throw new InvalidOrderedIndexRangeV1Error({
          issue: { reason: "duplicateLowerBound", expressionIndex: index },
        });
      }
      lower = expression;
    } else {
      if (upper !== undefined) {
        throw new InvalidOrderedIndexRangeV1Error({
          issue: { reason: "duplicateUpperBound", expressionIndex: index },
        });
      }
      upper = expression;
    }
  }

  const equalityPrefixKey = encodeOrderedIndexComponentsV1(equalities);
  const equalityPrefix = orderedIndexKeyAsBoundV1(equalityPrefixKey);
  const inequalityHasTrailingFields =
    equalities.length + 1 < spec.orderedFields.length;
  const startInclusive = lower === undefined
    ? equalityPrefix.length === 0 ? undefined : equalityPrefix
    : lower.op === "gt"
      ? orderedIndexExclusiveEndAfterTupleV1(
        encodeOrderedIndexComponentsV1([...equalities, lower.value]),
        inequalityHasTrailingFields,
      )
      : orderedIndexKeyAsBoundV1(
        encodeOrderedIndexComponentsV1([...equalities, lower.value]),
      );
  const endExclusive = upper === undefined
    ? equalityPrefix.length === 0
      ? undefined
      : orderedIndexExclusiveEndAfterTupleV1(
        equalityPrefixKey,
        equalities.length < spec.orderedFields.length,
      )
    : upper.op === "lte"
      ? orderedIndexExclusiveEndAfterTupleV1(
        encodeOrderedIndexComponentsV1([...equalities, upper.value]),
        inequalityHasTrailingFields,
      )
      : orderedIndexKeyAsBoundV1(
        encodeOrderedIndexComponentsV1([...equalities, upper.value]),
      );

  return Object.freeze({
    ...(startInclusive === undefined ? {} : { startInclusive }),
    ...(endExclusive === undefined ? {} : { endExclusive }),
  });
}

export function orderedIndexPositionInBoundsV1(
  position: OrderedIndexPositionV1,
  bounds: OrderedIndexBoundsV1,
): boolean {
  const key = decodeOrderedIndexKeyBytesHexV1(position.encodedKey);
  decodeOrderedIndexRowIdHexV1(position.rowId);
  const startInclusive = bounds.startInclusive === undefined
    ? undefined
    : decodeOrderedIndexBoundHexV1(bounds.startInclusive);
  const endExclusive = bounds.endExclusive === undefined
    ? undefined
    : decodeOrderedIndexBoundHexV1(bounds.endExclusive);
  return (
    (startInclusive === undefined ||
      compareHexByteStrings(key, startInclusive) >= 0) &&
    (endExclusive === undefined ||
      compareHexByteStrings(key, endExclusive) < 0)
  );
}

function validateAppOrderedIndexPhysicalSpecV1(
  spec: {
    readonly accessPath: "developer" | "by_creation_time" | "by_id";
    readonly orderedFields: ReadonlyArray<AppOrderedIndexPhysicalFieldV1>;
  },
): string | undefined {
  switch (spec.accessPath) {
    case "developer": {
      if (spec.orderedFields.length < 2) {
        return "Expected at least one developer field plus system creation time";
      }
      const last = spec.orderedFields.at(-1);
      if (last?.kind !== "systemCreationTime") {
        return "Expected system creation time as the final encoded field";
      }
      const paths = new Set<string>();
      for (let index = 0; index < spec.orderedFields.length - 1; index += 1) {
        const field = spec.orderedFields[index];
        if (field?.kind !== "documentPath") {
          return "Expected developer document paths before system creation time";
        }
        if (paths.has(field.path)) {
          return "Expected unique developer document paths";
        }
        paths.add(field.path);
      }
      return undefined;
    }
    case "by_creation_time":
      return spec.orderedFields.length === 1 &&
          spec.orderedFields[0]?.kind === "systemCreationTime"
        ? undefined
        : "Expected only system creation time for by_creation_time";
    case "by_id":
      return spec.orderedFields.length === 0
        ? undefined
        : "Expected no encoded fields for by_id";
  }
}

function validateCreationTimeComponents(
  spec: AppOrderedIndexPhysicalSpecV1,
  values: ReadonlyArray<OrderedIndexComponentV1>,
): void {
  for (let index = 0; index < spec.orderedFields.length; index += 1) {
    const field = spec.orderedFields[index];
    if (field?.kind === "systemCreationTime") {
      validateCreationTimeComponent(
        readCanonicalArrayElement(
          values,
          index,
          `$[${index}]`,
          "component",
        ),
        index,
      );
    }
  }
}

function validateRangeValue(
  field: AppOrderedIndexPhysicalFieldV1 | undefined,
  value: OrderedIndexComponentV1,
  fieldIndex: number,
): void {
  if (field?.kind !== "systemCreationTime") return;
  validateCreationTimeComponent(value, fieldIndex);
}

function validateCreationTimeComponent(
  value: OrderedIndexComponentV1 | undefined,
  fieldIndex: number,
): void {
  if (value === undefined) {
    throw new OrderedIndexCodecV1InputError({
      issue: { reason: "invalidCreationTime", fieldIndex },
    });
  }
  validateVariantDataObject(value, `$[${fieldIndex}]`);
  if (value.kind !== "float64") {
    throw new OrderedIndexCodecV1InputError({
      issue: { reason: "invalidCreationTime", fieldIndex },
    });
  }
  const milliseconds = orderedIndexFloat64ToNumberV1(value);
  if (
    !(milliseconds > 0) ||
    milliseconds >= MAX_ORDERED_INDEX_CREATION_TIME_MS_EXCLUSIVE_V1
  ) {
    throw new OrderedIndexCodecV1InputError({
      issue: { reason: "invalidCreationTime", fieldIndex },
    });
  }
}

function samePhysicalField(
  left: AppOrderedIndexPhysicalFieldV1,
  right: AppOrderedIndexPhysicalFieldV1 | undefined,
): boolean {
  if (right === undefined || left.kind !== right.kind) return false;
  return left.kind === "systemCreationTime" ||
    (right.kind === "documentPath" && left.path === right.path);
}

function decodeOrderedIndexRangeFieldV1(
  value: unknown,
  expressionIndex: number,
): AppOrderedIndexPhysicalFieldV1 {
  try {
    if (value === null || typeof value !== "object") {
      throw invalidValue("$field", "range field must be a plain data object");
    }
    const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
    if (
      kindDescriptor === undefined ||
      !("value" in kindDescriptor) ||
      typeof kindDescriptor.value !== "string"
    ) {
      throw invalidValue("$field", "range field kind must be a data property");
    }
    validatePlainDataObject(
      value,
      "$field",
      kindDescriptor.value === "documentPath"
        ? ["kind", "path"]
        : ["kind"],
    );
    return decodeAppOrderedIndexPhysicalFieldV1Shape(value);
  } catch {
    throw new InvalidOrderedIndexRangeV1Error({
      issue: { reason: "invalidField", expressionIndex },
    });
  }
}

function orderedIndexKeyAsBoundV1(
  key: OrderedIndexKeyHexV1,
): OrderedIndexBoundHexV1 {
  return decodeOrderedIndexBoundHexV1(key);
}

function orderedIndexExclusiveEndAfterTupleV1(
  tuple: OrderedIndexKeyHexV1,
  hasTrailingFields: boolean,
): OrderedIndexBoundHexV1 {
  // A completed string/bytes/object encoding can prefix a larger value through
  // its 0x00 0xff escape. When fields remain, 0x16 is above every v1 value tag
  // but below 0xff; for a complete tuple, 0x00 is the exact-key successor.
  return decodeOrderedIndexBoundHexV1(
    `${tuple}${hasTrailingFields ? AFTER_ORDERED_VALUE_TAG_V1_HEX : "00"}`,
  );
}

class OrderedIndexByteWriter {
  readonly bytes: number[] = [];

  writeByte(value: number): void {
    this.bytes.push(value);
    this.checkSize();
  }

  writeBytes(values: Iterable<number>): void {
    for (const value of values) this.writeByte(value);
  }

  finish(): OrderedIndexKeyHexV1 {
    return markCanonicalOrderedIndexKeyHexV1(bytesToHex(this.bytes));
  }

  private checkSize(): void {
    if (this.bytes.length > MAX_ORDERED_INDEX_KEY_BYTES_V1) {
      throw new OrderedIndexKeyTooLargeError({
        observedBytes: this.bytes.length,
        maximumBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
      });
    }
  }
}

function encodeComponent(
  value: OrderedIndexComponentV1,
  writer: OrderedIndexByteWriter,
  depth: number,
  path: string,
  ancestors: WeakSet<object>,
  allowMissing: boolean,
): void {
  if (depth > MAX_ORDERED_INDEX_VALUE_DEPTH_V1) {
    throw new OrderedIndexCodecV1InputError({
      issue: {
        reason: "nestingTooDeep",
        path,
        maxDepth: MAX_ORDERED_INDEX_VALUE_DEPTH_V1,
      },
    });
  }
  validateVariantDataObject(value, path);
  switch (value.kind) {
    case "missing":
      if (!allowMissing) {
        throw invalidValue(path, "missing is allowed only as a top-level indexed field");
      }
      writer.writeByte(UNDEFINED_TAG);
      return;
    case "null":
      writer.writeByte(NULL_TAG);
      return;
    case "int64":
      writeInt64(value.value, writer, path);
      return;
    case "float64":
      writeFloat64(value.bits, writer, path);
      return;
    case "boolean":
      if (typeof value.value !== "boolean") {
        throw invalidValue(path, "boolean value is invalid");
      }
      writer.writeByte(value.value ? TRUE_BOOLEAN_TAG : FALSE_BOOLEAN_TAG);
      return;
    case "string":
      if (typeof value.value !== "string") {
        throw invalidValue(path, "string value is invalid");
      }
      if (value.value.length > MAX_ORDERED_INDEX_STRING_CODE_UNITS_V1) {
        throw new OrderedIndexKeyTooLargeError({
          observedBytes: value.value.length + 2,
          maximumBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
        });
      }
      if (!isWellFormedUnicode(value.value)) {
        throw invalidValue(path, "string must contain only valid Unicode scalar values");
      }
      writer.writeByte(STRING_TAG);
      writeEscapedBytes(TEXT_ENCODER.encode(value.value), writer);
      return;
    case "bytes":
      writer.writeByte(BYTES_TAG);
      writeEscapedBytes(
        hexToBytes(decodeOrderedIndexByteValueHexV1(value.hex)),
        writer,
      );
      return;
    case "array":
      encodeArray(value.value, writer, depth, path, ancestors);
      return;
    case "object":
      encodeObject(value.entries, writer, depth, path, ancestors);
      return;
    default:
      return assertNeverOrderedIndexComponent(value, path);
  }
}

function encodeArray(
  values: ReadonlyArray<OrderedIndexValueV1>,
  writer: OrderedIndexByteWriter,
  depth: number,
  path: string,
  ancestors: WeakSet<object>,
): void {
  validateCompoundDepth(depth, path);
  validateCanonicalArrayShape(
    values,
    path,
    "array value",
    MAX_ORDERED_INDEX_ARRAY_ITEMS_V1,
  );
  withAncestor(values, path, ancestors, () => {
    writer.writeByte(ARRAY_TAG);
    for (let index = 0; index < values.length; index += 1) {
      const value = readCanonicalArrayElement(
        values,
        index,
        `${path}[${index}]`,
        "array element",
      );
      encodeComponent(
        value,
        writer,
        depth + 1,
        `${path}[${index}]`,
        ancestors,
        false,
      );
    }
    writer.writeByte(TERMINATOR_BYTE);
  });
}

function encodeObject(
  entries: ReadonlyArray<OrderedIndexObjectEntryV1>,
  writer: OrderedIndexByteWriter,
  depth: number,
  path: string,
  ancestors: WeakSet<object>,
): void {
  validateCompoundDepth(depth, path);
  validateCanonicalArrayShape(
    entries,
    path,
    "object entries",
    MAX_ORDERED_INDEX_OBJECT_ENTRIES_V1,
  );
  withAncestor(entries, path, ancestors, () => {
    const prepared: Array<{
      readonly field: string;
      readonly value: OrderedIndexValueV1;
    }> = [];
    let minimumEncodedBytes = 2;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = readCanonicalArrayElement(
        entries,
        index,
        `${path}.entries[${index}]`,
        "object entry",
      );
      validatePlainDataObject(
        entry,
        `${path}.entries[${index}]`,
        ["field", "value"],
      );
      validateObjectField(entry.field, `${path}.entries[${index}].field`);
      minimumEncodedBytes +=
        (entry.field.length === 0 ? 2 : entry.field.length + 1) + 1;
      if (minimumEncodedBytes > MAX_ORDERED_INDEX_KEY_BYTES_V1) {
        throw new OrderedIndexKeyTooLargeError({
          observedBytes: minimumEncodedBytes,
          maximumBytes: MAX_ORDERED_INDEX_KEY_BYTES_V1,
        });
      }
      prepared.push({
        field: entry.field,
        value: entry.value,
      });
    }
    prepared.sort((left, right) =>
      compareAsciiStrings(left.field, right.field)
    );
    for (let index = 1; index < prepared.length; index += 1) {
      if (prepared[index - 1]?.field === prepared[index]?.field) {
        throw invalidValue(
          path,
          `duplicate object field ${JSON.stringify(prepared[index]?.field)}`,
        );
      }
    }

    writer.writeByte(OBJECT_TAG);
    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index];
      if (entry === undefined) continue;
      if (entry.value === undefined) {
        throw invalidValue(`${path}.${entry.field}`, "object value is missing");
      }
      writeEscapedBytes(TEXT_ENCODER.encode(entry.field), writer);
      if (entry.field.length === 0) writer.writeByte(ESCAPE_BYTE);
      encodeComponent(
        entry.value,
        writer,
        depth + 1,
        `${path}.${entry.field}`,
        ancestors,
        false,
      );
    }
    writer.writeByte(TERMINATOR_BYTE);
  });
}

function withAncestor(
  value: object,
  path: string,
  ancestors: WeakSet<object>,
  run: () => void,
): void {
  if (ancestors.has(value)) {
    throw new OrderedIndexCodecV1InputError({
      issue: { reason: "cyclicValue", path },
    });
  }
  ancestors.add(value);
  try {
    run();
  } finally {
    ancestors.delete(value);
  }
}

function validateCompoundDepth(depth: number, path: string): void {
  if (depth >= MAX_ORDERED_INDEX_VALUE_DEPTH_V1) {
    throw new OrderedIndexCodecV1InputError({
      issue: {
        reason: "nestingTooDeep",
        path,
        maxDepth: MAX_ORDERED_INDEX_VALUE_DEPTH_V1,
      },
    });
  }
}

function writeInt64(
  value: bigint,
  writer: OrderedIndexByteWriter,
  path: string,
): void {
  if (typeof value !== "bigint" || value < INT64_MIN || value > INT64_MAX) {
    throw invalidValue(path, "int64 must fit the signed 64-bit range");
  }
  if (value === 0n) {
    writer.writeByte(ZERO_INT64_TAG);
    return;
  }
  const byteLength = value >= -128n && value <= 127n
    ? 1
    : value >= -32_768n && value <= 32_767n
      ? 2
      : value >= -2_147_483_648n && value <= 2_147_483_647n
        ? 4
        : 8;
  const tagDistance = byteLength === 1 ? 1 : byteLength === 2 ? 2 : byteLength === 4 ? 3 : 4;
  writer.writeByte(
    value < 0n ? ZERO_INT64_TAG - tagDistance : ZERO_INT64_TAG + tagDistance,
  );
  const modulus = 1n << BigInt(byteLength * 8);
  let encoded = value < 0n ? modulus + value : value;
  const bytes = Array.from({ length: byteLength }, () => 0);
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    bytes[index] = Number(encoded & 0xffn);
    encoded >>= 8n;
  }
  writer.writeBytes(bytes);
}

function writeFloat64(
  bits: bigint,
  writer: OrderedIndexByteWriter,
  path: string,
): void {
  validateFloatBits(bits, `${path}.bits`);
  const transformed = (bits & FLOAT64_SIGN_BIT) !== 0n
    ? (~bits) & UINT64_MAX
    : bits | FLOAT64_SIGN_BIT;
  writer.writeByte(FLOAT64_TAG);
  writeUnsignedBigEndian(transformed, 8, writer);
}

function validateFloatBits(bits: bigint, path: string): void {
  if (typeof bits !== "bigint" || bits < 0n || bits > UINT64_MAX) {
    throw invalidValue(path, "float64 bits must be an unsigned 64-bit integer");
  }
}

function writeUnsignedBigEndian(
  value: bigint,
  byteLength: number,
  writer: OrderedIndexByteWriter,
): void {
  for (let index = byteLength - 1; index >= 0; index -= 1) {
    writer.writeByte(Number((value >> BigInt(index * 8)) & 0xffn));
  }
}

function writeEscapedBytes(
  values: Uint8Array,
  writer: OrderedIndexByteWriter,
): void {
  for (const value of values) {
    writer.writeByte(value);
    if (value === TERMINATOR_BYTE) writer.writeByte(ESCAPE_BYTE);
  }
  writer.writeByte(TERMINATOR_BYTE);
}

class OrderedIndexByteReader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get remaining(): number {
    return this.bytes.length - this.offset;
  }

  readComponent(
    depth: number,
    path: string,
    allowMissing: boolean,
  ): OrderedIndexComponentV1 {
    if (depth > MAX_ORDERED_INDEX_VALUE_DEPTH_V1) {
      throw this.invalid("encoded value exceeds the nesting limit");
    }
    const tag = this.readByte();
    switch (tag) {
      case UNDEFINED_TAG:
        if (!allowMissing) {
          throw this.invalid("missing is not canonical inside arrays or objects");
        }
        return ORDERED_INDEX_MISSING_V1;
      case NULL_TAG:
        return ORDERED_INDEX_NULL_V1;
      case NEG_INT64_8_BYTE_TAG:
      case NEG_INT64_4_BYTE_TAG:
      case NEG_INT64_2_BYTE_TAG:
      case NEG_INT64_1_BYTE_TAG:
      case ZERO_INT64_TAG:
      case POS_INT64_1_BYTE_TAG:
      case POS_INT64_2_BYTE_TAG:
      case POS_INT64_4_BYTE_TAG:
      case POS_INT64_8_BYTE_TAG:
        return Object.freeze({
          kind: "int64",
          value: this.readCanonicalInt64(tag),
        });
      case FLOAT64_TAG:
        return Object.freeze({
          kind: "float64",
          bits: this.readFloat64Bits(),
        });
      case FALSE_BOOLEAN_TAG:
        return Object.freeze({ kind: "boolean", value: false });
      case TRUE_BOOLEAN_TAG:
        return Object.freeze({ kind: "boolean", value: true });
      case STRING_TAG:
        return Object.freeze({
          kind: "string",
          value: this.decodeUtf8(this.readEscapedBytes(), "string"),
        });
      case BYTES_TAG:
        return orderedIndexBytesV1FromBytes(this.readEscapedBytes());
      case ARRAY_TAG:
        return this.readArray(depth, path);
      case OBJECT_TAG:
        return this.readObject(depth, path);
      default:
        throw this.invalid(`unrecognized value tag 0x${tag.toString(16).padStart(2, "0")}`);
    }
  }

  invalid(detail: string, cause?: unknown): InvalidEncodedOrderedIndexKeyV1Error {
    return new InvalidEncodedOrderedIndexKeyV1Error({
      offset: this.offset,
      detail,
      ...(cause === undefined ? {} : { cause }),
    });
  }

  private readCanonicalInt64(tag: number): bigint {
    if (tag === ZERO_INT64_TAG) return 0n;
    const distance = Math.abs(tag - ZERO_INT64_TAG);
    const byteLength = distance === 1 ? 1 : distance === 2 ? 2 : distance === 3 ? 4 : 8;
    const value = this.readSignedBigEndian(byteLength);
    const canonical = value >= -128n && value <= 127n
      ? 1
      : value >= -32_768n && value <= 32_767n
        ? 2
        : value >= -2_147_483_648n && value <= 2_147_483_647n
          ? 3
          : 4;
    const expectedTag = value < 0n
      ? ZERO_INT64_TAG - canonical
      : ZERO_INT64_TAG + canonical;
    if (value === 0n || expectedTag !== tag) {
      throw this.invalid("int64 is not minimally encoded");
    }
    return value;
  }

  private readFloat64Bits(): bigint {
    const transformed = this.readUnsignedBigEndian(8);
    return (transformed & FLOAT64_SIGN_BIT) !== 0n
      ? transformed & ~FLOAT64_SIGN_BIT
      : (~transformed) & UINT64_MAX;
  }

  private readArray(depth: number, path: string): OrderedIndexArrayV1 {
    if (depth >= MAX_ORDERED_INDEX_VALUE_DEPTH_V1) {
      throw this.invalid("encoded array exceeds the nesting limit");
    }
    const values: OrderedIndexValueV1[] = [];
    while (this.peekByte() !== TERMINATOR_BYTE) {
      const value = this.readComponent(
        depth + 1,
        `${path}[${values.length}]`,
        false,
      );
      if (value.kind === "missing") {
        throw this.invalid("missing is not canonical inside an array");
      }
      values.push(value);
    }
    this.readByte();
    return Object.freeze({ kind: "array", value: Object.freeze(values) });
  }

  private readObject(depth: number, path: string): OrderedIndexObjectV1 {
    if (depth >= MAX_ORDERED_INDEX_VALUE_DEPTH_V1) {
      throw this.invalid("encoded object exceeds the nesting limit");
    }
    const entries: OrderedIndexObjectEntryV1[] = [];
    let previousFieldBytes: Uint8Array | undefined;
    while (true) {
      let fieldBytes: Uint8Array;
      if (this.peekByte() === TERMINATOR_BYTE) {
        this.readByte();
        if (this.peekByteOrUndefined() === ESCAPE_BYTE) {
          this.readByte();
          fieldBytes = new Uint8Array();
        } else {
          break;
        }
      } else {
        fieldBytes = this.readEscapedBytes();
      }
      if (
        previousFieldBytes !== undefined &&
        compareBytesLexicographically(previousFieldBytes, fieldBytes) >= 0
      ) {
        throw this.invalid("object fields are duplicated or not strictly byte-ordered");
      }
      previousFieldBytes = fieldBytes;
      const field = this.decodeUtf8(fieldBytes, "object field");
      try {
        validateObjectField(field, `${path}.${field}`);
      } catch (cause) {
        throw this.invalid("object field is invalid", cause);
      }
      const value = this.readComponent(depth + 1, `${path}.${field}`, false);
      if (value.kind === "missing") {
        throw this.invalid("missing is not canonical inside an object");
      }
      entries.push(Object.freeze({ field, value }));
    }
    return Object.freeze({ kind: "object", entries: Object.freeze(entries) });
  }

  private readEscapedBytes(): Uint8Array {
    const values: number[] = [];
    while (true) {
      const value = this.readByte();
      if (value !== TERMINATOR_BYTE) {
        values.push(value);
        continue;
      }
      if (this.peekByteOrUndefined() === ESCAPE_BYTE) {
        this.readByte();
        values.push(TERMINATOR_BYTE);
        continue;
      }
      return new Uint8Array(values);
    }
  }

  private decodeUtf8(bytes: Uint8Array, label: string): string {
    try {
      const value = TEXT_DECODER.decode(bytes);
      if (!isWellFormedUnicode(value)) {
        throw new Error(`${label} contains invalid Unicode`);
      }
      return value;
    } catch (cause) {
      throw this.invalid(`${label} is not canonical UTF-8`, cause);
    }
  }

  private readSignedBigEndian(byteLength: number): bigint {
    const unsigned = this.readUnsignedBigEndian(byteLength);
    const bitLength = BigInt(byteLength * 8);
    const signBit = 1n << (bitLength - 1n);
    return (unsigned & signBit) === 0n
      ? unsigned
      : unsigned - (1n << bitLength);
  }

  private readUnsignedBigEndian(byteLength: number): bigint {
    let value = 0n;
    for (let index = 0; index < byteLength; index += 1) {
      value = (value << 8n) | BigInt(this.readByte());
    }
    return value;
  }

  private peekByte(): number {
    const value = this.peekByteOrUndefined();
    if (value === undefined) throw this.invalid("unexpected end of encoded key");
    return value;
  }

  private peekByteOrUndefined(): number | undefined {
    return this.bytes[this.offset];
  }

  private readByte(): number {
    const value = this.bytes[this.offset];
    if (value === undefined) throw this.invalid("unexpected end of encoded key");
    this.offset += 1;
    return value;
  }
}

function validateObjectField(field: string, path: string): void {
  if (typeof field !== "string") {
    throw invalidValue(path, "object field must be a string");
  }
  if (
    field.length > MAX_ORDERED_INDEX_OBJECT_FIELD_BYTES_V1 ||
    field.startsWith("$")
  ) {
    throw invalidValue(
      path,
      "object field must be at most 1024 non-control ASCII bytes and must not start with $",
    );
  }
  for (let index = 0; index < field.length; index += 1) {
    const codeUnit = field.charCodeAt(index);
    if (codeUnit > 0x7f || codeUnit < 0x20 || codeUnit === 0x7f) {
      throw invalidValue(
        path,
        "object field must be at most 1024 non-control ASCII bytes and must not start with $",
      );
    }
  }
}

function validateVariantDataObject(
  value: unknown,
  path: string,
): asserts value is OrderedIndexComponentV1 {
  if (value === null || typeof value !== "object") {
    throw invalidValue(path, "value must be a tagged plain data object");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidValue(path, "value must use a plain object prototype");
  }
  const kindDescriptor = Object.getOwnPropertyDescriptor(value, "kind");
  if (
    kindDescriptor === undefined ||
    !("value" in kindDescriptor) ||
    typeof kindDescriptor.value !== "string"
  ) {
    throw invalidValue(path, "kind must be a string data property");
  }
  const expectedKeys: ReadonlyArray<string> = (() => {
    switch (kindDescriptor.value) {
      case "missing":
      case "null":
        return ["kind"];
      case "float64":
        return ["kind", "bits"];
      case "object":
        return ["kind", "entries"];
      case "int64":
      case "boolean":
      case "string":
      case "array":
        return ["kind", "value"];
      case "bytes":
        return ["kind", "hex"];
      default:
        throw invalidValue(path, "unrecognized ordered index value kind");
    }
  })();
  validatePlainDataObject(value, path, expectedKeys);
}

function validatePlainDataObject(
  value: unknown,
  path: string,
  expectedKeys: ReadonlyArray<string>,
): void {
  if (value === null || typeof value !== "object") {
    throw invalidValue(path, "value must use a plain object prototype");
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw invalidValue(path, "value must use a plain object prototype");
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== expectedKeys.length ||
    !keys.every((key) => typeof key === "string" && expectedKeys.includes(key))
  ) {
    throw invalidValue(path, "value has unexpected or missing properties");
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !("value" in descriptor) ||
      !descriptor.enumerable
    ) {
      throw invalidValue(path, `property ${key} must be an enumerable data property`);
    }
  }
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
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

function validateCanonicalArrayShape(
  value: unknown,
  path: string,
  label: string,
  maximumLength: number,
): asserts value is ReadonlyArray<unknown> {
  if (
    !Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  ) {
    throw invalidValue(path, `${label} must use a canonical dense array`);
  }
  if (value.length > maximumLength) {
    throw invalidValue(
      path,
      `${label} exceeds its maximum length of ${maximumLength}`,
    );
  }
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== value.length + 1 ||
    !keys.every((key) => {
      if (key === "length") return true;
      if (typeof key !== "string") return false;
      const index = Number(key);
      return Number.isInteger(index) &&
        index >= 0 &&
        index < value.length &&
        String(index) === key;
    })
  ) {
    throw invalidValue(path, `${label} has unexpected or sparse properties`);
  }
}

function readCanonicalArrayElement<T>(
  values: ReadonlyArray<T>,
  index: number,
  path: string,
  label: string,
): T {
  const descriptor = Object.getOwnPropertyDescriptor(values, index);
  if (
    descriptor === undefined ||
    !("value" in descriptor) ||
    !descriptor.enumerable
  ) {
    throw invalidValue(path, `${label} must be an enumerable data property`);
  }
  const value = values[index];
  if (value === undefined) {
    throw invalidValue(path, `${label} is missing`);
  }
  return value;
}

function orderedIndexValueFromCanonicalFlarexValueV1(
  value: CanonicalFlarexRuntimeValueV1,
): OrderedIndexValueV1 {
  if (value === null) return ORDERED_INDEX_NULL_V1;
  if (typeof value === "bigint") {
    return Object.freeze({ kind: "int64", value });
  }
  if (typeof value === "number") {
    return orderedIndexFloat64FromNumberV1(value);
  }
  if (typeof value === "boolean") {
    return Object.freeze({ kind: "boolean", value });
  }
  if (typeof value === "string") {
    return Object.freeze({ kind: "string", value });
  }
  if (value instanceof ArrayBuffer) {
    return orderedIndexBytesV1FromBytes(new Uint8Array(value));
  }
  if (isCanonicalFlarexValueArray(value)) {
    return Object.freeze({
      kind: "array",
      value: Object.freeze(
        value.map(orderedIndexValueFromCanonicalFlarexValueV1),
      ),
    });
  }
  const entries: OrderedIndexObjectEntryV1[] = [];
  for (const field of Object.keys(value).toSorted(compareAsciiStrings)) {
    const member = value[field];
    if (member === undefined) {
      throw invalidValue(
        "$value",
        "normalized Flarex value lost an object property",
      );
    }
    entries.push(Object.freeze({
      field,
      value: orderedIndexValueFromCanonicalFlarexValueV1(member),
    }));
  }
  return Object.freeze({ kind: "object", entries: Object.freeze(entries) });
}

function isCanonicalFlarexValueArray(
  value: CanonicalFlarexRuntimeValueV1,
): value is ReadonlyArray<CanonicalFlarexRuntimeValueV1> {
  return Array.isArray(value);
}

// Canonical lowercase hex and validated ASCII fields preserve their byte order
// under ECMAScript's UTF-16 code-unit comparison.
const compareHexByteStrings = compareUtf16Strings;
const compareAsciiStrings = compareUtf16Strings;

function bytesToHex(values: Iterable<number>): string {
  let result = "";
  for (const value of values) {
    result += value.toString(16).padStart(2, "0");
  }
  return result;
}

function hexToBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function invalidValue(
  path: string,
  detail: string,
): OrderedIndexCodecV1InputError {
  return new OrderedIndexCodecV1InputError({
    issue: { reason: "invalidValue", path, detail },
  });
}

const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder("utf-8", { fatal: true });

const TERMINATOR_BYTE = 0x00;
const UNDEFINED_TAG = 0x01;
const NULL_TAG = 0x03;
const NEG_INT64_8_BYTE_TAG = 0x04;
const NEG_INT64_4_BYTE_TAG = 0x05;
const NEG_INT64_2_BYTE_TAG = 0x06;
const NEG_INT64_1_BYTE_TAG = 0x07;
const ZERO_INT64_TAG = 0x08;
const POS_INT64_1_BYTE_TAG = 0x09;
const POS_INT64_2_BYTE_TAG = 0x0a;
const POS_INT64_4_BYTE_TAG = 0x0b;
const POS_INT64_8_BYTE_TAG = 0x0c;
const FLOAT64_TAG = 0x0d;
const FALSE_BOOLEAN_TAG = 0x0e;
const TRUE_BOOLEAN_TAG = 0x0f;
const STRING_TAG = 0x10;
const BYTES_TAG = 0x11;
const ARRAY_TAG = 0x12;
const OBJECT_TAG = 0x15;
const ESCAPE_BYTE = 0xff;
const AFTER_ORDERED_VALUE_TAG_V1_HEX = "16";

const INT64_MIN = -(1n << 63n);
const INT64_MAX = (1n << 63n) - 1n;
const UINT64_MAX = (1n << 64n) - 1n;
const FLOAT64_SIGN_BIT = 1n << 63n;

export function appOrderedIndexDocumentPathV1(
  path: SchemaManifestAppIndexFieldPath,
): AppOrderedIndexDocumentPathV1 {
  return Object.freeze({
    kind: "documentPath",
    path: decodeSchemaManifestAppIndexFieldPath(path),
  });
}

function assertNeverOrderedIndexComponent(
  _value: never,
  path: string,
): never {
  throw invalidValue(path, "unrecognized ordered index value kind");
}
