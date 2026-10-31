import { Data } from "effect";

/** The trusted Application insert profile's existing error contract. */
export class ApplicationCommandError extends Data.TaggedError("ApplicationCommandError")<{
  readonly reason: "invalidAuthority" | "invalidInput" | "documentInvalid" | "limitExceeded" | "closed" | "rollbackOnly" | "deadlineExceeded" | "overlappingOperation" | "borrowedSettlement";
  readonly cause?: unknown;
}> {}
export const applicationCommandError = (reason: ApplicationCommandError["reason"], cause?: unknown) =>
  new ApplicationCommandError({ reason, ...(cause === undefined ? {} : { cause }) });
