import { Data } from "effect";

export class AppSchemaCandidateWriteGuardError extends Data.TaggedError(
  "AppSchemaCandidateWriteGuardError",
)<{
  readonly reason:
    | "notIssued"
    | "compositionMismatch"
    | "concurrentStateChange"
    | "corruption"
    | "persistence";
  readonly cause?: unknown;
}> {}
