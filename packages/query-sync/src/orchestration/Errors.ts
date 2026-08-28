import { Data } from "effect";

import type {
  AdmittedChangeSourceError,
  RefreshEvidenceAdmissionError,
} from "../change/Errors.js";
import type {
  ApplyInvalidationsError,
  BeginQueryEvaluationError,
  CompleteQueryEvaluationError,
} from "../kernel/Policy.js";
import type {
  BuildQuerySyncStateError,
  CaptureEvaluationEvidenceError,
  CaptureNamespaceCursorError,
  CaptureQueryDescriptorError,
} from "../kernel/Model.js";
import type {
  ClaimEvaluationWorkError,
  EvaluationAttemptOutcome,
  RecordEvaluationAttemptOutcomeError,
} from "../kernel/EvaluationWork.js";
import type {
  QueryEvaluationWorkBlockedError,
  QuerySyncCanonicalValueError,
} from "../kernel/Errors.js";
import type {
  CanonicalQueryKey,
  QueryGeneration,
} from "../kernel/CanonicalValue.js";
import type {
  QuerySyncStateIntegrationError,
} from "../state/Errors.js";
import type {
  CatchUpTurnBudget,
  NamespaceQuerySyncPolicy,
  QuerySyncTurnOperation,
} from "./Model.js";

export class QueryEvaluatorUnavailableError extends Data.TaggedError(
  "QueryEvaluatorUnavailableError",
)<{
  readonly operation: "evaluate";
  readonly reason: "temporarilyUnavailable";
  readonly cause: unknown;
}> {}

export class QueryEvaluatorTimeoutError extends Data.TaggedError(
  "QueryEvaluatorTimeoutError",
)<{
  readonly operation: "evaluate";
  readonly reason: "settlementTimedOut";
  readonly cause: unknown;
}> {}

export class QueryEvaluatorRefusedError extends Data.TaggedError(
  "QueryEvaluatorRefusedError",
)<{
  readonly operation: "evaluate";
  readonly reason: "terminalRefusal";
  readonly cause: unknown;
}> {}

export type QueryEvaluatorError =
  | QueryEvaluatorUnavailableError
  | QueryEvaluatorTimeoutError
  | QueryEvaluatorRefusedError;

export class InvalidNamespaceQuerySyncPolicyError extends Data.TaggedError(
  "InvalidNamespaceQuerySyncPolicyError",
)<{
  readonly operation: "makeNamespaceQuerySync";
  readonly field: keyof NamespaceQuerySyncPolicy;
  readonly reason: "invalidValue" | "aboveHardMaximum" | "invalidPair";
}> {}

export class InvalidQuerySyncTurnBudgetError extends Data.TaggedError(
  "InvalidQuerySyncTurnBudgetError",
)<{
  readonly operation: QuerySyncTurnOperation;
  readonly field: keyof CatchUpTurnBudget
    | "evaluatedQueries"
    | "evaluatorCallsPerQuery";
  readonly reason:
    | "invalidValue"
    | "aboveHardMaximum"
    | "notGreaterThanSettlementReserve";
  readonly observed: number;
}> {}

export class InvalidQueryEvaluationArtifactError extends Data.TaggedError(
  "InvalidQueryEvaluationArtifactError",
)<{
  readonly operation: "captureQueryEvaluationArtifact";
  readonly reason:
    | "namespaceMismatch"
    | "modelMismatch"
    | "epochMismatch"
    | "queryKeyMismatch"
    | "queryIdentityMismatch"
    | "generationMismatch"
    | "snapshotBeforeRegistration"
    | "snapshotBeforeRequestedDirtyFrontier";
  readonly queryKey: CanonicalQueryKey;
  readonly generation: QueryGeneration;
}> {}

export class EvaluationOutcomeSettlementDeadlineError
  extends Data.TaggedError(
    "EvaluationOutcomeSettlementDeadlineError",
  )<{
    readonly operation: "recordEvaluationAttemptOutcome";
    readonly reason: "settlementWindowElapsed";
    readonly queryKey: CanonicalQueryKey;
    readonly generation: QueryGeneration;
    readonly outcome: EvaluationAttemptOutcome;
  }> {}

export type NamespaceQuerySyncConstructionError =
  | CaptureNamespaceCursorError
  | InvalidNamespaceQuerySyncPolicyError;

export type CatchUpTurnError =
  | InvalidQuerySyncTurnBudgetError
  | BuildQuerySyncStateError
  | ApplyInvalidationsError
  | AdmittedChangeSourceError
  | QuerySyncStateIntegrationError<
    | "initializeOrInspectNamespace"
    | "applyAdmittedBatchAndAdvance"
  >;

export type QueryEvaluationArtifactCaptureError =
  | CaptureEvaluationEvidenceError
  | QuerySyncCanonicalValueError
  | InvalidQueryEvaluationArtifactError;

export type EvaluationPipelineError =
  | CatchUpTurnError
  | QueryEvaluationArtifactCaptureError
  | RefreshEvidenceAdmissionError
  | Exclude<
    CompleteQueryEvaluationError,
    QueryEvaluationWorkBlockedError<"completeQueryEvaluation">
  >
  | QuerySyncStateIntegrationError<"completeQueryEvaluation">
  | RecordEvaluationAttemptOutcomeError
  | QuerySyncStateIntegrationError<"recordEvaluationAttemptOutcome">
  | EvaluationOutcomeSettlementDeadlineError;

export type BeginQueryTurnError =
  | InvalidQuerySyncTurnBudgetError
  | CaptureQueryDescriptorError
  | Exclude<
    BeginQueryEvaluationError,
    QueryEvaluationWorkBlockedError<"beginQueryEvaluation">
  >
  | QuerySyncStateIntegrationError<"beginQueryEvaluation">
  | EvaluationPipelineError;

export type EvaluationWorkTurnError =
  | InvalidQuerySyncTurnBudgetError
  | ClaimEvaluationWorkError
  | QuerySyncStateIntegrationError<"claimEvaluationWork">
  | EvaluationPipelineError;
