import { Schema, SchemaTransformation } from "effect";

import { OrderedIndexRowIdHexV1Schema } from "./ordered-index";

const StrictStructOptions = {
  parseOptions: { onExcessProperty: "error" },
} as const;

const CanonicalUnsignedDecimalString = Schema.String.check(
  Schema.isPattern(/^(?:0|[1-9][0-9]*)$/),
);
export const MAX_INDEX_BUILD_ATTEMPT_FENCE = 9_223_372_036_854_775_807n;
const PositiveSignedInt64 = Schema.BigInt.check(
  Schema.makeFilter((value) =>
    value >= 1n && value <= MAX_INDEX_BUILD_ATTEMPT_FENCE
      ? undefined
      : `Expected a positive signed-64-bit build attempt fence no greater than ${MAX_INDEX_BUILD_ATTEMPT_FENCE}`
  ),
);
const CanonicalPositiveBigIntFromString = CanonicalUnsignedDecimalString.pipe(
  Schema.decodeTo(PositiveSignedInt64, SchemaTransformation.bigintFromString),
);

/**
 * Monotonic ownership token for one scoped physical-index build attempt.
 * A worker may mutate build progress only while this exact fence still wins.
 */
export const IndexBuildAttemptFenceSchema =
  CanonicalPositiveBigIntFromString.pipe(
    Schema.brand("FlarexDB/IndexBuildAttemptFence"),
  );
export type IndexBuildAttemptFence =
  typeof IndexBuildAttemptFenceSchema.Type;

export const IndexBuildLifecycleV1Schema = Schema.Literals([
  "declared",
  "building",
  "backfilling",
  "validating",
  "enabled",
  "retiring",
]);
export type IndexBuildLifecycleV1 =
  typeof IndexBuildLifecycleV1Schema.Type;
export const decodeIndexBuildLifecycleV1 = Schema.decodeUnknownSync(
  IndexBuildLifecycleV1Schema,
);

export const IndexBuildCursorCodecVersionV1Schema = Schema.Literal(1).pipe(
  Schema.brand("FlarexDB/IndexBuildCursorCodecVersion"),
);
export type IndexBuildCursorCodecVersionV1 =
  typeof IndexBuildCursorCodecVersionV1Schema.Type;
export const INDEX_BUILD_CURSOR_CODEC_VERSION_V1 =
  IndexBuildCursorCodecVersionV1Schema.make(1);
export const decodeIndexBuildCursorCodecVersionV1 = Schema.decodeUnknownSync(
  IndexBuildCursorCodecVersionV1Schema,
);

/**
 * Restart cursor for an ascending snapshot scan of one definition's table.
 * `afterRowId` is exclusive; null means no row has been durably completed.
 */
export const IndexBuildBackfillCursorV1Schema = Schema.Struct({
  codecVersion: IndexBuildCursorCodecVersionV1Schema,
  afterRowId: Schema.Union([OrderedIndexRowIdHexV1Schema, Schema.Null]),
}).annotate(StrictStructOptions);
export type IndexBuildBackfillCursorV1 =
  typeof IndexBuildBackfillCursorV1Schema.Type;
const decodeIndexBuildBackfillCursorV1Shape = Schema.decodeUnknownSync(
  IndexBuildBackfillCursorV1Schema,
  { onExcessProperty: "error" },
);

export function decodeIndexBuildBackfillCursorV1(
  value: unknown,
): IndexBuildBackfillCursorV1 {
  const cursor = decodeIndexBuildBackfillCursorV1Shape(value);
  return Object.freeze({
    codecVersion: cursor.codecVersion,
    afterRowId: cursor.afterRowId,
  });
}
