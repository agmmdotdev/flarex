import { Data } from "effect";

export type QuerySyncTransitionOperation =
  | "beginQueryEvaluation"
  | "applyAdmittedInvalidations";

export class QuerySyncTransitionFactError extends Data.TaggedError(
  "QuerySyncTransitionFactError",
)<{
  readonly operation: QuerySyncTransitionOperation;
  readonly reason:
    | "queryFactsInvalid"
    | "provisionalFenceMismatch"
    | "affectedTargetsInvalid"
    | "affectedActiveFactsInvalid";
}> {}

export class QuerySyncTransitionResumeDefect extends Data.TaggedError(
  "QuerySyncTransitionResumeDefect",
)<{
  readonly operation: "applyAdmittedInvalidations";
  readonly stage: "affectedTargets" | "affectedActiveFacts";
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
