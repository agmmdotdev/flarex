import { Cause, Tracer } from "effect";
import { expect } from "vitest";
import { PreparedMetadataEpochError } from "../../../persistence-postgres/src/preparedMetadataEpoch";

function hasSerializationFailure(value: unknown): boolean {
  const visited = new Set<object>();
  while (typeof value === "object" && value !== null && !visited.has(value)) {
    visited.add(value);
    if ("code" in value && value.code === "40001") return true;
    value = "cause" in value ? value.cause : undefined;
  }
  return false;
}

/** Assert the guard's own Exit, so body/deadline/projection failures cannot
 * satisfy a tail-refusal witness merely by entering the named span. */
export function assertProtectedGuardFailure(span: Tracer.NativeSpan | undefined,
  expected: readonly ("changed" | "busy" | "serialization")[]) {
  if (span === undefined || span.status._tag !== "Ended" || span.status.exit._tag !== "Failure")
    throw new Error("Expected a completed failing protected metadata guard");
  const failures = span.status.exit.cause.reasons.flatMap(reason =>
    Cause.isFailReason(reason) && reason.error instanceof PreparedMetadataEpochError ? [reason.error] : []);
  expect(failures).toHaveLength(1);
  const failure = failures[0];
  if (failure === undefined) throw new Error("Expected the guard's typed epoch failure");
  const classified = failure.reason === "resourceFailure" && hasSerializationFailure(failure.cause)
    ? "serialization" : failure.reason;
  expect(expected).toContain(classified);
}
