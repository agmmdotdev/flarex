import { Data } from "effect";

export class ApplicationActiveHeadStateError extends Data.TaggedError(
  "ApplicationActiveHeadStateError",
)<{
  readonly reason: "storedState" | "resourceFailure";
  readonly retryable: boolean;
  readonly revisionId?: string;
  readonly cause?: unknown;
}> {}
