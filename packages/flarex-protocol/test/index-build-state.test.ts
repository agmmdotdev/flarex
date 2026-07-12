import { Schema } from "effect";
import { describe, expect, expectTypeOf, it } from "vitest";

import {
  INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
  IndexBuildAttemptFenceSchema,
  MAX_INDEX_BUILD_ATTEMPT_FENCE,
  decodeIndexBuildBackfillCursorV1,
  decodeIndexBuildCursorCodecVersionV1,
  decodeIndexBuildLifecycleV1,
  type IndexBuildAttemptFence,
  type IndexBuildBackfillCursorV1,
  type IndexBuildLifecycleV1,
} from "../src/index-build-state";
import { decodeOrderedIndexRowIdHexV1 } from "../src/ordered-index";

describe("index build-state protocol", () => {
  it("keeps the accepted lifecycle closed", () => {
    const accepted = [
      "declared",
      "building",
      "backfilling",
      "validating",
      "enabled",
      "retiring",
    ] as const;
    type AcceptedLifecycle = typeof accepted[number];

    for (const lifecycle of accepted) {
      expect(decodeIndexBuildLifecycleV1(lifecycle)).toBe(lifecycle);
    }
    expect(() => decodeIndexBuildLifecycleV1("retired")).toThrow();
    expect(() => decodeIndexBuildLifecycleV1("failed")).toThrow();
    expectTypeOf<AcceptedLifecycle>().toEqualTypeOf<IndexBuildLifecycleV1>();
  });

  it("uses a canonical positive signed-int64 attempt fence", () => {
    const decode = Schema.decodeUnknownSync(IndexBuildAttemptFenceSchema);
    const encode = Schema.encodeSync(IndexBuildAttemptFenceSchema);
    const fence = decode(MAX_INDEX_BUILD_ATTEMPT_FENCE.toString());

    expect(fence).toBe(MAX_INDEX_BUILD_ATTEMPT_FENCE);
    expect(encode(fence)).toBe(MAX_INDEX_BUILD_ATTEMPT_FENCE.toString());
    for (const invalid of [
      "0",
      "01",
      "-1",
      "1.0",
      (MAX_INDEX_BUILD_ATTEMPT_FENCE + 1n).toString(),
      1,
      1n,
    ]) {
      expect(() => decode(invalid)).toThrow();
    }
    expectTypeOf(fence).toEqualTypeOf<IndexBuildAttemptFence>();
  });

  it("pins cursor codec v1 and an exclusive immutable row identity", () => {
    const rowId = decodeOrderedIndexRowIdHexV1("00".repeat(16));
    const cursor = decodeIndexBuildBackfillCursorV1({
      codecVersion: 1,
      afterRowId: rowId,
    });
    const initial = decodeIndexBuildBackfillCursorV1({
      codecVersion: 1,
      afterRowId: null,
    });

    expect(cursor).toEqual({ codecVersion: 1, afterRowId: rowId });
    expect(initial).toEqual({ codecVersion: 1, afterRowId: null });
    expect(Object.isFrozen(cursor)).toBe(true);
    expect(Object.isFrozen(initial)).toBe(true);
    expect(decodeIndexBuildCursorCodecVersionV1(1)).toBe(
      INDEX_BUILD_CURSOR_CODEC_VERSION_V1,
    );
    expectTypeOf(cursor).toEqualTypeOf<IndexBuildBackfillCursorV1>();
  });

  it("rejects malformed or widened cursors", () => {
    const invalid = [
      { codecVersion: 2, afterRowId: null },
      { codecVersion: 1, afterRowId: "00" },
      { codecVersion: 1, afterRowId: "AA".repeat(16) },
      { codecVersion: 1, afterRowId: null, extra: true },
      { afterRowId: null },
      null,
    ];

    for (const value of invalid) {
      expect(() => decodeIndexBuildBackfillCursorV1(value)).toThrow();
    }
  });
});
