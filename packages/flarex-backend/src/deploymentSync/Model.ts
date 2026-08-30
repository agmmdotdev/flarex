import { Data } from "effect";

export class ScopeSyncInvalidCommitChangeError extends Data.TaggedError(
  "ScopeSyncInvalidCommitChangeError",
)<{
  readonly operation: "collectInvalidationKeys";
  readonly changeKind: "appRow";
  readonly changeOrdinal: number;
  readonly cause: unknown;
}> {}
