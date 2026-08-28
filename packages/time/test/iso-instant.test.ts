import { Result } from "effect";
import { describe, expect, it } from "vitest";

import { decodeEpochMilliseconds } from "@flarex/time/epoch-milliseconds";
import {
  canonicalIsoInstantFromDate,
  canonicalIsoInstantFromEpochMilliseconds,
  decodeCanonicalIsoInstant,
  epochMillisecondsFromCanonicalIsoInstant,
  isCanonicalIsoInstant,
} from "@flarex/time/iso-instant";

describe("canonical ISO instants", () => {
  it.each([
    "2026-08-28T00:00:00.000Z",
    new Date(8_640_000_000_000_000).toISOString(),
    new Date(-8_640_000_000_000_000).toISOString(),
  ])("captures exact ECMAScript spelling %s", value => {
    expect(Result.isSuccess(decodeCanonicalIsoInstant(value))).toBe(true);
    expect(isCanonicalIsoInstant(value)).toBe(true);
  });

  it.each([
    { value: 0, reason: "invalidType" },
    { value: "not-a-date", reason: "invalidSyntaxOrRange" },
    { value: "2026-08-28", reason: "nonCanonical" },
    { value: "2026-08-28T00:00:00Z", reason: "nonCanonical" },
    { value: "2026-08-28T00:00:00.000+00:00", reason: "nonCanonical" },
    { value: "2026-02-30T00:00:00.000Z", reason: "nonCanonical" },
  ] as const)("rejects $value as $reason", ({ value, reason }) => {
    const decoded = decodeCanonicalIsoInstant(value);
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) expect(decoded.failure.reason).toBe(reason);
    expect(isCanonicalIsoInstant(value)).toBe(false);
  });

  it("round-trips epoch milliseconds exactly", () => {
    const epoch = Result.getOrThrow(decodeEpochMilliseconds(1_777_334_400_123));
    const instant = canonicalIsoInstantFromEpochMilliseconds(epoch);
    expect(instant).toBe("2026-04-28T00:00:00.123Z");
    expect(epochMillisecondsFromCanonicalIsoInstant(instant)).toBe(epoch);
  });

  it("formats only genuine finite Dates", () => {
    const valid = canonicalIsoInstantFromDate(new Date(0));
    expect(Result.isSuccess(valid)).toBe(true);
    if (Result.isSuccess(valid)) {
      expect(valid.success).toBe("1970-01-01T00:00:00.000Z");
    }
    expect(Result.isFailure(
      canonicalIsoInstantFromDate(new Date(Number.NaN)),
    )).toBe(true);
  });
});
