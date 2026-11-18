import { Data } from "effect";
import type { CanonicalFlarexRuntimeValueV1 } from "flarex-protocol/value";

/** Portable execution failures shared by trusted runner adapters and their owner. */
export class PointMutationOccUserCodeV1Error extends Data.TaggedError(
  "PointMutationOccUserCodeV1Error",
)<{
  readonly cause: unknown;
}> {}


export class PointMutationOccApplicationErrorV1 extends Data.TaggedError(
  "PointMutationOccApplicationErrorV1",
)<{
  readonly code: string;
  readonly message: string;
  readonly data?: CanonicalFlarexRuntimeValueV1;
}> {}

export type ApplicationPointMutationRunnerHostV1ErrorReason =
  | "sourceReadFailed"
  | "workerDefinitionFailed"
  | "runtimeHostMismatch"
  | "requestProjectionInvalid"
  | "workerLoadFailed"
  | "readBoundaryFailed"
  | "journalBoundaryFailed"
  | "terminalFailed"
  | "invalidResult"
  | "timedOut";

export class ApplicationPointMutationRunnerHostV1Error extends Data.TaggedError(
  "ApplicationPointMutationRunnerHostV1Error",
)<{
  readonly reason: ApplicationPointMutationRunnerHostV1ErrorReason;
  readonly cause?: unknown;
}> {}
