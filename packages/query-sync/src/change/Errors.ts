import { Data } from "effect";

import type { CaptureInvalidationBatchError } from "../kernel/Model.js";
import type {
  InvalidRefreshEvidenceError,
  QuerySyncAuthorityError,
  QuerySyncWorkLimitError,
} from "../kernel/Errors.js";

export type ChangeSourceLimitDimension =
  | "committedBatches"
  | "sourceTransportBytes"
  | "modelSemanticWorkUnits"
  | "modelSemanticBytes"
  | "dependencyKeyExaminations"
  | "canonicalDependencyBytes";

export type ChangeProjectionLimitDimension = Exclude<
  ChangeSourceLimitDimension,
  "committedBatches" | "sourceTransportBytes"
>;

export type ChangeBudgetShortfallDimension = Exclude<
  ChangeSourceLimitDimension,
  "committedBatches"
>;

export type ChangeProjectionOperation =
  | "projectCommittedBatch"
  | "projectAuthorityObservation";

export class ChangeSourceUnavailableError extends Data.TaggedError(
  "ChangeSourceUnavailableError",
)<{
  readonly operation: "readAfter";
  readonly reason: "temporarilyUnavailable" | "readConflict";
}> {}

export class ChangeSourceCorruptionError extends Data.TaggedError(
  "ChangeSourceCorruptionError",
)<{
  readonly operation: "readAfter" | "admitChangeSourceRead";
  readonly reason:
    | "requestMismatch"
    | "invalidRetentionBoundary"
    | "invalidPagePosition"
    | "nonContiguousPage"
    | "mixedAuthority"
    | "invalidCaughtUpObservation"
    | "invalidTransportMeasurement";
  readonly expectedSequence: bigint | null;
  readonly observedSequence: bigint | null;
}> {}

export class ChangeSourceIncompatibleError extends Data.TaggedError(
  "ChangeSourceIncompatibleError",
)<{
  readonly operation: "readAfter" | "admitChangeSourceRead";
  readonly reason:
    | "namespaceMismatch"
    | "modelMismatch"
    | "invalidBudget"
    | "unsupportedSourceContract";
}> {}

export class ChangeSourceCursorAheadError extends Data.TaggedError(
  "ChangeSourceCursorAheadError",
)<{
  readonly operation: "readAfter" | "admitChangeSourceRead";
  readonly requestedAfterSequenceExclusive: bigint;
  readonly observedLatestSequence: bigint;
}> {}

export class ChangeSourceSequenceExhaustedError extends Data.TaggedError(
  "ChangeSourceSequenceExhaustedError",
)<{
  readonly operation: "readAfter" | "admitChangeSourceRead";
  readonly requestedAfterSequenceExclusive: bigint;
}> {}

export class ChangeSourceLimitError extends Data.TaggedError(
  "ChangeSourceLimitError",
)<{
  readonly operation: "readAfter" | "admitChangeSourceRead";
  readonly dimension: ChangeSourceLimitDimension;
  readonly maximum: number;
  readonly observed: number | null;
}> {}

export class CommittedChangeInvalidError extends Data.TaggedError(
  "CommittedChangeInvalidError",
)<{
  readonly operation: ChangeProjectionOperation;
  readonly reason:
    | "invalidPayload"
    | "invalidAuthorityObservation"
    | "projectionAuthorityMismatch"
    | "invalidProjectionMetrics";
  readonly sourceSequence: bigint;
}> {}

export class ChangeProjectionLimitError extends Data.TaggedError(
  "ChangeProjectionLimitError",
)<{
  readonly operation: ChangeProjectionOperation;
  readonly dimension: ChangeProjectionLimitDimension;
  readonly maximum: number;
  readonly observed: number;
}> {}

export type ChangeSourceReadError =
  | ChangeSourceUnavailableError
  | ChangeSourceCorruptionError
  | ChangeSourceIncompatibleError
  | ChangeSourceCursorAheadError
  | ChangeSourceSequenceExhaustedError
  | ChangeSourceLimitError;

export type ChangeProjectionError =
  | CommittedChangeInvalidError
  | ChangeProjectionLimitError
  | CaptureInvalidationBatchError;

export type AdmittedChangeSourceError =
  | ChangeSourceReadError
  | ChangeProjectionError;

export type RefreshEvidenceAdmissionError =
  | QuerySyncAuthorityError<"admitGenerationRefreshEvidence">
  | InvalidRefreshEvidenceError<"admitGenerationRefreshEvidence">
  | QuerySyncWorkLimitError<"admitGenerationRefreshEvidence">;
