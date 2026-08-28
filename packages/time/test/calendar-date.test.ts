import { Result } from "effect";
import { describe, expect, it } from "vitest";

import {
  calendarDateToEpochMilliseconds,
  decodeCalendarDate,
  isCanonicalCalendarDate,
} from "@flarex/time/calendar-date";

describe("canonical calendar dates", () => {
  it.each([
    "0000-01-01",
    "2000-02-29",
    "2026-08-28",
    "9999-12-31",
  ])("captures valid four-digit date %s", value => {
    expect(Result.isSuccess(decodeCalendarDate(value))).toBe(true);
    expect(isCanonicalCalendarDate(value)).toBe(true);
  });

  it.each([
    { value: 0, reason: "invalidType" },
    { value: "2026-8-28", reason: "invalidShape" },
    { value: "+010000-01-01", reason: "invalidShape" },
    { value: "2026-02-29", reason: "invalidDate" },
    { value: "2026-02-30", reason: "invalidDate" },
    { value: "2026-13-01", reason: "invalidDate" },
  ] as const)("rejects $value as $reason", ({ value, reason }) => {
    const decoded = decodeCalendarDate(value);
    expect(Result.isFailure(decoded)).toBe(true);
    if (Result.isFailure(decoded)) expect(decoded.failure.reason).toBe(reason);
    expect(isCanonicalCalendarDate(value)).toBe(false);
  });

  it("converts a captured date to UTC midnight", () => {
    const date = Result.getOrThrow(decodeCalendarDate("2026-08-28"));
    expect(calendarDateToEpochMilliseconds(date)).toBe(
      Date.parse("2026-08-28T00:00:00.000Z"),
    );
  });
});
