import { finiteDateMilliseconds } from "@flarex/utils/dates";
import { Brand, Data, Result } from "effect";

import type { EpochMilliseconds } from "./epoch-milliseconds";

export type CanonicalIsoInstant = Brand.Branded<
  string,
  "FlarexTime/CanonicalIsoInstant"
>;

export type InvalidCanonicalIsoInstantReason =
  | "invalidType"
  | "invalidSyntaxOrRange"
  | "nonCanonical"
  | "invalidDate";

export class InvalidCanonicalIsoInstantError extends Data.TaggedError(
  "InvalidCanonicalIsoInstantError",
)<{
  readonly reason: InvalidCanonicalIsoInstantReason;
}> {}

const brandCanonicalIsoInstant = Brand.nominal<CanonicalIsoInstant>();
const brandEpochMilliseconds = Brand.nominal<EpochMilliseconds>();

function inspectCanonicalIsoInstant(value: string): number | undefined {
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) &&
      new Date(milliseconds).toISOString() === value
    ? milliseconds
    : undefined;
}

export function decodeCanonicalIsoInstant(
  input: unknown,
): Result.Result<CanonicalIsoInstant, InvalidCanonicalIsoInstantError> {
  if (typeof input !== "string") {
    return Result.fail(new InvalidCanonicalIsoInstantError({
      reason: "invalidType",
    }));
  }
  const milliseconds = Date.parse(input);
  if (!Number.isFinite(milliseconds)) {
    return Result.fail(new InvalidCanonicalIsoInstantError({
      reason: "invalidSyntaxOrRange",
    }));
  }
  if (new Date(milliseconds).toISOString() !== input) {
    return Result.fail(new InvalidCanonicalIsoInstantError({
      reason: "nonCanonical",
    }));
  }
  return Result.succeed(brandCanonicalIsoInstant(input));
}

export function isCanonicalIsoInstant(
  input: unknown,
): input is CanonicalIsoInstant {
  return typeof input === "string" &&
    inspectCanonicalIsoInstant(input) !== undefined;
}

export function canonicalIsoInstantFromEpochMilliseconds(
  input: EpochMilliseconds,
): CanonicalIsoInstant {
  return brandCanonicalIsoInstant(new Date(input).toISOString());
}

export function epochMillisecondsFromCanonicalIsoInstant(
  input: CanonicalIsoInstant,
): EpochMilliseconds {
  return brandEpochMilliseconds(Date.parse(input));
}

export function canonicalIsoInstantFromDate(
  input: unknown,
): Result.Result<CanonicalIsoInstant, InvalidCanonicalIsoInstantError> {
  const milliseconds = finiteDateMilliseconds(input);
  return milliseconds === undefined
    ? Result.fail(new InvalidCanonicalIsoInstantError({
      reason: "invalidDate",
    }))
    : Result.succeed(
      brandCanonicalIsoInstant(new Date(milliseconds).toISOString()),
    );
}
