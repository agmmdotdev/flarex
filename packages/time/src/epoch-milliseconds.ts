import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { Brand, Data, Result } from "effect";

export const MIN_EPOCH_MILLISECONDS = -8_640_000_000_000_000;
export const MAX_EPOCH_MILLISECONDS = 8_640_000_000_000_000;

export type EpochMilliseconds = Brand.Branded<
  number,
  "FlarexTime/EpochMilliseconds"
>;

export type InvalidEpochMillisecondsReason =
  | "invalidType"
  | "nonFinite"
  | "nonInteger"
  | "nonCanonical"
  | "outOfRange"
  | "invalidDate";

export class InvalidEpochMillisecondsError extends Data.TaggedError(
  "InvalidEpochMillisecondsError",
)<{
  readonly reason: InvalidEpochMillisecondsReason;
}> {}

const brandEpochMilliseconds = Brand.nominal<EpochMilliseconds>();

export function decodeEpochMilliseconds(
  input: unknown,
): Result.Result<EpochMilliseconds, InvalidEpochMillisecondsError> {
  if (typeof input !== "number") {
    return Result.fail(new InvalidEpochMillisecondsError({
      reason: "invalidType",
    }));
  }
  if (!Number.isFinite(input)) {
    return Result.fail(new InvalidEpochMillisecondsError({
      reason: "nonFinite",
    }));
  }
  if (!Number.isInteger(input)) {
    return Result.fail(new InvalidEpochMillisecondsError({
      reason: "nonInteger",
    }));
  }
  if (Object.is(input, -0)) {
    return Result.fail(new InvalidEpochMillisecondsError({
      reason: "nonCanonical",
    }));
  }
  if (input < MIN_EPOCH_MILLISECONDS || input > MAX_EPOCH_MILLISECONDS) {
    return Result.fail(new InvalidEpochMillisecondsError({
      reason: "outOfRange",
    }));
  }
  return Result.succeed(brandEpochMilliseconds(input));
}

export function isEpochMilliseconds(
  input: unknown,
): input is EpochMilliseconds {
  return typeof input === "number" && Number.isFinite(input) &&
    Number.isInteger(input) && !Object.is(input, -0) &&
    input >= MIN_EPOCH_MILLISECONDS &&
    input <= MAX_EPOCH_MILLISECONDS;
}

export function epochMillisecondsFromDate(
  input: unknown,
): Result.Result<EpochMilliseconds, InvalidEpochMillisecondsError> {
  const milliseconds = finiteDateMilliseconds(input);
  return milliseconds === undefined
    ? Result.fail(new InvalidEpochMillisecondsError({ reason: "invalidDate" }))
    : Result.succeed(brandEpochMilliseconds(milliseconds));
}

export function dateFromEpochMilliseconds(input: EpochMilliseconds): Date {
  return new Date(input);
}

export function compareEpochMilliseconds(
  left: EpochMilliseconds,
  right: EpochMilliseconds,
): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}
