import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  classifySequence,
  MAX_SYNC_SEQUENCE,
  nextSyncSequence,
  QuerySyncModelMismatchError,
  QuerySyncNamespaceMismatchError,
  QuerySyncSequenceExhaustedError,
} from "@flarex/query-sync/internal/kernel";

import { batch, cursor, getSuccess } from "./fixtures.js";

describe("source sequence policy", () => {
  it("classifies duplicates, exact next values, and forward gaps", () => {
    const current = cursor({ sequence: 7n });

    expect(getSuccess(classifySequence(
      current,
      batch({ sequence: 6n }),
    ))).toMatchObject({ _tag: "duplicate", observedSequence: 6n });
    expect(getSuccess(classifySequence(
      current,
      batch({ sequence: 7n }),
    ))).toMatchObject({ _tag: "duplicate", observedSequence: 7n });
    expect(getSuccess(classifySequence(
      current,
      batch({ sequence: 8n }),
    ))).toEqual({ _tag: "exactNext", nextSequence: 8n });
    expect(getSuccess(classifySequence(
      current,
      batch({ sequence: 10n }),
    ))).toEqual({
      _tag: "gap",
      expectedSequence: 8n,
      observedSequence: 10n,
    });
  });

  it("treats epoch drift as a reset decision without hiding routing errors", () => {
    const current = cursor({ sequence: 7n });
    const reset = getSuccess(classifySequence(
      current,
      batch({ sourceEpoch: "epoch-b", sequence: 1n }),
    ));
    expect(reset).toEqual({
      _tag: "resetRequired",
      expectedSourceEpoch: "epoch-a",
      observedSourceEpoch: "epoch-b",
    });

    const wrongNamespace = classifySequence(
      current,
      batch({ namespaceId: "tenant-b", sequence: 8n }),
    );
    expect(Result.isFailure(wrongNamespace)).toBe(true);
    if (Result.isFailure(wrongNamespace)) {
      expect(wrongNamespace.failure).toBeInstanceOf(
        QuerySyncNamespaceMismatchError,
      );
    }

    const wrongModel = classifySequence(
      current,
      batch({ syncModelId: "graph", sequence: 8n }),
    );
    expect(Result.isFailure(wrongModel)).toBe(true);
    if (Result.isFailure(wrongModel)) {
      expect(wrongModel.failure).toBeInstanceOf(QuerySyncModelMismatchError);
    }
  });

  it("uses zero as an applied baseline and one as the first exact next", () => {
    const initial = cursor();
    expect(getSuccess(classifySequence(
      initial,
      batch({ sequence: 0n }),
    ))._tag).toBe("duplicate");
    expect(getSuccess(classifySequence(
      initial,
      batch({ sequence: 1n }),
    ))).toEqual({ _tag: "exactNext", nextSequence: 1n });
  });

  it("keeps maximum-position duplicates valid and refuses only successor use", () => {
    const beforeMaximum = cursor({ sequence: MAX_SYNC_SEQUENCE - 1n });
    expect(getSuccess(classifySequence(
      beforeMaximum,
      batch({ sequence: MAX_SYNC_SEQUENCE }),
    ))).toEqual({
      _tag: "exactNext",
      nextSequence: MAX_SYNC_SEQUENCE,
    });
    expect(getSuccess(nextSyncSequence(beforeMaximum))).toBe(
      MAX_SYNC_SEQUENCE,
    );

    const maximum = cursor({ sequence: MAX_SYNC_SEQUENCE });
    expect(getSuccess(classifySequence(
      maximum,
      batch({ sequence: MAX_SYNC_SEQUENCE }),
    ))).toEqual({
      _tag: "duplicate",
      observedSequence: MAX_SYNC_SEQUENCE,
    });

    const successor = nextSyncSequence(maximum);
    expect(Result.isFailure(successor)).toBe(true);
    if (Result.isFailure(successor)) {
      expect(successor.failure).toBeInstanceOf(
        QuerySyncSequenceExhaustedError,
      );
      expect(successor.failure).toMatchObject({
        operation: "nextSyncSequence",
        appliedThroughSequence: MAX_SYNC_SEQUENCE,
      });
    }
  });

  it("returns frozen deterministic decisions", () => {
    const current = cursor({ sequence: 4n });
    const first = getSuccess(classifySequence(
      current,
      batch({ sequence: 5n }),
    ));
    const second = getSuccess(classifySequence(
      current,
      batch({ sequence: 5n }),
    ));

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
  });
});
