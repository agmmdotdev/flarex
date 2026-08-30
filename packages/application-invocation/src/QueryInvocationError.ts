import type { InvokeApplicationQueryError } from
  "@flarex/standard-application-invocation/internal/application-query-system";
import { Data } from "effect";

export type QueryInvocationErrorReason =
  | "invalidInput"
  | "invalidIdentity"
  | "queryNotFound"
  | "applicationUnavailable"
  | "invalidConfiguration"
  | "incompatibleRuntime"
  | "indexUnavailable"
  | "historyUnavailable"
  | "budgetExceeded"
  | "applicationError"
  | "executionFailed"
  | "unavailable"
  | "corruptData"
  | "staleScopeAuthority"
  | "transient"
  | "terminal"
  | "settlementUncertain";

class QueryInvocationFailure extends Data.TaggedError(
  "QueryInvocationError",
)<{
  readonly operation: "runQuery";
  readonly reason: QueryInvocationErrorReason;
  /** Opaque owner failure retained for diagnostics and Cause inspection. */
  readonly cause: unknown;
}> {}

/** Stable clean failure contract for read-only Query invocation. */
export type QueryInvocationError = QueryInvocationFailure;

export function projectQueryInvocationError(
  error: InvokeApplicationQueryError,
): QueryInvocationError {
  if (!("_tag" in error)) {
    return queryInvocationError(projectTransactionFailureReason(error), error);
  }

  switch (error._tag) {
    case "ApplicationQueryInputError":
      return queryInvocationError(projectInputReason(error), error);
    case "ApplicationQueryCompositionError":
      return queryInvocationError(projectCompositionReason(error), error);
    case "ApplicationQuerySnapshotError":
      return queryInvocationError(projectSnapshotReason(error), error);
    case "ApplicationActivationError":
      return queryInvocationError(projectActivationReason(error), error);
    case "ApplicationReadinessError":
      return queryInvocationError(projectReadinessReason(error), error);
    case "ApplicationSchemaAuthorityError":
      return queryInvocationError(projectSchemaAuthorityReason(error), error);
    case "ApplicationTaskCatalogSnapshotError":
      return queryInvocationError(projectTaskCatalogReason(error), error);
    case "TrustedScopeAuthorityResolutionError":
    case "ScopeClockNotFoundError":
    case "ScopeExecutionAuthorityError":
    case "AppUniqueConstraintSetBuildStaleAuthorityV1Error":
      return queryInvocationError("staleScopeAuthority", error);
    case "TrustedScopeAuthorityPortError":
    case "ScopeAuthorizationRevocationEpochPersistenceError":
    case "AppIndexDefinitionReadPersistenceError":
    case "AppSchemaVersionIndexBindingPersistenceError":
    case "AppUniqueConstraintCatalogPersistenceError":
    case "AppUniqueConstraintSetClosurePersistenceV1Error":
    case "PhysicalDefinitionLifecyclePersistenceError":
    case "SchemaVersionArtifactPersistenceError":
      return queryInvocationError("unavailable", error);
    case "ScopeClockCorruptionError":
    case "AppIndexDefinitionCatalogCorruptionError":
    case "AppUniqueConstraintCatalogCorruptionError":
    case "AppUniqueConstraintSetBuildStateV1Error":
    case "AppUniqueConstraintSetClosureCorruptionV1Error":
    case "IndexBuildReconciliationCatalogV1Error":
    case "InvalidAppIndexDefinitionBindingInputError":
    case "InvalidPhysicalDefinitionLifecycleInputError":
    case "InvalidPreparedPhysicalDefinitionLifecycleReadinessError":
    case "InvalidSchemaVersionArtifactInputError":
    case "SchemaVersionArtifactCorruptionError":
      return queryInvocationError("corruptData", error);
    case "AppUniqueConstraintSetBuildIntegrationV1Error":
      return queryInvocationError(
        error.retryable ? "transient" : "unavailable",
        error,
      );
    case "InvalidPhysicalDefinitionLifecyclePortError":
    case "PointCommitUniqueConstraintEligibilityUnavailableV1Error":
      return queryInvocationError("invalidConfiguration", error);
    case "AppUniqueConstraintSetEligibilityV1Error":
      return queryInvocationError(
        projectUniqueConstraintEligibilityReason(error),
        error,
      );
    case "PhysicalDefinitionLifecycleConflictError":
      return queryInvocationError(
        projectPhysicalDefinitionConflictReason(error),
        error,
      );
    case "ApplicationExecutionHostError":
      return queryInvocationError(projectExecutionHostReason(error), error);
    default: {
      const unhandledError: never = error;
      throw new TypeError(
        `Unhandled Query invocation error: ${String(unhandledError)}`,
      );
    }
  }
}

function queryInvocationError(
  reason: QueryInvocationErrorReason,
  cause: unknown,
): QueryInvocationError {
  return new QueryInvocationFailure({ operation: "runQuery", reason, cause });
}

function projectInputReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "ApplicationQueryInputError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidFunction":
    case "invalidArguments":
      return "invalidInput";
    case "invalidIdentity":
      return "invalidIdentity";
  }
}

function projectCompositionReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "ApplicationQueryCompositionError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidExecutionContext":
    case "invalidTarget":
      return "invalidConfiguration";
    case "sourceReadFailed":
    case "workerDefinitionFailed":
      return "unavailable";
  }
}

function projectSnapshotReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "ApplicationQuerySnapshotError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidComposition":
      return "invalidConfiguration";
    case "invalidInput":
      return "invalidInput";
    case "unsupportedTarget":
    case "functionUnsupported":
      return "incompatibleRuntime";
    case "functionMissing":
      return "queryNotFound";
    case "storedFunction":
    case "schemaMismatch":
      return "corruptData";
    case "indexMissing":
    case "indexUnavailable":
      return "indexUnavailable";
    case "historyUnavailable":
      return "historyUnavailable";
    case "budgetExceeded":
      return "budgetExceeded";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectActivationReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "ApplicationActivationError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidInput":
      return "invalidInput";
    case "invalidComposition":
      return "invalidConfiguration";
    case "notReady":
    case "activeMissing":
      return "applicationUnavailable";
    case "alreadyActive":
    case "expectedHead":
    case "concurrentHead":
      return "transient";
    case "scopeAuthority":
      return "staleScopeAuthority";
    case "storedState":
      return "corruptData";
    case "decisionUncertain":
      return "settlementUncertain";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectReadinessReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "ApplicationReadinessError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidInput":
    case "storedState":
    case "schemaBinding":
    case "coldMaterialization":
      return "corruptData";
    case "authorityChanged":
      return "staleScopeAuthority";
    case "conflictingReplay":
      return "transient";
    case "invalidComposition":
      return "invalidConfiguration";
    case "decisionUncertain":
      return "settlementUncertain";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectSchemaAuthorityReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "ApplicationSchemaAuthorityError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidDeployment":
      return "invalidConfiguration";
    case "invalidManifest":
    case "invalidSchema":
    case "projectionMismatch":
      return "corruptData";
    case "resourceFailure":
      return "unavailable";
  }
}

function projectTaskCatalogReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "ApplicationTaskCatalogSnapshotError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidInput":
    case "storedState":
      return "corruptData";
    case "authorityChanged":
      return "staleScopeAuthority";
    case "resourceFailure":
      return error.retryable ? "transient" : "unavailable";
  }
}

function projectUniqueConstraintEligibilityReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "AppUniqueConstraintSetEligibilityV1Error" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidPort":
      return "invalidConfiguration";
    case "scopeMismatch":
      return "staleScopeAuthority";
    case "targetTransaction":
      if (error.retryable) return "transient";
      return isDecisionUncertainTransactionCause(error.cause)
        ? "settlementUncertain"
        : "unavailable";
  }
}

function isDecisionUncertainTransactionCause(cause: unknown): boolean {
  if (
    !(cause instanceof Error) ||
    cause.name !== "LocatedReadCommittedTransactionFailureV1" ||
    !("issue" in cause)
  ) return false;
  const issue = cause.issue;
  return typeof issue === "object" && issue !== null &&
    !Array.isArray(issue) && "kind" in issue &&
    issue.kind === "decisionUncertain";
}

function projectPhysicalDefinitionConflictReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "PhysicalDefinitionLifecycleConflictError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "authorityChanged":
      return "staleScopeAuthority";
    case "expectedFenceMismatch":
    case "requestConflict":
      return "transient";
    case "transitionInvalid":
    case "storedStateInvalid":
      return "corruptData";
  }
}

function projectExecutionHostReason(
  error: Extract<
    InvokeApplicationQueryError,
    { readonly _tag: "ApplicationExecutionHostError" }
  >,
): QueryInvocationErrorReason {
  switch (error.reason) {
    case "invalidRequest":
    case "invalidResult":
      return "corruptData";
    case "workerLoadFailed":
    case "workerDefinitionFailed":
    case "readBoundaryFailed":
    case "journalBoundaryFailed":
      return "unavailable";
    case "callbackFailed":
    case "userCodeFailed":
      return "executionFailed";
    case "applicationError":
      return "applicationError";
    case "terminalFailed":
    case "timedOut":
      return "terminal";
  }
}

function projectTransactionFailureReason(
  error: Exclude<InvokeApplicationQueryError, { readonly _tag: string }>,
): QueryInvocationErrorReason {
  switch (error.issue.kind) {
    case "decisionUncertain":
    case "callbackCleanupFailed":
      return "settlementUncertain";
    case "infrastructureFailure":
    case "callbackRolledBack":
      return "unavailable";
  }
}
