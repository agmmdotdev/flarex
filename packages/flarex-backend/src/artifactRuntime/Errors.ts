import { Data } from "effect";

export class ExecutionArtifactRuntimeMissingSourcePackageError extends Data.TaggedError(
  "ExecutionArtifactRuntimeMissingSourcePackageError",
)<{
  readonly message: string;
}> {}

export class ExecutionArtifactRuntimeOperationError extends Data.TaggedError(
  "ExecutionArtifactRuntimeOperationError",
)<{
  readonly operation:
    | "normalizeRequest"
    | "loadSourcePackage"
    | "materialize"
    | "invoke"
    | "runtimeFetch";
  readonly status: number;
  readonly message: string;
  readonly cause: unknown;
}> {}
