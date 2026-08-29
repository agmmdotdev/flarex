import { Data } from "effect";

export type QuerySyncTransitionOperation =
  | "beginQueryEvaluation"
  | "applyAdmittedInvalidations"
  | "completeQueryEvaluation"
  | "claimEvaluationWork"
  | "recordEvaluationAttemptOutcome";

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
    | "evaluationAttemptOutcomeQueryFactsInvalid";
}> {}

export class QuerySyncTransitionResumeDefect extends Data.TaggedError(
  "QuerySyncTransitionResumeDefect",
)<{
  readonly operation:
    | "applyAdmittedInvalidations"
    | "completeQueryEvaluation"
    | "claimEvaluationWork";
  readonly stage:
    | "affectedTargets"
    | "affectedActiveFacts"
    | "completionReplayFacts"
    | "completionMaterialFacts"
    | "evaluationScanFacts"
    | "evaluationSelectedQueryFacts";
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
