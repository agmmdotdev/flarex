import { Data } from "effect";

export type QuerySyncTransitionOperation =
  | "beginQueryEvaluation"
  | "applyAdmittedInvalidations"
  | "completeQueryEvaluation"
  | "claimEvaluationWork"
  | "recordEvaluationAttemptOutcome"
  | "claimPublication"
  | "recordPublicationAttemptOutcome"
  | "completePublication";

export class QuerySyncTransitionFactError extends Data.TaggedError(
  "QuerySyncTransitionFactError",
)<{
  readonly operation: QuerySyncTransitionOperation;
  readonly reason:
    | "queryFactsInvalid"
    | "provisionalFenceMismatch"
    | "affectedTargetsInvalid"
    | "affectedActiveFactsInvalid"
    | "completeQueryFactsInvalid"
    | "completeQueryReplayFactsInvalid"
    | "completeQueryMaterialFactsInvalid"
    | "activeDependenciesInvalid"
    | "completionDependenciesInvalid"
    | "retainedPublicationFactsInvalid"
    | "pendingPublicationFactsInvalid"
    | "completionPublicationLifecycleFactsInvalid"
    | "evaluationScanFactsInvalid"
    | "evaluationSelectedQueryFactsInvalid"
    | "evaluationAttemptOutcomeQueryFactsInvalid"
    | "publicationLifecycleFactsInvalid"
    | "publicationOwnerFactsInvalid"
    | "publicationSelectionFactsInvalid";
}> {}

export class QuerySyncTransitionResumeDefect extends Data.TaggedError(
  "QuerySyncTransitionResumeDefect",
)<{
  readonly operation:
    | "applyAdmittedInvalidations"
    | "completeQueryEvaluation"
    | "claimEvaluationWork"
    | "claimPublication";
  readonly stage:
    | "affectedTargets"
    | "affectedActiveFacts"
    | "completionReplayFacts"
    | "completionMaterialFacts"
    | "evaluationScanFacts"
    | "evaluationSelectedQueryFacts"
    | "publicationInFlightOwnerFacts"
    | "lowestPendingPublicationFacts";
}> {}

export type QuerySyncInitializationPolicyReason =
  | "bootstrapBindingMismatch"
  | "aggregateMissing"
  | "namespaceBindingMismatch";

export class QuerySyncInitializationPolicyError extends Data.TaggedError(
  "QuerySyncInitializationPolicyError",
)<{
  readonly operation: "initializeOrInspectNamespace";
  readonly reason: QuerySyncInitializationPolicyReason;
}> {}
