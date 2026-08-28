import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  compareEpochMilliseconds,
  dateFromEpochMilliseconds,
  decodeEpochMilliseconds,
  epochMillisecondsFromDate,
  isEpochMilliseconds,
  MAX_EPOCH_MILLISECONDS,
  MIN_EPOCH_MILLISECONDS,
} from "@flarex/time/epoch-milliseconds";

describe("epoch milliseconds", () => {
  it.each([
    MIN_EPOCH_MILLISECONDS,
    -1,
    0,
    1,
    MAX_EPOCH_MILLISECONDS,
  ])("captures representable integer %s", value => {
    const decoded = decodeEpochMilliseconds(value);
    expect(Result.isSuccess(decoded)).toBe(true);
    expect(isEpochMilliseconds(value)).toBe(true);
  });

  it.each([
    { value: "0", reason: "invalidType" },
    { value: Number.NaN, reason: "nonFinite" },
    { value: Number.POSITIVE_INFINITY, reason: "nonFinite" },
    { value: 0.5, reason: "nonInteger" },
    { value: -0, reason: "nonCanonical" },
    { value: MIN_EPOCH_MILLISECONDS - 1, reason: "outOfRange" },
    { value: MAX_EPOCH_MILLISECONDS + 1, reason: "outOfRange" },
  ] as const)("rejects $value as $reason", ({ value, reason }) => {
    const decoded = decodeEpochMilliseconds(value);
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) expect(decoded.failure.reason).toBe(reason);
    expect(isEpochMilliseconds(value)).toBe(false);
  });

  it("snapshots genuine Dates and rejects invalid or proxied Dates", () => {
    const source = new Date(123);
    const captured = epochMillisecondsFromDate(source);
    expect(Result.isSuccess(captured)).toBe(true);
    if (Result.isSuccess(captured)) {
      const copy = dateFromEpochMilliseconds(captured.success);
      expect(copy).toEqual(source);
      expect(copy).not.toBe(source);
    }

    expect(Result.isFailure(
      epochMillisecondsFromDate(new Date(Number.NaN)),
    )).toBe(true);
    expect(Result.isFailure(
      epochMillisecondsFromDate(new Proxy(source, {})),
    )).toBe(true);
  });

  it("compares captured instants without coercion", () => {
    const earlier = Result.getOrThrow(decodeEpochMilliseconds(1));
    const later = Result.getOrThrow(decodeEpochMilliseconds(2));
    expect(compareEpochMilliseconds(earlier, later)).toBe(-1);
    expect(compareEpochMilliseconds(later, earlier)).toBe(1);
    expect(compareEpochMilliseconds(earlier, earlier)).toBe(0);
  });
});
