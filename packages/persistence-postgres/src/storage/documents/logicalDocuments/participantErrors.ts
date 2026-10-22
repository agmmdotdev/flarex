import { Data } from "effect";


export class LogicalParticipantAdmissionError extends Data.TaggedError("LogicalParticipantAdmissionError")<{
  readonly reason: "invalidInput" | "sourceMismatch" | "notReady" | "bindingMissing" | "invalidAuthority" |
    "unsupportedProfile" | "resourceFailure" | "storedCorruption" | "documentInvalid" | "limitExceeded";
  readonly cause?: unknown;
}> {}


/** The framework adapter classifies only its known native failures. Defects
 * and interruption remain in the Effect Cause, outside this typed channel. */
export class LogicalParticipantInvocationError extends Data.TaggedError("LogicalParticipantInvocationError")<{
  readonly kind: "rejection" | "infrastructure";
  readonly cause: unknown;
}> {}
