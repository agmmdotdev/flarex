import { Brand, Data, Result } from "effect";

import type { EpochMilliseconds } from "./epoch-milliseconds";

const CALENDAR_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export type CalendarDate = Brand.Branded<
  string,
  "FlarexTime/CalendarDate"
>;

export type InvalidCalendarDateReason =
  | "invalidType"
  | "invalidShape"
  | "invalidDate";

export class InvalidCalendarDateError extends Data.TaggedError(
  "InvalidCalendarDateError",
)<{
  readonly reason: InvalidCalendarDateReason;
}> {}

const brandCalendarDate = Brand.nominal<CalendarDate>();
const brandEpochMilliseconds = Brand.nominal<EpochMilliseconds>();

function inspectCalendarDate(value: string): number | undefined {
  if (!CALENDAR_DATE_PATTERN.test(value)) return undefined;
  const milliseconds = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString().slice(0, 10) === value
    ? milliseconds
    : undefined;
}

export function decodeCalendarDate(
  input: unknown,
): Result.Result<CalendarDate, InvalidCalendarDateError> {
  if (typeof input !== "string") {
    return Result.fail(new InvalidCalendarDateError({
      reason: "invalidType",
    }));
  }
  if (!CALENDAR_DATE_PATTERN.test(input)) {
    return Result.fail(new InvalidCalendarDateError({
      reason: "invalidShape",
    }));
  }
  if (inspectCalendarDate(input) === undefined) {
    return Result.fail(new InvalidCalendarDateError({
      reason: "invalidDate",
    }));
  }
  return Result.succeed(brandCalendarDate(input));
}

export function isCanonicalCalendarDate(
  input: unknown,
): input is CalendarDate {
  return typeof input === "string" && inspectCalendarDate(input) !== undefined;
}

export function calendarDateToEpochMilliseconds(
  input: CalendarDate,
): EpochMilliseconds {
  return brandEpochMilliseconds(Date.parse(`${input}T00:00:00.000Z`));
}
