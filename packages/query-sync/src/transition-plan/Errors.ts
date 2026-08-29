import { Data } from "effect";

export type QuerySyncTransitionOperation =
  | "beginQueryEvaluation"
  | "applyAdmittedInvalidations"
  | "completeQueryEvaluation";

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
    | "completionPublicationLifecycleFactsInvalid";
}> {}

export class QuerySyncTransitionResumeDefect extends Data.TaggedError(
  "QuerySyncTransitionResumeDefect",
)<{
  readonly operation:
    | "applyAdmittedInvalidations"
    | "completeQueryEvaluation";
  readonly stage:
    | "affectedTargets"
    | "affectedActiveFacts"
    | "completionReplayFacts"
    | "completionMaterialFacts";
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
