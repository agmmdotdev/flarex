import {
  isNonArrayRecord,
  type UnknownRecord,
} from "@flarex/utils/records";
import { Result } from "effect";

export type H05CloudflareSuccessEnvelopeIssue =
  | Readonly<{ readonly reason: "nonObject" }>
  | Readonly<{ readonly reason: "invalidEnvelope" }>
  | Readonly<{ readonly reason: "reportedError" }>
  | Readonly<{ readonly reason: "missingResult" }>;

export interface H05CloudflareSuccessEnvelope {
  readonly record: UnknownRecord;
  readonly result: unknown;
}

export function decodeH05CloudflareSuccessEnvelope(
  value: unknown,
): Result.Result<
  H05CloudflareSuccessEnvelope,
  H05CloudflareSuccessEnvelopeIssue
> {
  if (!isNonArrayRecord(value)) {
    return Result.fail({ reason: "nonObject" });
  }
  if (value.success !== true || !Array.isArray(value.errors)) {
    return Result.fail({ reason: "invalidEnvelope" });
  }
  if (value.errors.length !== 0) {
    return Result.fail({ reason: "reportedError" });
  }
  if (!Object.hasOwn(value, "result")) {
    return Result.fail({ reason: "missingResult" });
  }
  return Result.succeed({
    record: value,
    result: value.result,
  });
}
